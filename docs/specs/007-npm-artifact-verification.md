# 007 · 以验证过的 npm 发布产物驱动维护

| 字段 | 值 |
|---|---|
| id | 007 |
| status | implemented |
| created | 2026-11-05 |
| related | spec 005；CONTRACT §5；MAINTENANCE |

> 后续变化见 [spec 008](008-harness-drift-triage.md)：兼容优先选择宿主依赖图内候选，独立 latest 仅作观察；发现与固定复验新增 npm 临时解析写入，不安装或执行包，本文保留当时的纯网络验证设计记录。

**一句话**：缺少 `gitHead` 不再单独阻塞维护；以固定 npm 发布产物的 SHA-512 和注册表签名校验替代必填源码 commit，仍明确区分产物验证与源码构建来源证明。

## 1. 背景与问题

2026-11-05 实查 `@deepseek-ai/dsh@0.2.1-rc.5`：有 `dist.integrity`、npm 注册表签名（实际验签通过），无 `gitHead`，npm provenance 查询为 404。同名上游 tag 的存在不能证明 tarball 的构建来源。当前发现和 state 校验强制源码 commit，导致默认渠道维护永久 unknown。

用户在本任务会话明确批准“验证 npm 发布产物、允许源码 commit 缺省”的方案，并回复“按此方案修复”，授权本 spec 的实现；不再重复请求同一方案的批准。

## 2. 范围

- 开发维护层 npm 产物校验模块、discover/harness-watch、固定目标再验证入口。
- state、目标标记及恢复逻辑兼容与迁移，文档和 routine 指令同步。
- npm 包名、精确版本、固定官方 registry URL、有效 SHA-512 SRI、真实下载字节与有效注册表签名均须验证。

## 3. 非目标

不改插件运行行为、上游版本基线、I1–I10、审批、五工具或六个发布 skill；不发布、不合并、不执行真实 Apple 操作；不宣称 npm 签名证明源码构建来源，不猜 tag/commit；不增加运行时依赖。不借此将多个包的独立 latest 视为已兼容。

## 4. 契约变更

| 面 | 变更 | 备注 |
|---|---|---|
| Harness 来源 | 精确 npm 产物为验证依据；commit 为有效 gitHead 或 null | gitHead 即使存在也只是上游声明，不是构建证明 |
| 记录 | name/version/source/manifestUrl/tarball/integrity/verification | verification 记录签名类型和通过验证的 keyid；实际信任依据由代码重新验签，不信任模型自报字段 |
| PR marker | 新建 v3，保留版本组合 key 算法 | v2 不丢失、不自动升级为已验证；未完成旧目标阻塞迁移，已被 Git 证实 synced 的历史记录仍可识别 |
| CLI | 增加 verify-harness --input target.json [--lock-file package-lock.json] | 重新读取固定版本，不重查 latest；可比对将用于安装的 lockfile |
| 插件工具/config/policy | 无 | 仅开发脚本和维护契约变化 |

## 5. 行为规格

1. latest 只用于选择每个相关包的精确版本。发现结果保存该精确版本 manifest URL，不能把可变 latest 作为恢复时的下载身份。
2. 仅允许 `@deepseek-ai/` 下的合法包名和 `https://registry.npmjs.org`；manifest、tarball 路径必须与包名/版本匹配，拒绝凭据、query、fragment、HTTP、跨域和重定向。source 必须为指定 DeepSeek Harness 仓库；它只是来源声明，不是签名证明。
3. 从固定官方 registry keys 端点读取受支持的 ECDSA P-256 公钥；按 `name@version:integrity` 验证签名。未知/过期 key、缺签名、无有效签名、畸形 key/signature 都不能通过；不得信任 manifest 自带公钥。多个签名中有一个有效即可。
4. SHA-512 SRI 必须为规范 64 字节摘要。下载 tarball 到内存，设置请求和 body 超时及大小上限，按实际字节验摘要；不解压、不执行、不写用户目录。官方 keys 和 manifest 同样有有界读取。
5. `commit` 缺失为 null；畸形非空 gitHead 拒绝，不能补 tag。npm provenance 未验证，不添加源码构建已证明的字段。
6. `verify-harness` 对固定目标重新获取精确 manifest、官方 keys、tarball 并实际验签验摘要；版本、下载地址、摘要、source 或声明 commit 与固定记录不同则拒绝。复验指定原 keyid，多个有效签名的重排不影响结果。提供 lockfile 时，根 peer/dev 里的相关包名集合须与目标匹配，所有这些包的 version/integrity/resolved 必须一致，不能只检查目标里恰好列出的子集；dsh CLI 本身仅在 lockfile 中存在或根声明它时比较。
7. 同一版本组合仍只有一个 key；产物地址、摘要、来源或 verification 身份变化不能重用或覆盖已有固定目标。v3 结构校验不等于刚执行了验签；routine 必须运行再验证入口，再让 npm 根据已比对的锁文件安装和执行测试。
8. v1 继续显式 blocked。v2 历史标记继续参与去重和恢复；未收口旧记录或旧本地目标不自动改写，要求人工迁移并重新验证。新建标记和最终门禁只接受新的产物记录。损坏/重复/混合标记不能静默忽略。
9. discover/harness-watch 仍无文件写入；下载用于字节校验，因此不能再描述为只读元数据查询。失败仍 unknown，CLI 退出 2，不能记作 unchanged。

## 6. 安全与审批影响

I1–I10 均不改变。本变更经用户批准调整维护层的来源要求：信任官方 npm registry 的已签名发布物，不等同证明发布者身份或无恶意代码，更不等同验证源码 commit。脚本不读取 Apple 凭据，不执行下载数据；完整兼容测试和人工合并仍保留。routine 保持 AUTO_TO_PR、每天本地 10:17，不扩大到合并、同步或发布。

## 7. 兼容与迁移

新 marker v3；key 不变，避免绕过旧目标而重复开 PR。旧 v2 可读取，但未完成目标必须显式迁移，不能伪造新的 verification 字段。旧 v1 保持人工处理。源包缺 gitHead 的情况现在可通过发布物验证；缺少签名/摘要、网络失败等仍 unknown。

## 8. 验收标准

- [x] 缺 gitHead、有真实签名和正确 tarball 的默认渠道包可以发现；结果 commit=null，相关包独立定版。
- [x] 篡改字节、签名、包名或版本、未知/过期 key、无签名、畸形 SRI/URL、重定向都拒绝。
- [x] 完整记录能被 state/marker/recover 使用；未知修复预算仍 blocked，来源漂移不能覆盖旧目标。
- [x] 旧 v2 记录不会丢失或被默认升级；已确认同步的旧历史不会制造重复目标。
- [x] verify-harness 只读固定版本，重新验证真实内容；lockfile 不匹配或漏掉根相关依赖时拒绝。
- [x] npm run verify -- --unit-only；真实 16 个默认渠道包的产物发现和固定目标复验。
- [x] 完整 npm run verify 八阶段通过，含真实 asc 6.3.0 的 contract/classify/smoke；下载资产已按官方 SHA-256 校验。

## 9. 测试计划

使用 Node 原生 crypto 生成测试密钥并签名合成字节；注入 fetch/now，不触真实 npm/GitHub/Apple。覆盖成功链路、各类拒绝、固定目标再验证、旧记录恢复和 lockfile 漂移。现有 state/lock/sync/gate 回归保留，真实网络仅用于独立只读验证。

## 10. 文档与 skill 同步

ARCHITECTURE 在模块落地前登记新模块；同步 MAINTENANCE、TESTING、CONTRACT、README/README.zh、CHANGELOG、开发维护 skill，以及部署任务中的来源要求。历史 spec 005 保留当时要求，并链接本 spec 说明变更。

## 11. 开放问题

设计无阻塞项。源码构建证明未来可独立增强；本次不把 registry 签名宣传为构建证明。签名 key 过期或不可取得时保持 unknown，不降级为仅摘要验证。

## 12. 实施与验证记录（2026-11-05）

代码与文档已实现，完整引擎质量门通过，spec 收口为 implemented。首次回归有 10 项失败；后续内容协商、安装锁遗漏包和有效多签名重排另有 3 项回归先红后绿。`npm run verify -- --unit-only` 五阶段和最终 `npm run verify` 八阶段均通过：19 suites / 370 tests（新增产物回归 31 项）、typecheck、clean build、pack-manifest（23 个源文件对应 69 个产物）、contract-combos（13 组非法组合拒绝、8 组合法组合接受）。Node 本地实测 24.14.0；Node22/24 CI 结果需由 PR 单独确认。

真实 npm 查询已验证全部 16 个默认渠道包的 tarball SHA-512 和注册表签名；再次按固定精确 manifest 复验成功，所有缺 gitHead 的包 commit=null。没有安装或执行这些新目标包；这不是这些独立 latest 已兼容的证明。

基线 asc 6.3.0 首次下载遇到网络失败，后续下载执行曾被宿主自动审批拒绝（Code from External）；暂停后，用户明确授权“允许完整验证”，中断后再明确要求“继续”。最终用 curl 下载相同固定资产并核对官方 SHA-256：`asc_6.3.0_macOS_arm64`，`c460fff17553d5a0b982bb67d366188554ccce3da4fd28e38ecd24ceb05915f8`。完整验证退出 0：28 条真实命令契约通过，分类审计覆盖 1,932 条路径、11 组 flag vectors，无文件写路径被判为 read；离线 smoke 通过真实 Harness subprocess provider 完成 6 次调用，隔离 HOME 且未使用真实凭据。

主副本未修改，未合并或发布。routine 配置已同步 spec 007/v3/安装前复验，仍为每天 10:17、AUTO_TO_PR；若 main 尚无新代码则明确报告 BOOTSTRAP_REQUIRED，不能宣称部署完成。
