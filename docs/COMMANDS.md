# 命令面参考（COMMANDS）

> 基线：`0.2.0`｜**权威来源**：`src/registry.ts`（action 表）、各工具 schema（参数）、`./vendor/asc <cmd> --help`（上游行为）。
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
| `asc_setup.auth-status` | read | — | ✓ | — | `asc auth status --validate` |
| `asc_setup.doctor` | read | — | ✓ | — | `asc doctor` |
| `asc_setup.system-status` | read | — | ✓ | — | `asc system-status [--issues-only]` |
| `asc_setup.install-skills` | local-write | ✓ | no | — | `asc install-skills` |
| `asc.apps-list` | read | — | ✓ | — | `asc apps list --limit 20 [--name …] [--bundle-id …] [--sort …] [--paginate]` |
| `asc.apps-view` | read | — | ✓ | — | `asc apps view --id <app>` |
| `asc.builds-list` | read | — | ✓ | — | `asc builds list --app <app> --limit 20 [--version] [--build-number] [--platform] [--exclude-expired] [--paginate]` |
| `asc.builds-next-number` | read | — | ✓ | — | `asc builds next-build-number --app <app> [--version] [--platform] [--exclude-expired]` |
| `asc.testflight-feedback` | read | — | ✓ | — | `asc testflight feedback list --app <app> --limit 20 [--sort] [--paginate]` |
| `asc.testflight-crashes` | read | — | ✓ | — | `asc testflight crashes list --app <app> --limit 20 [--sort] [--paginate]` |
| `asc.testflight-groups` | read | — | ✓ | — | `asc testflight groups list --app <app> [--internal / --external]`（互斥） |
| `asc.reviews-list` | read | — | ✓ | — | `asc reviews list --app <app> --limit 20 [--sort] [--paginate]` |
| `asc.metadata-validate` | read | — | ✓ | — | `asc metadata validate --dir <dir>` |
| `asc_plan.validate` | read | — | ✓ | — | `asc validate --app <app> [--version] [--platform] [--strict] [--deep]` |
| `asc_plan.status` | read | — | ✓ | ✓ | `asc status --app <app> [--platform] [--include] [--until] [--timeout]`（长任务） |
| `asc_plan.metadata-plan` | local-write | ✓ | ✓ | — | `asc metadata plan --app <app> --version <v> --dir <dir> [--platform] [--review-dir]` |
| `asc_apply.upload` | write | ✓ | ✓ | ✓ | `asc builds upload --app <app> --ipa/--pkg <file> [--version] [--build-number] [--wait] [--dry-run]`；`.pkg` 必填 version+build-number；`--dry-run` 与 `--wait` 互斥 |
| `asc_apply.groups` | write | ✓ | ✓ | — | `asc builds add-groups --group <group> --build-id <id>` 或 `--app <app> --latest [--version] [--platform]`；`--submit` 与 `--dry-run` 互斥；`--confirm` 仅随 `--submit` |
| `asc_apply.metadata-init` | local-write | ✓ | ✓ | — | `asc metadata init --dir <dir> [--version] [--locale] [--force]` |
| `asc_apply.metadata-apply` | write | ✓ | ✓ | — | `asc metadata apply --app <app> --version <v> --dir <dir> [--platform] [--review-dir] [--dry-run]` |
| `asc_apply.stage` | write | ✓ | ✓ | ✓ | `asc release stage --app <app> --version <v> --build-id <id> (--metadata-dir <dir> / --copy-metadata-from <v>) [--platform] [--dry-run]` |
| `asc_apply.publish` | write | ✓ | ✓ | ✓ | `asc publish appstore --app <app> (--ipa <f> / --pkg <f>) [--version] [--build-number] [--platform] [--wait] [--submit --confirm]`；`.pkg` 必填 version+build-number，`.ipa` 不接受 `MAC_OS` |

统计：**15 read / 5 write / 3 local-write**。`run` / `discover` 不在表内：
- `asc.run`：argv 由模型给，分类器决定 kind（先归一化前导全局 flag）；**写本地文件的 `download`/`export` 叶子是 `local-write`**，两种模式都要 confirm + 审批；write/unknown 需要 confirm（read-only 下 write 拒绝、unknown 审批）。
- 参数组合由 registry 在 confirm/审批**之前**校验，非法组合直接 `ASC_INVALID_ARGUMENTS` 拒绝（见 §3 与 `scripts/contract-combos.mjs`）。
- `asc.discover`：把关键词交给 `asc search`，`kind: read`。
- `run` 的 `--report-file`、doctor `--fix`、Xcode Cloud `--save-logs`、review digest `--write-state` 等本地产物写入需要 confirm + 默认审批；`--report-file` 不降低 unknown 风险，仍走原有 ask/deny；flag 值不参与命令动词判断。`versions phased-release guard` 可执行任意程序，即使 dry-run 也 forbidden。

---

## 3. jobs（5 个）

| job | 风险 | 需要 confirm | 必填 | 可选 | 说明 |
|---|---|---|---|---|---|
| `release-check` | read | — | app（或 `defaultAppId`） | version、platform | validate → 阻塞项与修复顺序 |
| `ship-testflight` | write | ✓ | app（或 `defaultAppId`）、file；`.pkg` 另需 version+buildNumber | version、buildNumber、group、submit、dryRun、platform | dryRun 向 ASC 预留上传操作但不传文件、不等处理、不加组，仍需写审批；真实运行 upload `--wait` → buildId → add-groups（可选 beta 审核） |
| `stage-release` | write | ✓ | app（或 `defaultAppId`）、version、buildId、metadataDir/copyMetadataFrom **二选一** | platform、dryRun | 校验 → 附 build → 应用 metadata，不提交 |
| `triage-feedback` | read | — | app（或 `defaultAppId`） | limit | 反馈 + 崩溃 + 评论聚合；评论失败不致命，summary 用 `skipped`/`attempted-failed` 区分 |
| `compliance-sweep` | read | — | app（或 `defaultAppId`） | — | 四个只读探针，单个失败不致命 |

写 job 需要 `mode: write` + `confirm: true` + 审批；`validateJobArgs` 与 `runJob` 在审批前/执行前各校验一次，非法参数不会走到审批。

---

## 4. skills（6 个，随包 rank 600）

`dsh-asc-quickstart` · `dsh-asc-auth` · `dsh-asc-release-readiness` · `dsh-asc-testflight-ship` · `dsh-asc-feedback-triage` · `dsh-asc-compliance-sweep`

---

## 5. commands（2 个）

| command | 内容 | 约束 |
|---|---|---|
| `/asc` | 轻量能力卡：engine、版本提示、默认 app、5 个 job；认证标为未检查 | 只读，不产生模型消息，不查询 Apple |
| `/asc-doctor` | 二进制/来源/版本 vs 区间/认证/默认 app/provision/更新 | 只读；版本更新缓存仅内存，不写文件 |

---

## 6. 结果契约

`AscToolResult`：

```ts
{ ok, exitCode, command, durationMs, summary, errorClass?, hint?, data?,
  dataOmitted?, dataBytes?, text?, stderrTail?, truncated?, spillPath?,
  timedOut?, aborted?, versionNotice? }
```

`versionNotice` 也可出现在 job、diagnose、provision 顶层结果。字段为 `code, installedVersion?, recommendedVersion, supportedRange, latestVersion?, source, message, hint`。code 为 `upgrade-required / upgrade-recommended / upstream-unverified / outside-supported-range / version-unknown / engine-missing`。source 为 `configured / env / cache / path`。提示仅是建议，不改变 `ok`、业务 `hint` 或审批；在普通文本结果中显示，同会话同版本组合去重，job 内层步骤不重复。手动诊断不受展示去重限制。

- **错误分类**（10 类）：`auth` `state-conflict` `rate-limit` `usage` `missing-binary` `network` `timeout` `cancelled` `parse` `unknown`。
- **projector**：`validate`（readiness）、`status`（dashboard）、`metadata`（counters）有专用摘要。
- **裁剪**：`maxDataBytes`（默认 8,000，按 UTF-8 字节）超限省略 `data` 并给 `dataOmitted` + `dataBytes`（字节数，不落盘）；`maxOutputBytes`（默认 256 KB）截断给 `spillPath`；`dataOmitted` 不产生 `spillPath`。
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
| `maxDataBytes` | `8000` | `data` 省略阈值（UTF-8 字节） |
| `workdir` | — | 覆盖工作目录 |
| `allowValueExpansion` | `false` | 允许 `@env:` / `@file:` 展开 |
| `unknownCommands` | `ask` | 无法证明只读时 `ask` / `deny` |
| `allowProvision` | `false` | 允许下载固定版本 asc |
| `cacheDir` | — | provision 缓存目录；相对路径按宿主进程 cwd 解析为绝对路径，不随工具 cwd 改变 |
| `auditLog` | — | JSONL 审计路径 |
| `approvedActions` | `[]` | 写模式跳过审批的 action glob |
| `checkUpdates` | `true` | 普通使用时检查版本并查询公共 GitHub release；false 禁用自动检查及所有远端版本查询，保留显式本地诊断 |
| `bypassKeychain` | `false` | `ASC_BYPASS_KEYCHAIN=1` |
| `telemetryDisabled` | `true` | `ASC_TELEMETRY_DISABLED=1` |
| `env` | `{}` | 额外环境变量 |

---

## 8. 审计字段

`ts, tool, action, kind, argv, cwd, mode, confirm, ok, exitCode, durationMs, errorClass, appId?`

- 仅 `auditLog` 配置后写入；best-effort、脱敏、`0o600`、单行 ≤ 8 KB（UTF-8 字节）。
- 凭据形态 flag 的值结构化脱敏（独立 `--token SECRET` 与内联 `--token=SECRET`/`--pagination-token=…`）。
- `appId` 在参数带 `app`/`--app` 或配置了 `defaultAppId` 时写入，否则省略。
- **只记录工具发起的 `asc` 调用**；engine 探针（`version`/`auth status`/`doctor`/`diagnose`/`provision`）不写审计（在宿主 session log 之外，属已知例外）。
- 不记录审批 allow/deny（在宿主 session log）。

---

## 9. 引擎

| 环节 | 规则 |
|---|---|
| 定位 | `ascPath` → `ASC_CLI_PATH` → 插件缓存 → `PATH` |
| 版本 | pin `6.5.0`；支持线 `>=6.3.0 <7.0.0`（`src/compat.ts`）；实际回归覆盖 6.3.0 与 6.5.0，未来 minor 由漂移门监测 |
| provision | 默认关；pin 版本 + SHA-256；缓存到 `cacheDir`；下载透传取消信号，安装前再次检查取消 |
| 更新检查 | GitHub latest 成功缓存 24h、失败 15min，均在实例内存；重启可重查；旧 update-check.json 不读写/删除 |
| 普通提示 | 审批/参数校验后与业务执行并行，最多额外等待 1s；检查自身 5s 上限；业务 outcome 不变 |
| 本地版本 | 依实际执行快照、cwd/PATH 和文件指纹隔离；成功 5min、失败 15s；手动诊断和 provision 刷新 |
| 推荐 | 只推荐已验证 pin；未验证 latest 仅告知，prerelease 不当正式版；来源对应人工升级方式，不自动安装 |

---

## 10. 如何验证本文件

```bash
npm test                                  # 含 registry / policy / jobs / tools 断言
node scripts/contract.mjs ./vendor/asc    # 23 条 action + 5 条 job/discovery 路径，含 flag 声明校验
node scripts/contract-combos.mjs          # 非法参数组合必须由插件拒绝
node scripts/classify-audit.mjs ./vendor/asc  # completion 漂移：不得有 read 的写文件叶子
npm run verify                            # 一键质量门（含 build/pack/contract/classify/smoke）
```

新增/修改 action 时，本文件必须与 `src/registry.ts` 同步更新（见 [`CONTRIBUTING.md`](./CONTRIBUTING.md) §4 文档同步矩阵）。
