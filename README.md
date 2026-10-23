# dsh-bazi — DSH 八字模式

四柱八字排盘与命理分析的 DSH 模式插件。确认出生信息后排盘，按经典典籍逐节论断，
用历史事件校准，最后出报告；Web 端多一个「八字」页签，实时显示命盘、五行力量与论断链。

功能对照 `~/.workbuddy/skills/bazi`（Claude Code 版的八字 skill）实现，集成方式
对照 `@howmp/dsh-pentest`。与原 skill 的区别是：**排盘不再靠模型口算**——万年历、
节气、农历、神煞、大运全部由插件内的引擎计算，模型只负责解释。

盘面事实一律算出来、不靠模型背：四柱之外还给纳音、星运（十二长生）与自坐、旬与旬空、
胎元/胎息/命宫/身宫、十二流月、真太阳时校正、起运回执（按哪个节、差几天、折几年几个月）。
引擎只输出「可核对的事实 + 明确写下的口径」，不输出旺衰评分、格局名和用神——那几项
流派差异太大，硬算只会把猜测包装成结论。

## 安装

从仓库克隆后打包安装：

```bash
git clone https://github.com/Ranxian/dsh-bazi.git
cd dsh-bazi

npm install                                         # 装依赖（跑测试需要，打包不需要）
npm pack                                            # 产出 dsh-bazi-0.2.0.tgz
dsh plugin --profile web add ./dsh-bazi-0.2.0.tgz   # 会自动登记到 dsh.profile.bundles
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
| `lib/engine.js` | 排盘内核：万年历、节气、农历、四柱、大运、流年、流月、神煞、纳音、十二长生、四宫位、真太阳时。零依赖 |
| `lib/vsop87-earth.js` | 太阳位置用的 VSOP87D 地球黄经/向径截断级数（自动生成，见 `scripts/gen-astro-data.mjs`） |
| `lib/nutation.js` | IAU 1980 章动 Δψ 系数表（Meeus 表 22.A，自动生成） |
| `lib/tables.js` | 机械推算表：五行统计、十二长生、干支冲合刑害 |
| `lib/bazi.js` | Host 插件：11 个 `bazi_*` 工具、`bazi:protocol` 提示词段、`bazi` 会话投影 |
| `lib/ui-bazi.client.js` | 浏览器半边：「八字」页签（手写模块表产物，无需构建） |
| `lib/index.js` | 包根入口：空 `apply`，只为了让包根这一行能被 client-modules 扫描器认到 |
| `references/*.md` | 断语依据的典籍摘录与速查表，供 `bazi_reference` 按需取用 |

## 工具

| 工具 | 作用 |
| --- | --- |
| `bazi_start` | 录入/重置命主（改生辰会清空本会话已有命盘与论断；可选 `longitude` 走真太阳时） |
| `bazi_paipan` | 排盘：四柱（含纳音/星运/自坐/旬/旬空）、大运、流年、流月、四宫位、神煞、五行统计、干支关系、起运回执 |
| `bazi_add_reading` | 记一条论断（按节：日主强弱/十神/神煞/五行平衡/格局/大运/流年/历史校准/综合建议/综述） |
| `bazi_add_calibration` | 记一条可核对的过往年份预测 |
| `bazi_confirm_calibration` | 回填用户对某条预测的核对结果 |
| `bazi_state` | 读本会话状态：命主、命盘概要、论断清单、缺哪些节 |
| `bazi_chart` | 导出结构化命盘（含完整流年列表） |
| `bazi_liuyue` | 查某流年的十二流月（干支、交节日），并可指定日期查流日与所属流月 |
| `bazi_policy` | 输出本排盘器的全部口径（换年/换月/子时/真太阳时/起运/十二长生/四宫位/旬空/五行统计等） |
| `bazi_reference` | 取典籍原文；`section` 可取到 `###` 级小节 |
| `bazi_report` | 汇总成最终 Markdown 报告 |

排盘时间是**钟点优先**：给了 `hour`/`minute` 就用钟点定时柱，`shichen`（写地支、
「午时」或 `11:00-13:00` 都行）与钟点都给时钟点优先；都不知道时传
`timeUnknown: true`，只做年月日六字。

流派歧义一律走 `bazi_policy`：换年按立春还是元旦、晚子时归当日还是次日、起运按
三天折一年还是按实际天数、十二长生用阳顺阴逆还是统一顺行——这些口径都写在里面，
提问前先查它，不要自己猜。

## 正确性

排盘内核是从原 skill 的 `scripts/pai_pan.py` 逐行移植的，并用**逐字节对照**验证：

```bash
npm run golden      # 27 个固定用例 + 300 个随机用例，与 Python 原实现比 stdout
```

当前结果：**324/327 一致，0 不一致，2 例已知差异**（另有 1 例 Python 侧自己拒绝，跳过）。
已知差异都在起运上，原因是 Python 侧的节气时刻仍用旧简式、比历书早 5–8 分钟，
余数刚好卡在「×4 = 1.5」的舍入边界时就会差一个月；两例都按历书时刻复算核对过，
本项目与历书一致，脚本里逐条写明了原因，不计失败。

```bash
npm install            # 只在 clone 后需要先跑一次；zod 是唯一运行时依赖
npm test               # 104 个用例：内核 / Host 插件 / 浏览器页签
node scripts/xcheck.mjs 300   # 与 lunar-javascript 的差分校验
```

测试分三层，都自包含、不需要装进 DSH：

- `test/engine.test.mjs` — 内核算法（含与参考表的交叉核对、历书节气时刻）
- `test/plugin.test.mjs` — 工具注册面、工具行为、投影折叠与 wire 校验
- `test/ui.test.mjs` — 用最小桩替换模块表与 react，断言「投影 → 元素树」的映射

`scripts/xcheck.mjs` 换了个方向校验：拿参考库排出的四柱喂给本项目的机械函数，
逐字段比对纳音/旬/旬空/星运/自坐/四宫位（2400 余项），另比对 1150 项节气时刻，
并统计四柱端到端差异。当前：机械字段 0 不一致、四柱 0 差异、节气最大偏差 27 秒。

`npm install` 会读出 `package-lock.json` 精确复现同一套依赖（`npm ci` 亦可）。
`zod` 是唯一的运行时依赖；`@deepseek-ai/dsh-tools` 等声明为 peerDependency，
跑测试时 npm 会一并带上，装进 profile 后则由 DSH 安装体提供。

`scripts/link-deps.mjs` 是早期「本机已有 DSH 安装」时用的开发垫片，把宿主安装里的包
junction 进 `node_modules`。现在不需要了，留着只作无 npm 网络时的兜底。

## 节气算得准不准

交节时刻直接决定年柱、月柱和起运，差几分钟就能把同一天出生的人判成两个命。所以
这里不用「每年节气表」，也不接受 Meeus 25 章那条只有 0.01° 精度的三中心差简式
（换算成时刻偏早 5–8 分钟，2024 立春会算成 16:20:11，历书是 16:26:53）。

现在的做法是：VSOP87D 地球日心黄经（343 项截断级数，对完整级数最大偏差 0.04″）
→ 加 180° → FK5 修正 → IAU 1980 章动 Δψ（63 项）→ 光行差（−20.4898″/R），
再用二分法反解目标黄经对应的时刻，最后按 ΔT 换成 UTC 与北京时。

- 2024 立春：本项目 16:27:01，历书 16:26:53，相差 8 秒。
- `xcheck` 逐年比对 1902–2098 的 1150 个节气：最大偏差 27 秒，出现在 2050 年后。
- 剩余偏差几乎全部来自 ΔT 模型（本项目 2024 年取 73.9 秒，实际 TT−UTC ≈ 69.2 秒），
  黄经本身只差 0.04″。命理判断用不到秒级，暂不引入闰秒表。

均时差用同一套星历算（`EoT = 4 × (平黄经 − 视赤经)`），与天文年历差 3 秒以内；
早先用 Spencer 近似式，9 月初和 12 月下旬能差 1.5 分钟——刚好够把一个时辰判错。

两张天文数据表都是脚本从上游系数生成的，不手抄：

```bash
npm i --no-save astronomia && node scripts/gen-astro-data.mjs
```

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

- **真太阳时可选，且只认经度**：给了 `longitude` 才做完整校正（经度差 + 均时差），
  不给则只用 `birthPlace` 在钟点距时辰边界 ≤15 分钟时提醒一句。不做海拔、地形与
  夏令时校正——1979 年前后出生的人如果报的是夏令时钟点，需要用户自己说明。
- **只收录约 27 种神煞**，见 `references/shensha-table.md`。
- **流年列表**默认推到当前年（已故命主推到 `deceasedYear`）。
- **五行分值不是旺衰结论**：它只是把藏干按本气/中气/余气加权求和，用来显示配比；
  判强弱、取用神要靠典籍与命局组合，`bazi_policy` 里写明了这一点。
- **纳音、神煞不参与旺衰与用神**，只作参考信息输出。
- 命理属传统术数，报告末尾固定带免责声明，不作为决策依据。
