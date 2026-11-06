# ASC · DeepSeek Harness 的 App Store Connect 操作台

## 0.2.1 主要更新

- **旧版与新版宿主都能用**：同一插件兼容 Harness `0.2.1-rc.5` 和 `0.2.2-rc.1`，新增适配不会强制旧用户升级宿主。
- **更新 asc 验证基线**：推荐版本和可选代下载版本升至 `6.5.0`，继续保留经过验证的 `6.3.0` 支持；插件不会自动升级引擎。
- **使用时提供版本建议**：普通调用和 `/asc` 显示与实际引擎来源相关的版本提示；`/asc` 是轻量能力卡，完整环境与认证诊断交给 `/asc-doctor`。
- **持续验证兼容性**：双上游维护保留上一正式稳定兼容线，并逐步适配默认渠道更新；同一打包插件在两个受支持宿主及 Node 22/24 下验证。

**各版本的详细更新与迁移说明统一查看 [CHANGELOG.md](CHANGELOG.md)。**

> 当前 npm 发布版本是 [**0.2.1**](https://www.npmjs.com/package/@sleep9ull/dsh-asc-cli/v/0.2.1)。当前源码目标为**尚未发布的 0.2.2**，在打包前完成构建，消除本插件对消费者安装脚本授权的需求；详见 [spec 011](docs/specs/011-prebuilt-plugin-install.md) 和下方[安装插件](#1--安装插件)。

---

**用对话完成 TestFlight 发布、发版体检、反馈分诊与合规巡检。**

[English](README.md) | 中文

[![npm](https://img.shields.io/npm/v/@sleep9ull/dsh-asc-cli?label=npm&color=cb3837)](https://www.npmjs.com/package/@sleep9ull/dsh-asc-cli)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1--rc.5%20%7C%200.2.2--rc.1-4b5563)](https://github.com/deepseek-ai/deepseek-harness)

App Store Connect 是 iOS 发布流程的核心，也是团队最耗时间的地方：命令行参数、大段 JSON、状态机、审批与合规检查。这个插件把它搬进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：安装一次，用自然语言提出需求，Agent 会选对流程、先给出计划，并在真正改动线上之前停下来等你审批。

底层执行引擎仍是 [`asc` CLI](https://github.com/rorkai/App-Store-Connect-CLI)（MIT，Go）。本插件是它上层的产品层：5 个任务型**作业**、按意图组织的**读 / 计划 / 变更**工具面、随包发布的**内置技能**，以及负责体检、安装与版本对齐的**引擎管理器**。

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

先打开一次 DeepSeek Harness Desktop，初始化 profile，然后完全退出再安装。下面的命令安装已发布的 `0.2.1`；如果使用其他 profile，请把 `desktop` 替换为对应名称。

```bash
dsh plugin --profile desktop add @sleep9ull/dsh-asc-cli@0.2.1
```

安装来源请使用上面的 **npm 包名**。GitHub 仓库地址提供的是 TypeScript 源码，不包含编译后的 `lib/`，不能代替成品包入口。

从当前尚未发布的 `0.2.2` 源码起，插件在打包前完成构建和校验，用户安装预构建 npm 包或 `.tgz` 时无需执行本插件的安装脚本。待 `0.2.2` 正式发布后，将上面命令中的 `@0.2.1` 换成 `@0.2.2` 即可；其他包仍可能单独要求脚本授权。发布前体验当前源码，请按下方开发步骤构建本地安装包。

重启或重新加载 profile。插件会向 `cordis.patch.yml` 插入一行配置（默认 `mode: read-only`）。

### 2 · 准备引擎

```bash
brew install asc          # 或：curl -fsSL https://asccli.sh/install | bash
asc auth login --name "MyApp" --key-id ABC123 --issuer-id DEF456 --private-key /path/to/AuthKey.p8
```

然后运行 `/asc-doctor`，或让 Agent 执行 `asc_setup` 的 `diagnose`。如果还有缺失，它会给出**恰好一个**下一步。不要把私钥贴进对话；认证始终在你自己的终端完成。

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

第三条会走 `ship-testflight` 作业。`dryRun: true` 预览上传并跳过处理等待与加组，但上游可能联系 App Store Connect 预留上传操作，仍须走写操作确认与审批。

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
| `/asc` | 轻量能力卡：引擎/版本提示、默认 app、5 个作业；不检查认证 |
| `/asc-doctor` | 完整诊断：二进制/来源、声明支持范围与已验证 pin、认证、默认 app、provision、远端更新 |

命令直接对宿主执行，不产生模型消息。

### 6 个内置技能

随 npm 包发布，装完即可用——不需要 git、不需要全局技能目录：

`dsh-asc-quickstart` · `dsh-asc-auth` · `dsh-asc-release-readiness` · `dsh-asc-testflight-ship` · `dsh-asc-feedback-triage` · `dsh-asc-compliance-sweep`

覆盖首次使用选择、认证与 CI、发版体检、TestFlight 发布、反馈分诊、合规巡检——全部以本插件的工具语义书写。

### 引擎管理器

| 环节 | 行为 |
|---|---|
| 定位 | `ascPath` → `ASC_CLI_PATH` → 插件缓存 → `PATH` |
| 诊断 | 版本、声明支持范围和验证 pin、认证、默认 app、provision 状态，给一个下一步 |
| Provision | 可选：固定 `asc 6.5.0`、SHA-256 校验、按平台缓存 |
| 更新 | 普通调用和 `/asc` 显示来源相关的版本提示；`/asc-doctor` 展示完整事实；从不自动升级 |

`checkUpdates: true` 沿用已有默认值，允许的普通调用现在也可查询公共 GitHub release。成功结果内存缓存 24 小时，失败退避 15 分钟；普通调用最多额外等 1 秒，检查自身上限 5 秒。提示不改变业务成功/失败，同会话同版本组合只提示一次，job 只在顶层显示。设置 `checkUpdates: false` 关闭自动检查与远端版本查询；显式本地版本/诊断仍可用。

推荐目标是插件已验证 pin，未验证的 latest 仅告知。提示针对实际执行的配置路径、环境变量、插件缓存或 PATH；Homebrew 升级可能不会改变配置/缓存中的二进制。更新查询不再读写 `update-check.json`，旧文件保留不动；插件重启后可能重新查询。

开发维护机制见 [MAINTENANCE](docs/MAINTENANCE.md)：本地 Desktop 定时任务、仓库脚本、GitHub 门禁及可恢复的 main 同步。部署和持久写授权独立于插件安装，不自动发布 npm。Harness 维护固定 npm tarball，验证实际字节的 SHA-512 与注册表签名，并在安装前对照锁文件重新验证。缺少 `gitHead` 时记录未知源码 commit；注册表签名不证明源码构建来源。更新候选从精确宿主的严格 dependency/peer 图选择，各包独立 latest 仅作观察；每组开发/验证环境的宿主、组件和安装锁保持精确固定，用户宿主/peer 声明覆盖实际验证的支持集合。维护至少保留上一正式稳定兼容线，同时逐步适配默认渠道更新；1.x 以后按 major、0.x 按 minor 划线。没有正式稳定版时保留上一已验证基线，如实标明 RC。同一插件产物必须在保留与新增宿主上分别通过严格安装和真实审批测试，不能因追新静默排除旧用户。详见[长期兼容原则](docs/MAINTENANCE.md#0-长期兼容原则)。解析使用临时 npm lock/cache、关闭 scripts，不安装包。

---

## 文档

| 文档 | 内容 |
|---|---|
| [更新日志](CHANGELOG.md) | 各版本的详细更新、破坏性变更与迁移说明 |
| [契约](docs/CONTRACT.md) | 承诺与禁区、policy 矩阵、十条不变式 |
| [命令面](docs/COMMANDS.md) | 工具 / action / job / skill / 命令 / 配置 / 结果 |
| [架构](docs/ARCHITECTURE.md) | 分层、模块、数据流、扩展点 |
| [测试](docs/TESTING.md) | 测试模式、夹具、已知缺口 |
| [贡献](CONTRIBUTING.md) | 环境、Git 流程、质量门、发布 |
| [Spec](docs/SPECS.md) | spec-first 流程与索引 |
| [路线](docs/ROADMAP.md) | 版本计划与验收指标 |
| [ASC CLI 参考](ASC.md) | 上游 `asc` 命令目录与工作流配方（由 `asc init` 生成） |

## 为什么要做成插件，而不是让 Agent 直接跑 bash？

- **审批而非自证**：默认只读；写操作需要显式 `confirm` 和真人审批，模型无法自己放行。
- **先计划后执行**：`validate`、`status`、`--dry-run` 是一等公民，改动前先给你看。
- **结果适合对话**：摘要、修复顺序、计数替代大段 JSON；超大结果省略并给出下一步（只有原始输出被截断时才给 spill 指针）。
- **作业而非命令堆叠**：上传 → 等待 → 分组是一条确定性调用，不是五个可能被模型重排的命令。
- **Agent 自带工作流知识**：内置技能讲清作业、策略与失败恢复。
- **可审计**：可选的 JSONL 审计记录每次由工具发起的 `asc` 调用（engine 探针除外）；审批结论保留在 DSH 会话日志。

---

## 安全模型

- **默认只读**：每次调用带 `--read-only` + `ASC_READ_ONLY=1`，写操作在启动子进程前就被拒绝。
- **写模式**：需要 `confirm: true` 且默认弹出宿主审批；插件只在模型传入 `confirm: true` 时给底层命令加 `--confirm`，不会自行确认。
- **未知命令不静默**：无法确认只读的命令转人工审批（`ask`），或按配置直接拒绝（`unknownCommands: deny`）；写模式还额外要求 `confirm`。添加 `--report-file` 保留该策略，并额外要求确认本地文件写入。前导全局 flag 无法把禁区命令藏成 unknown。
- **非法参数在审批前失败**：已注册 action/job 会先校验互斥 flag、metadata 来源、包类型要求等组合，不会先弹审批再被上游 exit 2。
- **本地写需确认 + 审批**：`metadata init/plan/pull`、`docs init`、`doctor --fix`、`builds dsyms`、`install-skills`，以及所有写文件的 `download`/`export` 叶子（`screenshots download`、`profiles download`、`certificates export` 等）。
- **默认关闭值展开**：`asc` 会展开 flag 值里的 `@env:` / `@file:`；插件默认把行首 `@` 转义，除非显式开启 `allowValueExpansion`。
- **凭据不进模型**：宿主会清洗 `*KEY*` 变量，插件因此显式转发 `ASC_KEY_ID`、`ASC_ISSUER_ID`、`ASC_PRIVATE_KEY_PATH`、`ASC_PRIVATE_KEY`，从不读取、保存或打印密钥内容，并对 `ASC_WEB_SESSION` 做 tombstone，避免 web 会话 cookie 进入子进程。
- **永久拒绝**：`auth login/logout`、`asc web` 与 `versions phased-release guard`；分类器无法确认只读的命令转人工审批（`unknownCommands: ask`）或直接拒绝（`deny`）。
- **无 shell**：argv 数组直传；诊断信息脱敏；默认关闭 telemetry。
- **可选治理**：`auditLog` 记录执行内容；`approvedActions` 仅在写模式对已知动作跳过提示。

---

## 环境要求

| 依赖 | 版本 |
|---|---|
| DeepSeek Harness | 源码 `0.2.2`：保留 `0.2.1-rc.5` / Cordis `4.0.5` / Schemastery `3.18.5`，并适配 `0.2.2-rc.1` / `4.1.0` / `3.19.0`；peer 为精确并集，不强制升级宿主。同一打包插件在两个宿主上分别验证，见 spec 010 |
| Node.js | `^22.19.0 \|\| >=24.0.0`（推荐 24） |
| `asc` | 源码 `0.2.2`：已验证 pin `6.5.0`，保留基线 `6.3.0`；支持线 `>=6.3.0 <7.0.0`（`/asc-doctor` 会提示漂移） |
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
| `cacheDir` | — | 覆盖 provision 缓存目录；相对路径按宿主进程工作目录解析 |
| `bypassKeychain` | `false` | 设置 `ASC_BYPASS_KEYCHAIN=1`（CI / 无头环境） |
| `telemetryDisabled` | `true` | 设置 `ASC_TELEMETRY_DISABLED=1` |
| `auditLog` | — | 每次调用追加一行 JSONL 审计 |
| `approvedActions` | `[]` | 写模式下跳过审批的 glob 标签 |
| `checkUpdates` | `true` | 自动版本提示与公共 GitHub release 查询；false 保留显式本地诊断 |
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

## 升级到 0.2.1

可以继续使用已验证的 Harness `0.2.1-rc.5`，也可以使用 `0.2.2-rc.1`；更新插件不要求升级宿主。完全退出 Desktop，在原 profile 中按[安装方式](#1--安装插件)更新插件，然后重新打开 Desktop 或重新加载 profile。

运行 `/asc` 查看能力卡，运行 `/asc-doctor` 检查引擎和认证。启用写工作流前核对 `asc-tools` 配置。经过验证的 asc `6.3.0` 仍受支持；可选代下载推荐 `6.5.0`，仍需显式确认与宿主审批。

旧版本的更新记录和迁移映射统一保存在 [CHANGELOG.md](CHANGELOG.md)。

---

## 常见问题

| 现象 | 处理 |
|---|---|
| `/asc` 说找不到引擎 | `brew install asc`，或配置 `ascPath`，或开启 `allowProvision` 后执行 `asc_setup` `provision` |
| 鉴权失败 / exit 3 | 终端执行 `asc auth status --validate`；检查 key 在 App Store Connect 的角色 |
| Keychain 卡住 | 先在终端登录一次；或设置 `bypassKeychain: true` |
| 写操作被拒 | 仍是只读模式：把 `asc-tools` 行改成 `mode: write`，再带 `confirm: true` 重试 |
| 版本漂移提示 | `/asc-doctor` 显示已装版本、验证 pin、支持范围和上游 latest；按实际来源处理，未验证 latest 仅告知。 |
| 结果太大 | `dataOmitted`：payload 在进入结果前被省略，缩小查询即可；只有原始输出被截断并落盘时才会出现 `spillPath`。 |
| 未知命令要求审批 | 预期行为；可设 `unknownCommands: deny` 改为直接拒绝 |
| 安装时 pnpm 报 peer 警告 | 正常：DSH 运行时提供 `@deepseek-ai/*` peer |

---

## 开发

```bash
npm install
npm run build        # clean + tsc -> lib/
npm run typecheck
npm test             # vitest
node scripts/download-asc.mjs  # 下载基线版本并验证 SHA-256
npm run verify       # typecheck/test/build/pack/combos/contract/classify/smoke
npm run verify -- --unit-only  # 显式不运行引擎门禁

node scripts/contract.mjs ./vendor/asc   # 对真实 asc 跑契约测试
node scripts/smoke.mjs                   # 真实 Harness subprocess、隔离环境的离线引擎冒烟

# 把本地构建装进 profile
npm pack && dsh plugin --profile desktop add ./sleep9ull-dsh-asc-cli-*.tgz

# 用本仓库起一个独立开发实例
node scripts/dev-patch.mjs
dsh web --patch ./vendor/cordis.dev.patch.yml --no-open --port 3199
```

`vendor/asc` 已被 gitignore。完整验证需要校验过 SHA-256 的基线二进制；`--unit-only` 明确表示引擎门禁未经验证。普通 CI 同时检查已验证 pin 与最低保留引擎，并在 Node22/24 下用同一打包插件验证两个受支持宿主；每日任务对最新 release 跑 contract、分类审计与离线 smoke。开发 overlay 从当前 checkout 生成绝对路径。

## License

MIT
