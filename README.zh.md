# dsh-asc-cli

> npm 包名：[`@sleep9ull/dsh-asc-cli`](https://www.npmjs.com/package/@sleep9ull/dsh-asc-cli)。由 `dsh-asc-cli@0.1.0` 更名而来，旧包已标记 deprecated。

**DeepSeek Harness 的 App Store Connect 操作台，底层是 [`asc` CLI](https://github.com/rorkai/App-Store-Connect-CLI)。**

`@sleep9ull/dsh-asc-cli` 是一个 DSH **bundle 插件**：不重写 App Store Connect API，`asc`（Go 二进制）仍是执行引擎；插件负责让 AI 安全、准确、省 token 地使用它。

- **默认只读**：任何写操作都需要显式 `confirm` + 宿主审批。
- **按意图组织的工具面**：`asc`（读）/ `asc_plan`（计划）/ `asc_apply`（变更）/ `asc_setup`（环境），长尾用 `asc.run` 逃生。
- **结果可读**：列表变摘要，完整 JSON 落盘，不把上下文塞爆。
- **技能直接可用**：`asc install-skills` 装的 25 个官方 ASC 技能，DSH 原生识别。

> 这不是 asc 的替代品：仍需先安装并登录一次 `asc`。

## 环境要求

| 依赖 | 版本 |
|---|---|
| DeepSeek Harness | `0.2.1-rc.2` 线 |
| Node.js | ≥ 22.19（推荐 24） |
| `asc` | 契约测试针对 `5.16.0`，面向 `5.11+` |
| App Store Connect API Key | 在**终端**里完成登录，插件不接触私钥 |

```bash
brew install asc
asc auth login --name "MyApp" --key-id "ABC123" --issuer-id "DEF456" --private-key /path/to/AuthKey.p8
asc auth status --validate
```

无 Keychain 的 CI / 无头环境：登录时加 `--bypass-keychain`，并在插件配置里设 `bypassKeychain: true`。

## 安装

```bash
# npm（发布后）
dsh plugin --profile desktop add @sleep9ull/dsh-asc-cli

# 本地 checkout / tarball
npm run build && npm pack
dsh plugin --profile desktop add ./sleep9ull-dsh-asc-cli-0.1.2.tgz
```

重启或重新加载 profile。从内置模板创建的 profile 在**首次启动**时可能会生成模板自带的用户 patch 文件，因此请在首次启动之后再编辑 `cordis.patch.yml`（或直接用 `--patch` overlay）。默认插入一行配置：

```yaml
- insert:
    - id: asc-tools
      name: '@sleep9ull/dsh-asc-cli'
      config:
        mode: read-only
```

在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里按 `id: asc-tools` 覆盖（patch 是整块替换，需重述所有键）：

```yaml
- id: asc-tools
  name: '@sleep9ull/dsh-asc-cli'
  config:
    mode: write
    requireApproval: true
    profile: MyApp
    defaultAppId: "123456789"
```

## 命令

| 命令 | 作用 |
|---|---|
| `/asc` | 能力卡：引擎状态、五个作业、底层工具、下一步 |
| `/asc-doctor` | 完整诊断：二进制与来源、版本与测试范围、认证、默认 app、provision 状态 |

命令直接对宿主执行，不产生模型消息，只做只读探测。

## 作业

`asc_job` 是交付类任务的首选入口：一次调用、返回计划形状的结果、每步都有摘要。

| 作业 | 风险 | 作用 |
|---|---|---|
| `release-check` | 只读 | 跑 `asc validate`，返回阻塞项与有序修复步骤 |
| `ship-testflight` | 写 | 上传 `.ipa`/`.pkg`（等待处理）→ 提取 buildId → 加入 TestFlight 组（可选 beta review） |
| `stage-release` | 写 | 先 validate，再准备版本（元数据 + build），不提交 |
| `triage-feedback` | 只读 | 聚合 TestFlight 反馈、崩溃与评论 |
| `compliance-sweep` | 只读 | 巡检年龄分级、加密声明、可访问性与当前定价；单项失败只标注不阻断 |

写作需要 `mode: write`、`confirm: true` 和宿主审批；建议先 `dryRun: true`。

## 工具

工具面按意图组织：**读 / 计划 / 变更 / 作业 / 环境**。

| 工具 | actions | 会改 ASC |
|---|---|---|
| `asc_job` | `release-check` / `ship-testflight` / `stage-release` / `triage-feedback` / `compliance-sweep` | 仅写作 |
| `asc` | `apps-list`/`apps-view`、`builds-list`/`builds-next-number`、`testflight-feedback`/`-crashes`/`-groups`、`reviews-list`、`metadata-validate`、`discover`、`run` | 仅 `run`（按命令分类） |
| `asc_plan` | `validate` / `status` / `metadata-plan` | `metadata-plan` 写本地 review artifact |
| `asc_apply` | `upload` / `groups` / `metadata-init` / `metadata-apply` / `stage` / `publish` | 是 |
| `asc_setup` | `version` / `auth-status` / `doctor` / `system-status` / `diagnose` / `provision` / `install-skills` | `provision` 写插件缓存；`install-skills` 写本地文件 |

结果统一为紧凑 JSON：`ok`、`exitCode`、`command`、`durationMs`、`summary`、`data`、`errorClass`、`hint`、`spillPath` 等。`data` 超过 `maxDataBytes`（默认 8 KB）时不回传，改为 `dataOmitted` + `dataBytes`；stdout 超限写入 spill 文件。`validate` 会投影成 `blocking/errors/warnings` + 有序修复步骤，`status` 投影成 `health/nextAction/blockers/nextCommands`。

### 从 0.1.3 迁移

0.1.4 收敛了工具面，旧工具已移除：

| 0.1.3 | 0.1.4 |
|---|---|
| `asc_search` | `asc` 的 `discover` |
| `asc_run` | `asc` 的 `run` |
| `asc_apps` `list`/`view` | `asc` 的 `apps-list`/`apps-view` |
| `asc_builds` `list`/`next-number` | `asc` 的 `builds-list`/`builds-next-number` |
| `asc_builds` `upload`/`add-groups` | `asc_apply` 的 `upload`/`groups` |
| `asc_testflight` `feedback`/`crashes`/`groups` | `asc` 的 `testflight-feedback`/`-crashes`/`-groups` |
| `asc_metadata` `validate` | `asc` 的 `metadata-validate` |
| `asc_metadata` `init`/`plan`/`apply` | `asc_apply` `metadata-init`；`asc_plan` `metadata-plan`；`asc_apply` `metadata-apply` |
| `asc_release` `status`/`validate`/`stage`/`publish` | `asc_plan` `status`/`validate`；`asc_apply` `stage`/`publish` |

`asc_job` 与 `asc_setup` 名称不变（作业新增 `compliance-sweep`）。

## 安全模型

- **只读模式（默认）**：每次调用带 `--read-only` + `ASC_READ_ONLY=1`；写操作在**启动子进程之前**被拒绝。
- **写模式**：写操作需要 `confirm: true`，默认还会弹出宿主审批；插件从不自动加 `--confirm`。
- **审批豁免是显式的**：`approvedActions` 接受 glob 标签（如 `asc_apply.upload`、`asc_apply.*`），仅在 write 模式跳过提示；不会放宽只读模式、`confirm` 或拒绝列表。
- **审计可选**：设置 `auditLog` 后每次调用追加一行脱敏 JSONL（工具/动作/argv/模式/confirm/退出码/耗时/错误类）；审批结论仍在 DSH 会话日志。
- **未知命令不会被静默放行**：分类器无法确认只读的命令，默认升级为人工审批（`ask`），或按配置直接拒绝（`unknownCommands: deny`）；写模式下还额外要求 `confirm`，模型自己填的 `confirm` 不能替代宿主审批。
- **本地写需要确认 + 审批**：`metadata init`、`metadata plan`（写 review artifact）、`docs init`、`doctor --fix`、`builds dsyms`、`install-skills` 均需 `confirm: true`，默认还会弹出宿主审批。
- **默认关闭值展开**：`asc` 会把 flag 值里的 `@env:NAME` / `@file:PATH` 展开成环境变量/文件内容，可能导致任意本地文件被读进结果。插件默认把行首 `@` 转义为 `@@`，只有显式开启 `allowValueExpansion` 才放行。
- **凭据不进入模型**：为避免宿主清洗 `*KEY*` 变量导致环境认证失效，插件会显式转发 `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_PRIVATE_KEY_PATH` / `ASC_PRIVATE_KEY`，但从不读取、保存或打印密钥内容；登录请在终端执行 `asc auth login`。
- **永久拒绝**：`auth login/logout`、web session 命令、交互式命令、携带私钥内容的参数。
- **无 shell**：argv 数组直传；stderr 做私钥/JWT/密码脱敏；默认关闭 telemetry。

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `ascPath` | `"asc"` | 可执行文件（PATH 名或绝对路径） |
| `profile` | — | `asc --profile` |
| `mode` | `"read-only"` | `read-only` / `write` |
| `requireApproval` | `true` | 写操作是否询问宿主审批 |
| `timeoutMs` | `60000` | 普通命令超时 |
| `longTimeoutMs` | `1800000` | 上传/等待审核超时 |
| `maxOutputBytes` | `262144` | 模型可见输出上限，超出 spill |
| `workdir` | — | 覆盖会话工作目录 |
| `bypassKeychain` | `false` | 设置 `ASC_BYPASS_KEYCHAIN=1` |
| `telemetryDisabled` | `true` | 设置 `ASC_TELEMETRY_DISABLED=1` |
| `allowValueExpansion` | `false` | 允许 `asc` 的 `@env:` / `@file:` 值展开 |
| `unknownCommands` | `"ask"` | 无法确认只读时：`ask` 或 `deny` |
| `allowProvision` | `false` | 允许 `asc_setup` 的 `provision` 下载固定版本引擎 |
| `cacheDir` | — | 覆盖 provision 缓存目录（默认 `$DSH_HOME/cache/asc-cli`） |
| `maxDataBytes` | `8000` | 超过该 JSON 大小就不回传 `data` |
| `auditLog` | — | 每次调用追加一行 JSONL 审计 |
| `approvedActions` | `[]` | write 模式下跳过审批的 glob 标签 |
| `checkUpdates` | `true` | `/asc-doctor` 显示远端最新版本（24h 缓存，绝不自动升级） |
| `env` | `{}` | 传给 `asc` 的额外环境变量 |
| `defaultAppId` | — | 省略 `app` 参数时的默认 App |

## 内置技能包

包内自带 6 个 skill（`skills/`），通过宿主 skill 注册表以 bundled rank（600）注册：装完插件即可用，不需要 git、不需要全局技能目录、不需要手工 `asc install-skills`。

| Skill | 覆盖内容 |
|---|---|
| `dsh-asc-quickstart` | 首次使用、作业/`asc`/`asc_plan`/`asc_apply`/`asc.run` 的选择、结果与错误怎么读 |
| `dsh-asc-auth` | 认证、profile、exit 3 / 401 / 403、CI 与 keychain、私钥卫生 |
| `dsh-asc-release-readiness` | 发版体检报告、修复顺序、plan/apply、stage 与 submit |
| `dsh-asc-testflight-ship` | build number、上传、处理状态、内外部组、失败恢复 |
| `dsh-asc-feedback-triage` | 反馈/崩溃归类、评论回复草稿、限流、隐私 |
| `dsh-asc-compliance-sweep` | 年龄分级、加密、可访问性、定价；哪些项只能人工/网页处理 |

bundled 是最低优先级，用户自己装的同名上游 skill 会胜出。想额外装官方 25 个：

```bash
asc install-skills   # 写入 ~/.agents/skills，DSH 会读取
```

DSH 的技能扫描路径是 `<项目>/.dsh/skills`、`<项目>/.agents/skills`、`customSkillDirs`、`~/.dsh/skills`、`~/.agents/skills` 和 `$DSH_BUNDLED_SKILL_DIR`（优先级 100 → 600），**不扫描 `~/.claude/skills`**。

## 引擎管理

`asc` 仍是外部引擎，但"安装与对齐"由插件负责：

| 环节 | 做法 |
|---|---|
| 定位 | `ascPath` → `ASC_CLI_PATH` → 插件缓存 → `PATH` |
| 诊断 | `/asc-doctor` 或 `asc_setup` 的 `diagnose` |
| 安装 | `brew install asc`，或开启 `allowProvision` 后跑 `asc_setup` 的 `provision` |
| Provision | 下载固定 `asc 5.16.0` 平台资产、校验官方 checksums、缓存到 `$DSH_HOME/cache/asc-cli/<version>/<platform>-<arch>/` |
| 校验 | 版本与 `>=5.16.0 <6.0.0` 比对，漂移只提示、不自动升级 |

provision 永不隐式执行：需要 `allowProvision: true`、显式 `confirm` 和宿主审批。

## 上游更新怎么跟

- 所有命令形状集中在 `src/registry.ts`，升级只改一张表 + fixture。
- `scripts/contract.mjs` 用真实 `asc` 对每个命令跑 `--help`，命令/flag 改名会 CI 失败（只校验名称；值与组合由单元测试覆盖）。
- `asc` 的 `discover` / `run` 保证上游新命令无需插件发版即可使用：不支持 `--output` 的命令会自动重试一次，无法确认只读的命令会转人工审批而不是静默拒绝。
- `/asc-doctor` 会对比远端最新版本（24h 缓存）并提示升级；插件从不自动升级。
- 每日 upstream-watch 工作流巡检最新 release，漂移时开 issue。

## 开发

```bash
npm install
npm run build
npm run typecheck
npm test

node scripts/contract.mjs ./vendor/asc   # 真实 asc 契约测试
node scripts/smoke.mjs                   # 编译产物冒烟

# 独立端口起一个开发实例（不影响当前桌面实例）
dsh web --patch ./dev/cordis.patch.yml --no-open --port 3199
```

## 常见问题

| 现象 | 处理 |
|---|---|
| 找不到 `asc` | 跑 `/asc-doctor` 看下一步；`brew install asc`，或配置 `ascPath` / 开启 `allowProvision` |
| 版本过旧/过新 | `/asc-doctor` 会显示与 `>=5.16.0 <6.0.0` 的偏差；按提示升级或继续使用 |
| `dataOmitted` | 结果太大被省略：缩小查询（filter/limit）或读 `spillPath` |
| 鉴权失败 / exit 3 | `asc auth status --validate`，检查 API Key 角色 |
| Keychain 卡住 | 先在终端登录，或用 `bypassKeychain: true` |
| 写操作被拒 | 插件处于只读模式：把 `asc-tools` 行改成 `mode: write`，再带 `confirm: true` 重试 |
| JSON 太大 | 结果会自动截断 + spill；缩小查询范围 |
| 安装时 pnpm 报 peer 警告 | 正常：DSH 运行时提供 `@deepseek-ai/*` peer，插件从宿主解析 |

## License

MIT
