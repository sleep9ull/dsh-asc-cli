# 架构（ARCHITECTURE）

> 基线：`0.2.0`｜契约见 [`CONTRACT.md`](./CONTRACT.md)；命令面见 [`COMMANDS.md`](./COMMANDS.md)。
> 本文回答：代码怎么分层、一次调用经过哪些模块、在哪里加东西、失败如何收口。

---

## 1. 三层职责

```
┌──────────────────────────────────────────────────────────────┐
│ DSH 宿主：tools / commands / skills 注册、审批、子进程、      │
│           spill、LLM、session log                             │
├──────────────────────────────────────────────────────────────┤
│ 本插件：意图化工具面、policy、job 编排、随包知识、            │
│         引擎管理、审计、结果整形                              │
├──────────────────────────────────────────────────────────────┤
│ asc 引擎（外置）：全部 ASC API 调用、--read-only 硬门禁、      │
│                   JSON 输出、自身版本                          │
└──────────────────────────────────────────────────────────────┘
```

**第 0 条边界**：插件永不内嵌 `asc`，也不通过 shell 调用；执行只经过 `ctx.subprocess` 的单一 spawn 点，argv 为数组。

---

## 2. 模块地图

spec 005/006 已于 2026-11-04 获准实施：新增 `scripts/maintenance/` 属于开发维护层，负责上游发现、git common dir 中的互斥/恢复状态、PR 证据与指定 checkout 的保守快进同步，不进入 npm 插件运行路径。维护 skill 位于 `.claude/skills/upstream-maintenance/`，不改变六个发布 skill。部署与运行授权独立于代码实现。发现脚本借助 Node 22.19+/24 的原生类型擦除直接导入 `src/compat.ts` 的上游仓库与 `releaseAsset`，无需 build 或复制平台映射。`state.withLockOwner` 以 ownership.guard 包住所有权检查与最终写操作，锁交接也使用同一 guard。目标 v2 键包含相关包独立版本；恢复时保留修复预算，未知历史先阻塞。

spec 007 将 Harness 维护来源改为固定 npm 发布物：新增 `scripts/maintenance/npm-artifact.mjs`，集中处理官方 registry URL/记录校验、ECDSA 注册表验签、有界 tarball SHA-512 校验及固定目标/lockfile 再验证；`discovery.mjs` 负责版本选择，`state.mjs` 共用记录形状校验。新 PR marker 为 v3，旧 v2 仍参与恢复和去重，未收口旧目标需要显式迁移。产物验签不证明源码构建来源，缺失的源码 commit 记录 null；该开发模块不进入 npm 插件包。

spec 008 新增 `scripts/maintenance/compatibility.mjs`：用隔离配置的 npm package-lock-only / strict-peer-deps 解析精确宿主的完整依赖图，校核相关共享组件唯一性与固定产物身份；临时目录仅作解析且不执行包代码。discovery 选择该图中的相关包，独立 latest 只作 observations；watch 共用候选比较，不把 observations 当安装目标。npm 解析可满足不等于实测兼容，基线推进仍需完整验证和 PR。

开发层 `scripts/npm-command.mjs` 统一 npm argv：Windows 通过当前 Node 执行 npm CLI，Unix 保留 npm 可执行入口，不使用 shell；三宿主矩阵与维护宿主图解析共用。矩阵在生产端 clean build 后打包，实际消费端锁、目标、共同 tarball 与结果持久保存到新建的 vendor 证据目录，CI 上传该目录，临时安装目录仍清理。

spec 012 将 spec 010 的开发层入口 `scripts/harness-matrix.mjs` 扩为三宿主：固定最低 0.2.0-rc.2、保留 0.2.1-rc.5、开发 0.2.2-rc.1。读取各宿主固定目标、独立锁与开发锁，在隔离 HOME/npm 配置/cache 的临时 checkout 中复验产物再严格安装同一 tarball，从安装包加载插件并验证真实审批/guard、工具/技能/命令。兼容层只按实际公开 API 差异调整，生产插件缺少写路径宿主能力仍拒绝。`scripts/maintenance/compatibility.mjs` 导出 `MIN_HARNESS_VERSION`（0.2.0-rc.2），`src/compat.ts` 导出 `MIN_ASC_VERSION`（6.0.0）；最低仅由用户明确改变。discovery 的 support.minimum 报告固定最低，正式稳定发布记录仅描述事实，不自动移动锚点。公开 engines/peer 精确并集、开发 pin、已验证推荐与实际矩阵证据分开，每轮维护验证最低宿主/引擎。固定候选身份、v3 key、锁/恢复与来源规则不变。矩阵不进入 npm 发布包、不改真实 profile；新增最低环境的实际结果按 spec 012 记录。

版本提示由 `src/control/version-notice.ts` 协调：engine 提供同一执行快照下的版本事实和有界内存缓存，compat 提供版本判断，format 定义及渲染可选 `versionNotice`。runtime 绑定实际执行快照，顶层工具/命令统一装饰结果，job 内部不重复提示。取消等待者不取消共享检查；插件卸载清理检查。查询不再读写磁盘更新缓存。

| 文件 | 职责 | 关键约束 |
|---|---|---|
| `src/index.ts` | 组合根：注册 policy、工具、skills、commands | 只注入所需服务；可选表面缺失时降级 |
| `src/registry.ts` | **唯一命令表**：23 个 action 的 `kind` / argv 构造 / `needsConfirm` / `output` / `long` | 新增 action 只在这里加一行 |
| `src/classify.ts` | 任意 argv 的分类器、独立报告文件副作用、已知无歧义布尔 flag | 保守：报告不降低 unknown 风险；类型不明时字面化覆盖两种解析 |
| `src/approval.ts` | policy 矩阵、审批豁免、真实批准收据、pre-execute 与最终 guard | policy 的 SSOT；收据绑定单次执行与参数 |
| `src/runtime.ts` | 执行编排：超时选择、`--output` 决策、projector、审计钩子 | 不直接 spawn，交给 `exec` |
| `src/exec.ts` | **唯一 spawn 点**：argv 数组、env 构造、`@` 字面化、redact、截断/spill | 无 shell；写模式 tombstone `ASC_READ_ONLY` |
| `src/format.ts` | 结果契约：summary / errorClass / hint / projector / `maxDataBytes`（UTF-8 字节） | 模型可见形状的唯一来源 |
| `src/audit.ts` | 选开 JSONL：脱敏、`0o600`、best-effort | 失败不影响调用 |
| `src/config.ts` | Schema 与默认值 | 默认值即安全边界 |
| `src/compat.ts` | asc 固定最低 / 推荐 pin / 兼容区间 / release 资源 | 引擎版本事实 SSOT；最低仅用户明确改变 |
| `src/control/binary.ts` | engine/runtime 共用的动态二进制与缓存路径解析 | 缓存解析为宿主侧绝对路径，诊断、普通工具、job 使用同一路径；provision 后重新解析 |
| `src/control/engine.ts` | 引擎管理：locate / diagnose / provision / update check；本地和远端内存缓存 | provision 默认关、校验 SHA-256；共享检查有 deadline，单个等待者取消不污染其他调用 |
| `src/control/version-notice.ts` | 来源相关的提示与顶层调用协调、会话去重 | 审批后启动、最多额外等待 1s，不改业务 outcome；无缓存文件 |
| `src/capabilities.ts` | 能力卡数据：JOBS / TOOLS / BUNDLED_SKILLS | 与 registry / skills 保持一致 |
| `src/jobs.ts` | 5 个工作流实现 | 嵌套调用走同一 runtime；runner 二次闸门 |
| `src/skills.ts` | 随包 skill 的 provider（rank 600） | 不落用户目录 |
| `src/commands.ts` | `/asc`、`/asc-doctor` | 只读、不产生模型消息 |
| `src/tools/*.ts` | 5 个工具定义（schema、描述、呈现） | 薄；逻辑在 registry/runtime |
| `skills/*/SKILL.md` | 模型知识：何时用哪个 job/tool、失败恢复 | 工具面变更必须同步 |
| `scripts/vendor-path.mjs` | 开发脚本的 vendor 引擎路径 | 下载、verify、contract、audit、smoke、overlay 共用平台后缀 |

---

## 3. 一次调用的数据流

```
模型调用工具
  → approval.inspectCall(工具名, 参数, config)   # 分类 + confirm 事实 + 参数校验
  → decideCall()                                # invalid / allow / ask / deny
  → approval.request()                         # ask 需真实 allowed-once，生成本次调用收据
  → tools.guard                                # 最终复核 deny/confirm/收据，防 listener 绕过
  → 工具 handler
  → runtime.runAction(tool, action) 或 runArgv  # 超时、--output、审计
  → registry spec.build(args)                   # validate → argv 尾部
  → exec.execAsc()                              # globalFlags + literalize + spawn
  → format.formatResult()                       # summary / projector / data 闸门
  → audit.record()                              # best-effort
  → 工具 output.render()
```

job 的差别：`asc_job` 一次调用内运行多步，每步都走同一 `runAction`/`runArgv`（超时、`--output`、审计），但**不会**重新经过宿主 `tools/pre-execute`；审批只在外层工具调用发生一次。`runJob` 在 runner 内再复核 `mode`/`confirm`，`runReadOnlyArgv` 对只读探针再跑一次分类器。

---

## 4. 扩展点

| 要加什么 | 改哪里 | 必须同步 |
|---|---|---|
| 新 action | `src/registry.ts`（`define` 一行，含 `validate` 守卫）+ 所属工具 schema | 测试（registry + `test/tools.test.ts`）、`docs/COMMANDS.md`、`scripts/contract-combos.mjs`、相关 skill、CHANGELOG |
| 新 job | `src/capabilities.ts` 的 `JOBS` + `src/jobs.ts` 实现 | 测试（jobs）、能力卡、对应 skill、`docs/COMMANDS.md` |
| 新 skill | `skills/<name>/SKILL.md` + `capabilities.BUNDLED_SKILLS` | `test/skills.test.ts`、`docs/COMMANDS.md` |
| 新 command | `src/commands.ts` | `test/commands.test.ts`、`docs/COMMANDS.md` |
| 新配置项 | `src/config.ts` | 默认值安全侧、`docs/COMMANDS.md` 配置表、测试 |
| 新宿主能力 | `src/index.ts` 的可选注册 | 缺失时必须降级为 no-op |

**禁止**：绕过 registry 直接拼 argv；在工具层直接 spawn；把 policy 判断写进工具 handler。

---

## 5. 失败与收口

| 失败 | 结果 | 模型可见 |
|---|---|---|
| 二进制缺失 | `errorClass: missing-binary` | hint: `brew install asc` / `ascPath` / provision |
| 认证失败 | `auth` | hint: `asc auth status --validate` |
| 参数/flag 错 | `usage`（exit 2） | hint: 查 `--help`；仅只读且明确拒绝 output flag 时单次重试 |
| 状态冲突 | `state-conflict` | hint: 先查状态再重试 |
| 超时/取消 | `timeout` / `cancelled` | 不自动重试 mutation |
| 输出非 JSON | `parse` | `stderrTail` + 截断标记 |
| 超大 `data` | `dataOmitted`（不落盘） | 缩窄查询；不产生 `spillPath` |
| stdout 截断 | `truncated` + `spillPath` | 读 spill 文件 |
| 限流 | `rate-limit` | 等待后重试，避免大页 `--paginate` |
| 网络/Apple 5xx | `network` | 查 `asc system-status` 后重试 |
| 其他 | `unknown` | 看 `stderrTail` |

完整 10 类 `errorClass` 见 [`COMMANDS.md §6`](./COMMANDS.md#6-结果契约)；错误分类、重试边界与超时策略以 [`CONTRACT.md §3`](./CONTRACT.md#3-安全契约不可变) 与 `src/format.ts` 为准。

---

## 6. 模块与契约的对应

| 契约条目 | 实现位置 |
|---|---|
| policy 矩阵（I1–I3） | `src/approval.ts` + `test/approval.test.ts` |
| 参数守卫（审批前拒绝） | `src/registry.ts` 的 `validate` + `src/jobs.ts` 的 `validateJobArgs` + `test/registry.test.ts` |
| `@` 字面化（I4） | `src/exec.ts` + `test/exec.test.ts` |
| 单一执行点与 env（I5） | `src/exec.ts` |
| 工具面（I6） | `src/index.ts` + `src/registry.ts` |
| 知识随包（I7） | `src/skills.ts` + `package.json files` |
| 引擎契约（I8） | `src/compat.ts` + `src/control/engine.ts` + `test/engine.test.ts` |
| 审计（I9） | `src/audit.ts` + `test/audit.test.ts` |
| 禁区（I10） | `src/classify.ts` |
| 结果契约 | `src/format.ts` + `src/tools/common.ts` |
| 版本事实 | `src/compat.ts` + `package.json` |
