# 009 · 适配 Harness 0.2.2-rc.1 与 asc 6.5.0

| 字段 | 值 |
|---|---|
| id | 009 |
| status | implemented |
| created | 2026-11-06 |
| related | spec 005 §4.1 / 007 / 008；CONTRACT §3 / §5 |

**一句话**：将源码版宿主与 peer 锁定到默认宿主图选出的新组合，在完整验证后将可选 provision 的 asc pin 推进到 6.5.0，保留 6.3.0 最低支持线。

## 1. 背景与授权

本轮 daily-dsh-asc-upstream-maintenance 使用持久授权 `deployment-2026-11-05-pr-v1`（来源会话 `local_5d422dc8-d6c5-43c0-9553-56fa0b682075`），按 spec 005 §4.1 自动起草范围内兼容适配，终点为唯一 PR。该既有任务授权仍受宿主实际审批约束。首次记录共享状态时遭宿主拒绝并停止；2026-11-06 用户在本会话明确回复“那么，继续吧，适应性升级。”后恢复执行，宿主已实际放行同一固定目标的 record，spec 进入 approved。

默认宿主 latest 为 `0.2.2-rc.1`；严格完整依赖/peer 图选出 13 个相关 dsh-* 包 `0.2.2-rc.1`、Cordis `4.1.0`、Schemastery `3.19.0`。宿主实际要求 `~4.1.0` / `~3.19.0`，不再受旧宿主的 minor 上界限制。13 项独立 latest 较旧，仅作 observation，不混装或降级。宿主及 15 个相关产物的真实 SHA-512 与官方注册表签名已验证，全部 `gitHead` 缺省，commit=null；这不是源码构建证明。

asc stable 为 `6.5.0`，tag 声明 commit `08c8ffcefbc57210cfe829bd00a4b695f192752d`；macOS arm64 资产 SHA-256 为 `ab1dfca6777e66c5e5d55b2abe2e8a06f74743be841183575dcd87b11aa9eb6c`，仍须在下载后校验真实字节。完整目标键为 `966eed80553646c9619206652f3375f6773d142e09e0d74aa6a1c6f2ebdf1d76`，固定后不再读取 latest 替换目标。

## 2. 范围与非目标

范围：既有宿主接口的必要适配、精确 host / peer / dev pin、安装锁、asc pin、受影响测试及文档和 quickstart skill。先复验固定产物和安装锁，再安装，最后验证真实 Harness 服务和引擎。

**2026-11-06 用户补充约束**：未升级 dsh 的用户也必须继续使用插件。原单新版 engines/peer 声明不再是可交付方案；[spec 010](010-dual-harness-compatibility.md) 已按用户后续明确指令进入 approved：插件目标版本 0.2.1，长期保留上一稳定兼容线并持续适配新版本；当前无正式稳定版，保留已验证 0.2.1-rc.5 并适配 0.2.2-rc.1。当前新宿主测试成功只是一部分证据，需完成同一插件产物的旧/新宿主安装与行为验证。此新增兼容要求已在第三轮实施，两宿主各通过类型检查和 29 个真实集成测试，但整体测试各有一条失败，尚不能宣称完整验收通过；最新状态见 §6.3。

不新增工具、action、job、配置或插件运行时模块；开发验证入口按 spec 010 扩展；不放宽 I1–I10，不移除公共能力，不修改维护策略、权限或 CI 门禁。不自动合并、同步主副本、发布或操作真实 Apple 账号，不升级全局工具。npm 0.2.0 的既有发布说明保持历史事实。

## 3. 契约与行为

| 面 | 目标行为 |
|---|---|
| 宿主与依赖 | 按 spec 010，engines.dsh 为 0.2.1-rc.5 与 0.2.2-rc.1 精确并集，peer 接受对应两组；开发 pin 和每环境解析图/锁精确固定 |
| 引擎 | 验证成功后 provision pin 为 6.5.0；最低 6.3.0，声明范围仍为 >=6.3.0 <7.0.0 |
| 用户版本提示 | 已验证 pin 是推荐版本；支持范围内的旧版本仍可执行，提示不能触发自动安装 |
| 工具与知识 | 保持五工具、五 job、六个 rank 600 skill、两命令 |
| 安全与结果 | 保留实际批准收据、最终 guard、单一 argv subprocess、只读注入、凭据 tombstone 和既有结构化结果 |

如新组件发生依赖冲突或功能回归，按原契约评估最小适配；不能解决则保留原基线，记录固定候选失败和累计修复预算，不以换候选、删除能力或弱化测试过门。

## 4. 验证与迁移

1. 仅在本轮独立 worktree，使用隔离 npm 配置/HOME/cache，ignore-scripts、strict-peer-deps 生成安装锁，保留 dev/optional。
2. `verify-harness --input target.json --lock-file package-lock.json` 复验全部 16 个固定产物和实际安装锁，并严格重新解析固定宿主与组件图；通过后才按同一锁 npm ci。
3. 对类型或行为回归先保留失败证据，再最小修复；既有测试继续验证公共契约，不新增复述 pin 常量的测试。新宿主的 tools.execute 已改为 executor 提供的批次接口；本插件不提供 executor，集成测试通过宿主公开的 ToolExecutionPipeline / executeToolBatch 执行单调用批次并解包结果，保留真实调度、pre-execute、批准收据和最终 guard。不得用工具 handler 直调替代管线，或为此新增未固定的 executor 依赖。新版 ApprovalService 另要求 sessionProjections 服务；集成环境必须加载已在固定组合中的真实 SessionProjectionRegistry，不能模拟批准或跳过批准审计。
4. 目标 asc 6.5.0 跑完整 npm run verify，保留 typecheck、真实 Harness、测试、build、pack、combos、contract、classify、离线 smoke。6.3.0 旧支持基线也实际验证，分别记录引擎版本和代码状态。
5. Node 22/24 和 contract PR CI 单独记录，pending 不算通过。v3 marker 固定完整原始来源，累计 repairAttempts 不重置。
6. 按 spec 010 保留旧宿主并适配新宿主，插件目标 0.2.1，不强制用户升级宿主；已发布 npm 0.2.0 的历史宿主仍为 rc.5。本轮不执行真实 profile 更新。

## 5. 验收标准

- [x] 完整分页恢复为 idle，main 实际保护满足任务要求，持锁固定唯一目标。
- [x] 严格宿主图及实际产物发现成功；两次 Harness 产物身份一致，observations 单独保留。
- [x] 安装锁及固定产物复验通过，严格按锁安装，无脚本执行或依赖冲突。
- [x] 真实 Harness 既有工具、技能、命令、审批收据与最终 guard 测试通过。
- [x] asc 6.5.0 完整八阶段验证通过；6.3.0 保留支持验证完成。
- [x] README / README.zh / CHANGELOG / AGENTS / CONTRACT / COMMANDS / TESTING / quickstart 同步。
- [ ] 自检 diff，commit/push，创建含完整 v3 marker 的唯一 PR 并绑定 Desktop 监控。
- [ ] PR Node22 / Node24 / contract CI（仅创建 PR 后可确认）。

## 6. 本轮实施记录

### 6.1 首次自动运行（安装前停止）

发现阶段首次完整请求网络超时，一次重试使用 Node 自带环境代理支持后成功；使用已有代理未修改用户配置。宿主自动审批拒绝共享状态 record，理由为 `Modify Shared Resources`。首次运行停止在安装前，保留固定目标和本分支，正常释放锁，未换手段绕过拒绝。当时共享 state 为 missing。

### 6.2 用户授权续跑（宿主适配通过，引擎执行阻塞）

用户明确要求继续适应性升级后，重新取得仓库锁；同一目标的 record 实际获准，恢复 state 成功记录。分支仍为 `maintenance/dsh-0.2.2-rc.1-asc-6.5.0-966eed80`，起点仍为 origin/main `e422a4c1ce5c58ff157b11493671e8346191af4c`，没有更换目标或归零修复预算。

隔离配置下生成严格安装锁，复验全部 16 个固定产物与实际安装锁通过；随后以 ignore-scripts / strict-peer-deps、包含 dev/optional 的 npm ci 安装 87 个包。安装前后 lock SHA-256 相同：`5ef21f6ea92c2636009ced1f2d3643acffe85289b6ed476dc772db052e52260b`。

先红后绿的两轮适配：

1. 新宿主把 tools.execute 改为批次接口，原集成夹具类型检查失败。记录 repairAttempts=1 后，改用公开 ToolExecutionPipeline / executeToolBatch 执行单调用批次，保留原有断言。
2. 随后类型检查通过，但 7 个审批相关测试失败；新版 ApprovalService 注入 sessionProjections，原夹具未加载该真实服务。记录 repairAttempts=2 后，加载已在固定组合中的 SessionProjectionRegistry。

最终 `npm run verify -- --unit-only` 五阶段全部通过：typecheck、20 个 suite / 387 tests（含 29 个真实宿主集成测试）、clean build、23 个源码文件对应 69 个构建产物、13 个非法组合拒绝及 8 个合法组合接受。证据：本轮 gitignored `vendor/maintenance-20261106-966eed80/verify-unit-repair2.log`；此前红测试保存在同目录 initial / repair1 日志中。

asc 6.5.0 和 6.3.0 均下载到各自新建的独立目录，并校验真实字节 SHA-256。6.5.0 摘要为 §1 所列值；6.3.0 为 `c460fff17553d5a0b982bb67d366188554ccce3da4fd28e38ecd24ceb05915f8`。尝试在隔离 HOME/配置及只读环境下执行新版引擎时，宿主自动审批拒绝，理由为 `Code from External`。没有通过其他入口执行该引擎。两版本的实际引擎 contract / classify-audit / smoke 均未完成，unit-only 不代表完整通过。

第二轮结束时，工作为未提交候选：package.json / package-lock.json 已固定新宿主组合，test/harness.test.ts 与 TESTING 已适配；生产 src 未修改，asc provision / 推荐 pin 仍为 6.3.0。其余基线文档同步、完整验证和 PR 均待完成，spec 保持 approved，不标 implemented。恢复时必须沿用原 target / key / branch，保留 repairAttempts=2；完成原授权要求的完整验证前不能 commit/push/创建 PR。

退出前尝试持锁把最终 blocked 结果写入共享 state，宿主再次以 `Modify Shared Resources` 拒绝 record；未换工具写同一共享状态。因此共享 state 仍保留此前成功写入的 adapting / repairAttempts=2，最终 blocked 输入仅保存在 gitignored state-input.json，不等于已记录。恢复必须关联本 spec 的执行阻塞和已通过验证证据，不能把旧状态当作引擎执行授权。维护锁通过持有进程正常释放。主副本 HEAD 与用户已有 `.gitignore` 修改、`docs/ASSESSMENT.md` 和 `docs/assessment/` 未跟踪内容只读核验并保留。未合并、同步主副本或发布。

### 6.3 第三轮：插件 0.2.1 双宿主适配（未收口）

用户明确回复“逐项审批继续”后，重新持锁，第三轮 record 实际成功，repairAttempts=3；本节取代 §6.2 的当前状态描述，历史拒绝仍保留。

已按 spec 010 实施公开 engines/peer 精确并集、精确开发 pin、旧宿主产物/锁夹具、同一打包插件的保留宿主 runner、旧单调用/新批次公开入口适配、正式稳定线发现和 CI 矩阵步骤。插件 package.json 与 package-lock.json 版本均为 0.2.1，生产 src 未改、asc pin 仍 6.3.0。长期规则、原定时任务说明和相关文档已同步。

旧宿主消费端先因 Cordis peer 冲突 ERESOLVE；精确并集修复后，16 固定产物复验与严格安装成功。新开发环境也复验 16 固定产物及最终安装锁，并以无安装脚本的严格 npm ci 安装成功；最终锁 SHA-256 为 e1d51396656e7fc42ba255070c56ea1b61ae646f780bd33f71b187c09afcbc0f，§6.2 的锁摘要仅对应历史版本。

两宿主 typecheck 和 29 个真实集成测试均通过；完整测试均 405 passed / 1 failed（406 总数）。失败是新增维护测试期待 HTTP 503 出现在原因文本中，而有界 npm 读取器返回通用失败文本；status 仍正确为 unknown。第三轮失败，按预算停止，未自动追加第四轮。实际引擎执行再次被自动审批以 Code from External 拒绝；未绕过。没有完成完整引擎门禁、远端 CI、提交或 PR，spec 仍 approved。最终持锁 record blocked 再次被自动审批以 Modify Shared Resources 拒绝，未绕过；共享状态仍为 adapting / repairAttempts=3，blocked 输入只在本地。最新证据见 spec 010 §11 及本轮 vendor 报告。

### 6.4 显式人工续跑与引擎推进

用户明确授权提交、创建 PR、Review、检查通过后 Squash Merge，并再次明确授权必要行为后，本轮实际获准持锁 record 累计第 4 轮和执行固定引擎。未重置预算，也未修改 routine 的三轮上限或 gate；自动 gate 对超过三轮仍要求人工决定，本次使用真实用户的直接授权。

503 测试改为断言 unknown 且不含成功字段，保留有界读取器。双宿主 runner 补齐新宿主消费端，使用两组固定产物和精确锁严格安装同一 tarball，真实集成从安装包加载插件。src/compat.ts 推荐 pin 推进 6.5.0，最低 6.3.0 不变；对应提示测试、quickstart 和文档同步。

npm run verify 在实际 SHA-256 校验的 6.5.0 上完整八阶段通过，406 个测试通过。保留的 6.3.0 同样实际通过 contract / classify-audit / smoke。两版本分别接受 28 条命令，完成 1,995 / 1,932 路径分类审计，无文件写入被判为 read。新旧环境严格安装和同包测试的最终结果见 spec 010；PR CI 独立记录，未完成前不称通过。
