# dsh-bazi — DSH 八字模式

四柱八字排盘与命理分析的 DSH 模式插件。确认出生信息后排盘，按经典典籍逐节论断，
用历史事件校准，最后出报告；Web 端多一个「八字」页签，实时显示命盘、五行力量与论断链。

功能对照 `~/.workbuddy/skills/bazi`（Claude Code 版的八字 skill）实现，集成方式
对照 `@howmp/dsh-pentest`。与原 skill 的区别是：**排盘不再靠模型口算**——万年历、
节气、农历、神煞、大运全部由插件内的引擎计算，模型只负责解释。

## 安装

从仓库克隆后打包安装：

```bash
git clone https://github.com/Ranxian/dsh-bazi.git
cd dsh-bazi

npm install                                         # 装依赖（跑测试需要，打包不需要）
npm pack                                            # 产出 dsh-bazi-0.1.0.tgz
dsh plugin --profile web add ./dsh-bazi-0.1.0.tgz   # 会自动登记到 dsh.profile.bundles
```

装好后重启 DSH，在预设选择器里选「八字模式」，Web 端会多出「八字」页签。

卸载：

```bash
dsh plugin --profile web remove dsh-bazi
```

## 组成

| 文件 | 作用 |
| --- | --- |
| `cordis.patch.yml` | bundle 补丁：声明 `bazi` 预设（`@deepseek-ai/dsh-agent-preset` 行），并插入浏览器半边的行 |
| `lib/engine.js` | 排盘内核：万年历、节气、农历、四柱、大运、流年、神煞。零依赖 |
| `lib/tables.js` | 机械推算表：五行统计、十二长生、干支冲合刑害 |
| `lib/bazi.js` | Host 插件：9 个 `bazi_*` 工具、`bazi:protocol` 提示词段、`bazi` 会话投影 |
| `lib/ui-bazi.client.js` | 浏览器半边：「八字」页签（手写模块表产物，无需构建） |
| `lib/index.js` | 包根入口：空 `apply`，只为了让包根这一行能被 client-modules 扫描器认到 |
| `references/*.md` | 断语依据的典籍摘录与速查表，供 `bazi_reference` 按需取用 |

## 工具

| 工具 | 作用 |
| --- | --- |
| `bazi_start` | 录入/重置命主（改生辰会清空本会话已有命盘与论断） |
| `bazi_paipan` | 排盘：四柱、大运、流年、神煞、五行统计、干支关系 |
| `bazi_add_reading` | 记一条论断（按节：日主强弱/十神/神煞/五行平衡/格局/大运/流年/历史校准/综合建议/综述） |
| `bazi_add_calibration` | 记一条可核对的过往年份预测 |
| `bazi_confirm_calibration` | 回填用户对某条预测的核对结果 |
| `bazi_state` | 读本会话状态：命主、命盘概要、论断清单、缺哪些节 |
| `bazi_chart` | 导出结构化命盘（含完整流年列表） |
| `bazi_reference` | 取典籍原文；`section` 可取到 `###` 级小节 |
| `bazi_report` | 汇总成最终 Markdown 报告 |

排盘时间是**钟点优先**：给了 `hour`/`minute` 就用钟点定时柱，`shichen`（写地支、
「午时」或 `11:00-13:00` 都行）与钟点都给时钟点优先；都不知道时传
`timeUnknown: true`，只做年月日六字。

## 正确性

排盘内核是从原 skill 的 `scripts/pai_pan.py` 逐行移植的，并用**逐字节对照**验证：

```bash
npm run golden      # 27 个固定用例 + 300 个随机用例，与 Python 原实现比 stdout
```

当前结果：**326/327 一致，0 不一致**（1 例 Python 侧自己拒绝，跳过）。
覆盖 1901/1984/2000/2099 边界年、立春前后、早晚子时、闰月、时辰未知、已故年份等。

```bash
npm install     # 只在 clone 后需要先跑一次；zod 是唯一运行时依赖
npm test        # 81 个用例：内核 / Host 插件 / 浏览器页签
```

测试分三层，都自包含、不需要装进 DSH：

- `test/engine.test.mjs` — 内核算法（含与参考表的交叉核对）
- `test/plugin.test.mjs` — 工具注册面、工具行为、投影折叠与 wire 校验
- `test/ui.test.mjs` — 用最小桩替换模块表与 react，断言「投影 → 元素树」的映射

`npm install` 会读出 `package-lock.json` 精确复现同一套依赖（`npm ci` 亦可）。
`zod` 是唯一的运行时依赖；`@deepseek-ai/dsh-tools` 等声明为 peerDependency，
跑测试时 npm 会一并带上，装进 profile 后则由 DSH 安装体提供。

`scripts/link-deps.mjs` 是早期「本机已有 DSH 安装」时用的开发垫片，把宿主安装里的包
junction 进 `node_modules`。现在不需要了，留着只作无 npm 网络时的兜底。

## 与 dsh-pentest 的取舍

对照 pentest 的实现，这里有意做了三处简化：

1. **存储用宿主默认后端**，没有自带 sqlite 后端与路由覆盖。数据量很小（每会话一份命主、
   一张命盘、若干论断），不值得引入 `node:sqlite` 与 Node 版本要求。
2. **没有子 agent 回填工具**。命理论断由主 agent 一次做完，不需要委派。
3. **预设用 0.1.7 的声明式行**（`@deepseek-ai/dsh-agent-preset` + 内联 `plugins`），
   不用 pentest 那个 `preset-root.js` + `cordis:include` 的兼容垫片。

## 命盘怎么进 Web 页签

参数里没有命盘（`bazi_paipan` 无参数，命盘是算出来的），所以命盘走**工具结果**回投影：

1. `bazi_paipan` 的规范输出带 `chart`，`output.presentationMeta` 把它包成
   `{kind:'bazi/chart', subjectId, chart}`；
2. 该 meta 随 `tool/result` 事件进会话日志（可重放）；
3. `bazi` 投影折叠 `tool/result` 的 meta，落进 `state.chart`；
4. `view` 产出客户端视图，经 `wire.viewSchema` 校验后送到浏览器。

命盘的形状只在 `chartViewSchema` 声明一次：投影的 `viewSchema` 用它，
`chartViewSchema` 也是「不多带字段」的判据（`chartViewOf` 要滤掉命盘行里多出来的
`stats`/`liunian`/`engine` 等字段，否则 wire 校验会拒绝）。

## 已知边界

- **真太阳时只给提示**：给了出生地且钟点距时辰整点边界 ≤15 分钟时，只加一条
  「校正后可能跨时辰」警告，不做经度校正。
- **只收录约 27 种神煞**，见 `references/shensha-table.md`。
- **流年列表**默认推到当前年（已故命主推到 `deceasedYear`）。
- 命理属传统术数，报告末尾固定带免责声明，不作为决策依据。
