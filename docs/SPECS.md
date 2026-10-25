# SPEC 规范：先对齐规格，再改代码（SPECS）

> 状态：**标准（SSOT）**｜更新：2026-10-24
> 上级契约：[`CONTRACT.md`](./CONTRACT.md)｜常驻规则：[`../AGENTS.md`](../AGENTS.md)｜模板：[`specs/000-template.md`](./specs/000-template.md)
> 本文规定：**什么时候写 spec、spec 写什么、如何用它驱动代码**。与 `CONTRACT.md` 冲突时以契约为准。

---

## 0. 为什么需要 spec

coding agent 最常见的失败不是"写不出代码"，而是**做错了事**：范围膨胀、悄悄改契约、绕过安全边界、做完才发现和预期不同。spec 把"对齐"从对话里的隐性共识变成仓库里的显性契约。

| 文档 | 回答 | 生命周期 |
|---|---|---|
| `CONTRACT.md` | 产品**长期**契约 | 跨版本 |
| **本文件 + `specs/`** | **一次变更**的契约增量与验收 | 每个功能 |
| 代码 + 测试 | spec 的实现与可执行验收 | 每个 PR |

**合格标准**：另一个 agent 只读 spec、不读对话，也能实现同样的功能，并知道何时算完成。

---

## 1. 什么时候必须写

**必须（MUST）**：新增/修改工具、action、job、skill、command、配置项、结果或错误契约、policy/审批、engine/版本行为、审计；任何用户可观察的行为变化；跨模块 bugfix（≥ 2 模块）或有设计取舍的修复；修改 `CONTRACT.md` 任何条目。

**可以跳过（MAY，PR 描述写"无需 spec"及原因）**：typo、链接、纯格式化、注释；不改变行为的测试补充；依赖版本 bump（无 API/行为变化）。

不确定时写 **mini spec**：只填模板的「范围 / 非目标 / 验收标准 / 测试计划」。

---

## 2. 流程（spec-first，5 步）

### 2.1 Align — 对齐

读 `CONTRACT.md` §2–§3、相关历史 spec；确认落在哪一层（宿主 / 插件 / engine）。产出三句话：**改什么 / 不改什么 / 怎么验证**，并列受影响契约面与 I1–I10。

**完成标准**：能指出需求对应 `CONTRACT.md` 的哪个章节，且不违反任何 I 项。

### 2.2 Write — 写 spec

复制 [`specs/000-template.md`](./specs/000-template.md) 到 `docs/specs/NNN-<slug>.md`，状态 `draft`，逐节填写。

**完成标准**：必填章节无 TODO；验收标准逐条可测；非目标已写明。

### 2.3 Approve — 评审

把 spec 交给用户/维护者确认；**确认前不改代码**（用户明确"边写边改"除外，需在 PR 注明）。

**完成标准**：用户确认或明确接受风险；状态 → `approved`。

### 2.4 Implement — 实现

按 spec 改代码与测试。**spec 与实现冲突时以 spec 为准**；发现 spec 有误，先改 spec 并在 PR 说明。

**完成标准**：验收标准逐条通过；质量门全绿。

### 2.5 Close — 收口

spec 状态 → `implemented`；按 [`CONTRIBUTING.md`](./CONTRIBUTING.md) §4 文档同步矩阵更新；PR 链接 spec。

**完成标准**：文档与代码一致，无"待补"项；开放问题均有结论。

---

## 3. Spec 质量门槛（评审 checklist）

| 检查项 | 合格标准 |
|---|---|
| 可独立实现 | 不读对话也能照做 |
| 非目标 | 明确写出"不做什么" |
| 契约变更 | 细到工具/action/`kind`/默认值/结果字段 |
| 安全影响 | 对照 I1–I10 逐条说明；新增写路径给 mode/confirm/审批/审计设计 |
| 兼容 | breaking 与否、迁移路径、版本策略 |
| 验收标准 | 可执行断言（命令 + 期望，或单测名） |
| 测试计划 | 单元/契约/smoke/手动 + fixture 来源 |
| 文档同步 | README/CHANGELOG/skills/CONTRACT 的具体改动项 |
| 开放问题 | 每条标明是否阻塞实现 |

---

## 4. 文件规范

- 目录 `docs/specs/`；命名 `NNN-kebab-case.md`，三位递增、**永不复用**；`000` 保留给模板。
- 头部元信息：`id / status / created / owner / related`。
- 状态：`draft` → `approved` → `implemented`；被取代时保留文件并写 `superseded by NNN`。
- 一篇 spec 一个主题；不相关变更拆分。
- 不维护手工索引：按编号排序；跨 spec 关系写进 `related`。

### 4.1 现有 spec

| spec | 主题 | 状态 |
|---|---|---|
| `000-template` | 模板 | — |
| `001-contract-alignment` | `--exclude-expired` 透传、README/skill 失真修正 | implemented |
| `002-docs-contract-0.1.5` | 文档契约体系重构 + v0.1.5 发布 | implemented |
| `003-write-path-contract` | 写路径契约与可用性修复（分类器/本地写/参数校验/发布物） | implemented |

---

## 5. 与其他文档的边界

| 文档 | 回答 | 更新时机 |
|---|---|---|
| `CONTRACT.md` | 长期契约（范围 / 安全 / 兼容） | 契约变化时 |
| `SPECS.md` + `specs/` | 单次变更的契约增量与验收 | 每个功能 |
| `COMMANDS.md` | 命令面参考（代码的缓存） | 命令面变化时 |
| `ARCHITECTURE.md` | 模块与数据流 | 结构调整时 |
| `TESTING.md` / `CONTRIBUTING.md` | 测试模式 / 开发流程 | 流程变化时 |
| `ROADMAP.md` | 版本计划 | 每版本 |
| `AGENTS.md` | agent 常驻规则（含 spec-first 摘要） | 流程变化时 |
| README / CHANGELOG | 对外承诺与版本记录 | 每版本 |

---

## 6. 示例（mini spec）

```markdown
# NNN · 透传 `builds next-build-number --exclude-expired`（示例）

| 字段 | 值 |
|---|---|
| id | NNN |
| status | implemented |
| related | CONTRACT §4（能力承诺） |

## 范围
`asc` 的 `builds-next-number` action 透传 `--exclude-expired`；不新增工具。

## 非目标
不做能力表重构；不覆盖 `builds list` 的 `excludeExpired`。

## 行为
`excludeExpired: true` → argv 追加 `--exclude-expired`；缺省不追加。

## 验收标准
- [ ] `test/registry.test.ts` 断言 argv 含该 flag；
- [ ] `npm test` 全绿；contract 通过。

## 测试计划
单测 1 条（registry）；无需 smoke。

## 文档
`docs/COMMANDS.md` 参数说明同步。
```

真实 spec 按模板完整填写，尤其「安全影响」与「兼容」两节。

---

## 7. 反模式

| 反模式 | 后果 | 正确做法 |
|---|---|---|
| 先写代码，PR 里补 spec | spec 变成事后说明 | 先 spec 后代码；紧急修复至少 mini spec |
| spec 写成愿望清单 | 无法判断完成 | 每条都有可执行验收 |
| 一份 spec 塞多个变更 | 评审失焦、回滚困难 | 拆分 |
| 用 spec 绕开 `CONTRACT.md` | 安全边界被侵蚀 | 先改契约，再写 spec |
| 用 spec 代替测试 | 验收落地不了 | 验收标准转成测试 |
| 实现偏离 spec 但不更新 | 文档与代码漂移 | PR 说明偏离，或回写 spec |
