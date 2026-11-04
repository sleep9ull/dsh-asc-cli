# 双上游定期维护：使用与部署

实现依据：[spec 005](specs/005-scheduled-upstream-maintenance.md)。仓库提供确定性辅助脚本与维护 skill；**安装代码不代表已部署 Desktop routine、GitHub 规则或持久写授权**。本说明不授权执行示例中的 GitHub 写操作。

## 1. 已提供的入口

```bash
node scripts/maintenance/cli.mjs --help
node scripts/maintenance/cli.mjs discover --repository sleep9ull/dsh-asc-cli
node scripts/maintenance/cli.mjs harness-watch
```

需要 Node 22/24，不新增运行时依赖。脚本直接读取 `src/compat.ts` 的上游仓库事实，不要求预先 build。`discover` 查询 npm `@deepseek-ai/dsh` 的 latest manifest、当前 package.json 中所有相关 peer/dev 包各自的 latest 精确版本及来源，再查询 asc 正式 latest release 的 tag、源码 commit、平台资产与 SHA-256。latest 为 rc 时保留；不会追踪 alpha/next。每个包的版本独立解析，并保存 Harness 声明的依赖范围；发现结果不是这些独立版本已经兼容的证明。

所有命令输出 JSON（help 除外）。退出码 0 为成功，2 表示 unknown/drift/blocked/pending，1 表示输入或执行错误。HTTP 超时/元数据缺失为 unknown，不能解释成无更新。`harness-watch` 只比较默认渠道与 package.json/lockfile 基线：它不安装包、不改代码，也不验证新组合的真实集成。GitHub upstream-watch 保存报告 artifact，漂移/无法查询时开独立去重 issue；自动适配只属于另行部署的 Desktop routine。

| 命令 | 输入和行为 |
|---|---|
| `discover` | 必填 `--repository OWNER/REPO`，可选 `--package-file`；输出固定目标与查询时间 |
| `harness-watch` | 可选 `--package-file` / `--lock-file`；只读基线差异 |
| `download` | `--input target.json --directory /existing/download-parent`；创建独立空子目录，校验后才写可执行资产，不执行它 |
| `marker` | `--input target.json`；输出稳定 key 与 PR 机器标记 |
| `hold-lock` | `--checkout /repo [--run-id ID] [--reclaim-dead]`；保持进程直到 SIGINT/SIGTERM，输出 owner/token |
| `state` | `--checkout /repo`；读取 shared state，损坏文件保留原样 |
| `recover` | `--checkout /repo --input github-snapshot.json`；从 PR/Git 事实决定恢复分支 |
| `record` | `--checkout /repo --input state.json --lock-token TOKEN`；验证活跃锁和状态 schema，原子替换 |
| `gate` | `--input final-head-evidence.json`；确定性门禁，**不调用 GitHub，不授权合并** |
| `sync` | `--input sync-authorization.json [--lock-token TOKEN]`；只对明确指定主副本快进 |

`discover` 的完整输出或其中的 `target` 对象均可作为 download/marker 输入。版本组合固定后，不用再次发现的 latest 替换目标；新 latest 留到下一轮。

## 2. 互斥与恢复

所有 worktree 共用 `<git common dir>/asc-maintenance/`：`lock.json` 记录运行标识、PID、主机、时间与所有权 token；`state.json` 保存恢复线索。目录 0700、文件 0600。`ownership.guard` 用原子 mkdir 串行化锁交接；状态以临时文件加 rename 写入，不保存认证 token 或子进程环境。所有权 token 只是本机锁身份，不是 GitHub/Apple 凭据。

在 Terminal 中启动 `hold-lock`，整个维护写阶段保持该进程运行，将其 token 传给 record/sync，结束后 Ctrl-C 并确认 released。只有 token 对应本机仍存活的持有者才允许 record。独立 sync 没有 token 时自行持锁。活跃持有者不因 TTL 过期而被抢占；不同主机、EPERM、损坏锁、遗留 guard 都保守阻塞。`--reclaim-dead` 只有本机 PID 被确认为不存在才重领锁；PID 复用会保守阻塞。异常遗留 guard 需要人工确认所有相关进程退出后处理，脚本不自动删除它。

每轮先恢复，后发现。使用只读 GitHub API/`gh` 完整分页获取历史 PR；不要只取前 30 或 100 条。输入形状：

```json
{
  "complete": true,
  "repository": "sleep9ull/dsh-asc-cli",
  "prs": [
    {
      "number": 123,
      "state": "OPEN",
      "headRefName": "maintenance/harness-rc5-asc-640",
      "body": "正文中包含 marker 命令生成的完整 asc-maintenance:v1 标记",
      "mergeCommit": null
    }
  ],
  "syncedKeys": []
}
```

`prs` 也要包括 CLOSED/MERGED。GitHub 是事实源，local merged 不能覆盖实际 OPEN；MERGED 必须提供 `mergeCommit: { "oid": "40位SHA" }`。只有 Git 重新证明对应 merge commit 已进入主副本、主副本干净且等于本轮 fetch 的 origin/main，才可把 key 放进 syncedKeys。不要从 local status 标签推导它。开放或关闭未合并 PR 即使被误填进 syncedKeys 仍需处理。

存在唯一未收口 PR 时恢复其原目标/分支；同组合多个 PR、多个未完成目标、关闭未合并或找不到对应 PR/分支均 blocked，不猜测、不重开。状态损坏时保留文件供诊断，但可从唯一 PR 标记重建。PR 合并后尚未记录会恢复为 sync-pending；同步后尚未记录可重跑 sync 幂等成功。无 PR 的 discovered/adapting 只能恢复仍存在的已知分支。孤立 maintenance 分支需要人工关联，不能因本地文件缺失而另开重复 PR。

记录文件由 `target`（保留完整原始来源）与最小状态组成，例如：

```js
// target 来自 discover，key/marker 来自 marker；不在此手工编造来源。
const state = {
  status: 'adapting', key, target,
  branch: 'maintenance/harness-rc5-asc-640',
  repairAttempts: 0, updatedAt: Date.now(), published: false,
}
```

允许状态为 discovered/adapting/pr-open/awaiting-checks/ready/merge-requested/merged/sync-pending/synced/blocked；可记录 pr、head、mergeCommit、syncedHead、reason。未知字段拒绝；同 key 的 provenance 不允许替换；前一个目标没有 synced 前不允许换 key。这个 schema 负责状态完整性，实际完成依据仍须来自 GitHub/Git。

## 3. 最终 head 证据

门禁输入是**调用者刚从 GitHub/Git/验证结果整理的事实**，不能把文件写成 true 当作获得批准。保留原始 CI run 链接、实际规则与评审查询来源在 PR/任务记录中，脚本不查询或修改 GitHub。

```js
const evidence = {
  target, // 与 PR 标记完全相同的版本、commit、integrity、SHA-256
  head: '<当前PR的40位SHA>',
  evidence: {
    target, head: '<同一个SHA>',
    fullVerify: true,       // 完整目标版本 npm run verify
    baselineVerify: true,  // 保留支持的旧基线实际验证完成；无旧基线时记录不适用理由
  },
  policy: {
    enforced: true,         // 实际生效的 PR/required checks/force-push/base 保护已核验
    requiredChecks: [
      { name: '<实际Node22检查全名>', appId: 15368 },
      { name: '<实际Node24检查全名>', appId: 15368 },
      { name: '<实际contract检查全名>', appId: 15368 },
    ],
    reviewsSatisfied: true,
    squashAllowed: true,
    mergeQueue: false,
  },
  checks: [
    { name: '<实际Node22检查全名>', appId: 15368, head: '<同一个SHA>', status: 'COMPLETED', conclusion: 'SUCCESS' },
    // 其余 required checks 全部列出；App id 从实际 check-run 来源读取，示例值不是配置常量。
  ],
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  unresolvedReviews: 0,
  withinScope: true,
  repairAttempts: 0,
}
```

精确匹配检查 name + App id + head；缺失、重复、skipped、旧 head 或 unknown 均不能通过。来源矛盾、完整验证未通过、第三轮修复失败、未处理实质评审、不满足 review 要求、规则未生效或无法保证 squash 的 merge queue 均拒绝。检查 gate 通过后仍须在启用 auto-merge 紧邻时确认 head 未变；每次新 push 前撤销旧 auto-merge，后续重新验证。GitHub 规则负责请求发出后到实际合并之间的约束，不以本地 gate 代替远端规则。

PR 创建后使用 Desktop PR 关联/监控，按授权启用 Auto-fix。由应用 CI、冲突、评审事件继续处理；不额外开启 loop/cron，不轮询 CI。若规则无法启用或权限无法核验，停在 PR-ready，不降级无保护合并。三轮失败后 blocked，撤销已授权 PR 的 auto-merge。

## 4. 指定主副本同步

示例仅说明输入，路径必须由部署授权指定，**脚本没有用户主副本默认路径**：

```json
{
  "checkout": "/authorized/canonical/main-checkout",
  "authorizedCheckout": "/authorized/canonical/main-checkout",
  "expectedOrigin": "git@github.com:owner/repository.git",
  "featureCheckout": "/authorized/maintenance-worktree",
  "mergeCommit": "0123456789abcdef0123456789abcdef01234567",
  "exclusiveAccess": true
}
```

expectedOrigin 是部署核验的精确字符串，不在失败后自动改成“当前看到的值”。授权路径应为 realpath，不能用后来指向另一仓库的 symlink。exclusiveAccess 只能在调用方实际确认编辑器、其他 agent/终端和用户没有并发写入后设置；文件锁无法检测外部所有写者，无法排除则传 false 并延期。

检查 current branch 必须 main、工作区/staging/untracked 干净、无 merge/rebase/cherry-pick/bisect/锁文件。fetch 使用无强制的显式 main refspec；确认 squash commit 在 origin/main，且本地 main 是其祖先或相同；临近更新重查 origin、branch、dirty/操作状态、HEAD 和 fetched ref 后执行 `git merge --ff-only --no-overwrite-ignore`（正常 hooks 保留，也拒绝覆盖被 ignore 的用户文件）。快进后再检查干净和 HEAD 等于本轮 fetched SHA。保留本地独有提交、所有用户文件和已有操作现场；绝不 stash/reset/force/切换分支。

成功报告包含 fetchedHead/head/mergeCommit，远端随后继续前进不使本轮结果失真。失败是 sync-pending 并附结构化原因；不宣称 synced。文件锁和临近复查不能消除任意外部写者的竞态，所以并发使用确认是调用方必须完成的前置条件。

## 5. 部署验收（仍需实际执行）

1. 记录用户对 spec 005 §4.1 自动维护范围的授权及版本；核验稳定项目目录、origin、main 归属、指定主副本 realpath，并确认本地时区/时段（建议每天 09:17）。一般开发批准不隐含部署批准。
2. 用 Desktop 工具/UI 创建唯一 routine，绑定稳定目录，显式启用独立 worktree，首次保存后暂停。若创建 API 无暂停字段，创建后立即禁用，并在启用前核实未误跑。不要改 permission mode 或添加宽泛 allowlist。
3. 检查实际 CI check 名，配置 main 必须 PR、Node 22/24 和 contract 必需检查、禁止 force-push、满足 base 最新性；确认规则真的生效，再配置允许 auto-merge 与 squash。这些是单独授权的 GitHub 写操作，脚本不会自动做。
4. 暂停状态下执行手动演练（具体 Desktop 版本若不允许 disabled Run now，需要在获准的临时时段启用、手动运行、再暂停）；验证 fresh session、独立 worktree、实际工具权限、日志、锁恢复。拒绝审批要单独报告，不能把未执行写成成功。
5. 在已授权的实际维护 PR 上核验：PR 监控事件、required checks、squash auto-merge、merge commit、本地快进与分别记录的完成状态。通过后才启用每日自动运行。未跑的阶段保持未验证，不声称已部署。

任务 prompt 应自包含，推荐从以下模板填入**实际核验**的值：

> 每日本地 09:17 在 `<稳定项目目录>` 的独立 worktree 运行 upstream-maintenance。先读 `<仓库中的 .claude/skills/upstream-maintenance/SKILL.md>`、AGENTS、spec 005 和 docs/MAINTENANCE。仓库 `<owner/repo>`，授权版本 `<已批准记录>`；固定主副本 `<realpath>`、origin `<精确remote URL>`。仅在 spec 005 §4.1 范围内自动适配/测试/提交/PR/Auto-fix/通过门禁后的 squash auto-merge/安全快进。先持锁并从 PR/Git 恢复固定目标，未完成前不换版本；缺来源/重复/关闭未合并/越界/三轮修复失败均 blocked。保持 I1–I10，不发布、不全局升级、不真实 Apple 写、不清理用户资源。完整 verify 和旧基线验证、Node22/24 与 contract required checks、最终 head/评审/实际规则全部核验；CI 用 Desktop 事件，不轮询。未知并发使用则 sync-pending。分别报告适配/验证/PR/合并/本地同步/发布，未做明确标记。任何部署字段或权限缺失只报告，不自授权限。

Desktop 必须打开且机器唤醒；关闭期间不保证准时执行，漏跑按产品实际补跑行为核验。不承诺云执行或合并后立即唤醒；下次定时运行恢复 sync-pending。暂停 routine 不会取消 GitHub 已有的 auto-merge：暂停时另行核实并显式取消对应维护 PR 的自动合并请求。同步完成前不自动归档。

## 6. 本地测试

```bash
npm test -- test/maintenance.test.ts
```

夹具仅使用临时 bare remote/main/worktree、模拟网络/时钟/进程探针，不接触真实 GitHub 或 Apple。覆盖默认 rc/独立包来源、未知元数据、校验和污染、跨进程锁、保守死锁恢复、PR 去重和崩溃恢复、最终 head 门禁、干净快进以及 dirty/独有提交/错分支/origin/操作中/并发编辑拒绝。常规 npm test 与 verify/CI 自动包含该测试，不需要另增测试 runner。真实 GitHub 规则与 Desktop 部署行为必须按上节单独验收。
