# dsh-asc-cli 核心契约与开发原则

> 状态：**契约（Single Source of Truth）**｜基线：`0.1.4`（commit `235d28c`）｜更新：2026-10-24
> 本文件回答三个问题：**做什么**（核心功能）、**不做什么**（边界与禁区）、**怎么演进**（版本、路线、质量门）。
> 根目录 [`AGENTS.md`](../AGENTS.md) 是它的精悍摘要与入口；两者冲突时以本文件为准。评估依据与逐条证据见 `docs/ASSESSMENT.md`（本地评估文档）。

---

## 0. 怎么用这份文件

- **改代码前**：先读 §2（能力契约）与 §3（安全契约），确认改动落在既有边界内；超出边界先读 §4.3 的决策树。
- **做新功能前**：读 [`SPEC.md`](./SPEC.md) 与模板 [`specs/000-template.md`](./specs/000-template.md)，按 spec-first 流程先写 spec、对齐后再改代码。
- **改契约前**：读 §8。不可变原则不允许静默放宽。
- **写文档/做叙事前**：读 §1 与 §4，避免承诺产品不打算做的东西。
- 本文件是契约，随版本演进；§3 的 I1–I10 是**不可变**部分，§6 的路线是**可变**部分。

---

## 1. 定位

**一句话**：把 App Store Connect 变成 agent 可以安全执行的发布操作层——不是命令封装器，也不是 ASC 数据平台。

判断一个新能力该不该做，用三个条件同时卡：

1. 它让"发版 / 合规巡检 / 反馈分诊"更**确定**（顺序、闸门、摘要可预期）；
2. 它不扩大模型可触达的**危险面**（写路径、凭据、本地产物）；
3. 上游 `asc` 没有已做好的等价能力；有则薄封装，不重写。

### 1.1 三层职责

| 层 | 负责 | 不负责 |
|---|---|---|
| **DSH 宿主** | tools / commands / skills 注册、审批、子进程、spill、LLM、session log | ASC 语义、工作流编排 |
| **本插件** | 意图化工具面、policy 与审批、job 编排、随包知识、引擎管理、审计、结果整形 | 执行 ASC API、保管凭据、替代 `asc` |
| **`asc` 引擎（外置）** | 全部 ASC API 调用、`--read-only` 硬门禁、JSON 输出、自身版本 | 编排、审批、领域知识、产品语义 |

**第 0 条边界（不可变）**：插件永不内嵌 `asc` 二进制，也不通过 shell 调用它。执行只经过 `ctx.subprocess` 的单一 spawn 点，argv 为数组。

---

## 2. 核心功能契约（0.1.4 基线）

### 2.1 工具面：5 个，固定

| 工具 | 职责 | action | 形态 |
|---|---|---|---|
| `asc` | 读 + 逃生舱 | `apps-list` `apps-view` `builds-list` `builds-next-number` `testflight-feedback` `testflight-crashes` `testflight-groups` `reviews-list` `metadata-validate` `discover` `run` | 9 个 typed read + `discover`；`run` 按分类器实时判定 |
| `asc_plan` | 只读计划 | `validate` `status` `metadata-plan` | 2 read + 1 local-write |
| `asc_apply` | 全部变更 | `upload` `groups` `metadata-init` `metadata-apply` `stage` `publish` | 5 write + 1 local-write |
| `asc_job` | 工作流 | 5 个 job（见 §2.3） | read / write 由 job 声明 |
| `asc_setup` | 环境与引擎 | `version` `auth-status` `doctor` `system-status` `install-skills` `diagnose` `provision` | 4 read + 1 local-write + 2 引擎动作 |

**registry 契约**：`src/registry.ts` 是唯一命令表，23 行 = **15 read / 5 write / 3 local-write**。每行声明 `kind` 与 argv 构造（`build`），并按需标注 `needsConfirm` / `output`（该命令是否接受 `--output json`）/ `long`（是否用长超时）。新增能力进既有 action 或 job，**不新增命令型工具**（`asc_job` 是唯一例外，作为"任务级入口"单列）。

> 现状：typed 覆盖 23/1,507 ≈ 1.5%，这是**有意**的——长尾交给 `asc discover` / `asc run`，不要扩张。

### 2.2 为什么是这 5 个

按**意图**而不是上游命令组组织：读（`asc`）/ 计划（`asc_plan`）/ 变更（`asc_apply`）/ 工作流（`asc_job`）/ 环境（`asc_setup`）。同一意图下的命令共享同一套 policy 与文案，模型只需理解 5 个入口而不是 85 个命令组。

### 2.3 jobs：5 个，契约 = 确定性 + 逐步摘要 + 闸门

| job | 风险 | 产物 | 契约 |
|---|---|---|---|
| `release-check` | read | `asc validate` 的阻塞计数 + 有序修复项 | 只读，可自由跑 |
| `ship-testflight` | write | 上传 → 等处理 → 取 build id → 加 TestFlight 组（可选 beta 审核） | 需 `mode: write` + `confirm` + 审批；`dryRun` 先看计划 |
| `stage-release` | write | 校验 → 附 build → 应用 metadata，**不提交** | 同上；publish 是独立动作 |
| `triage-feedback` | read | TestFlight 反馈 + 崩溃 + 评论聚合 | 只读 |
| `compliance-sweep` | read | 年龄分级 / 加密声明 / 可访问性 / current pricing 四项探测 | 只读；单项失败只报告，不致命 |

**闸门与守卫**：job 的嵌套调用走同一 runtime（`runAction` / `runArgv`），因此每一步都受 policy 约束；read-only job 额外有"嵌套命令必须被分类器证明为只读"的守卫，写 job 的写步骤在构造时显式 `confirm: true`，`runJob` 再复核外层 mode/confirm 闸门，不依赖外层调用者。

### 2.4 skills：6 个，随包发布

`dsh-asc-quickstart` · `dsh-asc-auth` · `dsh-asc-release-readiness` · `dsh-asc-testflight-ship` · `dsh-asc-feedback-triage` · `dsh-asc-compliance-sweep`

- 以 `ctx.skills.registerProvider()` 注册，rank **600**（bundled，最低优先级）；用户自装官方 25 skill pack（rank 500）或项目 skill 同名自动覆盖。
- `package.json` 的 `files` 包含 `skills`；不写 `~/.dsh/skills`，不要求 `asc install-skills`。
- **契约**：skill 里提到的工具名 / action / 配置项必须与 `src/` 一致；工具面变更时同提交重写受影响 skill。

### 2.5 commands：2 个，人直接用的只读入口

| command | 内容 | 约束 |
|---|---|---|
| `/asc` | 能力卡：engine 状态、认证、默认 app、5 个 job、下一步 | 只读；不产生模型消息 |
| `/asc-doctor` | 完整体检：二进制与来源、版本 vs 区间、认证、默认 app、provision、上游更新 | 只读；`validateAuth` + `checkUpdates` |

命令 handler **只读**；任何变更一律回到工具 + 审批。

### 2.6 engine 契约

| 环节 | 规则 |
|---|---|
| 定位顺序 | `ascPath` → `ASC_CLI_PATH` → 插件缓存 → `PATH`（`src/control/engine.ts`） |
| 版本 | pin **`5.16.0`**，测试区间 **`>=5.16.0 <6.0.0`**（`src/compat.ts` 是 SSOT）；漂移只警告，不阻断只读 |
| provision | **默认关闭**（`allowProvision: false`）；下载 pin 版本，按平台选 release asset，校验 SHA-256，缓存到 `cacheDir`；永不静默安装 |
| 更新检查 | `checkUpdates` 默认 true；GitHub latest，24h 缓存，失败静默；只展示建议，永不自动升级 |
| 结果可路由 | job 结果带 `ascVersion`；结果本身尚无 `environment` / `profile` 路由字段（v0.2 补） |

### 2.7 结果契约

`AscToolResult`：`{ ok, exitCode, command, durationMs, summary, errorClass?, hint?, data?, dataOmitted?, dataBytes?, text?, stderrTail?, truncated?, spillPath?, timedOut?, aborted? }`

- **错误分类**（10 类）：`auth` `state-conflict` `rate-limit` `usage` `missing-binary` `network` `timeout` `cancelled` `parse` `unknown`，每类配一条可执行 hint。
- **裁剪**：`maxDataBytes`（默认 8,000）超限时省略 `data` 并给 `dataOmitted` + `dataBytes`；`maxOutputBytes`（默认 256 KB）字节截断后提供 `spillPath`。
- **projector**：`validate` / `status` / `metadata` 三个响应有专用摘要（readiness / dashboard / metadata counters）。
- 已知缺口（进 v0.2）：`output.schema` 仍是通用 `json`（未类型化）；`search` / `system-status` 无 projector；超限 `data` 是丢弃而非"投影 + spill"。

### 2.8 审计契约

`auditLog` 配置后才写入；每条 invocation 一行 JSONL：`ts, tool, action, kind, argv, cwd, mode, confirm, ok, exitCode, durationMs, errorClass, appId`。

- 写入 best-effort：路径不可写**不得**把成功调用变成失败；`0o600`；单行 8 KB 上限。
- 脱敏：凭据形态 flag 的值结构化替换；`data` / `command` 仍可能含敏感内容（v0.2 修）。
- 审计记录"执行了什么"，**不记录**审批 allow/deny（后者在宿主 session log）。

### 2.9 配置契约

`mode`（read-only）、`requireApproval`（true）、`ascPath`、`profile`、`defaultAppId`、`timeoutMs`（60s）、`longTimeoutMs`（30min）、`maxOutputBytes`、`maxDataBytes`、`workdir`、`allowValueExpansion`（false）、`unknownCommands`（ask）、`allowProvision`（false）、`cacheDir`、`auditLog`、`approvedActions`（[]）、`checkUpdates`（true）、`bypassKeychain`（false）、`telemetryDisabled`（true）、`env`。

**默认值即安全边界**：任何新配置项的默认值必须落在"只读 / 关闭 / 空"一侧。

---

## 3. 安全契约（不可变）

### 3.1 policy 矩阵（`src/approval.ts` 是 SSOT）

| kind | read-only 模式 | write 模式 |
|---|---|---|
| `read` | allow | allow |
| `local-write` | **confirm + 审批** | **confirm + 审批** |
| `write` | deny | confirm + 审批 |
| `unknown` | **ask**（`unknownCommands: deny` 时拒绝） | **confirm + 审批** |
| `forbidden` | deny | deny |

补充规则：

- `approvedActions`（glob）只在 **write 模式的 write/unknown** 上跳过审批；read-only、local-write、confirm 要求、forbidden 列表均不放宽。
- `requireApproval: false` 只关闭"审批提示"，**不关闭 confirm**：本地写仍需 `confirm: true`，只是不再弹审批（默认 `requireApproval: true` 时两者都要）。read-only 下本地写允许执行 + confirm + 审批，这是有意的"现状边界"（见 §3.3）。
- read-only 是**双防线**：插件层拦截 + `asc --read-only` / `ASC_READ_ONLY=1`。write 模式对父进程 `ASC_READ_ONLY` 做 tombstone。

### 3.2 十条不可变原则（I1–I10）

| # | 原则 | 锁定方式 |
|---|---|---|
| **I1** | 只读默认：每次调用注入 `--read-only` + `ASC_READ_ONLY=1`；ASC 写只在 `mode: write` 放行 | `src/exec.ts`、`src/approval.ts`；policy 矩阵测试 |
| **I2** | 写路径三件套：`mode: write` + `confirm: true` + 宿主审批；模型的自证不算批准 | `src/approval.ts`；`test/approval.test.ts` |
| **I3** | unknown 永不静默：`ask`（默认）或 `deny`；read-only 下也走审批 | `unknownCommands` + `test/approval.test.ts` |
| **I4** | 值字面化：模型值的前导 `@` 转义为 `@@`（含 `--flag=@…`）；`allowValueExpansion` 默认 false | `literalizeArgv`（`src/exec.ts`） |
| **I5** | 单一执行点：`ctx.subprocess` + argv 数组、无 shell；只转发 4 个 `ASC_*` 认证变量，凭据不进模型 | `src/exec.ts` 的 `FORWARDED_AUTH_ENV` |
| **I6** | 工具面固定 5 个；新能力进既有工具或 job，不新增命令型工具 | `src/index.ts`、`src/registry.ts` |
| **I7** | 知识随包：6 个 skill 以 rank 600 发布；工具名变更同提交更新 skill | `src/skills.ts`、`package.json files` |
| **I8** | 引擎外置：pin `5.16.0` / 区间 `>=5.16.0 <6.0.0`；provision 默认关 + SHA-256；永不自动升级 | `src/compat.ts`、`src/control/engine.ts` |
| **I9** | 审计可关：未配置即无写入；best-effort、脱敏、`0o600` | `src/audit.ts` |
| **I10** | 禁区：`auth login/logout` 与 `asc web` 一律 `forbidden`，配置不得放宽；未识别的交互式/长尾命令走 `unknown`（ask/deny），不静默放行 | `src/classify.ts` 的 `auth` / `web` 分支 |

### 3.3 现状边界（已知、有意保留，不是缺陷）

写下这些是为了让后来者不要"顺手修掉"而破坏兼容：

1. **read-only 不是"零本地写"**：`metadata init/plan`、`docs init`、`doctor --fix`、`builds dsyms/compile/package`、`install-skills` 在 read-only 下仍可执行——但必须 confirm + 审批。
2. **unknown 在 read-only 下只需审批、不需 confirm**：`asc --read-only` 已在 HTTP 层拦截 ASC 写，剩下要防的是本地写，所以由人判断。
3. **长尾读命令可能需要一次失败重试**：`--output json` 不是能力表驱动，而是"根黑名单 + 已带 flag 跳过 + exit 2 单次重试"。
4. **`output.schema` 是通用 `json`**：契约靠 `AscToolResult` 类型 + 文档，不靠 schema 强校验。

---

## 4. 做与不做

### 4.1 做（当前范围）

- **已交付（0.1.2–0.1.4）**：安全补丁（2 个 P0）、engine manager、5 jobs、6 skills、`/asc` + `/asc-doctor`、审计、审批豁免、更新检查。
- **下一阶段（v0.2「Prove」）**：补证据——契约值/组合测试、builder 参数守卫、工具端到端测试、smoke 断言、search/system-status projector、错误分类补全、redaction 补 `data`/`command`。
- **再往后**：job 幂等与失败恢复、审计报告化、能力快照（离线可用）、审批记忆（scope/expiresAt）、多 app/profile 路由、policy as code、CI 模式。

### 4.2 不做（禁区）

| 不做 | 理由 | 复议触发 |
|---|---|---|
| 工具数量竞赛 / typed 覆盖率扩张 | 上游 85 组 1,507 叶子，追不完；`discover`/`run` 已兜底 | 上游提供机器可读能力表且稳定 |
| ASO 数据平台 | 拼不过 Appfigures/AppTweak 的数据 | 不复议 |
| `asc web` / web-session 主路径 | 未公开接口 + ToS/账号风险 | 需要时做默认关闭的独立扩展包 |
| 重写 / fork 官方 25 skill pack | MIT 可复用，维护权在上游 | 上游停更 |
| 内嵌 `asc` 二进制 | 架构相关、体积、升级脱钩 | 不复议 |
| 精美卡片 / client bundle | 内置 Web 不消费 `presentCall`/`presentResult` | 宿主开始消费卡片 |
| 把主形态改成 MCP server | native plugin 才有 skills/commands/approval | 需要同时服务 Claude Code/Cursor/Codex |
| 保管/读取凭据（`.p8`、Apple ID 密码） | 安全叙事的地基 | 不复议 |
| 新增运行时依赖 | 宿主提供 `@deepseek-ai/*` peers；包要保持薄 | 确有无法内联的必需能力 |

### 4.3 决策树（新能力先过这四问）

1. **是不是"发版 / 巡检 / 分诊"的确定性步骤？** 否 → 不进插件，长尾走 `asc run`。
2. **能不能扩展现有 5 工具 / 5 job / 6 skill？** 能 → 优先扩展；必须改工具面时按 §5 走 breaking 流程。
3. **会不会扩大危险面（新写路径、新凭据、新本地写）？** 会 → 必须过 policy 矩阵 + 审批 + 审计 + 测试，并更新 §3。
4. **上游有没有等价能力？** 有 → 薄封装 + 文档引用，不重写。

---

## 5. 兼容与版本契约

- **版本**：`0.x` 阶段；工具/action 的破坏性变更用 `feat!`，并在同一提交内提供：README + README.zh 迁移表、CHANGELOG 条目、受影响 skill 重写、registry/contract 更新。
- **过渡期**：0.1.4 是硬切换（旧 7 个工具直接删除）。**下一次**破坏性变更应保留一个 minor 的 deprecated 别名，或在 README 显著位置给出逐步迁移路径。
- **引擎契约**：pin 与区间只在 `src/compat.ts` 定义；`scripts/contract.mjs` 锁定 23 个注册命令与 `--help` 兼容性；CI 与每日 upstream-watch 兜底（漂移自动开 issue）。
- **宿主契约**：`engines.dsh` 为 `>=0.2.1-rc.2 <0.3.0`；peer 依赖由宿主提供，不打包。
- **发布物**：`files` 必须包含 `lib`、`skills`、`cordis.patch.yml`、README/CHANGELOG；`prepack`/`prepare` 构建 `lib`；不做 postinstall 下载。

---

## 6. 开发路线（可变部分）

> 论证与逐条工作项见 `docs/ASSESSMENT.md` §6（本地评估文档）；本节只保留契约级的版本主题与退出条件。

| 版本 | 主题 | 核心工作 | 退出条件 |
|---|---|---|---|
| **0.1.2–0.1.4** | Fix → Know → Consolidate | 2 个 P0、engine manager、5 jobs、6 skills、2 commands、审计、工具面收敛 | ✅ 已完成（144 tests / contract 23/23） |
| **v0.2.0「Prove」** | 补证据 | 契约值/组合测试、P2-1..5 参数守卫、工具端到端测试、smoke 断言、search/system-status projector、错误分类与脱敏补全 | 新测试全绿；contract 覆盖 flag 值/组合；工具覆盖率门槛入 CI |
| **v0.3.0「Orchestrate」** | 让 job 可重放 | job 幂等与失败恢复、审计报告化 + 审批结果关联、能力快照、审批记忆 | 重跑不产生重复副作用；审计可按 app/时间聚合 |
| **v0.4.0「Govern」** | 让团队敢用 | 多 app/profile 路由、policy as code、不可逆操作影响面、CI 模式（`--report junit`）、跨 app 看板 | 团队场景可审计、可策略化；CI 确定性退出码 |
| **v1.0「Platform」** | 稳定契约 | 公开兼容矩阵、contract 覆盖 100%、文档站、与官方 skill pack 协作声明、上游 DSH 集成 | 契约可被第三方依赖 |

**止损条件**：上游官方发布覆盖 skills + 审批的 DSH 集成 → 转型为"工作流剧本包"或归档；v0.2 发布 3 个月后无真实用户反馈（≥10 个信号）→ 停止加功能转维护。

---

## 7. 质量门与验收

每次改动的最低验证：

```bash
npm run typecheck
npm test                          # 全绿（0.1.4 基线：144 tests / 11 文件）
node scripts/contract.mjs ./vendor/asc   # 23 个注册命令；需 vendor/asc
npm run build
```

CI：node 22/24 的 typecheck + test + build；独立 contract job；每日 `upstream-watch` 在漂移时自动开 issue。

**评审视角的验收指标**（详见 ASSESSMENT §6 验收表）：首次成功 < 3 分钟；发版任务成功率 > 90%；每任务审批 ≤ 2 次；token 下降 ≥ 30%；上游漂移致败 < 1%；未知/被拒命令可恢复率 > 80%。

当前质量缺口（v0.2 关闭）：无 `src/tools/*` 端到端测试；contract 不校验值与组合；smoke 无断言；无覆盖率门槛；CI 无 lint。

---

## 8. 本契约的修改规则

1. **I1–I10 不可静默放宽**。任何放宽必须：在 §8.1 追加一条记录（日期 / 变更 / 理由 / 影响版本）→ 同一提交更新 `AGENTS.md` 摘要与 README 安全模型 → 加一条锁定新行为的测试。
2. **新增不可变原则**：只有"跨越本插件的安全地基"才升级为 I 级；一般约定写进 §4/§5。
3. **删除/改名**：契约段落可随版本重写，但不得让历史决策失去依据——历史原因留在 `docs/ASSESSMENT.md` 与 `03-plugin-audit.md`。
4. **文档语言**：本文件与 `docs/` 设计文档用中文；对外 README/CHANGELOG 用英文（README.zh 同步）；代码注释用英文。
5. **失真即缺陷**：README/信息面板承诺的能力必须能被代码或测试证实；发现不一致按 P2 缺陷处理（如当前 README 的 "never adds `--confirm`" 与实现不符）。
6. **契约级变更先有 spec**：修改本文件或 §2/§3 的任何条目，必须先按 [`SPEC.md`](./SPEC.md) 写 spec 并评审；spec 与本节冲突时以本节为准。

### 8.1 修订记录

| 日期 | 版本 | 变更 | 理由 |
|---|---|---|---|
| 2026-10-24 | 0.1.4 | 初版契约建立 | 0.1.2–0.1.4 收敛后固化边界与路线 |

---

## 9. 反模式速查

| 症状 | 违反 | 正确做法 |
|---|---|---|
| 「未知命令直接放行，反正上游有 read-only」 | I3 | `unknownCommands: ask`（或 deny），人来做判断 |
| 「为了方便默认打开 `@` 展开」 | I4 | 保持字面化；需要展开时由用户显式 `allowValueExpansion: true` |
| 「再加一个 `asc_signing` 工具」 | I6 | 扩 `asc`/`asc_apply` 的 action，或做成 job |
| 「把 58 MB 二进制打进 npm 包，省事」 | I8 / 第 0 条边界 | 外置 + 诊断 + 可选 provision |
| 「审计写失败就报错吧，更严格」 | I9 | best-effort，调用结果不受影响 |
| 「在 config 里放私钥，省得配环境」 | I5 | 只在宿主环境注入 4 个认证变量 |
| 「README 先写上，功能后面补」 | §8 第 5 条 | 承诺必须能被代码/测试证实 |
| 「契约测试只看命令名就够了」 | §5 | 值/组合/枚举必须进 contract（v0.2） |
| 「skill 先不改，模型自己会适应」 | I7 | 工具面变更同提交重写 skill |
