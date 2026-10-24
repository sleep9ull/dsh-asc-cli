# 文档地图（docs/）

> 基线：`0.1.5`｜常驻规则：[`../AGENTS.md`](../AGENTS.md)｜契约：[`CONTRACT.md`](./CONTRACT.md)

本目录是仓库的**规范文档**。代码、测试与 `./vendor/asc --help` 是权威事实源；文档是它们的缓存，冲突时以代码为准并修正文档。

---

## 1. 先读哪一份

| 文档 | 回答的问题 | 权威性 | 何时读 |
|---|---|---|---|
| [`CONTRACT.md`](./CONTRACT.md) | 做什么 / 不做什么 / 安全不变式 / 兼容 | **契约（SSOT）** | 任何行为或范围变更前 |
| [`COMMANDS.md`](./COMMANDS.md) | 5 工具 / 23 action / 5 job / 6 skill / 2 command / 配置 / 结果 | 参考（代码的缓存） | 改命令面、查参数、写文档 |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 分层、模块、数据流、扩展点、失败收口 | 结构说明 | 找实现位置、加 action/job |
| [`TESTING.md`](./TESTING.md) | 测试模式、夹具、不写什么、已知缺口 | 规范 | 写测试之前 |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | 环境、Git 流程、质量门、文档同步、发布 | 流程 | 提交/PR/发版前 |
| [`SPECS.md`](./SPECS.md) + [`specs/`](./specs/) | 一次变更的规格与验收 | 契约增量 | 开新功能前 |
| [`ROADMAP.md`](./ROADMAP.md) | 版本计划、退出条件、验收指标 | 可变计划 | 规划与复盘 |
| `docs/ASSESSMENT.md` | 评估依据与逐条证据（**本地未跟踪**，不随仓库发布） | 历史快照 | 需要"为什么"时 |

---

## 2. 优先级

```
用户指令 > AGENTS.md > CONTRACT.md > 其他 docs > specs（单次变更） > README/CHANGELOG
```

- 代码与测试必须服从 `CONTRACT.md`；spec 与契约冲突时先改契约。
- 文档承诺必须能被代码或测试证实；发现不一致按缺陷处理（`CONTRACT.md` §6.5）。

---

## 3. 文档生命周期

| 文档 | 谁维护 | 何时更新 |
|---|---|---|
| `CONTRACT.md` | 维护者 + agent | 契约级变更（需 spec + §8 修订记录） |
| `COMMANDS.md` | 改命令面的人 | action/job/skill/command/配置/结果变化 |
| `ARCHITECTURE.md` | 改结构的人 | 新增模块、扩展点变化 |
| `TESTING.md` / `CONTRIBUTING.md` | 维护者 | 流程或门禁变化 |
| `ROADMAP.md` | 维护者 | 每版本 |
| `specs/NNN-*.md` | 发起变更的人 | 变更全过程（draft → approved → implemented） |

---

## 4. 本地评估文档

`ASSESSMENT.md` 与 `assessment/` 是本地未跟踪的评估快照（0.1.1 初评 + 0.1.4 复核），不随仓库发布；需要历史依据时读取，不要把其中的数字当作当前事实。

---

## 5. 与代码的核对方式

```bash
npm test                                  # 策略、registry、job、引擎等断言
node scripts/contract.mjs ./vendor/asc    # 23 条命令对上游 --help
./vendor/asc <cmd> --help                 # 单个命令的权威行为
```

读一遍 [`../AGENTS.md`](../AGENTS.md) 再动手；它包含常驻的执行边界与验证要求。
