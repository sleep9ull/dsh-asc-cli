# AGENTS.md — dsh-asc-cli

`@sleep9ull/dsh-asc-cli` 是 DeepSeek Harness 插件：把 App Store Connect 变成 agent 可安全执行的发布操作层。`asc` CLI 是执行引擎，本仓库是它前面的 policy / 编排 / 知识层。产品契约以 [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md) 为准。

## 先读哪一份

- 改工具面、action、job、审批、schema、配置 → [`docs/PRINCIPLES.md`](docs/PRINCIPLES.md)（§2 能力契约、§3 安全契约、§4 做与不做）。
- 开始任何功能或行为变更 → [`docs/SPEC.md`](docs/SPEC.md)（spec 规范）与 [`docs/specs/000-template.md`](docs/specs/000-template.md)；**先写 spec、对齐后再改代码**（见下「开发流程」）。
- 需要"为什么现在这样"、历史决策、当前缺口 → `docs/ASSESSMENT.md`（本地评估文档，存在则读）；逐条审计状态 → `docs/assessment/03-plugin-audit.md`（同上）。
- 上游命令/flag 的真实行为 → `./vendor/asc <cmd> --help`；机器可读契约 → `scripts/contract.mjs`。

## 不可变原则

1. **只读默认**：read-only 模式下每次调用注入 `--read-only` 与 `ASC_READ_ONLY=1`（write 模式移除两者，tombstone 父进程值）；ASC 写只在 `mode: write` 放行。本地写（`metadata init/plan`、`docs init`、`doctor --fix`、`install-skills`）在两种模式下都要 `confirm`，默认还需宿主审批（`requireApproval: true`）。
2. **写路径三件套**：`mode: write` + `confirm: true` + 宿主审批。模型的自证不算批准；`approvedActions` 只对写模式的 write/unknown 生效。
3. **unknown 不静默**：`unknownCommands` 默认 `ask`、可设 `deny`；read-only 下也走审批。
4. **值字面化**：模型给的参数前导 `@` 转义为 `@@`（含 `--flag=@…`）；`allowValueExpansion` 默认 false。
5. **单一执行点**：只经 `ctx.subprocess` 传 argv 数组，无 shell；只转发 4 个 `ASC_*` 认证变量，凭据不进模型、不落审计。
6. **工具面固定 5 个**：`asc` / `asc_plan` / `asc_apply` / `asc_job` / `asc_setup`。新能力扩展既有工具或 job，不新增命令型工具。
7. **知识随包**：`skills/` 的 6 个 skill 以 rank 600 随包发布；工具名或 action 变更必须在同一提交更新受影响 skill。
8. **引擎外置**：`asc` 二进制不进 npm 包；pin `5.16.0`、区间 `>=5.16.0 <6.0.0`（`src/compat.ts` 是 SSOT）；provision 默认关、校验 SHA-256；永不自动升级。
9. **审计可关**：未配置 `auditLog` 就不写；写入 best-effort，失败不影响调用；内容脱敏、`0o600`、单行 8 KB。
10. **禁区**：`auth login/logout` 与 `asc web` 一律 `forbidden`，配置不得放宽；未识别的交互式命令走 `unknown`（ask/deny），不静默放行。

## 质量门

```bash
npm run typecheck && npm test              # 全绿（0.1.4 基线 144 tests，只增不减）
node scripts/contract.mjs ./vendor/asc     # 23 个注册命令；无 vendor/asc 时说明原因
npm run build
```

测试不触网、不执行任何写 ASC 的操作；CI 另跑 node 22/24 与每日 upstream-watch 契约漂移。

## 开发流程（spec-first）

1. **先对齐 spec**：功能或行为变更，读 `docs/PRINCIPLES.md` §2–§4 → 从 `docs/specs/000-template.md` 复制到 `docs/specs/NNN-<slug>.md`，写清范围、非目标、契约变更、验收标准 → 与用户确认后再改代码。
2. **按 spec 实现**：实现中发现 spec 有问题，先改 spec 并说明，再改代码；代码与 spec 冲突时以 spec 为准。
3. **收口同步**：spec 标 `implemented`；契约变化同步 README / README.zh / CHANGELOG / `skills/` / `PRINCIPLES.md`；PR 描述链接 spec。
4. **可跳过**：typo、格式化、纯文档、无行为变更的测试；PR 里写"无需 spec"及原因。

## 变更纪律

- **破坏性工具面变更**：`feat!` + README / README.zh 迁移表 + CHANGELOG 条目 + skills 同步，一个提交内完成；下一次破坏性变更先保留一个 minor 的 deprecated 别名。
- **新 action**：进 `src/registry.ts`，声明 `kind` / `needsConfirm` / `output`。**新 job**：进 `src/capabilities.ts` 的 `JOBS`，read-only 优先，写 job 必须过 runner 内的二次闸门。
- **新配置项**：默认值落在只读 / 关闭 / 空一侧，补 README 配置表与至少一条测试。
- **零运行时依赖**：宿主 `@deepseek-ai/*` 走 peer，不打包、不引入新的运行时依赖。
- **文档语言**：对外 README / CHANGELOG 英文（README.zh 同步）；`docs/` 设计与契约文档中文；代码注释英文。
- **失真即缺陷**：README 或信息面板承诺的能力必须能被代码或测试证实；发现不一致按缺陷修。
