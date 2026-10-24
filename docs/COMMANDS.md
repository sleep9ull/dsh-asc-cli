# 命令面参考（COMMANDS）

> 基线：`0.1.5`｜**权威来源**：`src/registry.ts`（action 表）、各工具 schema（参数）、`./vendor/asc <cmd> --help`（上游行为）。
> 本文件是参考手册，不是契约；与代码冲突时以代码 + 测试为准，并修正本文件。契约见 [`CONTRACT.md`](./CONTRACT.md)，架构见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。

---

## 1. 工具（5 个）

| 工具 | 职责 | 入口动作 |
|---|---|---|
| `asc` | 读 + 逃生舱 | 9 个 typed read + `discover` + `run` |
| `asc_plan` | 只读计划 | `validate` / `status` / `metadata-plan` |
| `asc_apply` | 全部变更 | 6 个写/本地写 |
| `asc_job` | 工作流 | 5 个 job |
| `asc_setup` | 环境与引擎 | 4 个 read + `install-skills` + `diagnose` / `provision` |

`diagnose` / `provision` 由 engine 管理，不在 registry 中；`run` / `discover` 在 policy 中特判。

---

## 2. action 表（23 条 registry）

`confirm` = 是否需要模型显式 `confirm: true`；`output` = 是否默认追加 `--output json`；`long` = 是否使用 `longTimeoutMs`。

| action | kind | confirm | output | long | 上游命令（示例参数） |
|---|---|---|---|---|---|
| `asc_setup.version` | read | — | no | — | `asc version` |
| `asc_setup.auth-status` | read | — | — | — | `asc auth status --validate` |
| `asc_setup.doctor` | read | — | — | — | `asc doctor` |
| `asc_setup.system-status` | read | — | — | — | `asc system-status` |
| `asc_setup.install-skills` | local-write | ✓ | no | — | `asc install-skills` |
| `asc.apps-list` | read | — | ✓ | — | `asc apps list --limit 20 [--name …] [--bundle-id …]` |
| `asc.apps-view` | read | — | ✓ | — | `asc apps view --id <app>` |
| `asc.builds-list` | read | — | ✓ | — | `asc builds list --app <app> --limit 20 [--version] [--build-number] [--platform] [--exclude-expired]` |
| `asc.builds-next-number` | read | — | ✓ | — | `asc builds next-build-number --app <app> [--version] [--platform] [--exclude-expired]` |
| `asc.testflight-feedback` | read | — | ✓ | — | `asc testflight feedback list --app <app> --limit 20` |
| `asc.testflight-crashes` | read | — | ✓ | — | `asc testflight crashes list --app <app> --limit 20` |
| `asc.testflight-groups` | read | — | ✓ | — | `asc testflight groups list --app <app> [--internal / --external]` |
| `asc.reviews-list` | read | — | ✓ | — | `asc reviews list --app <app> --limit 20 [--sort]` |
| `asc.metadata-validate` | read | — | ✓ | — | `asc metadata validate --dir <dir>` |
| `asc_plan.validate` | read | — | ✓ | — | `asc validate --app <app> [--version] [--platform]` |
| `asc_plan.status` | read | — | ✓ | — | `asc status --app <app> [--platform]`（长任务） |
| `asc_plan.metadata-plan` | local-write | ✓ | ✓ | — | `asc metadata plan --app <app> [--version] --dir <dir>` |
| `asc_apply.upload` | write | ✓ | ✓ | ✓ | `asc builds upload --app <app> --ipa/--pkg <file> [--version] [--build-number] [--wait]` |
| `asc_apply.groups` | write | ✓ | ✓ | — | `asc builds add-groups --app <app> --group <group> [--build-id <id> 或 --latest] [--submit --confirm]` |
| `asc_apply.metadata-init` | local-write | ✓ | ✓ | — | `asc metadata init --dir <dir> [--version]` |
| `asc_apply.metadata-apply` | write | ✓ | ✓ | — | `asc metadata apply --app <app> [--version] --dir <dir> [--confirm]` |
| `asc_apply.stage` | write | ✓ | ✓ | ✓ | `asc release stage --app <app> [--version] [--build-id] [--platform] [--confirm]` |
| `asc_apply.publish` | write | ✓ | ✓ | ✓ | `asc publish appstore --app <app> [--version] [--build-number] [--platform] [--submit --confirm]` |

统计：**15 read / 5 write / 3 local-write**。`run` / `discover` 不在表内：
- `asc.run`：argv 由模型给，分类器决定 kind；write/unknown 需要 confirm（read-only 下 write 拒绝、unknown 审批）。
- `asc.discover`：把关键词交给 `asc search`，`kind: read`。

---

## 3. jobs（5 个）

| job | 风险 | 需要 confirm | 说明 |
|---|---|---|---|
| `release-check` | read | — | validate → 阻塞项与修复顺序 |
| `ship-testflight` | write | ✓ | 上传 → 等处理 → 取 build id → 加组（可选 beta 审核） |
| `stage-release` | write | ✓ | 校验 → 附 build → 应用 metadata，不提交 |
| `triage-feedback` | read | — | TestFlight 反馈 + 崩溃 + 评论聚合 |
| `compliance-sweep` | read | — | 年龄分级 / 加密声明 / 可访问性 / current pricing |

写 job 需要 `mode: write` + `confirm: true` + 审批；`runJob` 在 runner 内再复核一次闸门。

---

## 4. skills（6 个，随包 rank 600）

`dsh-asc-quickstart` · `dsh-asc-auth` · `dsh-asc-release-readiness` · `dsh-asc-testflight-ship` · `dsh-asc-feedback-triage` · `dsh-asc-compliance-sweep`

---

## 5. commands（2 个）

| command | 内容 | 约束 |
|---|---|---|
| `/asc` | 能力卡：engine、auth、默认 app、5 个 job、下一步 | 只读，不产生模型消息 |
| `/asc-doctor` | 二进制/来源/版本 vs 区间/认证/默认 app/provision/更新 | 只读 |

---

## 6. 结果契约

`AscToolResult`：

```ts
{ ok, exitCode, command, durationMs, summary, errorClass?, hint?, data?,
  dataOmitted?, dataBytes?, text?, stderrTail?, truncated?, spillPath?,
  timedOut?, aborted? }
```

- **错误分类**（10 类）：`auth` `state-conflict` `rate-limit` `usage` `missing-binary` `network` `timeout` `cancelled` `parse` `unknown`。
- **projector**：`validate`（readiness）、`status`（dashboard）、`metadata`（counters）有专用摘要。
- **裁剪**：`maxDataBytes`（默认 8,000）超限省略 `data` 并给 `dataOmitted` + `dataBytes`（不落盘）；`maxOutputBytes`（默认 256 KB）截断给 `spillPath`。
- `output.schema` 是通用 `json`；类型以 `AscToolResult` 为准。

---

## 7. 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `mode` | `read-only` | `read-only` / `write` |
| `requireApproval` | `true` | 写路径是否弹审批 |
| `ascPath` | `asc` | 可执行文件或绝对路径 |
| `profile` | — | `asc --profile` |
| `defaultAppId` | — | 工具未传 `app` 时的回退 |
| `timeoutMs` | `60000` | 普通命令超时 |
| `longTimeoutMs` | `1800000` | 上传 / 发布等待 |
| `maxOutputBytes` | `262144` | stdout 截断阈值 |
| `maxDataBytes` | `8000` | `data` 省略阈值 |
| `workdir` | — | 覆盖工作目录 |
| `allowValueExpansion` | `false` | 允许 `@env:` / `@file:` 展开 |
| `unknownCommands` | `ask` | 无法证明只读时 `ask` / `deny` |
| `allowProvision` | `false` | 允许下载固定版本 asc |
| `cacheDir` | — | provision 缓存目录 |
| `auditLog` | — | JSONL 审计路径 |
| `approvedActions` | `[]` | 写模式跳过审批的 action glob |
| `checkUpdates` | `true` | `/asc-doctor` 检查上游新版本 |
| `bypassKeychain` | `false` | `ASC_BYPASS_KEYCHAIN=1` |
| `telemetryDisabled` | `true` | `ASC_TELEMETRY_DISABLED=1` |
| `env` | `{}` | 额外环境变量 |

---

## 8. 审计字段

`ts, tool, action, kind, argv, cwd, mode, confirm, ok, exitCode, durationMs, errorClass, appId`

- 仅 `auditLog` 配置后写入；best-effort、`0o600`、单行 8 KB。
- 凭据形态 flag 的值结构化脱敏；`data` / `command` 未脱敏（已知缺口）。
- 不记录审批 allow/deny（在宿主 session log）。

---

## 9. 引擎

| 环节 | 规则 |
|---|---|
| 定位 | `ascPath` → `ASC_CLI_PATH` → 插件缓存 → `PATH` |
| 版本 | pin `5.16.0`；区间 `>=5.16.0 <6.0.0`（`src/compat.ts`） |
| provision | 默认关；pin 版本 + SHA-256；缓存到 `cacheDir` |
| 更新检查 | GitHub latest，24h 缓存，只建议，永不自动升级 |

---

## 10. 如何验证本文件

```bash
npm test                                  # 含 registry / policy / jobs 断言
node scripts/contract.mjs ./vendor/asc    # 23 条命令对上游 --help 校验
./vendor/asc <command> --help             # 单个命令的权威行为
```

新增/修改 action 时，本文件必须与 `src/registry.ts` 同步更新（见 [`CONTRIBUTING.md`](./CONTRIBUTING.md) §4 文档同步矩阵）。
