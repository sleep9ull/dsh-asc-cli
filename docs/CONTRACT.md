# 产品契约（CONTRACT）

> 状态：**契约（SSOT）**｜源码：`0.2.2`（npm 已发布 `0.2.1`）｜更新：2026-11-07
> 常驻规则见 [`../AGENTS.md`](../AGENTS.md)；命令面参考见 [`COMMANDS.md`](./COMMANDS.md)；流程见 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 与 [`SPECS.md`](./SPECS.md)。
> **优先级**：用户指令 > `AGENTS.md` > 本文件 > 其他文档。代码与测试必须服从本文件；发现不一致，走 spec 流程修正，禁止沉默偏离。

---

## 1. 定位

**一句话**：把 App Store Connect 变成 agent 可以安全执行的**发布操作层**——不是命令封装器，也不是 ASC 数据平台。

一个新能力同时满足三条才做：

1. 让"发版 / 合规巡检 / 反馈分诊"更**确定**（顺序、闸门、摘要可预期）；
2. 不扩大模型可触达的**危险面**（写路径、凭据、本地产物）；
3. 上游 `asc` 没有已做好的等价能力；有则薄封装，不重写。

**失败模式**：范围膨胀、契约漂移、安全边界被顺手放宽、文档承诺跑在实现前面。

---

## 2. 范围：做与不做

### 2.1 做

| 阶段 | 范围 |
|---|---|
| 已交付（0.1.2–0.1.6） | 2 个 P0 安全修复、engine manager、5 个 job、6 个内置 skill、`/asc` + `/asc-doctor`、审计、审批豁免、更新检查、`--exclude-expired` 透传、文档契约体系、分类器归一化与本地写门禁、审批前参数校验、clean build/verify |
| 0.2.0 迁移实现 | Harness rc.5 / asc 6.3.0、真实宿主审批收据与最终 guard、动态引擎路径、离线 subprocess smoke、可复现 CI；验收状态见 spec 004 |
| 后续「Prove」 | 契约值校验、结果 projector 补全、错误分类与深度脱敏补全 |
| 之后 | job 幂等与恢复、审计报告化、能力快照、审批记忆、多 app/profile、policy as code、CI 模式 |

完整版本计划与退出条件见 [`ROADMAP.md`](./ROADMAP.md)。

### 2.2 不做（禁区）

| 不做 | 理由 | 复议触发 |
|---|---|---|
| 工具数量竞赛 / typed 覆盖扩张 | 上游 85 组 1,507 叶子，追不完；`discover`/`run` 已兜底 | 上游提供稳定机器可读能力表 |
| ASO 数据平台 | 拼不过专门数据产品 | 不复议 |
| `asc web` / web-session 主路径 | 未公开接口 + ToS/账号风险 | 需要时做默认关闭的独立扩展包 |
| 重写 / fork 官方 skill pack | MIT 可复用，维护权在上游 | 上游停更 |
| 内嵌 `asc` 二进制 | 架构相关、体积、升级脱钩 | 不复议 |
| 精美卡片 / client bundle | 内置 Web 不消费 `presentCall`/`presentResult` | 宿主开始消费卡片 |
| 把主形态改成 MCP server | native plugin 才有 skills/commands/approval | 需同时服务 Claude Code/Cursor/Codex |
| 保管/读取凭据（`.p8`、Apple ID 密码） | 安全叙事的地基 | 不复议 |
| 新增运行时依赖 | 宿主提供 `@deepseek-ai/*` peers；包要薄 | 确有无法内联的必需能力 |

### 2.3 新能力四问（决策树）

1. 是"发版 / 巡检 / 分诊"的确定性步骤吗？否 → 不进插件，长尾走 `asc run`。
2. 能扩展现有 5 工具 / 5 job / 6 skill 吗？能 → 优先扩展；必须改工具面时走 [`CONTRACT §5`](#5-兼容与版本) 的破坏性流程。
3. 会扩大危险面（新写路径、新凭据、新本地写）吗？会 → 必须过 policy 矩阵 + 审批 + 审计 + 测试，并更新本文件。
4. 上游有等价能力吗？有 → 薄封装 + 文档引用，不重写。

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

补充：

- `approvedActions`（glob）只在 **write 模式的 write/unknown** 上跳过审批；read-only、local-write、confirm 要求、forbidden 均不放宽。
- `requireApproval: false` 只关闭审批提示，**不关闭 confirm**；默认 `true`。read-only 下的 `unknown` 始终走审批（I3 优先），不受该项影响。
- 已注册 action/job 的非法参数组合在 confirm/审批**之前**拒绝（拒绝码 `ASC_INVALID_ARGUMENTS`）；校验逻辑与 builder 共用（`registry.validate` / `validateJobArgs`），包括 `publish` 的 `.ipa` + `MAC_OS`。
- 宿主最终 `tools.guard` 复核策略；需审批的调用必须持有实际 `approval.request` 返回的单次批准收据，绑定本次执行 token 与参数，不能由其他 pre-execute listener 的 allow 代替。
- read-only 双防线：插件层拦截 + `asc --read-only` / `ASC_READ_ONLY=1`；write 模式对父进程 `ASC_READ_ONLY` 做 tombstone。

### 3.2 十条不可变原则（I1–I10）

| # | 原则 | 锁定位置 |
|---|---|---|
| I1 | 只读默认；ASC 写只在 `mode: write` 放行 | `src/exec.ts`、`src/approval.ts`、policy 测试 |
| I2 | 写路径三件套：`mode: write` + `confirm: true` + 宿主审批；模型自证不算批准 | `src/approval.ts`、`test/approval.test.ts` |
| I3 | unknown 永不静默：`ask`（默认）或 `deny`；read-only 下也走审批 | `src/approval.ts`、`test/approval.test.ts` |
| I4 | 模型值字面化：可展开值的前导 `@` → `@@`（含 `--flag=@…`）；上游排除展开的 output / root selectors 及 `--` 后负载保持原文；`allowValueExpansion` 默认 false | `literalizeArgv`（`src/exec.ts`） |
| I5 | 单一执行点：`ctx.subprocess` + argv 数组、无 shell；显式转发 4 个 `ASC_*` 认证变量、`ASC_WEB_SESSION` 强制 tombstone；凭据不进模型 | `src/exec.ts` |
| I6 | 工具面固定 5 个；新能力进既有工具或 job，不新增命令型工具 | `src/index.ts`、`src/registry.ts` |
| I7 | 知识随包：6 个 skill 以 rank 600 发布；工具名变更同提交更新 skill | `src/skills.ts`、`package.json files` |
| I8 | 引擎外置：固定最低 `6.0.0` / 推荐 pin `6.5.0` / 区间 `>=6.0.0 <7.0.0`；最低仅由用户明确改变；provision 默认关 + SHA-256；永不自动升级 | `src/compat.ts`、`src/control/engine.ts` |
| I9 | 审计可关：未配置 `auditLog` 即不写；best-effort、脱敏、`0o600`、单行 8 KB | `src/audit.ts` |
| I10 | 禁区：`auth login/logout`、`asc web`、`versions phased-release guard` 一律 `forbidden`；未识别命令走 `unknown` | `src/classify.ts` |

### 3.3 现状边界（有意保留，不是缺陷）

1. **read-only 不是"零本地写"**：`metadata init/plan/pull`、`docs init`、`doctor --fix`、`builds dsyms/compile/package`、`install-skills`、`testflight config export`，以及写文件的 `download`/`export` 叶子（`analytics download`、`profiles download`、`certificates export` 等 9 条）在 read-only 下属于 `local-write`，需 confirm + 审批。
2. **unknown 在 read-only 下始终走 ask/deny**：没有已识别本地写副作用时不需 confirm；带 `--report-file` 仍保持 unknown，并额外要求 confirm。报告副作用不能降低未知命令的策略等级，也不能借 `approvedActions` 跳过默认本地写审批。
3. **长尾 `--output` 不是能力表驱动**：根黑名单 + 文件输出路径跳过 + 已带 flag（含内联值）跳过；仅对确认是新增 output flag 被解析器拒绝的只读调用单次重试，不能因普通 exit 2 重放写操作。
4. **额外本地写需审批**：全局 `--report-file`、`doctor --fix`（含布尔值形态）、`xcode-cloud doctor --save-logs`、`reviews digest --write-state`、`apps registry pull`、`analytics sales`、`notarization log --fetch --path` 不能借 flag 值中的 read 动词绕过门禁。
5. **任意子程序不开放**：`versions phased-release guard` 的 `--dry-run` 仍执行健康检查程序，属于 forbidden。
6. **`output.schema` 是通用 `json`**：契约靠 `AscToolResult` 类型 + 文档，不靠 schema 强校验。

---

## 4. 能力承诺

| 面 | 承诺 |
|---|---|
| 工具 | 固定 5 个：`asc` / `asc_plan` / `asc_apply` / `asc_job` / `asc_setup`（I6） |
| action | 23 条 registry：15 read / 5 write / 3 local-write；参数枚举化 |
| job | 5 个工作流，read-only 优先；写 job 有 runner 内二次闸门 |
| skill | 6 个随包发布，bundled rank 600，用户自装可覆盖 |
| command | `/asc`、`/asc-doctor`，只读、不产生模型消息 |
| 结果 | `AscToolResult` + 10 类错误 + 3 个 projector + `maxDataBytes` |
| 审计 | 选开 JSONL，字段见 [`COMMANDS.md §6`](./COMMANDS.md#6-结果契约) |
| 引擎 | 定位 / 诊断 / 可选 provision / 版本握手 / 使用时版本提示；推荐已验证 pin，latest 未验证时仅告知；更新缓存仅内存 |

逐项参考见 [`COMMANDS.md`](./COMMANDS.md)；模块与数据流见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。

---

## 5. 兼容与版本

- **版本**：`0.x`；工具/action 的破坏性变更用 `feat!`，同一提交内更新：README + README.zh 迁移表、CHANGELOG、受影响 skill、registry/contract。
- **过渡期**：0.1.4 是硬切换。下一次破坏性变更应保留一个 minor 的 deprecated 别名，或在 README 给出逐步迁移路径。
- **质量门**：`npm run verify`（typecheck → test → build → pack-manifest → contract → classify-audit → smoke）；`scripts/pack-manifest.mjs` 断言 `lib/` 与 `src/` 文件集一致。
- **引擎**：`MIN_ASC_VERSION`、推荐 pin 与区间只在 `src/compat.ts` 定义；固定最低 `6.0.0`、已验证推荐 `6.5.0` 和声明支持范围 `>=6.0.0 <7.0.0` 分开，未来版本不称为已实测。历史实际回归覆盖 6.3.0 / 6.5.0；新增 6.0.0 的 contract/classify/smoke 与最终完整验证证据按 spec 012 记录，未执行不能称为通过。`scripts/contract.mjs` 锁定 23 个注册命令与 `--help` 兼容性；CI + 每日 upstream-watch 监测 asc 漂移和 Harness 默认渠道变化，监测不等于完成适配。
- **版本提示**：`checkUpdates` 沿用默认 true，扩展到普通工具和 `/asc`；可选 `versionNotice` 不改变业务结果或审批。远端缓存 24h、失败 15min，均在内存；不读写旧更新缓存文件。false 关闭自动检查和远端查询；显式本地诊断保留。
- **开发维护的 npm 来源**（spec 007）：固定官方 registry 中精确版本/tarball/SHA-512，实际验签和验字节；源码 commit 可为 null。registry 签名不等于源码构建证明，记录字段不代替安装前复验；缺有效签名、摘要不符或来源漂移仍阻塞。新 marker 为 v3，旧 v2 不静默升级，未收口旧目标需显式迁移。
- **宿主**：源码候选 0.2.2 的 `engines.dsh` 扩为 `0.2.0-rc.2 || 0.2.1-rc.5 || 0.2.2-rc.1`，公开 peer 为各精确环境需要的并集，由宿主提供；开发 pin 仍为 dsh-* 0.2.2-rc.1 / Cordis 4.1.0 / Schemastery 3.19.0。保留 0.2.1-rc.5 / Cordis 4.0.5 / Schemastery 3.18.5，最低环境固定 dsh-* 0.2.0-rc.2 / Cordis 4.0.5 / Schemastery 3.18.5，使用独立精确产物及安装锁。三个消费端严格安装同一打包插件，验证类型、真实审批/guard、工具/技能/命令及完整本地门禁；每组产物/锁安装前复验。新增最低环境的实际结果见 spec 012，历史双宿主证据不能代替。开发维护按 spec 008/012 解析完整宿主图，独立 latest 只作观察；产物验签、锁复验、完整集成与旧支持回归仍是新增支持与推进推荐 pin 的前置条件，禁止自动降级、force 或 legacy-peer-deps。
- **固定最低兼容原则**（[spec 012](specs/012-fixed-compatibility-baselines.md)，2026-11-07 用户授权）：Harness 最低 `0.2.0-rc.2`、asc 最低 `6.0.0`；只有用户明确要求才能改变最低要求或移除已有支持。该规则替代 spec 010 的上一稳定线/最新 patch 自动移动策略；正式稳定发布记录只描述事实，不生成移动锚点。官方 npm 没有正式 0.2.0，用户明确选择 rc.2，不能冒称稳定版。持续评估默认渠道每次更新，最新开发升级与固定最低兼容验证分开，不把最低环境当成开发降级。用户兼容声明覆盖实际验证集合，每组宿主图/锁精确固定；所有维护运行都验证固定最低宿主与最低引擎，并保留既有支持和新增候选的同包验证，不以放宽声明代替实测。
- **发布物**（spec 011）：`files` 含 `lib`、`skills`、`cordis.patch.yml`、README/CHANGELOG；`prepack` 执行 clean build + pack-manifest，生产端完成编译与校验。成品包不声明 `prepare` / `preinstall` / `install` / `postinstall`，用户安装本插件无需运行安装脚本；正式入口为 npm 包名及精确已发布版本，或预构建 `.tgz`。GitHub 源码不含 lib，不作为成品包安装入口。其他包的脚本授权不在此承诺内；无 postinstall 下载。

---

## 6. 契约变更规则

1. **I1–I10 不可静默放宽**。放宽必须：在本文件 §8 修订记录登记（日期 / 变更 / 理由 / 版本）→ 同提交更新 `AGENTS.md` 摘要与 README 安全模型 → 加锁定测试。
2. **契约级变更先有 spec**：修改本文件任何条目，先按 [`SPECS.md`](./SPECS.md) 写 spec 并评审。
3. **新增不可变原则**：只有"跨越本插件的安全地基"才升 I 级；一般约定写进 §2/§5。
4. **文档语言**：本文件与 `docs/` 设计文档中文；README/CHANGELOG 英文（README.zh 同步）；代码注释英文。
5. **失真即缺陷**：README、信息面板、文档承诺必须能被代码或测试证实；发现不一致按缺陷处理。
6. **历史可追溯**：删除/改名契约段落时，把历史原因留在本地评估文档 `docs/ASSESSMENT.md`（未纳入仓库）。

---

## 7. 反模式速查

| 症状 | 违反 | 正确做法 |
|---|---|---|
| 「未知命令直接放行，反正上游有 read-only」 | I3 | `unknownCommands: ask` 或 `deny`，人判断 |
| 「默认打开 `@` 展开方便调试」 | I4 | 保持字面化；需要时显式 `allowValueExpansion: true` |
| 「再加一个 `asc_signing` 工具」 | I6 | 扩 action 或做成 job |
| 「把 58 MB 二进制打进 npm 包」 | I8 / 边界 | 外置 + 诊断 + 可选 provision |
| 「审计写失败就报错，更严格」 | I9 | best-effort，调用结果不受影响 |
| 「config 里放私钥省事」 | I5 | 只在宿主环境注入 4 个认证变量 |
| 「README 先写上，功能后面补」 | §6.5 | 承诺必须能被代码/测试证实 |
| 「skill 先不改，模型会适应」 | I7 | 工具面变更同提交重写 skill |

---

## 8. 修订记录

| 日期 | 版本 | 变更 | 理由 |
|---|---|---|---|
| 2026-11-07 | Unreleased | I8 最低 asc 从 6.3.0 调整为用户指定的 6.0.0，推荐 pin 仍为 6.5.0；固定 Harness 最低 0.2.0-rc.2，保留两个已有宿主并扩为三宿主矩阵；替代自动移动稳定线策略 | 用户明确批准 spec 012 并在确认无正式 0.2.0 后选择 rc.2；仅最低版本及兼容保留策略改变，I1–I7/I9–I10、来源/审批/验证门禁不变 |
| 2026-11-06 | Unreleased | 新增长期兼容保留原则、同包双宿主严格验证与精确支持并集；asc pin 推进 6.5.0，最低 6.3.0；没有正式稳定版时保留已验证基线 | 用户明确要求插件 0.2.1 按此适配并更新双上游维护原则，spec 010；I1–I10 不变 |
| 2026-11-05 | Unreleased | 宿主与 peer 精确锁定已验证组合；维护先解析完整宿主依赖/peer 图，独立 latest 只作观察 | 用户要求兼容优先的最新组合与升级前验证，spec 008；I1–I10 不变 |
| 2026-11-05 | Unreleased | 维护层验证 npm 产物 SHA-512 和注册表签名、commit 可缺省、固定目标复验与 v3 恢复记录 | 用户明确批准 spec 007 的方案与实现；仅调整维护来源要求，I1–I10 不变 |
| 2026-11-04 | Unreleased | 使用时版本提示、稳定范围与验证 pin 分离、内存缓存、双上游维护入口 | 用户批准 spec 005/006 的代码实现；I1–I10 不放宽，部署/持久写授权/发布另行验收 |
| 2026-10-24 | 0.1.4 | 初版契约建立 | 0.1.2–0.1.4 收敛后固化边界与路线 |
| 2026-10-24 | 0.1.5 | 拆分重组为 CONTRACT / COMMANDS / ARCHITECTURE / TESTING / CONTRIBUTING / ROADMAP / SPECS，并按上游仓库模式重写 AGENTS.md | 文档与代码对齐，减少单文件 sprawl |
| 2026-10-25 | 0.1.6 | 分类器归一化前导全局 flag（I10）、文件写 `download/export` 改 local-write（I1）、审批前参数校验（I2/I3）；I5 增加 `ASC_WEB_SESSION` tombstone | 修复 0.1.5 评估的 2 个安全 P1 与 2 个写路径 P1；spec 003 |
| 2026-11-03 | 0.2.0 | I8 升至 asc 6.3.0 / 6.x 支持线，宿主 rc.5；I1 本地写 flags、I2 真实批准收据与最终 guard、I10 phased-release guard 禁区；发布 IPA/MAC_OS 审批前拒绝 | 用户要求适配两个上游最新默认发布版本；spec 004，未来 6.x 由漂移门监测 |
| 2026-11-03 | 0.2.0 | PR 评审修复：I4 按可能值位置字面化，I3 报告副作用不降低 unknown 风险；缓存绝对路径、Windows 后缀与 provision 取消 | 用户要求修复全部 P1/P2；spec 004 §7.1 |
