# AGENTS.md — dsh-asc-cli

`@sleep9ull/dsh-asc-cli` 是 DeepSeek Harness 插件：把 App Store Connect 变成 agent 可安全执行的发布操作层。`asc` CLI 是执行引擎，本仓库是它前面的 policy / 编排 / 知识层。

## 文档地图（动手前先读）

- 契约、范围、安全不变式 → [`docs/CONTRACT.md`](docs/CONTRACT.md)
- 工具 / action / job / skill / command / 配置 / 结果 → [`docs/COMMANDS.md`](docs/COMMANDS.md)
- 模块地图、数据流、扩展点 → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- 测试规则与模式 → [`docs/TESTING.md`](docs/TESTING.md)
- spec 流程、Git 流程、质量门、发布 → [`docs/SPECS.md`](docs/SPECS.md)、[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md)
- 版本计划 → [`docs/ROADMAP.md`](docs/ROADMAP.md)
- 本地评估（未纳入仓库，存在则读）→ `docs/ASSESSMENT.md`、`docs/assessment/03-plugin-audit.md`

文档是缓存，不是事实源：与代码/测试冲突时以代码为准，并按 spec 流程修正文档。

## 权限与执行边界

- 审计、评审、调研、状态检查、起草文本是**只读**。编辑、提交、push、建 PR、评论、label、合并、发布是**写操作**，需要请求或会话上下文的授权；一个请求可以授权多个动作，不要重复确认。
- 用户指令优先于本文件与所有 docs；不要用文档对抗明确指令。
- 默认分支 `main` 只通过 PR 变更：不直接推 `main`、不 `--no-verify`、不为过门弱化 CI。
- 非共享历史不改写（rebase / force-push / squash 仅在用户明确要求时使用）。
- 合并、发布、删除远程资源只在被授权时执行；合并前必须确认 checks 与可合并状态。
- 只就材料性的范围、兼容性或权限缺口提问；其余按仓库约定自行决定。

## 核心插件契约

完整矩阵与理由见 [`docs/CONTRACT.md`](docs/CONTRACT.md) §3；以下是每轮都要生效的硬约束：

1. **只读默认**：read-only 模式注入 `--read-only` + `ASC_READ_ONLY=1`；ASC 写只在 `mode: write` 放行。本地写（含 `download`/`export` 文件写）在两种模式都要 `confirm`，默认还需审批。
2. **写路径三件套**：`mode: write` + `confirm: true` + 宿主审批；模型自证不算批准；`approvedActions` 只放松写模式的 write/unknown。
3. **unknown 不静默**：`unknownCommands` 默认 `ask`，可 `deny`；read-only 下也走审批。
4. **值字面化**：模型值前导 `@` → `@@`（含 `--flag=@…`）；`allowValueExpansion` 默认 false。
5. **单一执行点**：只经 `ctx.subprocess` 传 argv 数组，无 shell；显式转发 4 个 `ASC_*` 认证变量并 tombstone `ASC_WEB_SESSION`；凭据不进模型、不落审计。
6. **工具面固定 5 个**：`asc` / `asc_plan` / `asc_apply` / `asc_job` / `asc_setup`；新能力扩 action 或 job，不新增命令型工具。
7. **知识随包**：6 个 skill 以 rank 600 发布；工具名/action 变更必须同提交更新受影响 skill。
7.1 **审批前校验**：已注册 action/job 的非法参数组合在 confirm/审批前拒绝（`ASC_INVALID_ARGUMENTS`）；守卫与 builder 共用同一校验。
8. **引擎外置**：`asc` 不进 npm 包；pin `5.16.0`、区间 `>=5.16.0 <6.0.0`（`src/compat.ts` 是 SSOT）；provision 默认关、校验 SHA-256；永不自动升级。
9. **审计可关**：未配 `auditLog` 不写；best-effort、脱敏、`0o600`、单行 8 KB。
10. **禁区**：`auth login/logout` 与 `asc web` 一律 `forbidden`；未识别命令走 `unknown`。

新配置项的默认值必须落在只读 / 关闭 / 空一侧。README、能力卡、skill 的承诺必须能被代码或测试证实。

## 发现当前行为（Discovery）

不要依赖记忆中的命令形状。动手前：

```bash
./vendor/asc <command> --help          # 上游权威行为
sed -n '1,80p' src/registry.ts         # action → kind / argv 构造
npm test                               # 当前契约的断言（208 tests）
node scripts/contract.mjs ./vendor/asc # 23 条注册命令 vs 上游
```

action 的具体行为以 `src/registry.ts`、工具 schema、`src/approval.ts` 为准；引擎版本事实只在 `src/compat.ts`；`docs/COMMANDS.md` 是这些代码的缓存。

## 开发流程（spec-first）

1. **对齐**：读 `CONTRACT.md` §2–§4 与相关历史 spec，确认需求落在哪一层；列出受影响契约面。
2. **写 spec**：从 [`docs/specs/000-template.md`](docs/specs/000-template.md) 复制到 `docs/specs/NNN-<slug>.md`，写清范围、非目标、契约变更、验收标准；与用户确认后再改代码。
3. **实现**：先红后绿；spec 有误先改 spec 再改代码；代码与 spec 冲突时以 spec 为准。
4. **收口**：spec 标 `implemented`；按 [`CONTRIBUTING.md`](docs/CONTRIBUTING.md) §4 文档同步矩阵更新；PR 链接 spec。

可跳过 spec：typo、格式化、纯文档、无行为变更的测试（PR 写明"无需 spec"）。

## 实现不变式

- `src/registry.ts` 是唯一命令表（`kind` / `needsConfirm` / `output` / `long`）；工具层保持薄。
- policy 只在 `src/approval.ts`；spawn 只在 `src/exec.ts`；结果形状只在 `src/format.ts`；版本事实只在 `src/compat.ts`。
- 不绕过 runtime 直接拼 argv；不在工具 handler 里做 policy 判断。
- 零运行时依赖（`@deepseek-ai/*` 走 peer）；不内嵌 `asc` 二进制。
- 新增模块/扩展点先更新 `docs/ARCHITECTURE.md`。

## 测试

- 只写"用户或调用方依赖的行为被破坏时会失败"的测试；每个 bugfix 先写红测试。
- 不写复述实现（常量、默认值、自己设的字段）、只断言非空、锁定偶然文本、复制矩阵的测试。
- 不触网、不写 ASC；用注入的 `spawn` / `fetch` / `now`；不用 `sleep`。
- 每个 PR 为新增测试点名它捕获的回归。模式见 [`docs/TESTING.md`](docs/TESTING.md)。

## 构建与验证

```bash
npm run verify                             # 一键：typecheck/test/build/pack-manifest/contract/classify-audit/smoke
# 或分开跑
npm run typecheck
npm test                                   # 基线 208 tests 起只增不减
npm run build                              # clean + tsc，lib/ 与 src/ 一一对应
node scripts/contract.mjs ./vendor/asc     # 需要 vendor/asc
node scripts/contract-combos.mjs           # 插件侧非法组合必须被拒
node scripts/classify-audit.mjs ./vendor/asc  # completion 漂移门
```

CI 跑 node 22/24 的 typecheck + test + build，外加独立 contract job 与每日 upstream-watch。改了命令面还要同步 `docs/COMMANDS.md`、相关 skill 与 README（若用户可见）。

## Git 与交付

- 从 `main` 拉分支，一个逻辑变更一个分支/提交；提交信息用 `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`，破坏性用 `feat!`。
- PR 需要：spec 链接、checks 全绿、文档同步完成、无密钥/大文件。
- 合并策略按请求：默认普通 merge commit，用户明确要求时才 squash。
- 交付报告写清：结果、决定性证据、未验证项、下一步。

## 参考

- 契约：[`docs/CONTRACT.md`](docs/CONTRACT.md)
- 命令面：[`docs/COMMANDS.md`](docs/COMMANDS.md)
- 架构：[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- 测试：[`docs/TESTING.md`](docs/TESTING.md)
- 流程：[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) · spec：[`docs/SPECS.md`](docs/SPECS.md)
- 路线：[`docs/ROADMAP.md`](docs/ROADMAP.md)
