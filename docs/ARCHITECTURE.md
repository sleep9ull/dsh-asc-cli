# 架构（ARCHITECTURE）

> 基线：`0.1.5`｜契约见 [`CONTRACT.md`](./CONTRACT.md)；命令面见 [`COMMANDS.md`](./COMMANDS.md)。
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

| 文件 | 职责 | 关键约束 |
|---|---|---|
| `src/index.ts` | 组合根：注册 policy、工具、skills、commands | 只注入所需服务；可选表面缺失时降级 |
| `src/registry.ts` | **唯一命令表**：23 个 action 的 `kind` / argv 构造 / `needsConfirm` / `output` / `long` | 新增 action 只在这里加一行 |
| `src/classify.ts` | 任意 argv 的分类器（`read`/`write`/`local-write`/`forbidden`/`unknown`） | 保守：不能证明只读即不视为只读 |
| `src/approval.ts` | `tools/pre-execute` 策略：policy 矩阵、审批豁免、结构化拒绝 | policy 的 SSOT |
| `src/runtime.ts` | 执行编排：超时选择、`--output` 决策、projector、审计钩子 | 不直接 spawn，交给 `exec` |
| `src/exec.ts` | **唯一 spawn 点**：argv 数组、env 构造、`@` 字面化、redact、截断/spill | 无 shell；写模式 tombstone `ASC_READ_ONLY` |
| `src/format.ts` | 结果契约：summary / errorClass / hint / projector / `maxDataBytes` | 模型可见形状的唯一来源 |
| `src/audit.ts` | 选开 JSONL：脱敏、`0o600`、best-effort | 失败不影响调用 |
| `src/config.ts` | Schema 与默认值 | 默认值即安全边界 |
| `src/compat.ts` | asc pin / 兼容区间 / release 资源 | 版本事实的 SSOT |
| `src/control/engine.ts` | 引擎管理：locate / diagnose / provision / update check | provision 默认关、校验 SHA-256 |
| `src/capabilities.ts` | 能力卡数据：JOBS / TOOLS / BUNDLED_SKILLS | 与 registry / skills 保持一致 |
| `src/jobs.ts` | 5 个工作流实现 | 嵌套调用走同一 runtime；runner 二次闸门 |
| `src/skills.ts` | 随包 skill 的 provider（rank 600） | 不落用户目录 |
| `src/commands.ts` | `/asc`、`/asc-doctor` | 只读、不产生模型消息 |
| `src/tools/*.ts` | 5 个工具定义（schema、描述、呈现） | 薄；逻辑在 registry/runtime |
| `skills/*/SKILL.md` | 模型知识：何时用哪个 job/tool、失败恢复 | 工具面变更必须同步 |

---

## 3. 一次调用的数据流

```
模型调用工具
  → approval.inspectCall(工具名, 参数)          # 分类 + confirm 事实
  → decideCall()                                # allow / ask / deny
  → 工具 handler
  → runtime.runAction(tool, action) 或 runArgv  # 超时、--output、审计
  → registry spec.build(args)                   # argv 尾部
  → exec.runAsc()                               # globalFlags + literalize + spawn
  → format.fromOutcome()                        # summary / projector / data 闸门
  → audit.record()                              # best-effort
  → 工具 output.render()
```

job 的差别：`asc_job` 一次调用内运行多步，每步都走同一 `runAction`/`runArgv`，因此每一步都重新经过 policy；写 job 在 `runJob` 内再复核 `mode`/`confirm`。

---

## 4. 扩展点

| 要加什么 | 改哪里 | 必须同步 |
|---|---|---|
| 新 action | `src/registry.ts`（`define` 一行）+ 所属工具 schema | 测试（registry）、`docs/COMMANDS.md`、相关 skill、CHANGELOG |
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
| 参数/flag 错 | `usage`（exit 2） | hint: 查 `--help`；`--output` 场景单次重试 |
| 状态冲突 | `state-conflict` | hint: 先查状态再重试 |
| 超时/取消 | `timeout` / `cancelled` | 不自动重试 mutation |
| 输出非 JSON | `parse` | `stderrTail` + 截断标记 |
| 超大 `data` | `dataOmitted`（不落盘） | 缩窄查询 |
| stdout 截断 | `truncated` + `spillPath` | 读 spill 文件 |

错误分类、重试边界与超时策略以 [`CONTRACT.md §3`](./CONTRACT.md#3-安全契约不可变) 与 `src/format.ts` 为准。

---

## 6. 模块与契约的对应

| 契约条目 | 实现位置 |
|---|---|
| policy 矩阵（I1–I3） | `src/approval.ts` + `test/approval.test.ts` |
| `@` 字面化（I4） | `src/exec.ts` + `test/exec.test.ts` |
| 单一执行点与 env（I5） | `src/exec.ts` |
| 工具面（I6） | `src/index.ts` + `src/registry.ts` |
| 知识随包（I7） | `src/skills.ts` + `package.json files` |
| 引擎契约（I8） | `src/compat.ts` + `src/control/engine.ts` + `test/engine.test.ts` |
| 审计（I9） | `src/audit.ts` + `test/audit.test.ts` |
| 禁区（I10） | `src/classify.ts` |
| 结果契约 | `src/format.ts` + `src/tools/common.ts` |
| 版本事实 | `src/compat.ts` + `package.json` |
