# ASC · DeepSeek Harness 的 App Store Connect 操作台

**用对话完成 TestFlight 发布、发版体检、反馈分诊与合规巡检。**

[English](README.md) | 中文

[![npm](https://img.shields.io/npm/v/@sleep9ull/dsh-asc-cli?label=npm&color=cb3837)](https://www.npmjs.com/package/@sleep9ull/dsh-asc-cli)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1--rc.2-4b5563)](https://github.com/deepseek-ai/deepseek-harness)

App Store Connect 是 iOS 发布流程的核心，也是团队最耗时间的地方：命令行参数、大段 JSON、状态机、审批与合规检查。这个插件把它搬进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：安装一次，用自然语言提出需求，Agent 会选对流程、先给出计划，并在真正改动线上之前停下来等你审批。

底层执行引擎仍是 [`asc` CLI](https://github.com/rorkai/App-Store-Connect-CLI)（MIT，Go）。本插件是它上层的产品层：5 个任务型**作业**、按意图组织的**读 / 计划 / 变更**工具面、随包发布的**内置技能**，以及负责体检、安装与版本对齐的**引擎管理器**。

```bash
dsh plugin --profile desktop add @sleep9ull/dsh-asc-cli
```

> 安装后运行 `/asc`：它会告诉你引擎、认证、默认 app 以及**下一步该做什么**（不经过模型）。

---

## 你可以做什么

| 在对话里说 | 插件会做什么 |
|---|---|
| "1.2.3 能提交了吗？把阻塞项和修复顺序列出来" | `release-check` — 跑 `asc validate`，给出阻塞统计与有序修复步骤 |
| "把这个包发到内部测试组" | `ship-testflight` — 上传、等待处理、把 build 加入 TestFlight 组 |
| "把 1.2.3 和元数据准备好，先别提交" | `stage-release` — 校验、挂 build、应用元数据，停在提交之前 |
| "测试员在抱怨什么？" | `triage-feedback` — TestFlight 反馈 + 崩溃 + 评论，聚合归类 |
| "合规有问题吗？年龄分级、加密、可访问性、定价" | `compliance-sweep` — 四项只读探测，单项失败不阻断 |
| "其他操作：证书、用户、分析、广告、原始 API" | `asc` 读取、`discover` 找命令、`run` 兜底长尾 |

所有写操作都遵循同一形态：**先出计划 → `confirm: true` → 宿主审批 → 执行 → 可审计结果**。

---

## 快速开始

### 1 · 安装插件

```bash
dsh plugin --profile desktop add @sleep9ull/dsh-asc-cli
```

重启或重新加载 profile。插件会向 `cordis.patch.yml` 插入一行配置（默认 `mode: read-only`）。

### 2 · 准备引擎

```bash
brew install asc          # 或：curl -fsSL https://asccli.sh/install | bash
asc auth login --name "MyApp" --key-id ABC123 --issuer-id DEF456 --private-key /path/to/AuthKey.p8
```

然后运行 `/asc`，或让 Agent 执行 `asc_setup` 的 `diagnose`。如果还有缺失，它会给出**恰好一个**下一步。不要把私钥贴进对话；认证始终在你自己的终端完成。

也可以让插件代下载引擎：开启 `allowProvision`，执行 `asc_setup` 的 `provision`。它会下载固定版本的 `asc`、校验官方 SHA-256，并缓存到 `$DSH_HOME/cache/asc-cli/`。

### 3 · 直接提需求

```text
列出我的 app，选 bundle id 为 com.example.focus 的那个，设为默认。
```

```text
1.2.3 能提交了吗？按优先级给我阻塞项。
```

```text
把 ./build/Focus.ipa 作为 1.2.3 build 42 传到内部测试组。
```

第三条会走 `ship-testflight` 作业；想先看计划就加 `dryRun: true`，不会触碰 App Store Connect。

---

## 插件里有什么

### 5 个作业

`asc_job` 是首选入口：一次调用、计划形状的结果、每步摘要，必要时支持 dry-run。

| 作业 | 风险 | 作用 |
|---|---|---|
| `release-check` | 只读 | 跑 `asc validate`，返回阻塞数与有序修复项 |
| `ship-testflight` | 写 | 上传 `.ipa`/`.pkg`（等待处理）→ 取 buildId → 加入 TestFlight 组；可选 beta review |
| `stage-release` | 写 | 先校验，再准备版本（元数据 + build），不提交 |
| `triage-feedback` | 只读 | 聚合 TestFlight 反馈、崩溃与评论 |
| `compliance-sweep` | 只读 | 巡检年龄分级、加密声明、可访问性、当前定价 |

写作业（write）需要 `mode: write`、`confirm: true` 和宿主审批。

### 5 个工具

| 工具 | 定位 | 用途 |
|---|---|---|
| `asc_job` | 任务 | 上面 5 个完整工作流 |
| `asc` | 读 | apps、builds、TestFlight、reviews、离线元数据校验，以及 `discover` / `run` |
| `asc_plan` | 计划 | `validate`、`status`、`metadata-plan`，不改动 App Store Connect |
| `asc_apply` | 变更 | `upload`、`groups`、`metadata-init`、`metadata-apply`、`stage`、`publish` |
| `asc_setup` | 环境 | 版本、认证状态、doctor、系统状态、diagnose、provision、安装技能 |

### 2 个命令

| 命令 | 作用 |
|---|---|
| `/asc` | 能力卡：引擎状态、认证、默认 app、5 个作业、下一步 |
| `/asc-doctor` | 完整诊断：二进制与来源、版本与测试范围、认证、默认 app、provision、远端更新 |

命令直接对宿主执行，不产生模型消息。

### 6 个内置技能

随 npm 包发布，装完即可用——不需要 git、不需要全局技能目录：

`dsh-asc-quickstart` · `dsh-asc-auth` · `dsh-asc-release-readiness` · `dsh-asc-testflight-ship` · `dsh-asc-feedback-triage` · `dsh-asc-compliance-sweep`

覆盖首次使用选择、认证与 CI、发版体检、TestFlight 发布、反馈分诊、合规巡检——全部以本插件的工具语义书写。

### 引擎管理器

| 环节 | 行为 |
|---|---|
| 定位 | `ascPath` → `ASC_CLI_PATH` → 插件缓存 → `PATH` |
| 诊断 | 版本、测试范围、认证、默认 app、provision 状态，给一个下一步 |
| Provision | 可选：固定 `asc 5.16.0`、SHA-256 校验、按平台缓存 |
| 更新 | `/asc-doctor` 对比 GitHub 最新 release（24h 缓存），提示 `brew upgrade asc`，从不自动升级 |

---

## 为什么要做成插件，而不是让 Agent 直接跑 bash？

- **审批而非自证**：默认只读；写操作需要显式 `confirm` 和真人审批，模型无法自己放行。
- **先计划后执行**：`validate`、`status`、`--dry-run` 是一等公民，改动前先给你看。
- **结果适合对话**：摘要、修复顺序、计数替代大段 JSON；超大结果省略并给出读取路径。
- **作业而非命令堆叠**：上传 → 等待 → 分组是一条确定性调用，不是五个可能被模型重排的命令。
- **Agent 自带工作流知识**：内置技能讲清作业、策略与失败恢复。
- **可审计**：可选的 JSONL 审计记录每次调用；审批结论保留在 DSH 会话日志。

---

## 安全模型

- **默认只读**：每次调用带 `--read-only` + `ASC_READ_ONLY=1`，写操作在启动子进程前就被拒绝。
- **写模式**：需要 `confirm: true` 且默认弹出宿主审批；插件只在模型传入 `confirm: true` 时给底层命令加 `--confirm`，不会自行确认。
- **未知命令不静默**：无法确认只读的命令转人工审批（`ask`），或按配置直接拒绝（`unknownCommands: deny`）；写模式还额外要求 `confirm`。
- **本地写需确认 + 审批**：`metadata init/plan`、`docs init`、`doctor --fix`、`builds dsyms`、`install-skills`。
- **默认关闭值展开**：`asc` 会展开 flag 值里的 `@env:` / `@file:`；插件默认把行首 `@` 转义，除非显式开启 `allowValueExpansion`。
- **凭据不进模型**：宿主会清洗 `*KEY*` 变量，插件因此显式转发 `ASC_KEY_ID`、`ASC_ISSUER_ID`、`ASC_PRIVATE_KEY_PATH`、`ASC_PRIVATE_KEY`，但从不读取、保存或打印密钥内容。
- **永久拒绝**：`auth login/logout` 与 `asc web`；分类器无法确认只读的命令转人工审批（`unknownCommands: ask`）或直接拒绝（`deny`）。
- **无 shell**：argv 数组直传；诊断信息脱敏；默认关闭 telemetry。
- **可选治理**：`auditLog` 记录执行内容；`approvedActions` 仅在写模式对已知动作跳过提示。

---

## 环境要求

| 依赖 | 版本 |
|---|---|
| DeepSeek Harness | `0.2.1-rc.2` 线（`engines.dsh: >=0.2.1-rc.2 <0.3.0`） |
| Node.js | ≥ 22.19（推荐 24） |
| `asc` | 固定 `5.16.0`；测试范围 `>=5.16.0 <6.0.0`（`/asc-doctor` 会提示漂移） |
| App Store Connect API Key | 团队或个人 key，在 Agent 之外完成认证 |

---

## 配置

在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 中覆盖 `asc-tools` 行。patch 是整块替换，需要重述所有用到的键：

```yaml
- id: asc-tools
  name: '@sleep9ull/dsh-asc-cli'
  config:
    mode: write            # 上传 / 提交 / 元数据 apply 需要
    requireApproval: true
    profile: MyApp         # 传给 asc --profile
    defaultAppId: "123456789"
    allowProvision: true   # 可选：允许插件下载固定版本引擎
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `mode` | `"read-only"` | `read-only` 或 `write` |
| `requireApproval` | `true` | 写操作是否询问宿主审批 |
| `ascPath` | `"asc"` | 可执行文件（PATH 名或绝对路径） |
| `profile` | — | `asc --profile` |
| `defaultAppId` | — | 省略 `app` 时的默认 App |
| `timeoutMs` | `60000` | 普通命令超时 |
| `longTimeoutMs` | `1800000` | 上传与等待发布 |
| `maxOutputBytes` | `262144` | stdout 超限写入 spill |
| `maxDataBytes` | `8000` | 超过该 JSON 大小就不回传 `data`（`dataOmitted`） |
| `workdir` | — | 覆盖会话工作目录 |
| `allowValueExpansion` | `false` | 允许 `asc` 的 `@env:` / `@file:` 展开 |
| `unknownCommands` | `"ask"` | 无法确认只读时：`ask` 或 `deny` |
| `allowProvision` | `false` | 允许 `asc_setup` 的 `provision` |
| `cacheDir` | — | 覆盖 provision 缓存目录 |
| `bypassKeychain` | `false` | 设置 `ASC_BYPASS_KEYCHAIN=1`（CI / 无头环境） |
| `telemetryDisabled` | `true` | 设置 `ASC_TELEMETRY_DISABLED=1` |
| `auditLog` | — | 每次调用追加一行 JSONL 审计 |
| `approvedActions` | `[]` | 写模式下跳过审批的 glob 标签 |
| `checkUpdates` | `true` | 在 `/asc-doctor` 显示最新版本 |
| `env` | `{}` | 传给 `asc` 的额外环境变量 |

---

## 技能

包内自带 6 个技能，注册在 bundled rank（600）。优先级为：项目 `.dsh/skills`（100）→ 项目 `.agents/skills`（200）→ 自定义（300）→ `~/.dsh/skills`（400）→ `~/.agents/skills`（500）→ bundled（600）。因此你自己安装的同名技能会覆盖内置版本——内置兜底、用户可覆盖。

想额外安装官方 25 个 ASC 技能：

```bash
asc install-skills   # 写入 ~/.agents/skills，DSH 会读取
```

DSH 的技能扫描路径是 `<项目>/.dsh/skills`、`<项目>/.agents/skills`、`customSkillDirs`、`~/.dsh/skills`、`~/.agents/skills` 和 `$DSH_BUNDLED_SKILL_DIR`；**不扫描 `~/.claude/skills`**。

---

## 从 0.1.3 升级

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

`asc_job` 与 `asc_setup` 名称不变；作业新增 `compliance-sweep`。

---

## 常见问题

| 现象 | 处理 |
|---|---|
| `/asc` 说找不到引擎 | `brew install asc`，或配置 `ascPath`，或开启 `allowProvision` 后执行 `asc_setup` `provision` |
| 鉴权失败 / exit 3 | 终端执行 `asc auth status --validate`；检查 key 在 App Store Connect 的角色 |
| Keychain 卡住 | 先在终端登录一次；或设置 `bypassKeychain: true` |
| 写操作被拒 | 仍是只读模式：把 `asc-tools` 行改成 `mode: write`，再带 `confirm: true` 重试 |
| 版本漂移提示 | `/asc-doctor` 会显示已装 / 测试范围 / 最新版本；按提示 `brew upgrade asc` |
| 结果太大 | `dataOmitted`：payload 在进入结果前被省略，缩小查询即可；只有原始输出被截断并落盘时才会出现 `spillPath`。 |
| 未知命令要求审批 | 预期行为；可设 `unknownCommands: deny` 改为直接拒绝 |
| 安装时 pnpm 报 peer 警告 | 正常：DSH 运行时提供 `@deepseek-ai/*` peer |

---

## 开发

```bash
npm install
npm run build        # tsc -> lib/
npm run typecheck
npm test             # vitest

node scripts/contract.mjs ./vendor/asc   # 对真实 asc 跑契约测试
node scripts/smoke.mjs                   # 编译产物冒烟

# 把本地构建装进 profile
npm pack && dsh plugin --profile desktop add ./sleep9ull-dsh-asc-cli-*.tgz

# 用本仓库起一个独立开发实例
dsh web --patch ./dev/cordis.patch.yml --no-open --port 3199
```

`vendor/asc` 已被 gitignore；契约与冒烟测试需要把真实二进制放在这里。CI 每晚会对上游最新 release 跑一次契约测试。

## License

MIT
