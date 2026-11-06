# 011 · 预构建插件安装，不在用户安装时编译

| 字段 | 值 |
|---|---|
| id | 011 |
| status | implemented |
| created | 2026-11-06 |
| owner | sleep9ull |
| related | CONTRACT §5；spec 003、010 |

**一句话**：正式用户安装包含完整 JavaScript 的 npm 成品包，插件不再声明安装时构建脚本。

## 1. 背景与问题

用户通过 GitHub 仓库地址安装 0.2.1，pnpm 拦截 `prepare: npm run build`，Desktop 要求允许脚本后才能重试。Git 不包含 `lib/`，直接删除 prepare 会使源码安装缺少运行入口。

授权来源：本会话先提出“移除 prepare、改用 prepack 在打包阶段构建，以预构建 npm 包作为正式安装入口”，用户明确回复“按这个方案改”。本 spec 记录已确认的方案，不重复请求批准。

发布事实以官方 npm registry 为准：本轮实际查询确认 0.2.1 已于 2026-11-06 发布，且仍声明 prepare。仓库原有“npm 最新 0.2.0 / 0.2.1 未发布”的说明已过时。修复使用新的 patch 候选 0.2.2，不覆盖既有 0.2.1；本次不发布。

## 2. 范围

- 用 `prepack` 替换 `prepare`；打包前 clean build 并执行已有 lib/src 文件集检查。
- 正式安装入口为 npm 包名及精确已发布版本；本地验证可使用预构建 `.tgz`。明确 GitHub 仓库地址不是成品包安装入口。
- 增加真实打包回归：初始无 lib 的源码能够打包出完整入口、声明和技能；成品包没有需要消费者执行的安装生命周期脚本，解包后可以直接加载。
- 插件与安装锁根版本同步为 0.2.2；README 当前 npm 版本据实更新为 0.2.1，修复版 0.2.2 保持未发布。
- 同步安装、开发、发布说明及质量门文档；独立 CI contract job 在下载器读取 lib/compat.js 前显式 build，替代旧 prepare 的隐式构建。

## 3. 非目标

- 不发布 npm/tag/release，不提交或推送 Git。
- 不修改 dsh/pnpm 的审批机制或用户 profile，不全局允许脚本。
- 不承诺 GitHub 源码地址无构建安装；不把 lib 提交到 Git。
- 不改变工具、引擎管理、宿主兼容版本声明或 ASC 权限。

## 4. 契约变更

| 面 | 变更 | 备注 |
|---|---|---|
| 发布物 | 构建只在生产端 prepack 执行；npm 包包含 lib/skills/patch | 包的 main/exports 不变 |
| 安装 | 无 prepare/preinstall/install/postinstall | 消费者不需要编译插件 |
| 工具 / 配置 / 结果 | 无 | 五工具与现有公共契约不变 |
| policy / 审批 | 无 | 不绕过宿主安装权限，也不放宽运行时审批 |
| 版本 / 兼容 | 插件 patch 候选 0.2.2；保留现有宿主/peer 支持并集 | 发布仍需单独授权 |

## 5. 行为规格

1. 在已安装开发依赖、没有 lib 的源码目录执行 `npm pack`：prepack 执行 clean build 和 manifest 检查，生成完整成品包。
2. 用户通过 npm 包名或预构建 tgz 安装该产物：安装本插件无需运行生命周期脚本；现有宿主提供 peer，不需要插件编译工具链。
3. 回归验证从真实 tarball 读取 manifest，拒绝安装脚本；解包后直接通过公开入口加载并读取技能/patch。
4. `--ignore-scripts` 打包仍要求调用方先显式 build；现有双宿主矩阵沿用该行为。
5. 打包前编译或 manifest 检查失败则打包失败；不降级为不完整产物。
6. README 默认安装示例使用实际已发布的 0.2.1，另给 0.2.2 发布后才适用的升级说明，不把候选标成已发布；保留历史 0.2.0 迁移章节。

## 6. 安全与审批影响

I1–I10 均无变化。仅开发者打包时执行本仓库构建；不新增插件运行时写路径，不下载 asc，不触碰凭据或真实 profile。测试在隔离临时目录操作，执行源码及其构建产物，不执行外部下载包脚本。其他包仍可能触发宿主脚本授权，本变更只消除插件自身的安装脚本要求。

## 7. 兼容与迁移

npm 包消费者沿用现有入口；GitHub 源码用户切换到正式 npm 版本或维护者构建的 tgz。开发者 `npm install` 后需显式运行 `npm run build`（现有贡献说明已包含）。安装包不变更 peer 或 engines 支持集合。不能用本地重建的 0.2.1 冒充 registry 的同版本产物；本轮早期同名临时产物被最终 0.2.2 候选替代。

## 8. 验收标准（最终 0.2.2 候选）

- [x] 回归测试在旧 prepare 设计下失败，在新 prepack 设计下通过。
- [x] 无 lib 的隔离源码执行真实 npm pack，产物包含可加载入口、类型声明、六个技能和 patch，无安装生命周期脚本。
- [x] `npm run clean && npm run verify` 完整八阶段通过，410 tests（Node 24.14.0、asc 6.5.0）。
- [x] 双宿主以同一 0.2.2 成品包、禁用安装脚本进行严格安装和真实宿主集成验证。
- [x] README 双语、CONTRACT、CONTRIBUTING、TESTING、CHANGELOG 与行为及实际发布状态一致。

## 9. 测试计划

| 类型 | 内容 |
|---|---|
| 回归 | 隔离源码真实 npm pack → 解包 → 拒绝安装脚本 → 直接加载公开入口及随包资源；无网络 |
| 契约 | 既有 pack-manifest 和完整 verify |
| 集成 | 双宿主矩阵严格 ignore-scripts 安装同一 tarball 与真实审批回归 |
| 手动 | 不操作真实 Desktop profile；npm 发布与 Desktop 安装另行明确记录 |

## 10. 文档与 skill 同步

- [x] README / README.zh：npm 成品包入口、GitHub 源码限制、当前发布与候选版本状态。
- [x] CHANGELOG：记录 0.2.2 prepack 与免安装构建；0.2.1 标注 registry 实际发布日期。
- [x] CONTRACT §5、CONTRIBUTING、TESTING：构建/打包/安装边界与回归。
- skills 无需修改：工具名/action/运行时策略均未变化。

## 11. 开放问题

| 问题 | 结论 | 阻塞实现？ |
|---|---|---|
| 是否发布 0.2.2 | 本次不发布，交付验证后的候选变更 | 否 |
| 是否承诺 Desktop 不显示任何提示 | 只消除本插件的安装脚本要求；不替其他依赖或宿主作保证 | 否 |

## 12. 验证历史与环境

版本校正前的本地完整八阶段已通过 410 tests；asc 6.5.0 的 28 条命令契约、1,995 路径分类审计与真实 subprocess 离线 smoke 均通过。首轮同包矩阵在旧宿主 0.2.1-rc.5 下严格禁用脚本安装成功、410 tests 及 smoke 通过；新宿主停在严格依赖图复验，不能记成双宿主成功。

当前机器需要现有网络代理；隔离 npm 解析环境未转发代理时长时间阻塞。仅为本地验证转发既有代理后，新宿主严格解析成功（725 packages）；不修改源码、固定目标、校验算法、strict-peer-deps 或 ignore-scripts。最终版本重新验证，早期临时产物及其结果不替代最终 0.2.2 证据。

最终 0.2.2 验收已通过：Node 24.14.0 从无 lib 状态执行完整 verify 八阶段，22 suites / 410 tests；asc 6.5.0 的 28 条命令契约、1,995 路径分类审计和离线 smoke 通过。同包双宿主矩阵在 0.2.1-rc.5、0.2.2-rc.1 上各复验 16 个固定产物、严格禁用脚本安装，各通过 410 tests、全部本地门禁及真实 subprocess 离线 smoke。

证据目录：`vendor/harness-matrix-eYO5Aq/`，含两侧实际锁、固定目标、共同 plugin.tgz 和 status=passed 的 result.json。共同包摘要为 `sha512-rjtt6ECJ2B5IBNqo+XRDezV8lYwiEK8nnj/+eTcak0f2y5lt89FXRIDZjf1OjzCA12BIa1AHsb7LH7xc4/k4Lw==`。交付安装包 `vendor/prebuilt-install-ml9e8F/sleep9ull-dsh-asc-cli-0.2.2.tgz` 与矩阵产物逐字节相同，包含 69 个编译文件、六个技能和 patch；没有消费者安装生命周期脚本。

未执行：远端 Node22/24 CI、真实 Desktop profile 安装、Apple 账号业务读写、Git 提交/push 和 npm/tag/release 发布。
