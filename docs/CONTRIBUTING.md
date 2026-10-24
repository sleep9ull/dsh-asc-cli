# 贡献指南（CONTRIBUTING）

> 面向人类与 agent 的开发流程。契约见 [`CONTRACT.md`](./CONTRACT.md)，spec 流程见 [`SPECS.md`](./SPECS.md)，测试模式见 [`TESTING.md`](./TESTING.md)。

---

## 1. 环境

```bash
# Node >= 22.19（CI 跑 22 / 24）
npm install
npm run build          # tsc -> lib/（gitignored）

# 契约测试需要真实的 asc 二进制（gitignored）
mkdir -p vendor && cp "$(command -v asc)" vendor/asc   # 或放入 5.16.0 发布包
```

独立开发实例（不污染日常 profile）：

```bash
dsh web --patch ./dev/cordis.patch.yml --no-open --port 3199
```

本地打包安装：

```bash
npm pack && dsh plugin --profile desktop add ./sleep9ull-dsh-asc-cli-*.tgz
```

---

## 2. Git 工作流

- 从 `main` 拉分支，**一个逻辑变更一个分支**；不要直接 push `main`。
- 一个逻辑变更一个提交；提交信息用仓库风格（`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`，破坏性用 `feat!`）。
- 提交前 `git diff` 自检；不提交密钥、`.tgz`、`lib/`、`vendor/`。
- 不 `--no-verify`、不跳过 checks、不为了过门而弱化 CI。
- 非共享历史不改写（不 rebase/force-push/squash），除非用户明确要求该策略。
- 合并策略：默认普通 merge commit；**用户明确要求 squash 时才 squash**。
- 合并后删除分支（本地 + 远端）。

---

## 3. 提交前质量门

```bash
npm run typecheck
npm test                                   # 基线 144 tests 起只增不减
npm run build
node scripts/contract.mjs ./vendor/asc     # 23 条注册命令
```

- 改了命令面/参数：同时更新 `docs/COMMANDS.md`、相关 skill、README/README.zh（若用户可见）。
- 改了策略/安全边界：更新 `docs/CONTRACT.md` 与 `AGENTS.md` 摘要，并加锁定测试。
- 改了流程/门禁：更新 `docs/CONTRIBUTING.md` / `docs/TESTING.md`。
- 文档改动：校验表格列数与相对链接。

---

## 4. 文档同步矩阵

| 改动类型 | 必须同步 |
|---|---|
| 新/改/删 action | `src/registry.ts`、工具 schema、`test/registry.test.ts`、`docs/COMMANDS.md`、相关 `skills/*`、CHANGELOG |
| 新 job | `src/capabilities.ts`、`src/jobs.ts`、`test/jobs.test.ts`、能力卡、`docs/COMMANDS.md`、对应 skill |
| 新 skill | `skills/<name>/SKILL.md`、`src/capabilities.ts`、`test/skills.test.ts`、`docs/COMMANDS.md` |
| 新 command | `src/commands.ts`、`test/commands.test.ts`、`docs/COMMANDS.md` |
| 新配置项 | `src/config.ts`（安全默认）、`docs/COMMANDS.md` 配置表、README 配置表、测试 |
| policy / 安全边界 | `src/approval.ts`、`docs/CONTRACT.md` §3 + 修订记录、`AGENTS.md` 摘要、审批矩阵测试 |
| 结果/错误契约 | `src/format.ts`、`docs/COMMANDS.md` §6、format 测试 |
| 引擎/版本 | `src/compat.ts`、`docs/COMMANDS.md` §9、engine 测试 |
| 发布 | `package.json` + `package-lock.json` 版本、CHANGELOG 章节、README 需求表（若变） |

---

## 5. 版本与发布

1. 按 SemVer 判断版本（`0.x`；破坏性工具面变更用 `feat!` 并给迁移表）。
2. `package.json` 与 `package-lock.json` 同步 bump。
3. CHANGELOG 增加该版本章节（把 Unreleased 条目归入），写清 breaking/fixed/docs。
4. 跑完整质量门 + contract。
5. 发版由维护者执行（当前无自动 publish workflow）；tag 与 npm publish 需明确授权。

---

## 6. PR 检查清单

- [ ] 关联 spec（或 PR 说明"无需 spec"及原因）
- [ ] 一个逻辑变更；提交信息符合仓库风格
- [ ] typecheck / test / build / contract 全绿；CI required checks 通过
- [ ] 文档同步矩阵逐项核对
- [ ] 无密钥、无本地配置、无意外大文件
- [ ] PR 描述包含：改了什么、为什么、如何验证、已知限制
