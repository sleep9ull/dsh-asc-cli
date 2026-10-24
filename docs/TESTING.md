# 测试规范（TESTING）

> 测试的**规则**（写什么、不写什么）在 [`../AGENTS.md`](../AGENTS.md)「测试」一节；本文给模式与工具。
> 基线 `0.1.5`｜质量门见 [`CONTRIBUTING.md`](./CONTRIBUTING.md) §3。

---

## 1. 原则

1. **先红后绿**：行为变更先写会失败的回归测试（或先复现），再改实现。
2. **一个回归一个测试**：每个 bugfix 在 PR 里点名它捕获的回归。
3. **不触网、不写 ASC**：所有外部交互走注入的 seam（`spawnFn`、`fetch`、`now`），测试只断言插件行为。
4. **高信号优先**：宁可少而准，不要为每个 action/flag 复制一份矩阵。
5. **失败信息可行动**：断言里写清楚期望与实际的差异，不写 `toBeTruthy()` 糊弄。

---

## 2. 测试布局

| 文件 | 覆盖 |
|---|---|
| `test/classify.test.ts` | 任意 argv 的分类（read/write/local-write/forbidden/unknown）、只读根扩充 |
| `test/approval.test.ts` | policy 矩阵、confirm/审批/豁免、unknown 两条路、结构化拒绝 |
| `test/registry.test.ts` | 每个 action 的 argv 构造、参数校验、confirm 位置、`--platform`、`--exclude-expired` |
| `test/exec.test.ts` | env 构造、`@` 字面化、`ASC_READ_ONLY` tombstone、redact、超时/取消、截断/spill |
| `test/runtime.test.ts` | `--output` 决策、重试边界、projector 挂接、审计调用 |
| `test/format.test.ts` | summary / errorClass / hint / projector / `maxDataBytes` |
| `test/jobs.test.ts` | 5 个 job 的步骤顺序、写闸门二次复核、read-only 守卫、dryRun |
| `test/engine.test.ts` | 定位顺序、版本区间、provision 校验（含篡改校验和）、更新检查缓存 |
| `test/commands.test.ts` | `/asc`、`/asc-doctor` 的渲染与只读性 |
| `test/skills.test.ts` | frontmatter、rank 600、provider list/get、非法目录 |
| `test/audit.test.ts` | 脱敏、`0o600`、失败不影响调用 |
| `test/helpers.ts` / `test/compat-helpers.ts` | `makeConfig`、spawn 替身等共用夹具 |

---

## 3. 常用模式

### 3.1 spawn 替身

`exec` 接受注入的 spawn seam；测试不启动真实进程：

```ts
const calls: SubprocessSpawnSpec[] = []
const spawn = (spec: SubprocessSpawnSpec) => {
  calls.push(spec)
  return fakeHandle({ stdout: '{"ok":true}', exitCode: 0 })
}
```

断言 `calls[0].argv`（数组，不是字符串）、`calls[0].env`（不含父进程凭据、`ASC_READ_ONLY` 正确）。

### 3.2 配置夹具

统一用 `makeConfig({ ... })`（`test/helpers.ts`）覆盖默认值；不要在测试里手抄默认值——默认值变化时测试应当自然跟上。

### 3.3 注入时间与网络

- 超时/重试：注入时钟或直接构造 `AscExecOutcome`，不用 `setTimeout` 等待。
- 引擎：`provision({ fetch })` / `latestVersion({ fetch, now })`，用假的 `Response`；篡改校验和的用例必须保留。

### 3.4 表驱动

重复的 argv/flag 组合放表格里，加一行而不是复制一个 `it`。每个 action 的**独有**行为（路径、flag、confirm 位置）才单独断言。

### 3.5 契约测试

`scripts/contract.mjs` 把 23 条注册命令逐条交给真实 `asc --help`，用于发现上游漂移；它不校验值/组合（见 [`ROADMAP.md`](./ROADMAP.md) v0.2）。

---

## 4. 不写什么

| 反模式 | 原因 |
|---|---|
| 复述实现：断言代码里的常量/默认值、或测试自己刚设的字段 | 默认值变了测试也变，没有回归信号 |
| 测标准库/依赖（JSON 往返、`Response` 构造） | 不是本仓库的行为 |
| 只断言 `not null` / `no throw` / 包含某个单词 | 抓不到行为破坏 |
| 为每个 action 复制同样的 happy-path 测试 | 维护成本高、信号弱；加表行 |
| 锁定偶然文本：空白、帮助文案全文、无序输出顺序 | 无意义地脆 |
| 用 `sleep` 等真实超时 | 慢且 flaky |
| 覆盖已有测试已覆盖的同一路径 | 冗余 |

---

## 5. 质量门

```bash
npm run typecheck
npm test                     # 11 个 suite，0.1.4 基线 144 tests 起只增不减
npm run build
node scripts/contract.mjs ./vendor/asc
```

CI：node 22/24 的 typecheck + test + build；独立 contract job；每日 `upstream-watch` 发现漂移自动开 issue。

---

## 6. 已知缺口（v0.2 关闭）

- 没有从 `src/tools/*` 进入 `defineTool → registry → exec` 的端到端测试；
- contract 只校验命令名/flag 名，不校验值/组合/dryRun；
- `scripts/smoke.mjs` 无断言、未使用真实 scrubbed env；
- 没有覆盖率门槛；CI 无 lint。
