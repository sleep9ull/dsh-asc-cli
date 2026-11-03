# 004 · 适配最新 DeepSeek Harness 与 asc

| 字段 | 值 |
|---|---|
| id | 004 |
| status | implemented |
| created | 2026-11-03 |
| related | CONTRACT §3/§5；spec 003 |

**一句话**：按用户明确要求调整旧版本契约，以当前两个上游默认发布渠道的最新版本完成适应性更新；用户已明确要求“调整契约，不要锁 5.16”。

## 1. 背景与来源

当前插件 0.1.6 依赖 Harness 0.2.1-rc.2，asc 默认为 5.16.0、支持声明排除所有 6.x，而 CI 下载 latest。迁移必须一起更新实际行为、版本声明与验证对象。

本次上游事实基线（2026-11-03 查询）：

- DeepSeek Harness：官方默认安装 `npx @deepseek-ai/dsh web` 的 npm latest/next 为 `0.2.1-rc.5`，GitHub tag `dsh-v0.2.1-rc.5`，commit `b830ec950faba0a46dda564be3e2d854afed94f1`。独立 alpha 渠道不作为默认兼容承诺。
- asc：GitHub latest release/tag `6.3.0`，commit `4f67da429b0f7233601703f313feb2ece10ba00d`。按该 tag 源码比对，不以旧 5.16 契约限制适配。未发布 main 已领先该 release，本次不将 main 等同 6.3.0，也不宣称通过了未发布版本的兼容验证。
- Harness rc.2 到 rc.5 的 tools/schema/subprocess/skills/commands/package-manifest 核心接口未变；不虚构 breaking API 迁移。仍需以实际 rc.5 服务验证注册、审批及执行。

来源：[Harness](https://github.com/deepseek-ai/deepseek-harness/tree/b830ec950faba0a46dda564be3e2d854afed94f1)、[asc](https://github.com/rorkai/App-Store-Connect-CLI/tree/4f67da429b0f7233601703f313feb2ece10ba00d)。

## 2. 范围与非目标

范围：宿主依赖与 Node engines、asc 版本事实与默认 provision、上游参数组合、通用命令分类/本地写检测、真实宿主集成、可复现 CI 与离线烟测、相关契约与使用文档。

非目标：不新增工具/job/skill；不追求覆盖上游全部命令；不启用 alpha 或追踪未发布 master API；不自动升级已安装引擎；不执行真实 ASC 写操作；不发布 npm/tag、提交、push 或创建 PR。

## 3. 契约变更

| 面 | 变更 |
|---|---|
| 宿主 | peers/dev dependencies 升为 rc.5；`engines.dsh` 为 `>=0.2.1-rc.5 <0.2.2-0`，不放进未验证的 alpha；Node 与上游 `^22.19.0 \|\| >=24.0.0` 对齐 |
| 引擎 I8 | 移除 5.16.0/<6.0.0 旧约束；默认 provision 6.3.0，支持基线 `>=6.3.0 <7.0.0`，明确实际验证版本为 6.3.0、未来 minor 由漂移门监测 |
| 参数 | `publish` 的 ipa 与 MAC_OS 组合在确认/审批前返回 `ASC_INVALID_ARGUMENTS`，builder 复用同一校验 |
| 分类 | flag 值不能作为命令动词；正确处理前导布尔 flag 的显式值；已确认的本地写路径/flags 需 confirm + 默认审批；无法证明的命令保持 unknown |
| 禁区 I10 | 新增 `versions phased-release guard` 为 forbidden：该命令可在 `--` 后执行任意本地程序，`--dry-run` 同样执行，超出插件的发布操作范围；不向子程序注入输出 flag |
| 宿主审批 | 验证真实工具管线中 deny/ask/批准的实际行为；若 pre-execute 的短路能绕过插件策略，使用最终 guard 与宿主实际批准凭证 fail closed，不把模型 confirm 或可覆写 hook 决定当批准 |
| 结果 | 保持现有结果字段与五工具；仅在上游实际结果变化需要时调整消费逻辑 |
| 版本 | 提高最低引擎要求属于兼容基线变化；以 0.2.0 记录迁移路径，构建发布授权独立 |

## 4. 行为规格

1. `src/compat.ts` 保持唯一引擎版本事实源；兼容状态、缓存路径、下载 URL、更新建议使用新基线，SHA-256 校验保持启用。修复 engine 诊断解析了 `ASC_CLI_PATH`/缓存而 runtime 仍运行原始 `ascPath` 的分歧，共用动态解析路径；provision 后普通工具和 job 应使用同一个已解析引擎。无法解析的版本诊断为 unknown，不能因比较函数返回 0 被当作 supported。
2. 注册 action/job 的非法参数组合先于确认和宿主审批被拒绝。工具 handler 保持薄，命令表仍在 registry。
3. 通用 argv 分类只使用真实命令路径，不能让 `--path status`、`--output report` 等值把未知/本地写命令变成 read。禁区优先于本地写标记；`auth` 非只读分支与 `web` 仍不可达。
4. 处理当前源码证实的本地写：报告产物、doctor 修复、Xcode Cloud 日志保存、review digest 状态持久化，以及新增下载/export/registry/report 路径。没有写产物的变体不得仅因该命令存在写选项而冒充已写入；未知可保持 ask/deny。
5. output 注入依据命令的实际输出语义；不能给文件名型 `--output` 自动填 `json`。保留模型显式指定的输出格式/路径（含内联形态）。不要因任何 exit 2 就自动重放写命令；仅在能确认是插件追加 output flag 的执行前拒绝时允许安全重试。诊断认证必须同时尊重子进程失败状态，不能仅凭输出中仍有 credentials 就报告认证成功；命令取消信号应传至诊断子进程。
6. 若强化宿主审批，必须将宿主批准绑定本次执行 token 与参数；无审批服务、拒绝、取消、另一次调用或参数变化均不能充当本次允许；读命令、显式配置的合法豁免保持原矩阵行为。
7. 普通 CI 下载 compat 默认基线并验证 checksum；upstream-watch 另外下载 latest、执行 contract 与分类漂移检查。下载脚本复用版本/平台/校验和辅助函数。
8. verify 无条件运行 contract-combos；真实 binary 检查不得静默假装执行成功。smoke 隔离用户配置/凭据，仅运行离线命令，断言版本、执行结果、只读/禁区拒绝，失败非零退出。

## 5. 安全影响（I1–I10）

I1/I2/I3：保持只读默认、写确认和宿主审批，修复上游命令/flag 的分类漏洞及宿主管线的审批证据问题。I4：保持 @ 值字面化；对上游明确不展开的 output、root selectors 和 `--` 后负载保留原文，避免将字面路径改成错误的 `@@` 文件名。I5：仍只有 exec 经 ctx.subprocess 传 argv，无 shell；认证变量转发和 web-session tombstone 保持。I6/I7：五工具、五 job、六 rank 600 skill 不变。I8：按用户要求更新版本契约，provision 默认关闭、checksum、从不自动升级不变。I9：审计开关/权限/脱敏不变。I10：auth/web 禁区不能因布尔 flag 值或其他 flag 而绕过。

## 6. 兼容与迁移

README 中英文给出从 0.1.6 迁移到新基线的要求：升级 Harness 至 rc.5，升级 asc 至 6.3.0 或显式 provision；旧版本诊断为 older，不硬阻止只读工作。工具名称与已有合法参数保持；新增拦截只拒绝上游已经拒绝或必须审批的操作。支持范围不代表所有未来版本已经逐一实测。

## 7. 验收与测试计划

- [x] 原有测试行为基线保留并增加失败回归；当前 13 文件 / 242 测试通过。
- [x] rc.5 实际服务集成：五工具注册，读可执行，write/unknown/local-write 的确认/审批，deny/缺审批/取消不能 spawn；skills/commands 可被真实服务消费。
- [x] asc publish ipa/MAC_OS 在审批前被拒；其它有效 upload/publish/stage 参数不回归。
- [x] 分类回归覆盖 flag 值伪装动词、spaced/inline bool、report-file、save-logs、write-state、文件写叶子；unknown 不静默。
- [x] verify 无条件包含 typecheck/test/build/pack-manifest/contract-combos；默认强制引擎门禁，只有显式 `--unit-only` 才省略并报告未验证。
- [x] 6.3.0 二进制通过 SHA-256 校验、action 帮助契约、completion 审计、无真实凭据的离线 smoke；最终完整复验通过。
- [x] `npm pack --dry-run` 发布物完整且不含 vendor、凭据或上游源码。
- [x] README/README.zh、AGENTS/CONTRACT/COMMANDS、ARCHITECTURE/TESTING/CONTRIBUTING、相关技能、CHANGELOG 同步；历史 spec 保留历史版本事实。
- [x] 用户明确批准完整验证后，当前工作区 `npm run verify` 全部 8 阶段一次通过（exit 0），status 标记为 implemented。

## 7.1 PR 评审修复验收（2026-11-03）

用户已明确要求修复全部 P1/P2；以下补充既有契约的回归验收：

- [x] flag 值为 `--output` / `--` 时，后续真实 flag 的 `@file:` / `@env:` 仍字面化；已识别的 output/root selector 与 payload 保持原文。不复制完整上游 flag 表，类型不确定时按可能的解析位置保守处理；无法证明是 payload 的值仍保守字面化。
- [x] 添加 `--report-file` 不降低 unknown 风险；read-only 的 unknown deny/强制审批保持，已识别本地文件副作用仍需 confirm。
- [x] 相对 cacheDir（含相对 DSH_HOME）解析为宿主侧绝对路径，下载、探测与不同 cwd 的工具执行使用同一文件。
- [x] Windows 下载保留 `asc.exe`，verify/contract/audit/smoke/dev overlay 共用平台路径；离线测试覆盖脚本消费者（模拟平台，原生 Windows 执行未验证）。
- [x] provision 透传调用方 signal，两个 fetch 合并超时与取消，读取响应后及安装前检查取消；已取消调用不下载/覆盖缓存引擎。

## 8. 未验证边界

真实账号下的 App Store Connect API、上传、分发、提交依赖真实凭据与单独业务授权；本迁移不执行。任何工具权限阻塞的真实二进制门禁必须明确报告，不能把静态检查或替身结果标为通过。

## 9. 本地验收记录（2026-11-03）

- Node 24.14.0：`npm run verify -- --unit-only` 五阶段通过；13 测试文件、242 测试，包含 22 个真实宿主集成测试；新增 IPA/MAC_OS 后 contract-combos 单独复验为 13 组拒绝 / 8 组接受。
- 构建清单：22 个 src 模块对应 66 个 lib 产物；npm pack dry-run 共 78 文件，含六个 skill，无 vendor、认证文件、上游源码。当前 worktree 的 read-only/write 两种开发 overlay 均生成成功，未启动实例。
- 已验证的 macOS arm64 asc 6.3.0 SHA-256：`c460fff17553d5a0b982bb67d366188554ccce3da4fd28e38ecd24ceb05915f8`。此前独立 contract 检查覆盖 23 action + 5 条 job/discovery 路径及未知 flag 负向控制；completion 审计覆盖 1,932 路径 + 11 个 flag 向量；真实 subprocess 离线 search、metadata init/validate 和四个零 spawn 拒绝通过。
- 新增真实 provider 环境 canary 已在最终 smoke 中通过：显式转发四个合成认证值，验证 read-only/web-session tombstone，不读取真实凭据。完整 verify 首次被自动审批审查拒绝（Code from External）；用户随后明确批准完整验证，重跑后 8 阶段全部通过（exit 0）。最终 contract 为 28 条正向命令（23 action + 5 条 job/discovery）及未知 flag 负向控制；分类审计为 1,932 路径 + 11 向量；smoke 共 6 次真实 subprocess 调用，覆盖 search、metadata init/validate、环境 canary 与四个零 spawn 拒绝。
- 新下载脚本访问 GitHub 时 120 秒超时退出；用已校验 release 文件替换 fetch 的离线安装检查通过，损坏下载被拒且原引擎不变。真实网络下载仍未通过本轮验证。
- 初次迁移验收时：本地 Node 22 与远程 CI 未执行；CI 已配置 Node 22/24。当时尚未提交、push、建 PR 或发布。

## 10. PR 评审修复记录（2026-11-03）

- PR：[sleep9ull/dsh-asc-cli#8](https://github.com/sleep9ull/dsh-asc-cli/pull/8)。本次修复全部 2 项 P1 和 3 项 P2，补充 §7.1 验收。不将原 PR 的旧 CI 结果当成本轮修复结果。
- 红测试：参数/策略/相对路径/provision 链路新增回归首次 9 例失败；脚本路径首次 3 例失败。修复后本地全绿。
- Node 24.14.0：`npm run verify -- --unit-only` 五阶段通过，14 个测试文件 / 259 测试，包含 22 个真实宿主集成测试及 5 个离线脚本集成测试；22 源模块对应 66 构建产物；参数组合 13 拒绝 / 8 接受。
- `npm pack --dry-run --json`：78 文件、六个 skill，无 vendor 引擎、凭据或上游源码；`git diff --check` 通过。
- Windows/macOS/Linux 平台路径、下载器、全部脚本消费者与两种开发 overlay 在隔离 checkout 中模拟验证；原生 Windows executable/npm.cmd 未验证。
- 修复后首次尝试的 `npm run verify` 与真实引擎合成 canary 复现被自动审批审查以 `Code from External` 拒绝，未执行。用户再次明确批准完整验证后，重跑成功：Node 24.14.0 上完整八阶段门禁全部通过（exit 0），包括 259 测试、28 条真实上游命令契约、1,932 completion 路径 + 11 flag 向量，以及 6 次真实 Harness subprocess 离线 smoke 调用。
- 合成 canary 对照检查通过：真实 asc 6.3.0 对原始 `apps list --name --output --limit=@file:<fixture>` 会在 exit 2 的解析错误中出现合成文件内容；经过 `literalizeArgv` 后同样 exit 2，但不再包含文件内容。使用隔离 HOME/ASC 配置与合成文件，不使用真实凭据、不执行 Apple 业务操作。
