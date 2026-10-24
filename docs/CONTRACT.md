# 产品契约（CONTRACT）

> 状态：**契约（SSOT）**｜基线：`0.1.5`｜更新：2026-10-24
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
| 已交付（0.1.2–0.1.5） | 2 个 P0 安全修复、engine manager、5 个 job、6 个内置 skill、`/asc` + `/asc-doctor`、审计、审批豁免、更新检查、`--exclude-expired` 透传、文档契约体系 |
| v0.2「Prove」 | 契约值/组合测试、参数守卫、工具端到端测试、smoke 断言、结果 projector 补全、错误分类与脱敏补全 |
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
- `requireApproval: false` 只关闭审批提示，**不关闭 confirm**；默认 `true`。
- read-only 双防线：插件层拦截 + `asc --read-only` / `ASC_READ_ONLY=1`；write 模式对父进程 `ASC_READ_ONLY` 做 tombstone。

### 3.2 十条不可变原则（I1–I10）

| # | 原则 | 锁定位置 |
|---|---|---|
| I1 | 只读默认；ASC 写只在 `mode: write` 放行 | `src/exec.ts`、`src/approval.ts`、policy 测试 |
| I2 | 写路径三件套：`mode: write` + `confirm: true` + 宿主审批；模型自证不算批准 | `src/approval.ts`、`test/approval.test.ts` |
| I3 | unknown 永不静默：`ask`（默认）或 `deny`；read-only 下也走审批 | `src/approval.ts`、`test/approval.test.ts` |
| I4 | 模型值字面化：前导 `@` → `@@`（含 `--flag=@…`）；`allowValueExpansion` 默认 false | `literalizeArgv`（`src/exec.ts`） |
| I5 | 单一执行点：`ctx.subprocess` + argv 数组、无 shell；只转发 4 个 `ASC_*` 认证变量；凭据不进模型 | `src/exec.ts` |
| I6 | 工具面固定 5 个；新能力进既有工具或 job，不新增命令型工具 | `src/index.ts`、`src/registry.ts` |
| I7 | 知识随包：6 个 skill 以 rank 600 发布；工具名变更同提交更新 skill | `src/skills.ts`、`package.json files` |
| I8 | 引擎外置：pin `5.16.0` / 区间 `>=5.16.0 <6.0.0`；provision 默认关 + SHA-256；永不自动升级 | `src/compat.ts`、`src/control/engine.ts` |
| I9 | 审计可关：未配置 `auditLog` 即不写；best-effort、脱敏、`0o600`、单行 8 KB | `src/audit.ts` |
| I10 | 禁区：`auth login/logout` 与 `asc web` 一律 `forbidden`；未识别命令走 `unknown` | `src/classify.ts` |

### 3.3 现状边界（有意保留，不是缺陷）

1. **read-only 不是"零本地写"**：`metadata init/plan`、`docs init`、`doctor --fix`、`builds dsyms/compile/package`、`install-skills` 在 read-only 下仍可执行，但需 confirm + 审批。
2. **unknown 在 read-only 下只需审批、不需 confirm**：`asc --read-only` 已在 HTTP 层拦截写，剩下要防的是本地写。
3. **长尾 `--output` 不是能力表驱动**：根黑名单 + 已带 flag 跳过 + exit 2 单次重试。
4. **`output.schema` 是通用 `json`**：契约靠 `AscToolResult` 类型 + 文档，不靠 schema 强校验。

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
| 引擎 | 定位 / 诊断 / 可选 provision / 版本握手 / 更新建议 |

逐项参考见 [`COMMANDS.md`](./COMMANDS.md)；模块与数据流见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。

---

## 5. 兼容与版本

- **版本**：`0.x`；工具/action 的破坏性变更用 `feat!`，同一提交内更新：README + README.zh 迁移表、CHANGELOG、受影响 skill、registry/contract。
- **过渡期**：0.1.4 是硬切换。下一次破坏性变更应保留一个 minor 的 deprecated 别名，或在 README 给出逐步迁移路径。
- **引擎**：pin 与区间只在 `src/compat.ts` 定义；`scripts/contract.mjs` 锁定 23 个注册命令与 `--help` 兼容性；CI + 每日 upstream-watch 兜底。
- **宿主**：`engines.dsh` = `>=0.2.1-rc.2 <0.3.0`；peer 依赖由宿主提供。
- **发布物**：`files` 含 `lib`、`skills`、`cordis.patch.yml`、README/CHANGELOG；`prepack`/`prepare` 构建；无 postinstall 下载。

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
| 2026-10-24 | 0.1.4 | 初版契约建立 | 0.1.2–0.1.4 收敛后固化边界与路线 |
| 2026-10-24 | 0.1.5 | 拆分重组为 CONTRACT / COMMANDS / ARCHITECTURE / TESTING / CONTRIBUTING / ROADMAP / SPECS，并按上游仓库模式重写 AGENTS.md | 文档与代码对齐，减少单文件 sprawl |
