# 012 · 固定最低兼容基线，持续适配新上游

| 字段 | 值 |
|---|---|
| id | 012 |
| status | implemented |
| created | 2026-11-07 |
| related | spec 005 / 008 / 010 / 011；CONTRACT §3 / §5 |

**一句话**：最低要求固定为 Harness 0.2.0 线与 asc 6.0.0，持续适配新版，只有用户明确要求才改变最低基线。

## 1. 背景与授权

2026-11-07 用户要求同时调整代码仓库、upstream 维护规则和 Claude Desktop routine：主要基线为 DeepSeek Harness 0.2.0、asc 6.0，后续基线不变、及时适配新版，直到用户改变基线。查询官方 npm 后确认没有正式版 0.2.0，仅有 0.2.0-rc.1 / rc.2；用户进一步明确选择 **0.2.0-rc.2** 作为固定最低验证基线。用户所述最新 asc 0.6.5 对应仓库已适配的 **6.5.0**。

以上明确需求和版本选择授权本 spec 实施及更新既有 routine；替代 spec 010 的“上一稳定兼容线/最新 patch 自动移动”原则，不需要再次确认相同策略。不授权本轮 commit/push/PR/合并/发布；既有 routine 的 AUTO_TO_PR 持久权限继续生效。

## 2. 范围

- 固定最低 Harness 为 0.2.0-rc.2、asc 为 6.0.0；推荐 asc pin 保持 6.5.0，开发宿主保持 0.2.2-rc.1。
- 保留已支持的 Harness 0.2.1-rc.5 / 0.2.2-rc.1；增加最低宿主的精确产物与独立锁，并将同包矩阵扩为三个宿主。
- 维护发现报告固定最低要求，不根据 latest、major/minor 或稳定 patch 自动移动最低锚点；不要求低于最低要求的历史线。缺少真实最低发布物或公开声明未覆盖最低锚点时报告缺口，不能默默替换。
- latest 候选继续按精确宿主完整图、签名/摘要、安装锁和完整集成验证选择。比较开发升级与最低兼容要求时分开处理，不把旧基线当作开发降级。
- 同步仓库规则、契约、README、测试说明、发布 quickstart 及既有 Desktop routine。

## 3. 非目标与安全

不改变插件版本号、工具/action/job/结果/配置、审批和执行边界。不强制用户升级，不自动安装或降级，不改宿主权限，不弱化测试/CI/来源验证。I1–I7、I9–I10 不变；I8 仅将最低版本从 6.3.0 调整到用户指定的 6.0.0，外置、默认关闭 provision、SHA-256 和无自动升级不变。

## 4. 行为与兼容

- 最低要求、最新已验证推荐和精确开发 pin 分离；公开支持继续用实际验证的精确并集，不能以无界范围声称所有未来版本已测试。
- 同一个构建包在 0.2.0-rc.2 / 0.2.1-rc.5 / 0.2.2-rc.1 的隔离组合分别严格安装和验证真实审批、guard、工具/技能/命令。兼容层只在实际 API 差异需要时调整，写路径缺少宿主能力仍拒绝。
- asc 6.0.0 与 6.5.0 分别执行真实 contract/classify/smoke。低版本缺少已声明参数时先在本 spec 记录最小兼容处理，不能单纯删除门禁。
- 所有维护运行都验证最低宿主与最低引擎；持续适配的新候选不能替换最低锚点。提高最低版本或移除已有支持必须获用户另行授权。
- routine 保持原计划时间、启用状态、独立 worktree、锁/恢复、来源规则、三轮预算及 AUTO_TO_PR；本变更进入 main 前报告 BOOTSTRAP_REQUIRED，不让新 prompt 代替实现。

## 5. 验收标准

- [x] 最低宿主严格安装的原始失败被复现，兼容修改后同包三宿主矩阵通过。
- [x] 最低引擎版本状态与提示先红后绿；6.0.0 / 6.5.0 实际引擎门禁通过。
- [x] 注入网络回归证明 latest 跨线或稳定 patch 更新不移动最低锚点，不再要求 0.1.x 或新稳定 patch 替代基线；缺最低支持会报告 drift。
- [x] 完整 npm run verify、最终 clean build 与 pack-manifest 通过，逐环境结果记录。
- [x] 仓库当前规则、维护 skill、README/README.zh、CHANGELOG 和相关文档一致。
- [x] 原 Desktop routine 的完整 prompt/description 已更新，cron/启用状态保持；未执行实际维护、GitHub 写或发布。

## 6. 验证与交付记录

解析或本地单测成功不代替真实矩阵，远端 Node22/24 CI 与 Desktop 端到端运行单独报告。

- 官方 npm 实际读取完整发布列表，确认 0.2.0 正式版缺失，用户选择 rc.2；最低完整宿主图选出 dsh-* 0.2.0-rc.2 / Cordis 4.0.5 / Schemastery 3.18.5。16 个固定产物通过真实注册表验签、SHA-512 字节和安装锁复验；保存 minimum-harness-target.json / minimum-harness-lock.json。
- 决定性红例：原 0.2.2 包在最低宿主消费端 strict-peer-deps 解析报 ERESOLVE，dsh-llm peer 只接受 rc.5/rc.1。矩阵删最低宿主回归在实现前继续构建并失败；asc 6.0.0 在调整前被归为 older。维护新规格在实现前 16/40 失败，实现后维护相关 108 tests 通过。
- 实际 asc 6.0.0：28 条 contract、1,927 条分类路径、11 组副作用 flags 均通过；隔离 HOME、合成凭据下真实 Harness subprocess smoke 六次调用通过。证据 vendor/minimum-asc-gates.log。
- 第一轮根验证和最低消费端验证均发现六个旧提示测试错误地期待 asc 6.2.0 为 upgrade-required；实际代码正确返回 upgrade-recommended。保留原拒绝/提示断言，将不受支持的样本改为 5.99.0，另有 6.0.0/6.2.0/6.3.0 受支持提示回归；81 个针对性测试通过。最低消费端 strict 安装、类型检查、真实批准/guard 行为已通过，完整矩阵重跑结果另记。
- 原 Desktop 任务 daily-dsh-asc-upstream-maintenance 的 prompt/description 已通过 update_scheduled_task 实际更新；list_scheduled_tasks 复核 cron=17 10 * * *、enabled=true。未新建或手动触发任务；prompt 明确 spec 012 未进入 main 时 BOOTSTRAP_REQUIRED，保留 AUTO_TO_PR、独立 worktree、锁/恢复/三轮预算和所有来源/审批门禁。

### 最终验收

- 根目录 `npm run verify` 八阶段全部通过，22 suites / 415 tests；本次 clean build 为 23 个源码生成 69 个 lib 文件，pack-manifest 一一对应。推荐 asc 6.5.0 的 28 条命令、1,995 条分类路径、11 组 flag 向量与真实离线 smoke 通过。日志 vendor/fixed-baseline-full-verify-final.log。
- 同一个 0.2.2 构建包在 0.2.0-rc.2、0.2.1-rc.5、0.2.2-rc.1 三个隔离消费端均通过：每侧复验 16 个固定产物及实际安装锁、ignore-scripts / strict-peer-deps 安装，运行 415 tests、类型/构建/pack/参数守卫五阶段与最低 asc 6.0.0 真实 subprocess smoke。无需新增运行时 API 兼容分支，已有公开宿主适配满足最低版本，审批与最终 guard 保持。
- 三侧使用相同 tarball SHA-512：`sha512-5/7bORwvi4E6GHMhOxkOv7HBHqlX23zHUzCgjVcnJ30QronqJpwNCOcga4wYCIUYdpQTAyoHlw4BWCsz8JZ0og==`。证据 vendor/harness-matrix-5HEn0u/，日志 vendor/fixed-baseline-matrix-final.log。另行从实际 plugin.tgz、逐环境 package-lock.json 重新计算 SHA-512 / SHA-256，与三个 passed result.json 核对。
- 真实 `harness-watch` 返回 unchanged，固定最低 0.2.0-rc.2、当前开发 0.2.2-rc.1、changes=[]；13 个陈旧组件 latest 标签只保留 observations，无自动降级。证据 vendor/fixed-baseline-watch.json。
- 本轮实际运行 Node 24.14.0。隔离 npm 子进程临时转发现有网络代理，未改变验证算法或严格安装参数；辅助脚本在 gitignored vendor，不是生产变更。远端 Node22/24 CI、Desktop Run now、真实 Apple 账号操作、commit/push/PR/合并/同步/发布未执行。lib 与 vendor 证据均保持 gitignored。
