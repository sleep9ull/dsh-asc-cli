# 002 · 文档契约体系重构与 v0.1.5 发布

| 字段 | 值 |
|---|---|
| id | 002 |
| status | implemented |
| created | 2026-10-24 |
| owner | @sleep9ull |
| related | CONTRACT §6；SPECS §2；ROADMAP §0 |

**一句话**：按上游 `rorkai/App-Store-Connect-CLI` 的模式重组 `AGENTS.md` 与 `docs/`，让"契约 / 命令面 / 架构 / 测试 / 流程 / 路线"各自有唯一归属，并发布 `0.1.5`。

---

## 1. 背景与问题

- 契约内容此前集中在一个 `PRINCIPLES.md`（274 行）与 `SPEC.md`，与 AGENTS.md 有重复，且没有"命令面 / 架构 / 测试模式 / 贡献流程"的独立文档。
- 上游仓库的模式是：`AGENTS.md` 只放常驻规则与指针，`docs/` 按主题拆分（CONTRACT / COMMANDS / ARCHITECTURE / TESTING / CONTRIBUTING …），并强调"以实时行为（`--help`、代码、测试）为准"。
- `0.1.4` 之后已合入 `--exclude-expired` 修复与多处文档修正，但版本号仍停在 `0.1.4`，CHANGELOG 只有 Unreleased 条目。

## 2. 范围

- 重写 `AGENTS.md`：文档地图、权限边界、核心契约摘要、Discovery、spec-first、实现不变式、测试、质量门、Git/交付。
- 新增 `docs/README.md`、`CONTRACT.md`、`COMMANDS.md`、`ARCHITECTURE.md`、`TESTING.md`、`CONTRIBUTING.md`、`ROADMAP.md`、`SPECS.md`。
- 删除 `docs/PRINCIPLES.md`、`docs/SPEC.md`（内容拆分重组，非删减）。
- 新增根 `CONTRIBUTING.md` 与 `CLAUDE.md`（`@AGENTS.md`）。
- `docs/specs/000-template.md`、`001-contract-alignment.md` 的链接与引用同步。
- 版本：`package.json` / `package-lock.json` → `0.1.5`；CHANGELOG 增加 `0.1.5` 章节。
- README / README.zh 增加 Documentation 指引。

## 3. 非目标

- 不改运行时代码、工具面、policy、schema、配置默认值。
- 不做 v0.2 的契约值测试、参数守卫、projector 补全。
- 不改变发布物结构（`files` 不变）、不新增依赖。

## 4. 契约变更

| 面 | 变更 | 备注 |
|---|---|---|
| 工具 / action | 无 | 仍 5 工具 / 23 action（15 read / 5 write / 3 local-write） |
| 配置 | 无 | 默认值不变 |
| 结果 / 错误 | 无 | — |
| policy / 审批 | 无 | I1–I10 不变 |
| 版本 / 兼容 | `0.1.4` → `0.1.5`（patch） | 无 breaking；文档为新增/重组 |

## 5. 行为规格

- 运行时代码行为完全不变；`npm test` 数量不变（145）。
- 文档结构变化：`docs/PRINCIPLES.md`、`docs/SPEC.md` 不再存在；新文档为权威入口。
- 包版本与 CHANGELOG 一致为 `0.1.5`。

## 6. 安全与审批影响

- 无：I1–I10 的实现与默认值均未改动；新增文档不引入新的执行路径或凭据处理。
- 文档把 policy 矩阵、审计字段、边界条件集中到 `CONTRACT.md` / `COMMANDS.md`，降低失真风险。

## 7. 兼容与迁移

- 非 breaking。引用旧文档的链接（若有）迁移到新文档：
  - `docs/PRINCIPLES.md` → `docs/CONTRACT.md`
  - `docs/SPEC.md` → `docs/SPECS.md`

## 8. 验收标准（可执行）

- [x] `npm run typecheck`、`npm test`（145）、`npm run build`、`node scripts/contract.mjs ./vendor/asc`（23）全绿。
- [x] `docs/`、`AGENTS.md`、`README.md`、`README.zh.md`、`CONTRIBUTING.md`、`CHANGELOG.md` 中不存在指向 `PRINCIPLES.md` / `SPEC.md` 的活链接。
- [x] 文档表格列数与相对链接校验通过。
- [x] `package.json`、`package-lock.json`、`CHANGELOG.md` 版本均为 `0.1.5`。
- [x] `docs/COMMANDS.md` 的 action/kind/confirm 与 `src/registry.ts` 一致（23 条，15/5/3）。

## 9. 测试计划

| 类型 | 内容 |
|---|---|
| 单元 | 不新增（无行为变化） |
| 契约 | `scripts/contract.mjs` 23 条 |
| 结构 | 链接/表格校验脚本；版本号 grep；文档↔registry 对照 |
| 手动 | 阅读 `AGENTS.md` 与 `docs/` 入口，确认无死链 |

## 10. 文档与 skill 同步

- [x] `AGENTS.md`、`docs/*`、根 `CONTRIBUTING.md`、`CLAUDE.md`
- [x] README / README.zh（Documentation 指引）
- [x] CHANGELOG（0.1.5）
- [x] spec 000/001 链接更新
- [x] `skills/*`：无工具面变更，无需改动

## 11. 开放问题

| 问题 | 结论 | 阻塞实现？ |
|---|---|---|
| 是否把 `docs/COMMANDS.md` 改为脚本生成 | 暂不做；先用 contract 测试 + 评审保证一致，v0.2 再评估 | 否 |
