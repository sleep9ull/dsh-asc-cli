# 路线图（ROADMAP）

> 契约级的范围见 [`CONTRACT.md`](./CONTRACT.md) §2；本文是**可变**的版本计划与退出条件。
> 基线：`0.1.5`｜更新：2026-10-24

---

## 0. 已交付

| 版本 | 主题 | 内容 |
|---|---|---|
| 0.1.2 | Fix | 2 个 P0（unknown 强审批、`@` 字面化）；local-write confirm + 审批；`stage --platform`；env 认证转发；`ASC_READ_ONLY` tombstone；`presentResult` 退出码。tests 62 → 85 |
| 0.1.3 | Know & Do | engine manager（locate/diagnose/provision/版本握手/更新检查）；`/asc` + `/asc-doctor`；`asc_job` 四工作流；6 个内置 skill；三 projector + `maxDataBytes`。tests 85 → 132 |
| 0.1.4 | Consolidate | 工具面 9 → 5（`feat!`）；`compliance-sweep`；`auditLog`；`approvedActions`；`checkUpdates`；只读分类扩充。tests → 144 |
| 0.1.5 | Contract & Docs | 文档契约体系（CONTRACT / COMMANDS / ARCHITECTURE / TESTING / CONTRIBUTING / ROADMAP / SPECS）；`--exclude-expired` 透传；README/skill 失真修正；spec-first 流程。tests → 145 |

---

## 1. v0.2.0「Prove」—— 补证据

**主题**：让"它可靠"可验证，而不是加功能。

| 工作项 | 退出条件 |
|---|---|
| 契约升级：`contract.mjs` 覆盖 `--output`/dryRun/枚举值/组合，pin 上游版本 | 值/组合错误能在 CI 挂掉，而非生产 exit 2 |
| 参数守卫（P2-1..5）：`groups` dryRun+submit、`stage` 元数据二选一、`publish` ipa/pkg、`upload --pkg` 版本+构建号、`testflight groups` internal/external 互斥 | 已批准的调用不再用法报错 |
| 工具端到端：每个工具至少 1 条 `defineTool → registry → exec` 测试 | `src/tools/*` 覆盖；覆盖率门槛入 CI |
| smoke 断言：退出码 + 关键输出；使用真实 scrubbed env | 回归能被发现 |
| 结果补齐：`search`/`system-status` projector；超限 `data` 改为"投影 + spill 指针"；`output.schema` 至少顶层类型化 | 典型调用 token 再降 |
| 错误/脱敏：补 `pending`(exit 7)/`validation-failed`；redact 覆盖 `data`/`command` | 错误可路由、不泄露 |
| 文档：README 与实现一致性校验 | 无已知失真 |

---

## 2. v0.3.0「Orchestrate」—— 让 job 可重放

- job 幂等与失败恢复：groups/stage 重跑不产生重复副作用；每步产物与可恢复点写进结果。
- 审计报告化：按 app/时间聚合的 Markdown + JSON 报告；把审批结果从 session log 关联进来。
- 能力快照：缓存 `capabilities` + `schema`，离线可用，为 `plan`/`discover` 提供本地索引。
- 审批记忆：`allowlist: [{pattern, scope, expiresAt}]`，默认关闭。

**退出条件**：重跑不产生重复副作用；审计可按 app/时间聚合。

---

## 3. v0.4.0「Govern」—— 让团队敢用

- 多 app / 多 profile：per-call `profile` / `appId` 路由 + 结果路由字段。
- policy as code（"生产发布需双人确认"）；不可逆操作影响面文案分级。
- CI 模式：确定性 JSON、退出码表、幂等重放、`--report junit`。
- 跨 app 状态看板。

**退出条件**：团队场景可审计、可策略化；CI 有确定性退出码。

---

## 4. v1.0「Platform」—— 稳定契约

- 版本兼容矩阵公开；contract 覆盖 100% 注册命令 + 枚举值。
- 文档站 + 可复现 demo；与官方 skill pack 的协作声明。
- 向上游贡献 DSH 集成清单。

**退出条件**：契约可被第三方依赖。

---

## 5. 验收指标

| 指标 | 目标 | 0.1.5 现状 |
|---|---|---|
| time-to-first-success（装 → 第一次成功查询） | < 3 分钟 | 路径 2 步 + `/asc`；未实测 |
| 任务成功率（发版前检查 / 上传 / 提交） | > 90% | 未测量（缺真实响应 fixture / smoke 断言） |
| 每任务审批次数 | ≤ 2 | 可测（policy + audit）；unknown 会额外触发 |
| 每任务 token 消耗 | 下降 30%+ | projector 已有；search/system-status 待补 |
| 上游漂移致败率 | < 1% | contract 只校验名字，无法度量 |
| 未知/被拒命令可恢复率 | > 80% | hint 覆盖主要拒绝路径；未量化 |

---

## 6. 止损条件

- 上游官方发布覆盖 skills + 审批的 DSH 集成 → 转型为"工作流剧本包"或归档；
- v0.2 发布 3 个月后无真实用户反馈（≥ 10 个信号）→ 停止加功能，转维护模式；
- 企业面（多 app / policy）要求重写审批层 → 发 0.2 大版本重置 API，而非叠加。
