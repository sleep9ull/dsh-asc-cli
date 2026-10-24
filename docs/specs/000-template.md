# NNN · <一句话标题>

> 复制本文件到 `docs/specs/NNN-kebab-case.md` 后填写；`000` 保留给模板。规范见 [`../SPECS.md`](../SPECS.md)。

| 字段 | 值 |
|---|---|
| id | NNN |
| status | draft |
| created | YYYY-MM-DD |
| owner | @handle（可选） |
| related | CONTRACT §x；roadmap 版本；issue / PR 链接 |

**一句话**：<用户可观察的变化>

---

## 1. 背景与问题

- 为什么现在做（评估结论 / issue / 用户反馈）：
- 现状与差距（1–3 条）：

## 2. 范围

- <做什么，逐条>

## 3. 非目标（Out of scope）

- <明确不做什么——这一节用来防止范围膨胀>

## 4. 契约变更

| 面 | 变更 | 备注 |
|---|---|---|
| 工具 / action | 新增 / 修改 / 删除 | `kind`、`needsConfirm`、`output`、`long`、默认值 |
| 配置 | 新键 / 默认值 | 默认值必须落在只读 / 关闭 / 空一侧 |
| 结果 / 错误 | 新字段 / 新 `errorClass` | 兼容性 |
| policy / 审批 | 矩阵是否变化 | 对照 I1–I10 |
| 版本 / 兼容 | breaking？ | 迁移表、`feat!` |

## 5. 行为规格

- 正常路径（Given / When / Then 或编号步骤）：
- 边界条件：
- 错误路径与面向模型的提示文案：

## 6. 安全与审批影响

- 对 I1–I10 的逐条影响（无影响也写"无"）：
- 新增写路径的闸门设计（mode / confirm / 审批 / 审计）：
- 凭据、本地文件、可逆性：

## 7. 兼容与迁移

- 是否 breaking；旧用法如何处理：
- README / README.zh 迁移表项：

## 8. 验收标准（可执行）

- [ ] <命令 + 期望结果，或具体单测名>
- [ ] <...>

## 9. 测试计划

| 类型 | 内容 |
|---|---|
| 单元 | |
| 契约 | |
| smoke | |
| 手动 | |

## 10. 文档与 skill 同步

- [ ] README / README.zh
- [ ] CHANGELOG
- [ ] `skills/*`（工具面变更时）
- [ ] `CONTRACT.md`（契约变化时）

## 11. 开放问题

| 问题 | 结论 | 阻塞实现？ |
|---|---|---|
| | | |
