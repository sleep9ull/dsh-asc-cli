# 006 · 使用插件时提示 asc 版本与升级路径

| 字段 | 值 |
|---|---|
| id | 006 |
| status | implemented |
| created | 2026-11-04 |
| related | [spec 005](005-scheduled-upstream-maintenance.md)；spec 004；CONTRACT I5/I8/I9、§4/§5 |

**一句话**：用户正常使用插件时，获得针对实际执行的 asc 二进制的版本提示，并能区分推荐升级与尚未验证的上游更新；插件不自动升级引擎。

> 用户于 2026-11-04 批准代码实现；本 spec 不授权全局安装、发布或修改用户环境。spec 005 和本 spec 可独立实施，npm 发布后安装用户才能获得新行为。

## 1. 背景与问题

- `src/control/engine.ts` 已有版本探测、兼容判断、GitHub latest 查询和 24 小时磁盘缓存。`checkUpdates` 当前默认 true，主要由 diagnose 使用。
- `/asc` 显式禁用更新查询，普通工具不主动提供更新建议。用户需要知道先运行 `/asc-doctor` 才能看到新版本。
- 现有提示将上游 latest 与升级建议相连，未明确区分“声明支持范围内”与“实际验证基线”；例如仓库 pin 6.3.0，而 2026-11-04 查询到的 latest 为 6.4.0。
- engine/runtime 共同按配置路径 → ASC_CLI_PATH → 插件缓存 → PATH 解析。统一建议 `brew upgrade asc` 可能升级不到实际执行的二进制。
- 普通使用时扩大现有更新查询，会扩大隐式写 `update-check.json` 的触发范围；本方案改为内存缓存，避免自动提示产生新的本地写。

## 2. 范围

- 复用 engine 的版本能力，在五工具的顶层结果及 `/asc` 中附加轻量版本提示。
- 本地实际版本、插件最低支持版本、已验证推荐版本、上游最新版本的统一状态计算。
- 有限等待、缓存、并发去重、会话提示去重、安装来源相关的人工升级建议。
- `/asc-doctor` 和 `asc_setup diagnose` 使用同一事实与文案规则；保留完整诊断能力。

## 3. 非目标（Out of scope）

- 不增加工具、action、job 或发布 skill；不增加宿主通知服务、toast、session-start hook 或长期后台定时器。
- 不自动安装/升级 asc，不执行 brew，不读取 Apple 凭据，不用完整 diagnose 作为普通工具前置步骤。
- 不在线获取“另一版本插件的认证清单”，不承诺当前安装插件已验证上游 latest。
- 不因为版本提示拒绝本来允许的调用，也不改变现有写策略；无法安全执行的命令仍由既有 policy/engine 拒绝。
- 不实现 spec 005 的仓库维护流程，不在这次功能实现中顺便提高 asc/Harness 基线。

## 4. 契约变更

| 面 | 变更 | 备注 |
|---|---|---|
| 工具/action | 名称、参数、kind、确认要求均不变 | 提示在共享层计算，handler 保持薄 |
| 配置 | 不增加配置；扩展已有 `checkUpdates` 的使用入口，默认值保持 true | false 关闭普通调用自动检查；显式版本/诊断仍能查询本地版本，但不查远端 |
| 结果 | 添加可选 `versionNotice` | 不改变 ok、exitCode、errorClass、data 或 job 步骤语义 |
| 版本事实 | compat.ts 显式区分最低要求、推荐已验证基线及支持上界 | 推荐版本复用 PINNED_ASC_VERSION；最低要求初始仍为 6.3.0，不在别处复制版本事实 |
| 缓存 | 更新元数据改为插件实例内存缓存，不再创建/更新 update-check.json | 重启后可重新查；旧文件不读取、不迁移、不删除 |
| 审批/审计 | 只读版本探针，无新落盘或安装；审批矩阵不变 | engine 探针仍沿用已有“不写插件审计”边界 |

### 4.1 结果字段

在 `src/format.ts` 定义唯一的 `AscVersionNotice`，顶层 `AscToolResult`、`JobResult`、`DiagnoseReport`、`ProvisionResult` 可选引用 `versionNotice`。没有提示时省略字段，避免改变旧字段或塞入业务 data。

| 字段 | 类型 / 规则 |
|---|---|
| `code` | `upgrade-required` / `upgrade-recommended` / `upstream-unverified` / `outside-supported-range` / `version-unknown` / `engine-missing` |
| `installedVersion` | 可选 string；解析成功才提供 |
| `recommendedVersion` | string；当前插件实际验证并用于 provision 的版本 |
| `supportedRange` | string；来自 compat.ts |
| `latestVersion` | 可选 string；成功验证远端响应后才提供 |
| `source` | `configured` / `env` / `cache` / `path`，对应实际解析来源 |
| `message` | 简短解释，明确是否建议升级及兼容性边界 |
| `hint` | 人工下一步；不作为自动执行命令，不含凭据、认证参数或未经处理的输出 |

同一结果最多一个 notice，按 §5.2 优先级合并事实。renderResult、job/setup 渲染及命令文本都显示 message/hint；不能仅放在 presentResult 卡片中，因为并非所有宿主消费卡片。结果中的路径不新增默认暴露：诊断沿用已有 resolution，普通提示仅说明来源，用户可运行 `/asc-doctor` 查看路径。

## 5. 行为规格

### 5.1 触发与执行边界

1. `checkUpdates: true` 时，工具调用通过参数校验、policy 和实际审批后，在顶层调用范围启动版本检查。被拒绝、非法或已取消调用不能因为提示额外 spawn 或 fetch。
2. 普通检查只执行 `asc version` 和可选的公共 GitHub release 查询；不执行 auth status、apps list、doctor，不发送 app/profile/认证信息给 GitHub。
3. 检查与业务执行并行；返回前最多额外等待 1 秒获取检查结果。未完成则返回已有业务结果；有界检查可在实例存活期间完成，下一次调用消费结果。检查自身最多 5 秒，不能存在无限后台请求。
4. 探针必须通过 engine → exec → ctx.subprocess，使用业务执行实际采用的二进制解析快照和有效 cwd/PATH。`asc` 这个字符串不能作为不同会话实际引擎相同的证据。路径无法与业务执行一致时不输出误导性已安装版本；报告 unknown。
5. engine/runtime 共用解析机制；必要的依赖注入放组合根，不让 engine 为了提示递归调用顶层装饰器。job 内部步骤不各自触发检查，最终 job 结果统一带一次提示。
6. `/asc` 使用相同轻量版本事实补充卡片。`/asc-doctor` / `asc_setup diagnose` 是显式诊断，不受提示去重抑制，保留认证等既有检查，但版本建议复用同一计算结果。
7. `asc_setup version` 复用本次命令结果，避免多跑一次 version；provision 成功后清除旧版本事实，按新引擎生成提示，失败时不得假设安装成功。其他 setup 动作统一通过顶层装饰器处理。
8. 提示服务失败不重放业务命令、不修改业务 outcome，也不覆盖原有错误 hint。取消调用不等待提示；共享检查的一个等待者取消不能取消其他等待者。插件卸载时取消尚未完成的提示探针和网络请求。

### 5.2 版本分类与推荐规则

兼容区间和已验证推荐版本均来自当前安装插件；latest 只说明上游发布状态，不赋予兼容保证。版本比较需按 SemVer 正确处理 prerelease/build metadata，未知或 malformed 值不能通过“比较为 0”当作相等。

| 条件（按顺序判断） | notice | 提示行为 |
|---|---|---|
| 已证实实际引擎不存在 | engine-missing | 提示安装或配置路径；不重复业务 missing-binary 错误文本 |
| 探针失败、输出非法或无法确认引擎身份 | version-unknown | 建议手工版本诊断；不得宣称已是最新版 |
| installed 低于最低要求 | upgrade-required | 推荐当前插件已验证版本，说明可能缺命令/flag；提示本身不硬阻断 |
| installed 在声明支持范围之外，含未声明支持的 prerelease | outside-supported-range | 提示兼容未确认，优先检查插件兼容说明；不自动降级 |
| installed 在范围内但低于推荐已验证版本 | upgrade-recommended | 建议升级到推荐版本，不使用未经验证的 latest 代替 |
| latest 高于 installed，且不属于当前推荐已验证版本 | upstream-unverified | 告知上游更新与未验证状态，建议检查插件更新/兼容说明，不直接建议升到 latest |
| installed 满足推荐且没有已知更新 | 无 | 不产生无意义的“已最新”提示；diagnose 可显示查询事实 |

无法查询 latest 不妨碍离线判断最低要求和推荐版本。网络失败的 diagnose 状态为“上游版本未知”；只有成功取得 latest 且比较有效才能声称未发现更高版本。高于推荐但仍在声明范围内的 installed 不标为“已实测”，也不主动建议降级。相同主/次/补丁的 prerelease 不能等同正式版。

### 5.3 缓存、去重与边界

- 远端成功结果在插件实例内共享缓存 24 小时；失败/限流负缓存 15 分钟，避免每个调用重试。未来时间戳、非法缓存数据或时钟回退使缓存失效。
- 本地版本按二进制身份缓存，包含实际解析路径和可取得的文件指纹；普通成功结果最多缓存 5 分钟。路径/文件指纹变化、provision 成功或显式 diagnose 会强制刷新；未知身份不能复用旧版本。失败不永久缓存，短暂失败最多抑制 15 秒。
- 同一身份的并发探针、同一实例的并发远端查询合并为一次；缓存不依赖某个业务调用的取消信号存活。
- 去重键为会话身份 + 二进制身份 + installed + notice code + 推荐版本 + latest。取得稳定宿主 session 对象时用弱引用管理；没有会话身份时退化为插件实例内有界去重（最多 128 条，淘汰最早项），不增加新的必需服务。
- 在 notice 实际进入顶层返回结果时才标记已展示；job 内层结果或超时丢弃的结果不能提前耗尽提示。并发同会话返回只展示一次，不同会话可分别展示。
- 版本/路径变化可再次提示；仅 TTL 刷新但事实相同不重复刷屏。手工诊断始终展示当前完整事实。
- 所有缓存均在内存中；不创建 cacheDir、update-check.json、日志或其他文件。磁盘缓存改动必须与自动触发在同一实现中落地。

### 5.4 安装来源相关建议

- `configured`：提示更新配置指向的二进制，或调整 ascPath；不假定它属于 Homebrew。
- `env`：提示更新 ASC_CLI_PATH 指向的二进制或修改该环境变量。
- `cache`：提示当前使用插件管理的已验证 pin。推荐版本较新时可说明启用 allowProvision 并显式调用现有 provision 的路径；确认/审批仍必须发生。仅 upstream latest 较新时说明 provision 仍安装当前 pin，不能宣称它会安装 latest。
- `path`：提示更新实际安装来源；Homebrew 命令只作为“如果由 Homebrew 安装”的条件示例，不通过额外 brew 子进程猜测安装方式。
- 任意来源的提示都不能触发安装。尤其不能让模型把 `upgrade-required` 当作 `confirm: true` 或宿主批准。

### 5.5 结构与交付

在实施前同步 ARCHITECTURE：engine 管事实/缓存，compat 管版本与比较，新增 `src/control/version-notice.ts` 管会话去重和提示协调，format 管公开字段与渲染，runtime/jobs/commands 连接顶层执行，index 负责装配。不能复制五份版本检查逻辑，也不能引入新的命令表或 policy 分支。

更新随包 quickstart/setup 相关 skill，要求模型在收到 notice 时简短转述人工下一步，不自动执行升级。实际用户可见性至少由工具文本/命令文本保证；不能仅靠模型一定会转述，也不承诺主动桌面通知。

## 6. 安全与审批影响

| 不变式 | 影响 |
|---|---|
| I1 | 只读探测，不新增自动本地写；业务写模式要求不变 |
| I2 | provision 继续 confirm + 宿主审批；notice 不是批准 |
| I3 | unknown 审批保持；拒绝调用不触发提示探针 |
| I4 | 不执行上游 release 文本；版本/路径不经 shell 拼接 |
| I5 | 版本探针沿既有 exec/subprocess；GitHub 请求不携带 Apple 或宿主认证信息 |
| I6 | 工具面仍为五个，不新增 action/job |
| I7 | 六个发布 skill 数量/rank 不变，受影响内容同步 |
| I8 | 推荐基线仍外置、固定、校验 checksum；从不自动升级 |
| I9 | 不产生额外审计或落盘；现有审计开关/脱敏不变 |
| I10 | forbidden 不变，不通过提示路径执行禁区命令 |

注意：把更新缓存改为内存会改变现有跨进程缓存行为，但消除了只读诊断隐式写缓存的副作用，不以“缓存例外”扩大 I1/I2。

## 7. 兼容与迁移

- 添加可选结果字段；旧调用参数、业务结果、工具数量和命令保留。本功能本身不提高最低 asc/Harness 版本。
- `checkUpdates: true` 的已有用户将在普通工具使用时增加公共 release 查询；README 中英文明确触发方式、超时、频率与关闭方式。false 禁用自动提示检查和所有远端版本查询，显式本地诊断仍可用。
- 更新缓存不再跨插件重启复用；旧 update-check.json 留在原位置且不读取、不删除。用户可自行清理，插件不自动迁移它。
- 移除“整个未来范围已经 tested”的措辞，区分 supported range 和验证 pin；未验证 latest 不成为默认升级目标。
- 初始发版建议 0.3.0，最终按合入时版本决定并同步 lock/CHANGELOG；发布本身需要单独授权。尚未发布则报告“代码已实现，npm 用户尚未获得”。

## 8. 验收标准（可执行）

- [x] 普通工具首次实际使用旧版引擎，顶层 JSON 和文本均含正确升级提示，业务结果保持原值；第二次同会话同事实不重复，新会话能提示。
- [x] read/write/local-write/unknown 的拒绝、缺批准、非法参数和已取消调用均不因 notice 增加 spawn/fetch。
- [x] job 多步骤只在最终结果展示一次；内层步骤不提前消耗去重标记。五个工具及 `/asc` 的用户入口均有集成覆盖。
- [x] latest 超出范围或尚未验证时不建议盲升；旧版离线仍推荐 pin；远端错误/非法版本不显示“已最新”；prerelease 不等于正式版。
- [x] 两个不同 cwd/PATH/配置来源的调用不会混用版本；同路径文件更新或 provision 后下一次检查能刷新事实；诊断 auth/apps 和 output 重试保持同一快照。
- [x] pending fetch/probe 不拖住业务结果超过额外 1 秒；检查完成后下次调用能展示；取消/卸载不遗留无限任务或误取消其他等待者。
- [x] 并发同身份只查一次；24 小时正缓存、15 分钟远端负缓存和本地缓存边界通过注入时间验证，不 sleep。
- [x] checkUpdates=false 时普通调用不额外探针/联网，显式 version/diagnose 仍能报告本地兼容状态。
- [x] 四种来源生成正确人工路径；缓存旧 pin 不建议通过无条件 brew upgrade 修复，不暗示 provision 会安装 latest。
- [x] 空缓存目录、既有缓存文件、不可写目录三种环境中，检查前后文件内容/目录集合不变；不会读取旧缓存误报版本。
- [x] `npm run verify` 全门通过；真实 Harness 渲染/会话隔离与 asc 离线探针通过。npm pack 保持零内嵌引擎、六个 skill 和零新运行时依赖。

### 8.1 实施记录（2026-11-04）

代码、文档及本地完整验收已完成。2026-11-04 11:59 用户在当前 worktree 手动执行 `npm run verify` 并提供完整成功输出，全部八阶段通过，17 suites / 321 tests，含真实 Harness 服务集成（子进程 seam 注入）、版本缓存/取消/去重、无落盘和诊断/重试快照回归。npm dry-run 打包仍为六个发布 skill，无内嵌引擎或新增运行时依赖。当前本机为 macOS / Node 24；本轮未运行远端 Node 22/24 CI 或原生 Windows。

此前自动执行因 `Code from External` 被拒绝，用户手动验证已补齐真实引擎验收：校验过 SHA-256 的 asc 6.3.0 接受 28 条命令，分类审计覆盖 1,932 条路径和 11 组 flag 且无写文件路径误分类为 read；离线 smoke 通过真实 Harness subprocess 完成 6 次调用，search、metadata init/validate 和四项 spawn 前拒绝均通过，HOME 与凭据隔离。功能未发布，npm 0.2.0 用户尚未获得这些新增行为。

早期红测试因旧实现忽略 fetch 注入，曾意外查询公网并新建用户缓存 `update-check.json`。之后测试隔离 DSH_HOME 并默认拒绝全局 fetch；本轮最终测试全部采用注入网络。该次缓存的单文件清理被自动审批以 `Irreversible Local Destruction` 拒绝，文件保留；新实现不读写或删除旧缓存。

## 9. 测试计划

| 类型 | 内容与捕获的回归 |
|---|---|
| engine/compat 单元 | 注入 spawn/fetch/now；捕获错误推荐、SemVer 误判、过期/失败缓存、来源错配与同路径旧版本复用 |
| runtime/job/format | 捕获提示改变业务 outcome、提示丢失、嵌套重复或提前耗尽去重；覆盖各顶层结果类型 |
| 真实 Harness 集成 | 捕获审批前额外执行、会话互相吞提示、缺少可选服务时崩溃、文本渲染不展示 |
| 取消/延迟 | 使用可控 promise、假时钟和合成信号，验证等待上界及清理；不触网、不 sleep |
| 文件副作用 | 临时目录及文件读写 seam，检查查询不再创建/更新/读取磁盘缓存 |
| 离线 smoke | 真实目标 asc 的版本解析、共同解析路径与原有业务 smoke；GitHub fetch 仍注入 |

每个测试围绕调用者可观察的回归，不断言字段常量本身、不复制全部 action 矩阵。真实线上 release 查询不作为自动测试的必要条件。

## 10. 文档与 skill 同步

- [x] ARCHITECTURE：engine/notice/runtime/format 分工、取消及缓存生命周期。
- [x] CONTRACT / AGENTS：I8 的范围与已验证基线含义、更新提示只读且不自动安装；无需放宽 I1–I10。
- [x] COMMANDS：checkUpdates 语义、可选 versionNotice 字段、四种来源的升级方式。
- [x] TESTING：提示、去重、等待上界和无落盘回归。
- [x] README / README.zh：用户实际会看到的提醒、关闭方式、跨重启查询与非自动升级承诺。
- [x] CHANGELOG 与受影响的六个既有 skill：新行为与迁移；不得先于代码宣称已支持。

## 11. 开放问题与默认决定

| 问题 | 草案决定 | 阻塞阶段 |
|---|---|---|
| 普通使用是否默认检查 | 复用已有默认 true 的 checkUpdates，不新增默认开启配置；扩展触发语义需随本 spec 评审 | spec 批准 |
| 自动查询是否继续落盘 | 统一改内存缓存，避免新增审批/缓存写例外 | 无，已定方案 |
| 宿主 session 身份 | 实现时核对真实 ToolRunContext；有身份用会话去重，无身份按实例有界退化 | 宿主集成实现 |
| 推荐目标 | 当前插件已验证 pin；latest 只作资讯，不自动建议未验证更新 | 无，已定方案 |
| 发布时间 | 功能实现/验证后另行授权发布，不与维护任务合并授权混淆 | 仅发布 |
