# 010 · 同一插件兼容旧版与新版 Harness

| 字段 | 值 |
|---|---|
| id | 010 |
| status | implemented |
| created | 2026-11-06 |
| related | spec 004 / 008 / 009；CONTRACT §5 |

**一句话**：保留未升级 dsh 用户的插件使用能力，同时支持新版 dsh；新增支持不能自动替换或移除既有支持。

## 1. 背景与问题

2026-11-06 用户在 spec 009 适配过程中明确要求：“没升级 dsh 的用户，也能继续使用，然后更新了新版本 dsh 的用户，用我的 plugin 也能适应上”。这修正了原先将 engines.dsh 和所有 peer 直接替换为最新单个版本的交付方向。

本 spec 起草时，未提交候选已通过新宿主侧 387 个测试，但 engines.dsh 与 peer 仅声明新版本，安装会排除旧宿主；新宿主夹具使用的新批次入口也不能直接当作旧宿主验证证据。此外 compareBaseline 要求 peer 声明与开发锁单版本相等，需区分用户兼容声明和精确验证环境。

用户随后明确要求“要最低兼容 dsh 上一个大版本稳定版……同时要逐步适配每次更新的版本……按照这个原则，来完成本次的兼容性适配，升级到 0.2.1。同时也要把这个原则，放到双上游维护的原则上面”。此真实用户指令授权本 spec 的兼容方案、插件版本 0.2.1 与维护原则更新，状态进入 approved；不表示实现或验证完成，也不替代宿主实际审批。原固定维护目标、分支和共享状态已记录的 repairAttempts=2 保留。

## 2. 范围

- 插件目标版本从 0.2.0 升为 0.2.1；package.json、安装锁及 CHANGELOG 必须同步，不自动发布 npm/tag/release。
- 长期最低支持为 dsh 上一个兼容大版本的正式稳定线；当前线稳定版也保留。1.x 及以后以 major 为兼容大版本，0.x 以 minor 为兼容线。正式稳定版只指不带 prerelease 后缀的实际发布，RC/alpha 不能改称稳定版。
- 每条需保留的稳定线以该线最新正式 patch 作为最低回归验证锚点；维护跟随该线修复更新，公开支持仅覆盖有验证证据的版本。最新默认渠道的每次变化均进入适配评估，通过验证后逐步加入支持；不得因 latest 回归而自动丢弃旧支持。
- 若上游尚无正式稳定版或没有上一稳定线，明确记录缺省原因，保留既有已验证基线，不发明版本、不把 RC 冒充稳定版。
- 2026-11-06 官方 npm 元数据查询：@deepseek-ai/dsh 所有已发布版本均带预发布后缀，正式稳定版集合为空，latest 为 0.2.2-rc.1；本轮采用上述缺省规则。
- 因此本轮同一份插件包至少兼容原已验证宿主 0.2.1-rc.5 与本轮候选 0.2.2-rc.1。
- 调整宿主和 peer 的公开兼容声明；开发依赖、每组宿主图及安装锁继续精确固定。
- 在彼此隔离的旧/新完整宿主组合中安装并运行同一构建产物，验证插件公开行为和安全契约。
- 维护发现、基线比较和产物验证适应多个受支持宿主；新增支持后仍验证旧组合。
- 同步相关契约、测试说明及用户安装文档。

## 3. 非目标

- 不承诺全部历史、未来或区间内未测试的 Harness 版本都兼容。
- 不在用户安装或运行时强制升级/降级宿主，不引入多份共享宿主组件。
- 不改 I1–I10、公共工具/action/job/配置/结果，不自动发布、合并或同步主副本。
- 不重置本轮修复预算，不以单版本通过代替双版本通过，不绕过宿主审批拒绝。

## 4. 契约变更

| 面 | 目标行为 |
|---|---|
| 用户兼容声明 | engines.dsh 明确接受已验证的 0.2.1-rc.5 与 0.2.2-rc.1；peer 明确接受对应已验证版本 |
| 开发验证环境 | 新组合 devDependencies 与安装锁继续使用精确版本；旧组合有独立精确锁和来源记录 |
| 旧宿主组合 | dsh-* 0.2.1-rc.5、Cordis 4.0.5、Schemastery 3.18.5 |
| 新宿主组合 | dsh-* 0.2.2-rc.1、Cordis 4.1.0、Schemastery 3.19.0 |
| 维护验证 | 区分公开支持集合与当前开发基线；不能把支持集合首项误当成当前基线 |
| 支持保留 | 新增宿主支持时继续验证已支持旧宿主；移除支持须单独说明并获用户授权 |
| 工具、审批、安全 | 五工具、五 job、六技能、两命令及 I1–I10 均保持 |

初始声明采用精确版本的显式并集，如 engines.dsh 为 `0.2.1-rc.5 || 0.2.2-rc.1`；各 peer 同样只列实际验证的版本。支持范围的扩展必须有证据，不能用无上界范围暗示未来版本已实测。公开 peer 的并集不能替代各宿主完整图的兼容验证。

## 5. 行为规格

1. 用户保留旧 dsh 并安装候选插件时，严格 peer 安装成功，不要求升级 dsh，也不引入第二份 Cordis/共享 dsh 组件。
2. 用户升级到新 dsh 后，同一插件产物安装并运行成功，保留全部工具、技能、命令及审批路径。
3. 业务代码优先使用两版共有的宿主能力；只有实际验证证明需要时才增加最小兼容适配。遇到审批服务缺失或执行失败仍关闭写入，不以捕获异常后直接执行 handler 兜底。
4. 集成测试按各宿主公开入口组成真实执行管线：读取宿主工具包公开 exports，旧版使用真实 tools.execute 单调用入口，新版使用公开 ToolExecutionPipeline / executeToolBatch；不能靠模拟批准消除差异，加载实际 SessionProjectionRegistry。scripts/harness-matrix.mjs 读取 test/fixtures 中两宿主固定产物记录、保留宿主锁及根精确开发锁，临时复制可信源码/测试，复验后禁用 scripts 严格安装同一 tarball；两组消费端均从安装包加载插件，运行真实宿主测试和本地门禁。可传已校验引擎追加离线 smoke。CI Node22/24 均运行新环境与保留环境，保留原 required check 名称。
5. 维护检查允许合法的兼容声明，但仍拒绝开发 pin/锁不一致、候选不在声明支持集合内、产物身份不一致、共享组件分裂和未经授权降级。
6. 支持集合增加旧版本不应让当前最新开发组合持续误报 drift，也不能通过改变声明掩盖真实依赖漂移。

## 6. 安全与审批影响

I1–I10 无放宽：两宿主均必须验证只读默认、confirm、实际宿主批准、unknown 审批、禁区、非法参数提前拒绝、批准后参数替换拒绝和并发收据隔离。值字面化、单一 argv subprocess、凭据 tombstone、外置引擎及审计边界保持。

无新增插件本地写路径。开发中的临时依赖安装继续隔离 HOME/配置/cache，禁用 scripts、strict-peer-deps、包含 dev/optional；安装前复验固定产物与锁。不得为兼容旧宿主改用 force/legacy-peer-deps。

## 7. 兼容与迁移

旧宿主用户无需升级 dsh 即可使用通过验证的插件版本；新宿主用户使用同一插件包。保留已发布 npm 0.2.0 的历史说明，不将本轮未发布产物描述为已上线。

本 spec 修正 spec 008/009 的单组合公开版本声明方向；精确产物、完整图验证、失败阻塞和安全门禁要求继续生效。未来自动维护遇到无法同时保留旧支持的候选时应报告兼容回归，不能自动丢弃旧支持。

## 8. 验收标准

- [x] 插件 package.json / package-lock.json 版本均为 0.2.1，CHANGELOG 同步；未自动发布。
- [x] 维护发现从官方已发布版本识别正式稳定线与最新默认渠道；覆盖 0.x minor / 1.x major、无正式稳定版、RC latest、新线发布与旧线支持保留的回归。
- [x] 定时任务 prompt 和仓库维护原则同步；授权范围、调度、锁、累计修复预算及 AUTO_TO_PR 终点不扩大。
- [x] 相同构建产物在两个隔离的精确宿主环境均严格安装成功，无共享组件分裂；留存各自锁与产物来源。
- [x] 两环境均通过真实宿主工具/技能/命令及全部批准收据、拒绝、参数替换和并发隔离回归。
- [x] 新增行为回归先红后绿：公开兼容声明可接受两版；开发 pin/锁冲突、声明不覆盖候选和共享组件分裂仍拒绝。
- [x] 维护比较当前开发基线时不把旧支持项误判为降级或持续漂移；实际升级和产物漂移仍能被检测。
- [x] 目标 asc 6.5.0 与保留的 6.3.0 实际引擎门禁完成；unit-only 不代替完整验证。
- [x] Node22 / Node24 / contract CI 配置加上双宿主覆盖，原门禁不删除、不弱化；远端运行结果在 PR 阶段另行核验。
- [x] README / README.zh / CHANGELOG / CONTRACT / AGENTS / TESTING / MAINTENANCE 及维护 skill 同步，明确支持集合和验证边界。
- [ ] spec 009 关联此兼容约束；最终 PR 同时说明旧用户继续使用与新宿主适配的证据。

## 9. 测试计划

| 类型 | 验证内容 |
|---|---|
| 安装 | 同一打包插件在两个完整宿主组合下 strict-peer-deps 安装；检查实际解析图 |
| 真实集成 | 相同插件构建产物对两宿主运行现有 29 个集成行为断言，保留真实调度与审批 |
| 维护回归 | 合法支持并集、当前开发基线、候选漂移、锁冲突、产物身份和多实例拒绝 |
| 引擎 | 两个固定 asc 版本的 contract / classify-audit / offline smoke，隔离配置与合成凭据 |
| CI | Node22 / Node24 及双宿主矩阵；保留独立 contract job |

## 10. 文档同步

README/README.zh 写明两版安装与无需强制升级；CONTRACT/AGENTS 区分用户兼容集合和精确开发锁；TESTING 记录双宿主同产物验证；MAINTENANCE 与维护 skill 规定升级必须保留旧支持。无工具面变化，无需为此改动六个发布 skill 的工具说明；若其安装提示受影响则同步。

## 11. 当前状态与阻塞

用户明确回复“逐项审批继续”后，重新取得锁，并实际获准 record：同一 key/target/branch、repairAttempts=3、status=adapting。随后开始第三轮实施，未重置预算。

已实现 package.json / package-lock.json 0.2.1、公开 engines/peer 精确并集、精确新开发 pin、旧宿主固定目标与锁、矩阵 runner、宿主公开执行入口适配、稳定线发现/缺失支持检测，以及 Node22/24 CI 的保留宿主步骤。矩阵配置 test/fixtures/harness-support.json 必须覆盖声明中的所有保留宿主。正式 npm 发布仍为 0.2.0，本轮未发布。

决定性红测试：单新版 peer 的打包插件在旧宿主严格消费端安装时 ERESOLVE，旧 Cordis 4.0.5 与插件 peer 4.1.0 冲突。修正精确并集后，同一构建插件的旧消费端严格安装成功（93 个包、16 固定产物复验）；新开发环境也复验 16 固定产物和安装锁，再以 ignore-scripts / strict-peer-deps 安装。

新 0.2.2-rc.1 与旧 0.2.1-rc.5 两环境 typecheck、29 个真实宿主集成测试均通过；完整测试均为 405 passed / 1 failed（20 suites、406 tests）。唯一失败为 maintenance-compatibility.test.ts 中 HTTP 503 原因文本断言：实际 status 正确为 unknown，有界 npmJson 读取器给出通用失败原因，而测试期待 reason 含 503。未删除断言或继续自动修复，第三轮未收口。证据分别在 gitignored vendor/maintenance-20261106-966eed80/verify-021-new-host.log、retained-install-green.log；此前安装失败见 retained-install-red.log。

实际引擎执行再次被自动审批以 Code from External 拒绝，没有通过完整 verify 或其他入口绕过。生产 src 未修改，asc pin 仍 6.3.0；固定 6.5.0 与保留 6.3.0 的真实引擎门禁、Node22/24 远端 CI、完整验收及 PR 尚未完成。按三轮预算停止，保持 approved，不标 implemented；只有用户明确授权后才能追加第四轮修复。退出前持锁尝试 record 最终 blocked，自动审批以 Modify Shared Resources 拒绝。未换手段写入；共享状态仍为已实际记录的 adapting / repairAttempts=3，最终 blocked 输入仅在本轮 state-input.json，不表示共享状态已更新。

### 11.1 用户授权提交、PR、Review 与 Squash Merge

2026-11-06 用户在获知三轮失败和审批阻塞后明确要求：“那么这个版本升级，提交代码，创建 PR，然后 最后 Review PR，没问题之后，Squash Merge”。这授权人工续跑修复、提交/push、创建唯一 PR，以及审查和必需检查通过后 Squash Merge；不改变 routine 的长期三轮预算，不授权发布或主副本同步。

已重新持有维护锁，确认分支尚无 PR；本地续跑输入保留原 key/target/branch，累计 repairAttempts=4。实施修复前尝试 record，被自动审批以 Modify Shared Resources 拒绝。因此第四轮尚未成功记录，也未开始修改测试或实现；共享状态仍为 adapting / repairAttempts=3。不能把本地输入中的 4 当作已记录，或绕过拒绝换工具写同一状态。随后尝试在隔离只读环境校验固定 asc 6.5.0 字节并执行 --version，自动审批再次以 Code from External 拒绝，二进制未执行。提交/PR/Review/Squash Merge 当时均未开始，授权保留。

### 11.2 显式授权后的人工续跑

用户再次明确授权以上行为后，重新取得维护锁并实际成功 record，repairAttempts=4，原 key/target/branch 保留；实际 asc 6.5.0 执行也获准。这是人工续跑，不改变 routine 的自动三轮上限、mergeGate 或持久授权范围。

修复 503 测试，使其验证 unknown 且没有 harness/support 成功字段，保留有界 npmJson。将同包矩阵扩展到两个宿主消费端：新增 development-harness-target.json，开发组合使用根精确锁，保留组合使用独立锁，两边都严格安装同一个 tarball，并从安装包加载真实插件。此前只有旧消费端使用打包插件，新环境直接测源码，不足以证明同一产物；本次补齐该覆盖。

真实 6.5.0 contract/classify/smoke 通过后，src/compat.ts 的推荐/provision pin 推进到 6.5.0，最低仍为 6.3.0。提示测试暴露的旧推荐文本常量同步为当前 pin，同时明确断言旧 6.3.0 仍仅收到 upgrade-recommended。工具/action/job/配置及审批规则未改变。

新开发环境完整 npm run verify 八阶段通过，20 suites / 406 tests；6.5.0 contract 接受 28 条命令、分类审计 1,995 路径无 read 写文件、离线 smoke 通过。保留 6.3.0 的 28 条命令契约、1,932 路径分类审计及离线 smoke 也通过。测试均隔离配置并使用合成凭据。同包双消费端矩阵已完整通过：两个精确宿主环境各通过 20 suites / 406 tests、类型检查、构建、pack-manifest、参数守卫和保留引擎 smoke，安装前各复验 16 固定产物。两侧包摘要相同：sha512-E0WhFJZ8/KUA9oIiiw27/HN6kxw2wJI5PQx9x6yzDQUfTlDmSbiGHTdBK75NROt0XU9aq/H4OXm8TaPcuzfaeA==。证据为本轮 verify-authorized-full-650.log 与 verify-authorized-matrix.log。实现与本地验收完成，状态改为 implemented；PR 创建、远端 CI、最终审查与合并属于后续交付门禁，不能由本地通过推定。
