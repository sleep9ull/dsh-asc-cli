# dsh-asc-cli

**DeepSeek Harness 的 App Store Connect 操作台，底层是 [`asc` CLI](https://github.com/rorkai/App-Store-Connect-CLI)。**

这是一个 DSH **bundle 插件**：不重写 App Store Connect API，`asc`（Go 二进制）仍是执行引擎；插件负责让 AI 安全、准确、省 token 地使用它。

- **默认只读**：任何写操作都需要显式 `confirm` + 宿主审批。
- **意图级工具**：应用、构建、TestFlight、元数据、发布五条主流程；长尾用 `asc_search` + `asc_run`。
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
dsh plugin --profile desktop add dsh-asc-cli

# 本地 checkout / tarball
npm run build && npm pack
dsh plugin --profile desktop add ./dsh-asc-cli-0.1.0.tgz
```

重启或重新加载 profile。从内置模板创建的 profile 在**首次启动**时可能会生成模板自带的用户 patch 文件，因此请在首次启动之后再编辑 `cordis.patch.yml`（或直接用 `--patch` overlay）。默认插入一行配置：

```yaml
- insert:
    - id: asc-tools
      name: dsh-asc-cli
      config:
        mode: read-only
```

在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里按 `id: asc-tools` 覆盖（patch 是整块替换，需重述所有键）：

```yaml
- id: asc-tools
  name: dsh-asc-cli
  config:
    mode: write
    requireApproval: true
    profile: MyApp
    defaultAppId: "123456789"
```

## 工具

| 工具 | actions | 会改 ASC |
|---|---|---|
| `asc_setup` | `version` / `auth-status` / `doctor` / `system-status` / `install-skills` | 否 |
| `asc_search` | — | 否 |
| `asc_run` | 任意 `asc` argv | 按命令分类 |
| `asc_apps` | `list` / `view` | 否 |
| `asc_builds` | `list` / `next-number` / `upload` / `add-groups` | `upload` / `add-groups` |
| `asc_testflight` | `feedback` / `crashes` / `groups` | 否 |
| `asc_metadata` | `init` / `validate` / `plan` / `apply` | `apply`（先 `dryRun`） |
| `asc_release` | `status` / `validate` / `stage` / `publish` | `stage` / `publish` |

结果统一为紧凑 JSON：`ok`、`exitCode`、`command`、`durationMs`、`summary`、`data`、`errorClass`、`hint`、`spillPath` 等。错误会翻译成下一步动作；超限输出写入 spill 文件。

## 安全模型

- **只读模式（默认）**：每次调用带 `--read-only` + `ASC_READ_ONLY=1`；写操作在**启动子进程之前**被拒绝。
- **写模式**：写操作需要 `confirm: true`，默认还会弹出宿主审批；插件从不自动加 `--confirm`。
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
| `env` | `{}` | 传给 `asc` 的额外环境变量 |
| `defaultAppId` | — | 省略 `app` 参数时的默认 App |

## 技能包

在会话里让模型调用 `asc_setup` 的 `install-skills`，或自己运行 `asc install-skills`。DSH 会从 `~/.claude/skills`、`~/.agents/skills`、`~/.dsh/skills` 和项目 `.dsh/skills` 读取 `SKILL.md`；安装后新建会话即可看到 ASC 技能。

## 上游更新怎么跟

- 所有命令形状集中在 `src/registry.ts`，升级只改一张表 + fixture。
- `scripts/contract.mjs` 用真实 `asc` 对每个命令跑 `--help`，命令/flag 改名会 CI 失败。
- `asc_search` / `asc_run` 保证上游新命令无需插件发版即可使用。
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
| 找不到 `asc` | `brew install asc`，或配置 `ascPath` |
| 鉴权失败 / exit 3 | `asc auth status --validate`，检查 API Key 角色 |
| Keychain 卡住 | 先在终端登录，或用 `bypassKeychain: true` |
| 写操作被拒 | 插件处于只读模式：把 `asc-tools` 行改成 `mode: write`，再带 `confirm: true` 重试 |
| JSON 太大 | 结果会自动截断 + spill；缩小查询范围 |
| 安装时 pnpm 报 peer 警告 | 正常：DSH 运行时提供 `@deepseek-ai/*` peer，插件从宿主解析 |

## License

MIT
