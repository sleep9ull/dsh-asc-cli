# 贡献指南（CONTRIBUTING）

> 面向人类与 agent 的开发流程。契约见 [`CONTRACT.md`](./CONTRACT.md)，spec 流程见 [`SPECS.md`](./SPECS.md)，测试模式见 [`TESTING.md`](./TESTING.md)。

---

## 1. 环境

```bash
# Node ^22.19.0 || >=24.0.0（CI 跑 22 / 24）
npm install
npm run build          # tsc -> lib/（gitignored）

# 契约测试需要真实的 asc 二进制（gitignored）
node scripts/download-asc.mjs    # src/compat.ts 的基线版本，验证 SHA-256 后安装
```

下载器及开发脚本共用平台路径：Windows 为 `vendor/asc.exe`，其它平台为 `vendor/asc`。跨平台运行使用脚本默认路径（如 `npm run contract`），传显式路径时保留对应后缀。

独立开发实例（不污染日常 profile）：

```bash
node scripts/dev-patch.mjs      # 从当前 checkout/worktree 生成绝对路径 overlay
# --write 生成显式写模式 overlay，仍要求宿主审批
dsh web --patch ./vendor/cordis.dev.patch.yml --no-open --port 3199
```

安装开发依赖不再自动构建，先按上面步骤显式运行 `npm run build`。本地打包安装：

```bash
npm pack && dsh plugin --profile desktop add ./sleep9ull-dsh-asc-cli-*.tgz
```

`npm pack` / `npm publish` 的 `prepack` 自动 clean build 并检查 `lib/` 与 `src/` 文件集；校验日志写 stderr，保留 `npm pack --json` 的机器可读输出。成品包安装不执行本插件的安装脚本。若使用 `npm pack --ignore-scripts`，调用方必须先显式 build 和运行 pack-manifest。不要把 GitHub 源码 URL 当作用户成品包入口；正式用户使用 npm 包名及精确已发布版本，不要求用户放行构建脚本。详见 [spec 011](specs/011-prebuilt-plugin-install.md)。

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
npm run verify                             # 完整门禁，必须有 vendor/asc
npm run verify -- --unit-only               # 显式仅本地类型/测试/构建/pack/参数守卫，不代表引擎验证
# 或分开跑
npm run typecheck
npm test                                   # 基线 208 tests 起只增不减
npm run build                              # clean + tsc，lib/ 与 src/ 一一对应
node scripts/contract.mjs ./vendor/asc     # 23 条注册命令
node scripts/contract-combos.mjs           # 插件侧非法组合
node scripts/classify-audit.mjs ./vendor/asc
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
4. **版本更新后，合并前必须重新生成 `lib/`**：在最终版本号与源码上运行 `npm run build` 和 `node scripts/pack-manifest.mjs`（完整 `npm run verify` 已包含两步），记录本次构建与校验结果；构建后版本号或源码再变则重新执行。未生成、产物陈旧或校验失败不得合并，不能用旧构建证据代替。`lib/` 保持 gitignored，不提交 Git。完整质量门、contract 与所需 CI checks 必须全绿；确认真实 `npm pack` 从尚无 `lib/` 的源码产出可加载的完整插件，安装包没有消费者安装脚本，并完成同包双宿主的禁用脚本严格安装验证。
5. 发版由维护者执行（当前无自动 publish workflow）；tag 与 npm publish 需明确授权。发布完成后再更新 README 的当前 npm 版本与安装命令，不把候选版本称为已发布。

---

## 6. 定期维护部署

维护兼容原则见 [MAINTENANCE §0](MAINTENANCE.md#0-长期兼容原则) 与 [spec 010](specs/010-dual-harness-compatibility.md)：至少保留 dsh 上一兼容大版本正式稳定线，同时逐步适配默认渠道新版本；0.x 按 minor 划线，没有正式稳定版则保留已验证基线并如实说明。同一插件构建产物必须分别验证保留基线与新候选，用户兼容集合和精确开发锁分开，不能因追新排除稳定用户。

维护实现与部署分开：参见 [MAINTENANCE](MAINTENANCE.md) 和 [spec 005](specs/005-scheduled-upstream-maintenance.md)。任务初建为暂停，在独立 worktree 手动 Run now 验证后启用；Desktop 必须运行且电脑唤醒。每次先恢复未收口 PR，再发现双上游新版本。

只有显式记录的持久授权允许 routine 自动执行范围内适配、提交/push/PR/Squash 和指定主工作副本快进同步；同一授权可覆盖每轮单次 spec 的实施，不免除写 spec、质量门或越界复核。GitHub ruleset/auto-merge 在部署阶段单独配置，不让日常任务自行降低门禁。PR head 更新后旧验证证据失效；不通过额外 loop/cron 轮询 CI。

远端合并与本地同步分别记录；主副本 dirty/diverged/有其他写者时保留现场，不 stash/reset。维护流程不自动删除分支，也不自动发布 npm/tag；它是 §2 默认清理约定的限定例外。暂停 routine 不会取消已请求的 GitHub auto-merge，需显式取消。

## 7. PR 检查清单

- [ ] 关联 spec（或 PR 说明"无需 spec"及原因）
- [ ] 一个逻辑变更；提交信息符合仓库风格
- [ ] typecheck / test / build / contract 全绿；CI required checks 通过
- [ ] 若更新版本号，最终版本已重新生成 `lib/` 并通过 pack-manifest，PR 记录本次有效构建证据
- [ ] 文档同步矩阵逐项核对
- [ ] 无密钥、无本地配置、无意外大文件
- [ ] PR 描述包含：改了什么、为什么、如何验证、已知限制
