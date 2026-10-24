# 001 · 契约对齐：`--exclude-expired` 透传、README 与 skill 声明修正

| 字段 | 值 |
|---|---|
| id | 001 |
| status | implemented |
| created | 2026-10-24 |
| owner | @sleep9ull |
| related | PRINCIPLES §2.1（`asc` 读 action）、§8 第 5 条（失真即缺陷）；SPEC §2 |

**一句话**：让 `asc builds-next-number --exclude-expired` 真正生效，并把 README/skill 里两处与实现不符的安全声明改成事实。

---

## 1. 背景与问题

- `builds-next-number` 的 builder 未透传 `--exclude-expired`，而 schema 又把 `excludeExpired` 描述为“仅 builds-list”，导致该参数被静默丢弃；上游 `asc 5.16.0` 明确支持该 flag（`asc builds next-build-number --help`）。
- README（en/zh）两处声明与实现不符：
  1. “插件从不自动加 `--confirm`”——实际 builder 在模型传入 `confirm: true` 时会追加 `--confirm`；
  2. “永久拒绝：…交互式命令”——分类器没有交互式提示规则；这类命令走 `unknown`（`ask`/`deny`）。
- `dsh-asc-quickstart` skill 写有“用 `asc run` 绕过确认”，与 policy 矩阵冲突（`run` 同样被分类与审批）。
- README（en/zh）故障排查把 `dataOmitted` 与 `spillPath` 混为一谈：`dataOmitted` 是 payload 进入结果前被丢弃（不落盘），`spillPath` 只来自 `maxOutputBytes` 的 stdout 截断。

## 2. 范围

- `src/registry.ts`：`builds-next-number` 透传 `--exclude-expired`。
- `src/tools/asc.ts`：`excludeExpired` 描述改为适用于 `builds-list` / `builds-next-number`。
- `test/registry.test.ts`：新增回归用例（两个 action 都断言）。
- `README.md` / `README.zh.md`：修正两处安全声明（confirm 语义、拒绝面），以及 `dataOmitted` / `spillPath` 的语义表述。
- `skills/dsh-asc-quickstart/SKILL.md`：修正 `run` 不绕过确认的表述。
- `AGENTS.md` / `docs/PRINCIPLES.md`：精确化只读注入与测试基线表述；路线图移除已完成项。
- `CHANGELOG.md`：新增 Unreleased 记录。

## 3. 非目标

- 不做 P2-1..5 的 builder 参数守卫（留 v0.2）。
- 不改 `--output` 决策逻辑、结果契约、`output.schema` 类型化。
- 不新增/删除工具、action、job，不升版本号。

## 4. 契约变更

| 面 | 变更 | 备注 |
|---|---|---|
| 工具 / action | 无新增；`asc.builds-next-number` 新增可选 flag 透传 | 仍为 `kind: read` |
| 配置 | 无 | — |
| 结果 / 错误 | 无 | — |
| policy / 审批 | 无 | 只读 action，不触发审批 |
| 版本 / 兼容 | 无 breaking | 无迁移 |

## 5. 行为规格

- `asc` action `builds-next-number` + `excludeExpired: true` → argv 追加 `--exclude-expired`。
- 缺省或 `false` → 不追加（行为不变）。
- `builds-list` 行为不变。
- README/skill 文案与代码一致，不再承诺未实现行为。
- `dataOmitted` 不产生 `spillPath`；`spillPath` 仅来自 `maxOutputBytes` 截断，两者在文档中区分清楚。

## 6. 安全与审批影响

- 对 I1–I10：无影响。`builds-next-number` 是 `read`，read-only 与 write 模式都可执行；不新增写路径、不涉及凭据或本地文件。
- 文档修正降低“失真”风险（PRINCIPLES §8 第 5 条），不放松任何闸门。

## 7. 兼容与迁移

- 非 breaking：仅是原本被丢弃的可选 flag 开始生效；不传该参数的调用完全不变。

## 8. 验收标准（可执行）

- [x] `npm run typecheck` 通过。
- [x] `npm test` 全绿（145 tests；原 144 + 新增 1）。
- [x] 新增用例：`builds-list` 与 `builds-next-number` 在 `excludeExpired: true` 时 argv 含 `--exclude-expired`。
- [x] `node scripts/contract.mjs ./vendor/asc` → 23 commands accepted。
- [x] `npm run build` 通过。
- [x] `grep -n "never adds .--confirm\|interactive prompts" README.md` 无结果；`README.zh.md` 无“从不自动加”表述。
- [x] README 的 `dataOmitted` 行不再暗示读取 `spillPath`。

## 9. 测试计划

| 类型 | 内容 |
|---|---|
| 单元 | `test/registry.test.ts` 新增 `passes --exclude-expired to builds list and next-number` |
| 契约 | `scripts/contract.mjs`（23 条命令） |
| smoke | 不需要（无新表面） |
| 手动 | `./vendor/asc builds next-build-number --help` 确认上游支持该 flag |

## 10. 文档与 skill 同步

- [x] README / README.zh（安全模型两条）
- [x] CHANGELOG（Unreleased / Fixed）
- [x] `skills/dsh-asc-quickstart/SKILL.md`
- [x] `AGENTS.md`（I1 表述、质量门基线）与 `docs/PRINCIPLES.md`（§2.1、§6、§7）

## 11. 开放问题

| 问题 | 结论 | 阻塞实现？ |
|---|---|---|
| `builds-list` 的 `excludeExpired` 是否需要同时支持 `--not-expired` 别名 | 不需要，透传主 flag 即可 | 否 |
