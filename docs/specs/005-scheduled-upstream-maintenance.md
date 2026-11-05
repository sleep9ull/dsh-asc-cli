# 005 · Desktop 定期维护双上游兼容性

| 字段 | 值 |
|---|---|
| id | 005 |
| status | implemented |
| created | 2026-11-04 |
| related | spec 004；[spec 006](006-asc-version-notices.md)；CONTRACT §3/§5；CONTRIBUTING §2–§5 |

**一句话**：Claude Desktop 定期检查 DeepSeek Harness 与 asc 的默认发布渠道，完成范围内的兼容适配、验证、提交、PR 和 Squash 合并，并可恢复地同步指定的本地 main。

> 后续变更：npm 产物来源验证和 v3 标记按 [spec 007](007-npm-artifact-verification.md)；本文保留最初的源码 commit/v2 设计记录。当前部署权限以任务配置和 [MAINTENANCE §5.1](../MAINTENANCE.md#51-当前部署自动维护至-pr) 为准，AUTO_TO_PR 不授权自动合并或同步。

> 用户于 2026-11-04 批准代码实现。部署、GitHub 设置、持久提交/push/合并授权及真实主副本同步仍属独立验收；下文授权表只有在用户明确批准相应执行范围后才生效。

## 1. 背景与问题

- 当前 `.github/workflows/upstream-watch.yml` 每天 03:17 UTC 检查 asc latest 的 contract、分类漂移和离线 smoke，失败后开 issue；不检查 Harness，也不完成适配。
- 2026-11-04 查询快照：Harness npm latest/next 为 `0.2.1-rc.5`，alpha 为 `0.2.2-alpha.3`；asc latest 为 `6.4.0`，插件 pin 为 `6.3.0`。执行时必须重新查询，不能把快照当作目标常量。
- 同日 GitHub 快照：仓库 `sleep9ull/dsh-asc-cli` 允许 Squash，未开启 auto-merge，main 未保护、rulesets 为空。
- 新任务会话没有上次会话的执行记忆；远端合并、本地同步、插件发布是不同完成状态，必须分别报告。

## 2. 范围

- 一个 Desktop Code 本地 Scheduled Task，使用独立 worktree；一个仓库维护 skill，配合确定性脚本完成发现、去重、验证证据与同步检查。
- 在既有 upstream-watch 中增加 Harness 默认渠道监测；GitHub 负责持续探测与门禁，Desktop 负责代码适配，不创建两套自动改代码的执行器。
- 日常升级的权限边界、spec-first 例外范围、PR 检查、Squash 策略、失败恢复及主工作副本的快进同步。
- 任务首次手动演练、权限检查和运行记录。具体部署为独立验收阶段。

## 3. 非目标（Out of scope）

- 不在本 spec 的实现中顺便适配 asc 6.4.0；它可以成为部署后首次维护的独立 PR。
- 不追踪未发布 main API、非默认 alpha/next 渠道；latest 本身为 rc 时允许跟随，不把 rc 一概过滤。
- 不发布 npm、tag 或 GitHub release，不执行 Apple 真实业务操作，不升级维护者日常使用的全局 asc/Harness。
- 不搭建 Agent SDK 服务、云 routine、额外常驻 daemon；不承诺关机执行、精确整点或合并后立即同步。
- 不在日常维护中放宽插件 I1–I10、弱化验证、修改任务授权或扩大工具面。
- 不自动删除远端分支、工作树或用户文件；归档清理留到确认收口以后独立处理。

## 4. 契约变更

| 面 | 变更 | 备注 |
|---|---|---|
| 插件工具/config/结果 | 本 spec 不改 | 用户版本提示由 spec 006 定义 |
| 维护入口 | 新增 `.claude/skills/upstream-maintenance/SKILL.md` | 仓库开发 skill，不进入发布包的六个 rank 600 skill |
| 开发脚本 | 新增 `scripts/maintenance/` 中的发现、状态、证据及同步辅助模块 | 不新增运行时依赖；模块落地前更新 ARCHITECTURE |
| GitHub | main 必需检查与 PR 门禁；允许 auto-merge，采用 squash | 是部署写操作，不由普通维护运行自行修改 |
| spec-first | 经明确授权后，允许范围内日常适配自动编写并执行单次 spec | 特例必须同步 AGENTS/SPECS/CONTRIBUTING；本文不能隐式覆盖它们 |
| 完成语义 | `merged`、`synced`、`published` 分开 | 本任务最多自动达到 synced；发布显示未执行 |

### 4.1 拟议的持久授权边界

| 操作 | 日常任务权限 |
|---|---|
| 查询 npm/GitHub 元数据、源码与帮助；读取当前仓库 | 允许 |
| 在维护 worktree 中安装锁定开发依赖、下载校验后的目标 asc、运行隔离测试 | 允许；使用测试配置和合成凭据 |
| 适配既有能力的依赖/API/argv/结果、修复回归、更新版本范围与文档 | 允许；每轮记录 spec 和兼容影响，范围需由测试证实 |
| 为上述变化 commit、push 维护分支、建/更新 PR，开启该 PR Auto-fix | 允许 |
| 通过本 spec 门禁后启用该 PR squash auto-merge | 允许；不使用 admin bypass |
| 对已指定主工作副本进行 fetch 与 main 快进同步 | 允许；需满足 §5.5 的全部条件 |
| 放宽安全契约、移除既有公共能力、改变授权或 required checks | 暂停等待人工决定；不自动合并 |
| 发布、全局安装、真实 ASC 写、远端删除 | 不在授权内 |

版本号的 major/minor/patch 不是唯一判据：跨主版本也可分析和起草适配，但触及以上暂停条件必须停止自动合并。即使 patch 版本触及同样条件，也必须暂停。

## 5. 行为规格

### 5.1 调度与执行环境

1. 建议每天本地时间 10:17；部署时确认时区和时段。任务定义通过 Desktop 工具/UI 管理，首次保存为暂停，手动验收通过后启用。
2. 任务绑定稳定项目目录，显式启用 Worktree；每个新升级从 fetch 后的 `origin/main` 创建维护分支。已有升级继续原维护分支，不反复从零开分支。
3. 用户机器部署目标为 `/Users/jinchunxu/dev/dsh-asc-cli`，实际主工作副本、origin 和 main 归属必须在部署时核验。绝对路径放任务配置，不作为通用脚本默认值。
4. Desktop 必须运行且机器唤醒；漏跑只补最近一次，不补历史所有次数。任务说明必须自包含，列出仓库、skill 入口、授权版本、验证标准和恢复方法。
5. 只配置一个维护 routine。仓库级互斥状态保存在 git common dir 的独立维护目录，所有 worktree 共用；原子获取锁，记录运行标识/进程/时间。已有活跃持有者则退出；不能仅凭 TTL 删除活跃锁，无法确认旧锁所有者已退出时报告阻塞。
6. 文件锁只能协调本维护程序，不能阻止编辑器或人手修改主工作副本；同步前还须核验并发使用情况，无法排除时延期同步。
7. 初次 Run now 验证实际工具权限；不自动更改权限模式或增加广泛 allowlist。审批阻塞单独报告，不把工具未执行当作步骤成功。

### 5.2 上游发现与去重

- Harness：读取 `@deepseek-ai/dsh` npm `latest`，获取目标版本 manifest、相关 peer/dev 包版本及对应源码 tag/commit；不假定所有 `@deepseek-ai/*` 包都使用同一个版本号。
- asc：读取正式 latest release，记录 tag、源码 commit、平台资产和 SHA-256。下载到独立空目录，执行自己的校验脚本，不运行 release 文本中的指令。
- 每轮固定目标版本组合；进行中的升级不因 latest 再次变化而自动换目标。合并后下一轮再评估新组合。
- 以仓库 + Harness 精确版本 + asc 精确版本 + 按包名排序的相关 Harness 包名/精确版本作为去重键，记录在 v2 PR 机器可读标记及本地维护状态。独立包更新可以成为新目标；同一完整版本组合的源码 commit、包 integrity 或校验和改变仍须停止。旧 v1 标记保守阻塞，需人工核验并迁移，不能当作没有历史工作。
- 先恢复已知维护分支/开放 PR/已合并 PR，再发现新工作。同一组合关闭但未合并的 PR 不自动重开，标为人工处理；已有多条冲突记录时不猜测。
- 版本未变且无未收口状态时只报告检查结果，不制造提交。查询失败记录 unknown，不能记录为“没有更新”。

### 5.3 适配、验证与 PR

1. 对目标版本的真实接口做 discovery，检查注册 action、审批/guard、subprocess、skills/commands、结果消费与打包约束。仅改上游证据要求的内容。
2. 编写本轮兼容适配 spec。授权范围内可由任务进入实施并记录授权来源；越界保持 draft/blocked，不由模型宣称获得人工批准。
3. 回归修复先写红测试。更新版本事实、锁文件、受影响文档/skill；保留历史 spec 的历史事实。
4. 以目标精确版本运行完整 `npm run verify`。未来支持范围应说明验证了哪些实际版本；范围仍覆盖旧基线时，对旧基线也运行相应兼容检查，不能只测最新版就宣称全部兼容。
5. 保留 Node 22/24 CI 与真实 Harness 集成、contract-combos、pack、asc contract/classify/smoke。`--unit-only` 不可代替完整验收；网络失败、缺失引擎或权限阻塞均不是通过。
6. 一个版本组合一个逻辑 PR。提交信息遵循仓库规则；push 仅到维护分支。PR 包含 spec、目标来源、迁移影响、验证版本和未验证边界。
7. PR 创建后绑定 Desktop PR 监控，开启被授权的 Auto-fix；通过应用事件处理 CI/冲突/评审，不另建 loop/cron 轮询 CI。必要的 base 更新使用当前环境支持的同步方式。
8. CI 修复可追加提交，不 force-push。每次变更使旧 head 的验证/评审证据失效。日常失败达到三轮修复仍未解决则标记 blocked、停用该 PR 自动合并，保留分支供人工接续。

### 5.4 合并门禁与恢复状态

部署阶段配置 main ruleset/保护：必须走 PR，Node 22、Node 24 和引擎 contract job 是必需检查，限制 force-push，并要求与 base 保持可合并且满足配置的最新性要求。具体 check 名称由实际 CI 解析，禁止模糊匹配或把缺失/skipped 当 success。启用 auto-merge 前核实这些规则实际生效；无法启用规则时，停留在 PR-ready，不自动降级到无保护合并。

启用 squash auto-merge 前同时检查：目标/head 与已验证证据一致；必需检查全部 success；无未处理的实质评审问题；满足仓库 review 要求；不存在越界改动；mergeability 已确定。未知状态等待，不能当作允许。推新提交前撤销旧自动合并请求，重新验证后再启用。merge queue 的方法若不能保证 squash，停止并报告策略不符。

| 状态 | 进入依据 | 下一次运行 |
|---|---|---|
| discovered / adapting | 目标已固定，维护分支存在 | 继续同一适配，不开重复 PR |
| pr-open / awaiting-checks | PR 存在，证据尚不齐 | 恢复该 PR；依赖 Desktop CI 事件继续处理 |
| ready / merge-requested | 对当前 head 的门禁通过，已请求 squash | 重查 PR 实际状态；不能宣称已合并 |
| merged / sync-pending | GitHub 确认已合并，取得 squash commit | 优先同步本地 main |
| synced | 本地 main 与本轮 fetch 后的 origin/main 一致 | 允许检查下一组更新；发布仍是未执行 |
| blocked | 权限、越界、重复记录、验证或 Git 条件阻塞 | 报告原因；人工解除前不重复破坏性尝试 |

本地状态是恢复线索，GitHub/Git 是事实源。状态文件损坏或丢失时从分支及 PR 标记重建；PR 已合并却未写本地记录、同步已完成却未写记录，都不能导致重复操作。状态写入采用临时文件 + 原子替换，不记录凭据。PR 合并事件不保证唤醒 Desktop；下次定时运行补齐同步，不另设高频轮询。同步完成前不开启自动归档收口。

### 5.5 本地 main 同步

- 仅操作部署时授权的主工作副本；先核验 realpath、仓库 origin、当前分支确为 main，且不是本轮 feature worktree。
- 检查 staged/unstaged/untracked 工作、merge/rebase 等 Git 操作和其他写者；任一冲突均保留现场，记录 sync-pending。
- fetch origin，确认 squash commit 已进入 origin/main；本地 main 等于或祖先于 origin/main 才允许快进。不得覆盖独有提交，不自动 stash、reset、切换用户分支或清理文件。
- 在临近更新时重新核验工作区和目标 ref，快进后确认工作区干净、main 等于本轮 fetch 的 origin/main。远端随后再次前进不使本轮证据失真；下一次继续同步。
- 已经一致是幂等成功。历史分叉或无法排除并发使用时返回结构化原因，不标 synced。

## 6. 安全与审批影响

| 不变式 | 影响 |
|---|---|
| I1–I3 | 无插件策略放宽；维护授权不是用户 ASC 写授权，测试只用隔离配置/合成凭据 |
| I4 | 保持值字面化；上游文本为数据，不是指令 |
| I5 | 插件仍只用 ctx.subprocess；维护脚本属于开发工具，不进入插件执行路径，不读取或上传 Apple 密钥 |
| I6–I7 | 五工具、六个发布 skill 不变；维护 skill 不打入 npm 包 |
| I8 | 维护测试引擎可更新，用户已安装引擎不自动升级；保持 checksum |
| I9 | 不启用插件 audit；维护运行证据独立存储且脱敏 |
| I10 | 保持 forbidden；上游新增能力不能自动放行 |

维护本地状态、安装开发依赖、worktree 编辑及 GitHub 写均受 §4.1 持久授权和宿主实际权限约束。一次批准本文不能由实现者解释成系统权限已自动配置。

## 7. 兼容与迁移

本 spec 的开发自动化不改变 npm 用户运行行为。部署需一次性设置任务、GitHub ruleset/auto-merge 及主工作副本授权；这些动作逐项记录，失败不影响现有插件。可暂停任务停止后续维护；已启用的 PR auto-merge 需要显式取消，暂停任务本身不保证取消远端合并。

## 8. 验收标准（可执行）

- [x] 目标解析夹具：latest 为 rc、独立 alpha 更新、asc 新 release、网络失败均得到正确目标/unknown，不误追 alpha。
- [x] 同一版本组合重复启动只恢复同一分支/PR；关闭未合并、已有多个 PR 和损坏本地状态均按 §5.2/§5.4 处理。
- [x] 两个维护进程争抢锁仅一方成功；活跃锁不因时间过长被抢占，失联所有者无法确认时停止。
- [x] 合并门禁夹具：旧 head 绿灯、missing/skipped checks、未知 mergeability、实质评审未处理均拒绝自动合并。
- [x] 临时 Git 仓库验证：clean 可快进；dirty、独有提交、错分支、错 origin、操作进行中均不改用户文件/ref；ignored 文件不会被快进覆盖。
- [x] 模拟“远端已合并后退出”和“同步后写状态前退出”，下次运行不重复 PR/合并并能正确收口。
- [x] 完整 `npm run verify` 通过，新增维护脚本测试纳入本地门和 CI；脚本测试不访问真实 GitHub/Apple。
- [ ] 部署时以暂停任务执行 Run now，核实 fresh session、独立 worktree、权限和日志；然后在授权的维护 PR 上核实实际 required checks、Squash 和主副本同步证据。
- [ ] 对外报告分别列出适配、检查、合并、本地同步、发布状态；未跑的步骤明确标未验证。

### 8.1 实施记录（2026-11-04）

仓库代码及文档已落地。2026-11-04 11:59 用户在当前 worktree 手动执行 `npm run verify` 并提供完整成功输出，全部八阶段通过：typecheck、17 suites / 321 tests（其中 maintenance 24 tests）、clean build、pack-manifest、contract-combos、asc contract、classify-audit、真实引擎 smoke。asc 6.3.0 接受 28 条命令；分类审计覆盖 1,932 条路径和 11 组 flag，无写文件路径误分类为 read；隔离 smoke 通过真实 Harness subprocess 完成 6 次调用。临时 Git 测试无真实 GitHub/Apple 写入；npm dry-run 打包不包含维护脚本、开发 skill 或引擎。

此前自动执行因 `Code from External` 被拒绝，用户本次手动完整验证已补齐该缺口。未创建或启用 routine，未修改 GitHub 保护/auto-merge，未提交/push/建 PR/合并/同步真实 main/发布。部署步骤仍需 §5 和 §4.1 的明确授权及实际演练。

### 8.2 PR 10 评审修订（2026-11-04）

用户明确要求“修复评审问题”，授权本次修订与实现；保持既有维护授权边界。验收新增：

- 外部持锁进程退出/锁被重领后，旧 sync 不得更新 main；最终所有权校验、Git 复查及写入共用 ownership.guard 临界区，期间不得释放或重领锁。record 同样在临界区校验并写入。
- exclusiveAccess 只接受布尔 true，字符串等输入必须拒绝。
- 恢复开放 PR 保留同目标的累计 repairAttempts；历史缺失则保留目标并 blocked，人工重建计数后才能继续，不能默认零次。
- 独立包新版本产生新目标键；扫描全部孤立分支及未完成本地目标后才选择唯一恢复目标。
- repairAttempts 必须是 0–3 的整数；第三轮成功可以通过 gate，第三轮仍失败则按原流程 blocked，不能自动开始第四轮。
- asc 平台资产命名复用 src/compat.ts 的 releaseAsset；维护 CLI 在无 lib/ 的 checkout 仍能发现目标（使用受支持 Node 的类型擦除加载纯兼容模块）。

修复验证：新增维护回归先红（12 个失败用例），修复后 maintenance 37/37 通过；本地 `verify --unit-only` 五阶段通过，共 17 suites / 338 tests。本轮未重新执行真实引擎三项门禁，不能把此前 321 tests 的用户完整验收当作本次提交证据；提交后的 CI 独立重新验证。

## 9. 测试计划

| 类型 | 内容 |
|---|---|
| 单元 | 注入 npm/GitHub 响应、时钟和命令执行 seam；验证选择、去重、门禁与恢复分支 |
| Git 集成 | 临时 bare remote + 主 checkout + worktree；验证快进与拒绝条件，不改真实 main |
| 现有契约/smoke | 保持真实 Harness 服务与固定 asc 二进制验证，使用隔离环境 |
| 手动部署 | Run now、权限阻塞、暂停/恢复、PR 事件、Squash 与同步；没有实际完成则保留未勾选 |

## 10. 文档与 skill 同步

- [x] ARCHITECTURE：维护模块与运行时插件的边界、状态存放与 Git 同步入口。
- [x] AGENTS / SPECS / CONTRIBUTING：限定范围的持久授权、自动单次 spec 流程、Squash 和暂停条件；不能取消一般 spec-first 要求。
- [x] TESTING：维护脚本回归和新增 Harness watch 的验证范围。
- [x] CONTRACT：准确说明双上游漂移监测，保持“未来版本非逐一认证”。
- [x] 新维护 skill 和部署说明：任务自包含入口、每日时段、恢复方法及暂停后取消 auto-merge 的步骤。
- [x] README / README.zh / CHANGELOG：只在实现后描述实际可用的开发维护机制；不声称 npm 自动发布。

## 11. 开放问题与默认决定

| 问题 | 草案决定 | 阻塞阶段 |
|---|---|---|
| 调度时间与时区 | 建议本地 10:17，每日一次；部署前确认 | 仅任务启用 |
| GitHub 配置和维护写授权 | 采用 §4.1 范围；需用户明确批准执行范围，草案不视为授权 | 部署/自动写 |
| spec-first 自动适配特例 | 仅 §4.1 范围内生效；先落库规则再启用任务 | 无人值守实施 |
| 主工作副本与并发使用 | 部署核验固定路径；不能安全同步则延后 | 本地同步 |
| npm 自动发布 | 不纳入本次；合并报告明确待发布 | 不阻塞本 spec |

参考：[Desktop scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks)、[PR monitoring](https://code.claude.com/docs/en/desktop#monitor-pull-request-status)。产品能力以部署时版本核实为准，不将文档能力当作账号已启用。
