# SPEC 规范：先对齐规格，再改代码

> 状态：**标准（SSOT）**｜更新：2026-10-24
> 上级契约：[`PRINCIPLES.md`](./PRINCIPLES.md)（做什么 / 边界 / I1–I10）｜agent 行为规则：[`AGENTS.md`](../AGENTS.md)｜模板：[`specs/000-template.md`](./specs/000-template.md)
> 本文规定：**什么时候写 spec、spec 写什么、如何用它驱动代码**。产品契约与本文冲突时，以 `PRINCIPLES.md` 为准。

---

## 0. 为什么需要 spec

coding agent 最常见的失败不是"写不出代码"，而是**做错了事**：范围膨胀、悄悄改了契约、绕过了安全边界、做完才发现和预期不同。spec 把"对齐"从对话里的隐性共识变成仓库里的显性契约。

三份文档的分工：

| 文档 | 回答 | 生命周期 |
|---|---|---|
| `PRINCIPLES.md` | 产品**长期**契约：做什么、不做什么、不可变原则 | 跨版本 |
| **本文件 + `specs/`** | **一次变更**的契约增量与验收标准 | 每个功能 |
| 代码 + 测试 | spec 的实现与可执行的验收 | 每个 PR |

**合格标准**：另一个 agent 只读 spec、不读对话，也能实现同样的功能，并知道何时算完成。

---

## 1. 什么时候必须写 spec

**必须（MUST）**：

- 新增/修改工具、action、job、skill、command、配置项、结果或错误契约、policy/审批、engine/版本行为、审计；
- 任何用户可观察的行为变化；
- 跨模块 bugfix（≥ 2 个模块），或存在设计取舍的修复；
- 修改 `PRINCIPLES.md` 的任何条目。

**可以跳过（MAY，PR 描述里写"无需 spec"及原因）**：

- typo、链接、纯格式化、注释；
- 不改变行为的测试补充；
- 依赖版本 bump（无 API/行为变化）。

不确定时写 **mini spec**：只填模板的「范围 / 非目标 / 验收标准 / 测试计划」四节。

---

## 2. 流程（spec-first，5 步）

每一步都有可检查的完成标准；前一步没完成，不进下一步。

### 2.1 Align — 对齐

读 `PRINCIPLES.md` §2（能力契约）、§3（安全契约）、§4（做与不做），以及相关历史 spec；确认需求落在哪一层（宿主 / 插件 / engine）。

产出三句话：**改什么 / 不改什么 / 怎么验证**，并列受影响契约面与 I1–I10。

**完成标准**：能指出需求对应 `PRINCIPLES.md` 的哪个章节，且不违反任何 I 项。

### 2.2 Write — 写 spec

复制 [`specs/000-template.md`](./specs/000-template.md) 到 `docs/specs/NNN-<slug>.md`，状态 `draft`，逐节填写。

**完成标准**：必填章节无 TODO；验收标准逐条可测；非目标已写明。

### 2.3 Approve — 评审

把 spec 交给用户/维护者确认；**确认前不改代码**（用户明确要求"边写边改"时除外，需在 PR 里注明）。

**完成标准**：用户确认，或明确接受风险；状态 → `approved`。

### 2.4 Implement — 实现

按 spec 改代码与测试。**spec 与实现冲突时以 spec 为准**；发现 spec 有误，先改 spec 并在 PR 说明，再改代码。

**完成标准**：验收标准逐条通过；质量门（`npm run typecheck && npm test`、contract）全绿。

### 2.5 Close — 收口

spec 状态 → `implemented`；契约变化同步 `PRINCIPLES.md` / README(+zh) / CHANGELOG / `skills/`；PR 描述链接 spec。

**完成标准**：文档与代码一致，无"待补"项；spec 里的开放问题均有结论。

---

## 3. Spec 质量门槛（评审 checklist）

| 检查项 | 合格标准 |
|---|---|
| 可独立实现 | 不读对话也能照做 |
| 非目标 | 明确写出"不做什么" |
| 契约变更 | 细到工具 / action / `kind` / 默认值 / 结果字段 |
| 安全影响 | 对照 I1–I10 逐条说明；新增写路径给出 mode/confirm/审批/审计设计 |
| 兼容 | breaking 与否、迁移路径、版本策略 |
| 验收标准 | 可执行断言（命令 + 期望，或单测名） |
| 测试计划 | 单测 / 契约 / smoke / 手动；fixture 来源 |
| 文档同步 | README / CHANGELOG / skills / PRINCIPLES 的具体改动项 |
| 开放问题 | 每条标明是否阻塞实现 |

---

## 4. 文件规范

- 目录：`docs/specs/`；命名 `NNN-kebab-case.md`，三位数字递增、**永不复用**，`000` 留给模板。
- 头部元信息见模板：`id / status / created / owner / related`。
- 状态：`draft` → `approved` → `implemented`；被新 spec 取代时保留文件，并在头部写 `superseded by NNN`。
- 一篇 spec 一个主题；不相关变更拆成多篇。
- 不维护手工索引：按编号排序即可，跨 spec 关系写进 `related`。

---

## 5. 与其他文档的边界

| 文档 | 回答的问题 | 更新时机 |
|---|---|---|
| `PRINCIPLES.md` | 产品长期契约（做什么 / 不做什么 / 不可变原则） | 契约变化时 |
| `SPEC.md` + `specs/NNN-*.md` | 本次变更的契约增量与验收 | 每个功能 |
| `ASSESSMENT.md` | 为什么现在这样（评估与证据，本地快照） | 重大评估时 |
| `AGENTS.md` | agent 每轮行为规则（含 spec-first 摘要） | 流程变化时 |
| README / CHANGELOG | 对外承诺与版本记录 | 每版本 |
| `skills/` | 模型如何使用能力 | 工具面变更时 |

---

## 6. 示例（mini spec）

```markdown
# NNN · 透传 `builds next-build-number --exclude-expired`（示例）

| 字段 | 值 |
|---|---|
| id | NNN |
| status | implemented |
| related | PRINCIPLES §2.1（`asc` 读 action） |

## 范围
`asc` 的 `builds-next-number` action 透传 `--exclude-expired`；不新增工具、不改其他 action。

## 非目标
不做能力表重构；不覆盖 `builds list` 的 `excludeExpired`。

## 行为
`excludeExpired: true` → argv 追加 `--exclude-expired`；缺省不追加。

## 验收标准
- [ ] `test/registry.test.ts` 断言 argv 含该 flag；
- [ ] `npm test` 全绿；contract 通过（上游 5.16.0 支持）。

## 测试计划
单测 1 条（registry）；无需 smoke。

## 文档
README 无变更（参数已在 schema）。
```

真实 spec 按模板完整填写，尤其是「安全影响」与「兼容」两节。

---

## 7. 反模式

| 反模式 | 后果 | 正确做法 |
|---|---|---|
| 先写代码，PR 里补 spec | spec 变成事后说明，失去对齐作用 | 先 spec 后代码；紧急修复也至少写 mini spec |
| spec 写成愿望清单 | 无法判断是否完成 | 每条都要有可执行验收 |
| 一份 spec 塞多个变更 | 评审失焦、回滚困难 | 拆分 |
| 用 spec 绕开 `PRINCIPLES.md` | 安全边界被侵蚀 | 先改契约（§8），再写 spec |
| 用 spec 代替测试 | 验收标准落不了地 | 验收标准转成测试 |
| 实现偏离 spec 但不更新 | 文档与代码漂移 | PR 说明偏离，或回写 spec |
