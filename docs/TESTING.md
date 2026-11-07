# 测试规范（TESTING）

> 测试的**规则**（写什么、不写什么）在 [`../AGENTS.md`](../AGENTS.md)「测试」一节；本文给模式与工具。
> 源码 `0.2.2`｜质量门见 [`CONTRIBUTING.md`](./CONTRIBUTING.md) §3。

---

## 1. 原则

1. **先红后绿**：行为变更先写会失败的回归测试（或先复现），再改实现。
2. **一个回归一个测试**：每个 bugfix 在 PR 里点名它捕获的回归。
3. **不触网、不写 ASC**：所有外部交互走注入的 seam（`spawnFn`、`fetch`、`now`），测试只断言插件行为。
4. **高信号优先**：宁可少而准，不要为每个 action/flag 复制一份矩阵。
5. **失败信息可行动**：断言里写清楚期望与实际的差异，不写 `toBeTruthy()` 糊弄。

---

## 2. 测试布局

| 文件 | 覆盖 |
|---|---|
| `test/classify.test.ts` | 前导全局 flag 归一化、`--` 哨兵、auth/web 禁区、`download`/`export` 文件写叶子、read/write/local-write/unknown |
| `test/approval.test.ts` | policy 矩阵、confirm/审批/豁免、unknown 两条路、**审批前参数校验**（`ASC_INVALID_ARGUMENTS`）、job/engine 闸门 |
| `test/registry.test.ts` | 23 条 action 的 argv、7 组参数守卫、两个放宽（publish ipa 省 version / groups buildId 省 app）、confirm 位置、`--exclude-expired` |
| `test/tools.test.ts` | 5 个工具 `defineTool → execute` 的参数透传与错误（stub runtime/engine，不启真实进程） |
| `test/exec.test.ts` | env 构造、`ASC_READ_ONLY`/`ASC_WEB_SESSION` tombstone、`@` 字面化、redact、超时、截断/spill |
| `test/runtime.test.ts` | `--output` 决策、文件写叶子不追加 `--output`、重试边界、审计 `appId`、forbidden 在 spawn 前拒绝 |
| `test/format.test.ts` | summary / errorClass / hint / projector / `maxDataBytes`（UTF-8 字节）/ `dataOmitted` 文案 |
| `test/jobs.test.ts` | 5 个 job 的步骤顺序、写闸门二次复核、read-only 守卫、dryRun、metadata 二选一、triage 解耦 |
| `test/engine.test.ts` | 定位顺序、相对缓存与子进程 cwd 一致性、版本区间、provision 校验与取消后不覆盖、更新检查缓存 |
| `test/commands.test.ts` | `/asc`、`/asc-doctor` 的渲染与只读性 |
| `test/skills.test.ts` | frontmatter、rank 600、provider list/get、非法目录 |
| `test/audit.test.ts` | 脱敏（独立/内联 flag）、8 KB 按字节、`0o600`、失败不影响调用 |
| `test/harness.test.ts` | 0.2.2-rc.1 真实 Tools/ApprovalService/Skills/Commands，公开批次调度与执行管线；五工具、六技能、两命令；审批拒绝/取消/缺失、listener 绕过、参数替换与并发隔离 |
| `test/matrix-scripts.test.ts` | 已有旧 lib 时重新构建后再认证打包产物；Windows npm CLI 的路径空格与参数元字符保持字面值，不代表原生 Windows 实测 |
| `test/packaging.test.ts` | 隔离无 lib 源码执行真实离线 npm pack；成品包无消费者安装脚本，解包后仅提供宿主 peers 即可加载公开入口、六个技能和 patch |
| `test/scripts.test.ts` | 隔离 checkout 中运行实际下载/验证/overlay 脚本，模拟 Windows/macOS/Linux 路径、损坏下载与显式路径；不启动原生 Windows 引擎 |
| `test/version-notice.test.ts` | 业务 outcome 保持、版本/来源建议、会话与嵌套去重、1s 等待上限、显式版本复用 |
| `test/binary.test.ts` | cwd/PATH/文件指纹快照，避免不同实际引擎混用版本 |
| `test/maintenance.test.ts` | 注入的上游发现、状态恢复/锁、最终 head 门禁，以及临时 bare remote/worktree 的安全快进 |
| `test/maintenance-compatibility.test.ts` | 宿主完整图候选与独立 latest 分离、范围内独立 patch、旧标签不降级、共享实例分裂、实际安装锁与产品 pin 漂移、固定 peer 复验与隔离 npm 执行 |
| `test/maintenance-artifact.test.ts` | 实际签名的合成 npm 字节、无 gitHead 成功路径、摘要/签名/URL/过期 key 拒绝、固定目标和安装锁文件复验、v2/v3 恢复迁移；密钥与网络由夹具提供 |
| `test/discovery.test.ts` | 在临时 checkout 中通过真实 Vitest CLI 验证仅收集本 checkout 的测试，避免混入嵌套 worktree |
| `test/helpers.ts` / `test/compat-helpers.ts` | `makeConfig`、spawn 替身等共用夹具 |

---

## 3. 常用模式

### 3.1 spawn 替身

`exec` 接受注入的 spawn seam；测试不启动真实进程：

```ts
const calls: SubprocessSpawnSpec[] = []
const spawn = (spec: SubprocessSpawnSpec) => {
  calls.push(spec)
  return fakeHandle({ stdout: '{"ok":true}', exitCode: 0 })
}
```

断言 `calls[0].argv`（数组，不是字符串）、`calls[0].env`（不含父进程凭据、`ASC_READ_ONLY` 正确）。

### 3.2 配置夹具

统一用 `makeConfig({ ... })`（`test/helpers.ts`）覆盖默认值；不要在测试里手抄默认值——默认值变化时测试应当自然跟上。

### 3.3 注入时间与网络

- 超时/重试：注入时钟或直接构造 `AscExecOutcome`，不用 `setTimeout` 等待。
- 引擎：`provision({ fetch, signal })` / `latestVersion({ fetch, now })`，用假的 `Response`；篡改校验和的用例必须保留。取消用例覆盖 fetch 前、checksum/binary 下载中、响应 body 读取后，断言原文件不变。

### 3.4 表驱动

重复的 argv/flag 组合放表格里，加一行而不是复制一个 `it`。每个 action 的**独有**行为（路径、flag、confirm 位置）才单独断言。

### 3.5 契约与漂移门

- `scripts/contract.mjs`：23 条注册命令和 5 条 job/discovery 路径检查真实 `asc --help` 中的命令及已声明 flags；负向控制验证门禁能拒绝未知 flag；
- `scripts/contract-combos.mjs`：插件侧负向契约——13 组非法参数组合（含 IPA/MAC_OS）必须被 builder 拒绝、8 组合法组合必须可构造（不需要 asc）；
- `scripts/classify-audit.mjs`：从 `asc completion` 取全部路径，任何"写文件却分类为 read"的叶子都失败；
- `scripts/pack-manifest.mjs`：构建后断言 `lib/` 文件集与 `src/` 一一对应，防止 stale 模块进包。

四者都接在 `npm run verify` 与 CI 上。`test/packaging.test.ts` 通过 `npm test` 进入相同门禁：生产端启用 prepack，从没有 lib 的源码真实离线打包；消费者只解包并提供宿主 peers，不执行安装脚本、不提供编译器，即可加载插件与随包资源。它捕获重新引入 prepare/安装脚本、漏编译、漏打包资源及损坏入口的回归。实际包管理器禁用脚本严格安装由含固定最低的三宿主矩阵补充验证，不等同于真实 Desktop UI 实测。

`vitest.config.ts` 将发现范围限定为当前 checkout 的 `test/**/*.test.ts`，避免根目录运行测试时递归收集 `.claude/worktrees/` 下其他分支的测试。新增测试放在 `test/` 中（允许子目录）。测试发现隔离仅修正开发验证范围，不改变插件行为，无需产品 spec。

---

## 4. 不写什么

| 反模式 | 原因 |
|---|---|
| 复述实现：断言代码里的常量/默认值、或测试自己刚设的字段 | 默认值变了测试也变，没有回归信号 |
| 测标准库/依赖（JSON 往返、`Response` 构造） | 不是本仓库的行为 |
| 只断言 `not null` / `no throw` / 包含某个单词 | 抓不到行为破坏 |
| 为每个 action 复制同样的 happy-path 测试 | 维护成本高、信号弱；加表行 |
| 锁定偶然文本：空白、帮助文案全文、无序输出顺序 | 无意义地脆 |
| 用 `sleep` 等真实超时 | 慢且 flaky |
| 覆盖已有测试已覆盖的同一路径 | 冗余 |

---

## 5. 质量门

```bash
npm run verify               # 完整：typecheck → test → build → pack-manifest → contract-combos → contract → classify-audit → smoke
npm run verify -- --unit-only # 显式仅本地检查，不代表已通过引擎门禁
# 或分开跑
npm run typecheck
npm test                     # spec 012：22 suites / 415 tests，含固定最低及同包矩阵守卫回归
npm run build                # clean + tsc，lib/ 与 src/ 一一对应
node scripts/contract.mjs ./vendor/asc
node scripts/contract-combos.mjs
node scripts/classify-audit.mjs ./vendor/asc
```

CI：Node 22/24 跑 `verify --unit-only`，含真实宿主服务集成与 contract-combos；独立 contract job 在 npm ci 后显式 build（不依赖安装阶段构建），再分别下载 compat SSOT 的 pin 与最低保留版本，校验 SHA-256 后各跑 contract + classify-audit + offline smoke。下载器 `--minimum` 与 `--latest` 互斥。每日 `upstream-watch` 对 asc latest release 执行相同引擎门禁，并严格解析 Harness 默认宿主的兼容候选、保留独立 latest 观察；适用候选漂移或来源/依赖验证失败时自动开 issue。维护脚本测试通过 Vitest 自动进入 `npm test` 和 CI，不需要真实 GitHub。部署验收（Desktop Run now、GitHub ruleset/auto-merge、真实主副本同步）与这些本地模拟测试分别记录。完整 verify 缺少 vendor/asc 时失败，不再静默跳过。

---

## 6. 验证边界与剩余缺口

spec 012 要求固定最低 Harness 0.2.0-rc.2 的严格安装失败先复现，再验证同包三宿主；asc 6.0.0 与 6.5.0 分别跑真实 contract/classify/smoke。注入网络回归须证明 latest 跨线/稳定 patch 不移动最低，缺最低发布物/支持声明会报告缺口，不再要求 0.1.x。每轮维护都覆盖固定最低。本轮 asc 6.0.0 已通过 28 条 contract、1,927 条 completion 路径、11 组 flag 向量和真实 Harness 离线 smoke（6 次调用）；最低宿主 16 个固定产物及独立锁已生成复验，严格安装、typecheck 和真实审批/guard 测试已通过。首轮完整测试暴露 6 条旧版本提示夹具，修正后 81 条针对性测试通过；根目录完整 `npm run verify` 已通过全部八阶段（22 suites / 415 tests），最终 clean build 为 23 个源码生成 69 个 lib 产物并通过 pack-manifest；asc 6.5.0 通过 28 条 contract、1,995 条 completion 路径、11 组 flag 向量及 6 次调用的离线 smoke。最终同包三宿主矩阵已通过：0.2.0-rc.2 / 0.2.1-rc.5 / 0.2.2-rc.1 每组均在安装前复验 16 个固定产物、禁用脚本严格安装同一 tarball，通过 22 suites / 415 tests、五阶段本地门禁及 asc 6.0.0 离线 smoke。证据为 vendor/harness-matrix-5HEn0u/，三个 result.json 的 passed、包 SHA-512、实际锁 SHA-256 均另行核对一致；完整摘要见 spec 012。本轮运行 Node 24.14.0，隔离 npm 仅临时转发网络代理，不改变来源/严格校验；远端 Node22/24 CI、Desktop 端到端试跑、真实 Apple 账号操作和 npm 发布未执行。以下历史记录另行保留。

历史证据：spec 011（2026-11-06，源码 0.2.2）新增预构建成品包回归：从无 lib 状态运行完整八阶段通过，22 suites / 410 tests；同一个 0.2.2 tarball 在 0.2.1-rc.5 与 0.2.2-rc.1 两消费端禁用脚本严格安装，分别复验 16 个固定产物，均通过 410 tests、本地门禁及 asc 6.5.0 离线 smoke。证据在 `vendor/harness-matrix-eYO5Aq/`，两侧包摘要一致。当前机器的网络代理需临时转发给隔离 npm 子进程才能完成依赖解析；校验算法与严格安装参数未改变。此次实际运行 Node 24.14.0，未运行远端 Node22/24 CI，也未操作真实 Desktop profile 或发布 npm；0.2.1 已发布的事实已从官方 registry 核对。历史验证记录保留在下文。

spec 012 将 spec 010 的 `npm run harness:matrix` 扩为三个宿主：`0.2.0-rc.2` / `0.2.1-rc.5` / `0.2.2-rc.1`。读取 test/fixtures/harness-support.json、各宿主固定产物、独立安装锁与当前精确开发锁；三个消费端严格安装同一打包产物，在隔离环境执行真实审批/guard、工具/技能/命令及本地门禁。固定最低必须有环境且被实际运行，新增候选不能替换它；开发宿主仍为 0.2.2-rc.1。生产端先 clean build 当前源码再禁用生命周期脚本打包，避免认证 stale lib。声明的所有保留宿主必须有对应夹具，开发 pin 与最高精确支持项一致；新增支持不能跳过旧环境。实际消费端安装锁、目标、共同 plugin.tgz、锁 SHA-256 和逐宿主结果保存在新建的 `vendor/harness-matrix-*` 目录，临时安装目录仍清理；Node22/24 CI 上传证据，原 required check 名称保留。矩阵、宿主解析与 verify 共用无 shell 的 npm 启动方式；Windows 使用当前 Node 执行 npm CLI。

2026-11-06 源码 0.2.1：用户明确授权人工续跑并实际记录累计第 4 轮。发布列表 HTTP 503 用例改为断言 unknown 且不暴露 harness/support 成功字段，不再锁定偶然错误文本。推荐 pin 更新后的提示回归使用当前 pin，并验证保留的 6.3.0 只收到 upgrade-recommended。新开发宿主 20 suites / 406 tests 和 asc 6.5.0 完整八阶段通过；保留引擎 6.3.0 的 contract / classify-audit / smoke 通过。同一 tarball 的两消费端矩阵也各通过 406 个测试、类型/构建/pack/参数守卫与保留引擎 smoke（两侧均复验 16 个固定产物）；Node22/24/contract 远端检查与本地结果分开。此前 405/406 和审批拒绝仅是 spec 中的历史记录，不代表当前状态。

- 工具单测保留 stub runtime；`test/harness.test.ts` 用真实宿主 dispatch 到 exec seam，`scripts/smoke.mjs` 用真实 subprocess 到实际 6.3.0 引擎。尚未执行真实账号的 Apple 端业务读写验证；
- `contract.mjs` 仍只校验命令/flag 接受性（组合由 `contract-combos.mjs` 在插件侧覆盖，未对上游做值校验）；
- 0.2.0 已关闭 smoke 缺口：真实 Harness subprocess、隔离 HOME/ASC 配置、显式认证 canary 与 tombstone、离线 search/metadata init/validate、拒绝时零 spawn；断言失败非零退出。
- PR 10 评审回归额外覆盖：最终 Git 写入与锁交接互斥、非布尔 exclusiveAccess 拒绝、恢复预算与孤立目标、独立包版本键/v1 迁移、第三轮成功，以及显式版本结果更新后共享探针的等待者与生命周期；
- 没有覆盖率门槛；CI 无 lint；
- engine 探针（version/auth/doctor/diagnose/provision）不写审计（文档已声明例外）；
- `data`/`summary` 未做敏感键深度脱敏（0.1.7）。
