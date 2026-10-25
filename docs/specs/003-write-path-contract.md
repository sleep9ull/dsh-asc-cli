# 003 · 写路径契约与可用性修复（0.1.6）

| 字段 | 值 |
|---|---|
| id | 003 |
| status | implemented |
| created | 2026-10-25 |
| owner | @sleep9ull |
| related | CONTRACT §3/§4/§5/§6；ROADMAP v0.2；`docs/assessment/05-implementation-review-0.1.5.md` |

**一句话**：让只读/禁区承诺真正成立、让 5 条文档化写路径在正确参数下不再"先审批后 exit 2"，并让发布物与文档可复现。

---

## 1. 背景与问题

0.1.5 评估（`docs/assessment/05-implementation-review-0.1.5.md`）确认 5 个 P1：

1. 分类器只看 `argv[0]`：前导全局 flag 把 `forbidden` 降为 `unknown`，`auth token`/`auth login`/`web *` 可执行（I10）。
2. `download`/`export` 被当作 `read` 证据：9 条本地写命令在 read-only 下零 confirm、零审批（I1/local-write）。
3. `ship-testflight` 的 `dryRun:true` 必败：`--wait` 与 `--dry-run` 互斥。
4. `stage`/`stage-release` 未守卫 metadata 来源：0 个或 2 个来源均 exit 2，job 无 `copyMetadataFrom`。
5. `npm pack` 打包了 0.1.3 已删除模块（`build` 不清 `lib/`）。

同时确认 6 类"审批后才被上游拒绝"的参数组合（groups submit+dryRun、testflight-groups internal+external、upload .pkg 缺 version/build-number、publish 无来源/ipa+pkg/pkg 缺 build-number、stage 二选一），以及 `COMMANDS.md §2` 六行、`ARCHITECTURE.md` 两处、`TESTING.md` 覆盖表、3 个 skill 的失真。

## 2. 范围

1. `classify.ts`：前导全局 flag 归一化 + 禁区判定作用于真实根命令；`download`/`export` 改为 `local-write`（显式叶子表）。
2. `approval.ts`：对已注册 action / job 先做参数校验，非法组合在 confirm/审批**之前**拒绝（新拒绝码 `ASC_INVALID_ARGUMENTS`）。
3. `registry.ts`：6 类组合守卫 + 两个上游能力对齐（`publish --ipa` 可省 `--version`；`groups` 有 `buildId` 时可省 `--app`）。
4. `jobs.ts`：`ship-testflight` dryRun 不带 `--wait`；`stage-release` 增 `copyMetadataFrom` 并要求 metadata 来源恰好一个；`triage-feedback` 的评论步骤与 crashes 解耦；只读 job 不再标 `dryRun:true`。
5. `exec.ts`：显式 tombstone `ASC_WEB_SESSION`（凭据形 env）。
6. `runtime.ts`：文件输出类命令不追加 `--output json`；审计补 `appId`；重试后 `command` 标签用实际 argv。
7. `format.ts`：`maxDataBytes`/`dataBytes` 按 UTF-8 字节；`dataOmitted` 文案不再指向不存在的 spill。
8. `audit.ts`：8 KB 按字节、每次写入后 best-effort `chmod 0o600`、内联 `--token=` 形态脱敏。
9. 发布：`clean` + `build` 清理 `lib/`；`scripts/pack-manifest.mjs` 断言产物与 `src` 一致；补 `@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-util-values` peer。
10. 验证：`scripts/classify-audit.mjs`（1,902 条 completion 路径的 read/local-write 漂移门）、`scripts/contract-combos.mjs`（插件侧非法组合必须被拒）、`scripts/verify.mjs`、CI 接线。
11. 文档与 skill：COMMANDS §2/§3/§6/§8、ARCHITECTURE §3/§5/§6、TESTING §2/§5/§6、README/README.zh 安全模型与本地写清单、CHANGELOG 0.1.6、CONTRACT §3.3/§8、3 个 skill 的失真句。
12. 版本 `0.1.6`（patch；无 breaking）。

## 3. 非目标

- 不新增/删除工具、action、job、skill、command、配置项（I6/I7）。
- 不做 `data`/`summary` 深度脱敏（需单独设计，0.1.7）。
- 不改 10 类 `errorClass` 名单、不新增 `pending`/`validation-failed`（0.1.7）。
- 不做 job 幂等/恢复、审计报告化、能力快照、审批记忆（v0.3）。
- 不做 `output.schema` 类型化、projector 扩展、MCP。
- 不重写官方 skill pack。
- engine 探针（version/auth/doctor/diagnose/provision）仍不写审计；改为在 `COMMANDS.md §8` 明确例外（0.1.7 再评估）。

## 4. 契约变更

| 面 | 变更 | 备注 |
|---|---|---|
| 工具 / action | 无新增；`asc_apply.stage` 的 metadata 来源由"可选"变"恰好一个"；`asc_apply.publish` 的 `version` 在 `--ipa` 形态下可省；`asc_apply.groups` 在有 `buildId` 时 `app` 可省 | 仍 5 工具 / 23 action / 15 read / 5 write / 3 local-write |
| 配置 | 无 | 默认值不变 |
| 结果 / 错误 | `dataBytes` 改为 UTF-8 字节；`dataOmitted` 文案去掉 spill 暗示；新增 policy 拒绝码 `ASC_INVALID_ARGUMENTS`（不是 `errorClass`） | 向后兼容；`AscToolResult` 形状不变 |
| policy / 审批 | `asc.run` 中文件写命令由 allow 变 confirm+审批（local-write）；非法参数组合在审批前 deny | I1/I3 更严，无放宽 |
| 版本 / 兼容 | 0.1.5 → 0.1.6（patch） | 无 breaking；放宽的两个参数为向后兼容 |

## 5. 行为规格

### 5.1 分类器归一化（S1）

`normalizeArgv(argv)` 从左剥离开头全局 flag，直到首个非 flag token：

- 带值：`--profile`、`--report`、`--report-file`、`--output`（含 `--flag=value` 单 token 形态，跳过 1 个；空格形态跳过 2 个）。
- 不带值：`--debug`、`--api-debug`、`--read-only`、`--retry-log`、`--strict-auth`、`--pretty`、`--help`、`--version`（含 `=true/false`）。
- `--` 哨兵：跳过 1 个，继续取下一个 token 作为根。
- 遇到未知前导 flag：返回 `unknown`（不猜测它是否吃值）。
- 归一化后：`root` 为 `auth` → 走 auth 子命令规则；`root` 为 `web` → `forbidden`；其余按现有规则。
- 分类器内部所有 `argv[1]`、flag 扫描、write/read 动词扫描都基于归一化后的数组；`exec` 仍使用原始 argv（不丢模型传入的 flag）。

验收：`['--debug','auth','token']`、`['--profile','p','auth','login']`、`['--output','json','web','apps','list']`、`['--','auth','login']` 全部 `forbidden`；`['--profile','p','apps','list']` 为 `read`；未知前导 flag → `unknown`。

### 5.2 本地写叶子（S2）

从 `READ_VERBS` 移除 `download`/`export`。新增 `FILE_WRITE_LEAVES`（按归一化后的前导命令路径精确匹配，允许后面跟任意 flag）：

`analytics download`、`localizations download`、`performance download`、`profiles download`、`screenshots download`、`video-previews download`、`xcode-cloud artifacts download`、`testflight testers export`、`certificates export`。

分类顺序：auth/web/root 特判 → `FILE_WRITE_LEAVES` → 现有 local-write 特判 → write 动词 → read 根 → structured+read 动词 → unknown。`FILE_WRITE_LEAVES` 命中即 `local-write`（两种模式都 confirm + 审批）。

验收：9 条叶子全部 `local-write`；`testflight feedback list`、`reviews list` 仍 `read`；`apps list --name delete` 仍 `write`（保守不变）。

### 5.3 文件输出不追加 `--output json`

`runtime.runArgv` 对 `FILE_WRITE_LEAVES` 的命令路径不追加 `--output json`（用户显式传 `--output` 时本来就不追加）。避免 `analytics download` 生成名为 `json` 的文件。

### 5.4 参数校验（pre-approval）

`ActionSpec` 增可选 `validate?(args: ToolArgs): string | undefined`；`jobs.ts` 导出 `validateJobArgs(id: string, args: JobArgs): string | undefined`。`approval.inspectCall` 返回 `invalid?: string`，`decideCall` 在矩阵判定前对 `invalid` 返回 `deny`（`ASC_INVALID_ARGUMENTS`，reason 含具体缺什么）。builder 必须先调用同一个校验（防御直接调用）。

必须校验的组合与提示：

| action | 规则 |
|---|---|
| `asc_apply.upload` | `dryRun && wait` 拒绝；`.pkg` 必须 `version` + `buildNumber`（`.ipa` 两者可省） |
| `asc_apply.groups` | `dryRun && submit` 拒绝；无 `buildId` 时必须能从 `app` 或 `defaultAppId` 解析出 app（`buildId` 形态可省 `app`） |
| `asc_apply.stage` | `version`、`buildId` 必填；`metadataDir` 与 `copyMetadataFrom` 恰好一个 |
| `asc_apply.publish` | `ipa`/`pkg` 恰好一个；`--pkg` 时 `version` + `buildNumber` 必填；`--ipa` 时 `version` 可省 |
| `asc.testflight-groups` | `internal && external` 拒绝 |
| `asc_job.stage-release` | `version`、`buildId` 必填；`metadataDir` 与 `copyMetadataFrom` 恰好一个 |
| `asc_job.ship-testflight` | `file` 必填；`.pkg` 必须 `version` + `buildNumber`；`app`（或 `defaultAppId`）由 `appOf` 校验 |

### 5.5 ship-testflight / stage-release / triage / read job

- `ship-testflight`：`dryRun ? {} : { wait: true }`；`.pkg` 且 dryRun 时仍要求 version/buildNumber（见上）。
- `stage-release`：`JobArgs` 增 `copyMetadataFrom?: string`，schema 增同名参数，透传给 `asc_apply.stage`；validate 要求二选一。
- `triage-feedback`：reviews 步骤无条件尝试，失败仍由 `ignoreFailures: ['reviews']` 吞掉；summary 不再把未尝试写成 `reviews=n/a`（用 `skipped`/`attempted-failed` 区分）。
- 只读 job 的 `dryRun` 返回 `false`（它们不是预览）；渲染不再显示 `· dry run`。

### 5.6 结果 / 审计 / env

- `format.ts`：`dataBytes = Buffer.byteLength(serialized, 'utf8')`，比较阈值同单位；`renderResult` 只在 `spillPath` 存在时提 spill；`runArgv` 重试后用实际 `appendOutput` 生成 `command`。
- `audit.ts`：`Buffer.byteLength(line)` 判 8 KB 并按字节安全截断；每次 append 后 best-effort `chmodSync(path, 0o600)`；`sanitizeArgv` 处理 `--token=...`、`--pagination-token=...` 等内联形态。
- `runtime.ts` 的 `record`/runArgv 审计填 `appId`（`args.app`、argv 中的 `--app`/`--app=`，或 `config.defaultAppId`；没有则省略）。
- `exec.ts` `childEnv`：把 `ASC_WEB_SESSION` 设为 `undefined`（tombstone），不随父环境进入子进程；文档同步 I5 措辞（4 个显式转发 + 该 tombstone）。

### 5.7 发布物

- `package.json`：`"clean"` 用 Node 脚本删 `lib/`；`"build": "npm run clean && tsc -p tsconfig.build.json"`；`"verify"` 串联质量门；peer 增 `@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-util-values`（版本与宿主一致）。
- `scripts/pack-manifest.mjs`：从 `src/**/*.ts` 派生期望的 `lib/**/*.{js,d.ts,map}`，构建后断言集合相等（多一个即失败）。
- `scripts/verify.mjs`：typecheck → test → build → pack-manifest → contract（有 vendor 时）→ classify-audit（有 vendor 时）→ smoke（有 vendor 时）。
- CI：test job 增 `pack-manifest`；contract job 增 `classify-audit` 与 `contract-combos`。

## 6. 安全与审批影响

| 不变式 | 影响 |
|---|---|
| I1 | 更严：9 条文件写命令变为 local-write（confirm+审批）；`ASC_WEB_SESSION` 不再继承 |
| I2 | 无变化；非法参数在 confirm/审批前拒绝，不放松 |
| I3 | 无变化；`unknown` 仍 ask/deny |
| I4 | 无变化 |
| I5 | 显式转发 4 个 + tombstone `ASC_WEB_SESSION`；`data`/`summary` 深度脱敏不在本次 |
| I6/I7 | 无新增面；skill 同步修正 |
| I8 | 无变化 |
| I9 | 8 KB/0600/内联 token 与文档一致；engine 探针不写审计改为文档例外 |
| I10 | 归一化后禁区必须为 `forbidden`；补回归 |

## 7. 兼容与迁移

- 非 breaking：没有工具/action 改名；两条参数放宽（`publish --ipa` 省 version、`groups` 有 buildId 省 app）对旧调用无影响。
- 行为收紧：文件写命令需 confirm+审批；非法组合提前 deny；`ASC_WEB_SESSION` 不再透传。README/README.zh 与 CHANGELOG 写清。

## 8. 验收标准（可执行）

- [x] `npm run typecheck` / `npm test` / `npm run build` / `node scripts/contract.mjs ./vendor/asc` 全绿。
- [x] `node docs/assessment/0.1.5-audit/scripts/repro.mjs`：S1 全部 `forbidden`、S2 全部 `local-write`+DENY/ASK、C1/C2 的 nested argv 合法。
- [x] `npx vitest run test/classify.test.ts test/approval.test.ts test/runtime.test.ts test/registry.test.ts test/jobs.test.ts test/audit.test.ts test/format.test.ts` 全绿，且新增用例名在 PR 中列出。
- [x] `node scripts/classify-audit.mjs ./vendor/asc` 无未登记 read 写文件叶子。
- [x] `node scripts/contract-combos.mjs`：12 组非法组合全部被拒、8 组合法组合全部可构造。
- [x] `node scripts/pack-manifest.mjs` 在 clean build 后断言 0 多余文件；`npm pack --dry-run` 不含 `lib/tools/apps.js` 等旧模块。
- [x] `node scripts/verify.mjs` 一键通过（本机含 vendor）。
- [ ] 手动（需真实凭据，read-only 先跑）：apps list / builds list / feedback / reviews / status / validate；write 模式：upload(ipa)、groups(buildId)、stage(metadataDir)、publish(ipa)、metadata-apply；每条记录实际 argv 与结果。

## 9. 测试计划

| 类型 | 内容 |
|---|---|
| 单元 | classify 归一化/9 叶子；approval 非法组合 deny；registry 守卫与放宽；jobs 新流程；format 字节/文案；audit 字节/权限/内联 token |
| 契约 | `contract.mjs` 合法 argv；`contract-combos.mjs` 非法 argv 由插件拒绝；`classify-audit.mjs` completion 漂移 |
| smoke | 现有 smoke 仍退出 0；`verify.mjs` 串联 |
| 手动 | 上节 11 条 happy path（真实凭据） |

## 10. 文档与 skill 同步

- [x] `docs/COMMANDS.md` §2 六行、§3 job req/opt、§6 字节、§8 字段与例外
- [x] `docs/ARCHITECTURE.md` §3 审批措辞、§5 10 类、§6 函数名
- [x] `docs/TESTING.md` §2 覆盖表、§5 基线数、§6 缺口
- [x] `README.md` / `README.zh.md`：本地写清单、`dataOmitted`、verify、安装后可用的下一步
- [x] `CHANGELOG.md` 0.1.6 + 历史数字修正
- [x] `docs/CONTRACT.md` §3.3 文件写例外、§8 修订记录
- [x] `docs/ROADMAP.md` 0.1.6 已交付、v0.2 剩余项
- [x] `skills/`：testflight-ship（dryRun 示例）、release-readiness（metadata 二选一、allow-deletes）、feedback-triage（crashes log 需审批）

## 11. 开放问题

| 问题 | 结论 | 阻塞实现？ |
|---|---|---|
| `download/export` 是否需要 `allowLocalWrites` 开关 | 不做；安全优先，保持 local-write + 审批 | 否 |
| `data`/`summary` 深度脱敏 | 0.1.7 | 否 |
| engine 探针审计 | 0.1.7；本次只在文档写例外 | 否 |
| 是否在 0.1.6 打 tag / 发布 | 代码与质量门已通过；tag/发布由用户决定 | 否 |
