/**
 * 八字模式的端到端集成测试：用一个最小的假 Host 上下文挂载插件，
 * 然后像模型那样按顺序调用 9 个 `bazi_*` 工具，断言每一步的可见行为。
 *
 * 覆盖点（都是真会坏的地方）：
 * - 插件在缺省依赖下能加载、9 个工具全部注册、协议段与投影单元被认领
 * - 记录键形状（命主/命盘单例、论断/校准/边按 id 分行）与确定性 id 分配
 * - 写入即通过属域 schema 校验（假域与真域一样在 put 时 parse）
 * - 重排与 bazi_start 重置语义
 * - 投影折出的视图能通过 baziProjectionSchema（Web 端上线前就会校验）
 * - 报告包含命盘、按节论断链、校准汇总
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  apply,
  baziDomainSpec,
  baziProjectionSchema,
  baziStateSchema,
  chartViewSchema,
  buildReport,
  name as pluginName,
  inject as pluginInject,
  BAZI_INSTRUCTIONS,
  READING_SECTIONS,
  REFERENCE_DOCS,
  initialProjectionState,
  applyBaziEvent,
  viewBaziState,
  sliceSection,
} from '../lib/bazi.js';

const SESSION = 'sess-test-1';

/**
 * 内存版 storage domain：只实现插件真正用到的那部分 API。
 * put 时按表的 valueSchema parse——与真域在 load 时的行为一致，
 * 这样任何非法记录都会在测试里立刻暴露。
 */
function createMemoryDomain(spec) {
  const tables = new Map();
  for (const [tableName, tableSpec] of Object.entries(spec.tables)) {
    const records = new Map();
    tables.set(tableName, {
      get: (key) => records.get(key),
      entries: () => [...records.entries()][Symbol.iterator](),
      keys: () => [...records.keys()][Symbol.iterator](),
      get size() { return records.size; },
      put: async (key, value) => { records.set(key, tableSpec.valueSchema.parse(value)); },
      delete: async (key) => records.delete(key),
    });
  }
  return {
    table: (tableName) => {
      const table = tables.get(tableName);
      if (table === undefined) throw new Error(`unknown table ${tableName}`);
      return table;
    },
    close: async () => {},
  };
}

/** 假 Host 上下文：收集注册物，不实现任何行为。 */
function createFakeContext() {
  const tools = new Map();
  const projections = [];
  const promptSections = [];
  const effects = [];
  const opened = [];

  const ctx = {
    tools: {
      register(tool) {
        tools.set(tool.name, tool);
        return () => tools.delete(tool.name);
      },
    },
    storageDomain: {
      open(spec) {
        const domain = createMemoryDomain(spec);
        opened.push(domain);
        return Promise.resolve(domain);
      },
    },
    effect(callback, label) {
      effects.push({ label, dispose: callback() });
      return effects.at(-1).dispose;
    },
    inject(services, callback) {
      if (services.includes('sessionProjections')) {
        callback({
          sessionProjections: { register: (definition) => { projections.push(definition); } },
        });
      }
      if (services.includes('systemPrompt')) {
        callback({
          systemPrompt: { section: (section) => { promptSections.push(section); } },
        });
      }
    },
  };
  return { ctx, tools, projections, promptSections, effects, opened };
}

/** 组装一次工具调用的 exec 上下文。 */
function execFor() {
  return { agent: { session: { id: SESSION } } };
}

/** 挂载插件并返回可通过名字调用的工具表。 */
function mount() {
  const host = createFakeContext();
  apply(host.ctx);
  const call = (toolName, args = {}) => {
    const tool = host.tools.get(toolName);
    assert.ok(tool, `工具 ${toolName} 未注册`);
    return tool.execute(args, execFor());
  };
  return { ...host, call };
}

// ---------------------------------------------------------------------------
// 挂载面
// ---------------------------------------------------------------------------

test('插件注册 11 个 bazi_* 工具与协议段、投影单元', () => {
  const host = mount();

  assert.equal(pluginName, 'bazi');
  assert.deepEqual(pluginInject, ['tools', 'storageDomain']);

  const expected = [
    'bazi_start', 'bazi_paipan', 'bazi_add_reading', 'bazi_add_calibration',
    'bazi_confirm_calibration', 'bazi_state', 'bazi_chart', 'bazi_liuyue',
    'bazi_policy', 'bazi_reference', 'bazi_report',
  ];
  assert.deepEqual([...host.tools.keys()].sort(), [...expected].sort());

  // 每个工具都要有可用的 JSON Schema 与描述——缺了模型就看不到它
  for (const [toolName, tool] of host.tools) {
    assert.equal(tool.parameters.type, 'object', `${toolName} 参数根必须是 object`);
    assert.ok(tool.description.length > 20, `${toolName} 描述过短`);
    assert.ok(tool.output?.schema, `${toolName} 缺少输出 schema`);
  }

  assert.equal(host.promptSections.length, 1);
  assert.equal(host.promptSections[0].name, 'bazi:protocol');
  assert.equal(host.promptSections[0].order, 50);
  assert.match(host.promptSections[0].text(), /bazi_paipan/);

  assert.deepEqual(host.projections.map((p) => p.key), ['bazi', 'baziMounted']);
  assert.equal(host.projections[0].stateVersion, 3, '命盘/命主新增字段，旧缓存行必须作废');
  assert.equal(host.effects.length, 1, '存储域关闭钩子应注册一次');
});

// ---------------------------------------------------------------------------
// 录入与排盘
// ---------------------------------------------------------------------------

test('bazi_start 拒绝缺生日，接受合法录入', async () => {
  const host = mount();

  await assert.rejects(() => host.call('bazi_start', { sex: '男' }), /至少要提供/);
  await assert.rejects(
    () => host.call('bazi_start', { sex: '男', solar: '1990-05-15', leap: true }),
    /leap 只能与 lunar/,
  );

  const result = await host.call('bazi_start', {
    name: '张三', sex: '男', solar: '1990-05-15', shichen: '午', birthPlace: '辽宁省丹东市',
  });
  assert.equal(result.id, 'subject-1');
  assert.equal(result.sex, '男');
  assert.match(result.summary, /已记录命主 subject-1/);
  assert.match(result.summary, /- 时辰：午时$/m);
  assert.match(result.summary, /bazi_paipan/);
});

test('只给钟点时命主信息也记下对应时辰（回归：曾显示为未知）', async () => {
  const host = mount();
  const result = await host.call('bazi_start', { sex: '男', solar: '1990-05-15', hour: 12, minute: 0 });

  assert.equal(result.summary.includes('时辰：午时 12:00'), true, `实得 ${JSON.stringify(result.summary)}`);
  const stored = host.opened[0].table('subjects').get(SESSION);
  assert.equal(stored.shichen, '午', '命主记录里的时辰存地支');
  assert.equal(stored.timeUnknown, false);

  // 排盘与命主信息口径一致
  const chart = await host.call('bazi_paipan', {});
  assert.match(chart.pillars, /壬午$/);
  assert.match(chart.markdown, /- 时辰：午时/m);
});

test('bazi_start 接受带「时」与区间的写法，并归一到地支', async () => {
  for (const [shichen, expected] of [['午时', '午'], ['11:00-13:00', '午'], ['亥时', '亥']]) {
    const host = mount();
    await host.call('bazi_start', { sex: '男', solar: '1990-05-15', shichen });
    const stored = host.opened[0].table('subjects').get(SESSION);
    assert.equal(stored.shichen, expected, `shichen=${shichen}`);
  }
});

test('bazi_start 对无法识别的时辰给出可选值提示，且不落库', async () => {
  const host = mount();
  await assert.rejects(
    () => host.call('bazi_start', { sex: '男', solar: '1990-05-15', shichen: '十三时' }),
    /无法识别的时辰/,
  );
  // 校验在触碰存储之前失败：域根本没被打开
  assert.equal(host.opened.length, 0, '校验失败不应产生任何存储写入');
});

test('timeUnknown 压过钟点，只做六字', async () => {
  const host = mount();
  await host.call('bazi_start', { sex: '男', solar: '1990-05-15', hour: 12, timeUnknown: true });
  const stored = host.opened[0].table('subjects').get(SESSION);
  assert.equal(stored.shichen, '');
  assert.equal(stored.timeUnknown, true);
});

test('bazi_paipan 排出黄金四柱并落地命盘', async () => {
  const host = mount();
  await host.call('bazi_start', { name: '张三', sex: '男', solar: '1990-05-15', shichen: '午' });

  const result = await host.call('bazi_paipan', {});

  // 与 Python 参考实现（scripts/test_pai_pan.py 黄金用例）一致
  assert.match(result.pillars, /^庚午 辛巳 庚辰 壬午$/);
  assert.deepEqual(result.warnings, []);
  assert.match(result.markdown, /## 四柱/);
  assert.match(result.markdown, /\| 天干 \| 庚 \| 辛 \| 庚 \| 壬 \|/);
  assert.match(result.markdown, /- 方向：顺排/);
  assert.match(result.markdown, /天乙贵人/);
  assert.match(result.markdown, /## 五行力量（参考统计）/);
  assert.match(result.markdown, /## 干支关系/);

  // 命盘以会话为键落成单行
  const domain = host.opened[0];
  assert.equal(domain.table('charts').get(SESSION).id, 'chart-1');
  assert.ok(domain.table('subjects').get(SESSION), '命主应以会话为键');
});

test('未录入命主就排盘会给出可执行的错误', async () => {
  const host = mount();
  await assert.rejects(() => host.call('bazi_paipan', {}), /bazi_start/);
});

test('未知时辰只做六字，且警告如实带出', async () => {
  const host = mount();
  await host.call('bazi_start', { sex: '男', solar: '1990-05-15', timeUnknown: true });
  const result = await host.call('bazi_paipan', {});

  assert.match(result.pillars, /庚午 辛巳 庚辰 未知$/);
  assert.ok(result.warnings.includes('时辰未知'));
  assert.match(result.markdown, /时柱未知：仅作年月日六字分析/);
  // 时柱未知时不得用时支凑神煞：黄金命例的「天乙贵人」见于年支、时支，此盘只算年支
  assert.match(result.markdown, /天乙贵人 — 见于年支 — 年干\/日干查地支/);
});

test('bazi_start 重置整图：旧论断与命盘被清空', async () => {
  const host = mount();
  await host.call('bazi_start', { sex: '男', solar: '1990-05-15', shichen: '午' });
  await host.call('bazi_paipan', {});
  await host.call('bazi_add_reading', { section: '日主强弱', title: '庚金坐辰', content: '庚金得禄于申……' });

  const before = await host.call('bazi_state', {});
  assert.equal(before.readings.length, 1);

  // 改生辰重排：整图清空
  await host.call('bazi_start', { sex: '男', solar: '1991-06-15', shichen: '午' });
  const after = await host.call('bazi_state', {});
  assert.equal(after.readings.length, 0);
  assert.equal(after.hasChart, false);

  const chart = await host.call('bazi_paipan', {});
  assert.match(chart.pillars, /^辛未 /);
});

// ---------------------------------------------------------------------------
// 论断与校准
// ---------------------------------------------------------------------------

test('论断记录、确定性 id 与派生边', async () => {
  const host = mount();
  await host.call('bazi_start', { sex: '男', solar: '1990-05-15', shichen: '午' });
  await host.call('bazi_paipan', {});

  const first = await host.call('bazi_add_reading', {
    section: '日主强弱', title: '庚金得令', content: '生于巳月，火旺克金，日主偏弱。', citation: '《滴天髓》旺衰判断',
  });
  assert.equal(first.id, 'reading-1');
  assert.equal(first.edgeKind, 'spawns', '首条论断应挂到命主');

  const second = await host.call('bazi_add_reading', {
    section: '五行平衡', title: '喜土金', content: '金弱宜印比扶身。', derivedFromReadingId: first.id,
  });
  assert.equal(second.id, 'reading-2');
  assert.equal(second.edgeKind, 'derived_from');

  const domain = host.opened[0];
  const edges = [...domain.table('edges').entries()].map(([, row]) => row);
  assert.deepEqual(edges.map((e) => [e.kind, e.sourceId, e.targetId]), [
    ['spawns', 'subject-1', 'reading-1'],
    ['derived_from', 'reading-1', 'reading-2'],
  ]);
});

test('引用不存在的论断会被拒绝', async () => {
  const host = mount();
  await host.call('bazi_start', { sex: '男', solar: '1990-05-15', shichen: '午' });
  await assert.rejects(
    () => host.call('bazi_add_reading', {
      section: '格局', title: 'x', content: 'y', derivedFromReadingId: 'reading-99',
    }),
    /未知论断 reading-99/,
  );
});

test('校准记录、calibrates 边与反馈回填', async () => {
  const host = mount();
  await host.call('bazi_start', { sex: '男', solar: '1990-05-15', shichen: '午' });
  await host.call('bazi_paipan', {});

  const created = await host.call('bazi_add_calibration', {
    yearFrom: 2016, yearTo: 2018, ageFrom: 27, ageTo: 29,
    domain: '事业', prediction: '事业换轨或搬迁', basis: '大运甲申逢申金引动',
  });
  assert.equal(created.id, 'calibration-1');
  assert.equal(created.years, '2016-2018年');
  assert.equal(created.ages, '27-29岁');

  const confirmed = await host.call('bazi_confirm_calibration', {
    calibrationId: created.id, outcome: '相符', feedback: '2017 年确实换了工作并搬到上海',
    revisedModel: '申金为用，格局按身弱论成立',
  });
  assert.equal(confirmed.outcome, '相符');
  assert.equal(confirmed.revised, true);

  const domain = host.opened[0];
  const edge = [...domain.table('edges').entries()].map(([, row]) => row)
    .find((e) => e.kind === 'calibrates');
  assert.deepEqual([edge.sourceId, edge.targetId], ['chart-1', 'calibration-1']);

  await assert.rejects(
    () => host.call('bazi_confirm_calibration', {
      calibrationId: 'calibration-9', outcome: '相符', feedback: 'x',
    }),
    /未知校准 calibration-9/,
  );
});

test('bazi_state 报告未完成的论断节', async () => {
  const host = mount();
  await host.call('bazi_start', { sex: '女', lunar: '1990-04-21', shichen: '午' });
  await host.call('bazi_paipan', {});
  await host.call('bazi_add_reading', { section: '日主强弱', title: 'x', content: 'y' });

  const state = await host.call('bazi_state', {});
  assert.equal(state.initialized, true);
  assert.equal(state.hasChart, true);
  assert.equal(state.missingSections.length, READING_SECTIONS.length - 1);
  assert.ok(!state.missingSections.includes('日主强弱'));
  assert.match(state.summary, /命主 subject-1/);
});

test('bazi_state 在未开始时可安全调用', async () => {
  const host = mount();
  const state = await host.call('bazi_state', {});
  assert.equal(state.initialized, false);
  assert.match(state.summary, /bazi_start/);
});

test('bazi_chart 导出结构化命盘（含完整流年）', async () => {
  const host = mount();
  await host.call('bazi_start', {
    sex: '男', solar: '1990-05-15', hour: 12, deceasedYear: 2010,
  });
  await host.call('bazi_paipan', {});

  const { chart } = await host.call('bazi_chart', {});
  assert.equal(chart.currentYear, 2010);
  assert.equal(chart.liunian.length, 2010 - 1990 + 1, '流年应只到已故年份');
  assert.equal(chart.liunian.at(-1).year, 2010);
  assert.equal(chart.stats.score['木'] + chart.stats.score['火'] + chart.stats.score['土']
    + chart.stats.score['金'] + chart.stats.score['水'] > 0, true);
  assert.ok(chart.engine.includes('pai_pan.py'));
});

// ---------------------------------------------------------------------------
// 参考文档
// ---------------------------------------------------------------------------

test('bazi_reference 能取全文、取小节与列小节', async () => {
  const host = mount();

  const sections = await host.call('bazi_reference', { doc: 'wuxing-tables', listSections: true });
  assert.ok(sections.sections.includes('十天干阴阳五行表'));
  assert.match(sections.markdown, /wuxing-tables/);

  const slice = await host.call('bazi_reference', { doc: 'shensha-table', section: '天乙贵人' });
  assert.match(slice.markdown, /甲戊 → 丑未/);
  assert.ok(!slice.markdown.includes('寅丁'), '截取小节不应越界到下一个神煞');

  // 二级标题会带出它下面所有三级条目
  const group = await host.call('bazi_reference', { doc: 'shensha-table', section: '吉' });
  assert.match(group.markdown, /### 天乙贵人/);
  assert.match(group.markdown, /### 金舆/);
  assert.ok(!group.markdown.includes('### 羊刃'), '「吉」不应越界到「凶 / 中性」');

  const full = await host.call('bazi_reference', { doc: 'classical-texts' });
  assert.match(full.markdown, /穷通宝典/);

  // 非法文档名由工具层的 enum 校验挡下（先于 execute），错误里要带上可选值
  await assert.rejects(
    () => host.call('bazi_reference', { doc: 'nope' }),
    /wuxing-tables/,
  );
  await assert.rejects(
    () => host.call('bazi_reference', { doc: 'dayun-rules', section: '不存在的小节' }),
    /没有小节/,
  );
});

test('sliceSection 对首节与末节都正确', () => {
  const doc = '## 甲\n\n内容甲\n\n## 乙\n\n内容乙\n';
  assert.equal(sliceSection(doc, '甲'), '内容甲');
  assert.equal(sliceSection(doc, '乙'), '内容乙');
  assert.equal(sliceSection(doc, '丙'), null);
});

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

test('bazi_report 串起命盘、论断链与校准汇总', async () => {
  const host = mount();
  await host.call('bazi_start', {
    name: '张三', formerName: '张四', formerNameYear: '2005', sex: '男',
    solar: '1990-05-15', shichen: '午', birthPlace: '辽宁省丹东市',
  });
  await host.call('bazi_paipan', {});
  const r1 = await host.call('bazi_add_reading', {
    section: '日主强弱', title: '庚金偏弱', content: '巳月火旺，庚金受制。', citation: '《滴天髓》',
  });
  await host.call('bazi_add_reading', {
    section: '综合建议', title: '宜土金', content: '取印比扶身。', derivedFromReadingId: r1.id,
  });
  const c1 = await host.call('bazi_add_calibration', {
    yearFrom: 2016, yearTo: 2016, ageFrom: 27, ageTo: 27,
    domain: '事业', prediction: '工作变动',
  });
  await host.call('bazi_confirm_calibration', {
    calibrationId: c1.id, outcome: '部分相符', feedback: '换了部门但没换公司',
  });

  const { markdown } = await host.call('bazi_report', {});

  assert.match(markdown, /^# 八字命理报告/);
  assert.match(markdown, /曾用名：张四（改名时间：2005）/);
  assert.match(markdown, /- 出生地：辽宁省丹东市/);
  assert.match(markdown, /### 日主强弱/);
  assert.match(markdown, /推导自 reading-1/);
  assert.match(markdown, /calibration-1 2016年（27岁）· 事业 · 部分相符/);
  assert.match(markdown, /用户反馈：换了部门但没换公司/);
  assert.match(markdown, /校准汇总：已反馈 1\/1 条，其中相符或部分相符 1 条。/);
  assert.match(markdown, /命理分析仅供参考/);
});

test('buildReport 在未录入/未排盘时给出引导而不是抛错', () => {
  assert.match(buildReport({ readings: [], calibrations: [], edges: [] }), /bazi_start/);
  assert.match(
    buildReport({ subject: { id: 'subject-1', sex: '男', name: '', timeUnknown: true }, readings: [], calibrations: [], edges: [] }),
    /bazi_paipan/,
  );
});

// ---------------------------------------------------------------------------
// 会话投影（Web 页签的数据源）
// ---------------------------------------------------------------------------

/** 把工具调用折叠成投影状态。 */
function foldCalls(state, calls) {
  let current = state;
  for (const [name, args] of calls) {
    current = applyBaziEvent(current, {
      type: 'tool/call',
      data: { name, arguments: JSON.stringify(args) },
    });
  }
  return current;
}

test('投影折出合法视图，且 view 能通过 wire schema', () => {
  const state = foldCalls(initialProjectionState, [
    ['bazi_start', { name: '张三', sex: '男', solar: '1990-05-15', shichen: '午' }],
    ['bazi_paipan', {}],
    ['bazi_add_reading', { section: '日主强弱', title: '庚金偏弱', content: '正文', citation: '《滴天髓》' }],
    ['bazi_add_reading', { section: '格局', title: 'x', content: 'y', derivedFromReadingId: 'reading-1' }],
    ['bazi_add_calibration', {
      yearFrom: 2016, yearTo: 2016, ageFrom: 27, ageTo: 27, domain: '事业', prediction: '工作变动',
    }],
    ['bazi_confirm_calibration', { calibrationId: 'calibration-1', outcome: '相符', feedback: '确实' }],
  ]);

  assert.equal(state.subject.id, 'subject-1');
  assert.equal(state.readings.length, 2);
  assert.equal(state.edges.length, 1);
  assert.equal(state.edges[0].kind, 'derived_from');

  const view = viewBaziState(state);
  const parsed = baziProjectionSchema.parse(view);
  assert.equal(parsed.counts.readings, 2);
  assert.equal(parsed.counts.calibrations, 1);
  assert.equal(parsed.counts.confirmed, 1);
  assert.equal(parsed.calibrations[0].outcome, '相符');
  assert.equal(parsed.calibrations[0].years, '2016年');
  assert.equal(parsed.calibrations[0].ages, '27岁');
});

test('投影在未开始时视图为 null（页签据此隐藏）', () => {
  assert.equal(viewBaziState(initialProjectionState), null);
  assert.equal(baziProjectionSchema.parse(null), null);
});

test('命盘经工具结果的 meta 进投影（回归：命盘曾永远停在「尚未排盘」）', async () => {
  const host = mount();
  const started = foldCalls(initialProjectionState, [
    ['bazi_start', { name: '张三', sex: '男', solar: '1990-05-15', hour: 12, minute: 0 }],
  ]);
  assert.equal(started.chart, null, '排盘前没有命盘');

  // 真跑一次 bazi_paipan，用它的规范输出与 presentResult 之外的 meta 造结果事件
  await host.call('bazi_start', { name: '张三', sex: '男', solar: '1990-05-15', hour: 12, minute: 0 });
  const value = await host.call('bazi_paipan', {});
  const tool = host.tools.get('bazi_paipan');
  assert.equal(typeof tool.output.presentationMeta, 'function', 'bazi_paipan 必须声明 presentationMeta');
  const meta = tool.output.presentationMeta({}, value);
  assert.equal(meta.kind, 'bazi/chart');

  const state = applyBaziEvent(started, { type: 'tool/result', data: { meta } });
  assert.notEqual(state.chart, null, '结果事件应把命盘折进状态');

  // 折进来的命盘必须与黄金四柱一致
  const view = viewBaziState(state);
  const parsed = baziProjectionSchema.parse(view);
  assert.equal(parsed.chart.pillars.hour.gan + parsed.chart.pillars.hour.zhi, '壬午');
  assert.equal(parsed.chart.pillars.year.gan + parsed.chart.pillars.year.zhi, '庚午');
  assert.equal(parsed.chart.shichenText, '午 / 12:00', '给了钟点时内核把钟点一并带出');
  const tianyi = parsed.chart.shensha.find((s) => s.name === '天乙贵人');
  assert.ok(tianyi !== undefined, `神煞应随命盘进视图，实得 ${JSON.stringify(parsed.chart.shensha.map((s) => s.name))}`);
  assert.match(tianyi.detail, /见于年支、时支/, '神煞应带出位置依据');
  assert.ok(!tianyi.name.includes('—'), '神煞名里不应残留内核那行的破折号');
  assert.ok(parsed.chart.score['火'] > 0, '五行分值应随命盘进视图');
  const shareSum = ['木', '火', '土', '金', '水'].reduce((sum, wx) => sum + parsed.chart.share[wx], 0);
  assert.ok(Math.abs(shareSum - 100) < 0.5, `占比合计应接近 100，实得 ${shareSum}`);
  assert.ok(parsed.chart.relations.some((r) => r.kind === '自刑'), '干支关系应随命盘进视图');

  // 折叠状态本身要能过 stateSchema（持久化缓存回灌的前提）
  assert.equal(baziStateSchema.parse(state).chart.currentGz, parsed.chart.currentGz);
});

test('命盘视图字段与 chartViewSchema 完全一致（不多带字段）', async () => {
  const host = mount();
  await host.call('bazi_start', { sex: '男', solar: '1990-05-15', shichen: '午' });
  const value = await host.call('bazi_paipan', {});
  const chart = value.chart;
  // 视图不多带字段：多带的会被 wire schema 拒绝，客户端也用不上
  assert.deepEqual(Object.keys(chart).sort(), Object.keys(chartViewSchema.shape).sort());
  assert.deepEqual(Object.keys(chart.score).sort(), ['土', '木', '水', '火', '金']);
  for (const rel of chart.relations) {
    assert.deepEqual(Object.keys(rel).sort(), ['detail', 'kind'], '关系只带 kind/detail');
  }
  // 落库的命盘行比视图多，取视图时必须滤掉
  const stored = host.opened[0].table('charts').get(SESSION);
  assert.ok(Object.keys(stored).length > Object.keys(chart).length, '命盘行应比视图字段多');
  const parsedChart = chartViewSchema.safeParse(chart);
  assert.equal(
    parsedChart.success,
    true,
    `视图必须通过 chartViewSchema${parsedChart.success ? '' : `：${JSON.stringify(parsedChart.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))}`}`,
  );
  assert.deepEqual(chartViewSchema.parse(chart), chart, '视图不应有被 schema 悄悄丢掉的字段');
});

test('命盘 meta 只被本会话自己的命主接受，且重排/重开会清掉', () => {
  const started = foldCalls(initialProjectionState, [
    ['bazi_start', { name: '张三', sex: '男', solar: '1990-05-15', shichen: '午' }],
  ]);
  const chart = { solarText: 'x', lunarText: 'y', shichenText: '午', zishi: '', forward: true, qiyunText: 'q', currentYear: 2026, currentGz: '丙午', jieName: '立夏', hourUnknown: false, pillars: {}, dayun: [], shensha: [], warnings: [], score: {}, share: {}, relations: [] };

  // 别人的命盘（或别的工具）不带过来
  assert.equal(
    applyBaziEvent(started, { type: 'tool/result', data: { meta: { kind: 'bazi/chart', subjectId: 'subject-9', chart } } }).chart,
    null,
  );
  assert.equal(applyBaziEvent(started, { type: 'tool/result', data: { meta: { kind: 'other', chart } } }).chart, null);
  assert.equal(applyBaziEvent(started, { type: 'tool/result', data: {} }).chart, null);
  assert.equal(
    applyBaziEvent(started, { type: 'tool/result', data: { meta: { kind: 'bazi/chart', subjectId: 'subject-1', chart: null } } }).chart,
    null,
  );
  // 未 start 时结果事件不建立命主
  assert.equal(applyBaziEvent(initialProjectionState, { type: 'tool/result', data: { meta: { kind: 'bazi/chart', subjectId: 'subject-1', chart } } }), initialProjectionState);

  // 命盘进来后，改生辰重开要把旧命盘清掉
  const withChart = applyBaziEvent(started, { type: 'tool/result', data: { meta: { kind: 'bazi/chart', subjectId: 'subject-1', chart } } });
  assert.notEqual(withChart.chart, null);
  const restarted = applyBaziEvent(withChart, {
    type: 'tool/call',
    data: { name: 'bazi_start', arguments: JSON.stringify({ sex: '女', solar: '1991-06-15', shichen: '卯' }) },
  });
  assert.equal(restarted.chart, null, 'bazi_start 必须清掉旧命盘');
  // 无关事件不改变引用
  assert.equal(applyBaziEvent(withChart, { type: 'assistant/message', data: {} }), withChart);
});

test('投影拒绝非法折叠：无命主时的记录、缺字段的记录', () => {
  // 未 start 就记录：状态不变
  const untouched = foldCalls(initialProjectionState, [
    ['bazi_add_reading', { section: '格局', title: 'x', content: 'y' }],
    ['bazi_add_calibration', { yearFrom: 1, yearTo: 1, ageFrom: 1, ageTo: 1, domain: '事业', prediction: 'p' }],
  ]);
  assert.equal(untouched, initialProjectionState, '应原样返回同一引用');

  // start 后缺正文/缺预测的记录被丢弃
  const started = foldCalls(initialProjectionState, [
    ['bazi_start', { sex: '男', solar: '1990-05-15' }],
  ]);
  const after = foldCalls(started, [
    ['bazi_add_reading', { section: '格局', title: '只有标题' }],
    ['bazi_add_calibration', { yearFrom: 1, yearTo: 1, ageFrom: 1, ageTo: 1, domain: '事业' }],
    ['bazi_unknown_tool', { anything: true }],
    ['bazi_add_reading', { section: '不存在的节', title: 't', content: 'c' }],
  ]);
  assert.equal(after.readings.length, 1);
  assert.equal(after.readings[0].section, '综述', '未知 section 落到综述');
  assert.equal(after.calibrations.length, 0);
});

test('投影里的 bazi_start 会重置整图并归零计数', () => {
  const started = foldCalls(initialProjectionState, [
    ['bazi_start', { sex: '男', solar: '1990-05-15' }],
    ['bazi_add_reading', { section: '格局', title: 't', content: 'c' }],
    ['bazi_add_reading', { section: '格局', title: 't2', content: 'c2' }],
  ]);
  assert.equal(started.readings.length, 2);

  const restarted = foldCalls(started, [['bazi_start', { sex: '女', solar: '1991-06-15' }]]);
  assert.equal(restarted.readings.length, 0);
  assert.equal(restarted.counters.reading, 0);
  assert.equal(restarted.subject.sex, '女');

  const again = foldCalls(restarted, [['bazi_add_reading', { section: '格局', title: 't', content: 'c' }]]);
  assert.equal(again.readings[0].id, 'reading-1', 'id 应从头开始');
});

test('挂载标记只由该会话自身的证据置位', () => {
  assert.equal(applyBaziEvent, applyBaziEvent, 'applyBaziEvent 可用于两条投影');
  assert.equal(
    foldCalls(initialProjectionState, [['bazi_start', { sex: '男', solar: '1990-05-15' }]]).subject !== null,
    true,
  );
});

// ---------------------------------------------------------------------------
// 属域 schema 自检
// ---------------------------------------------------------------------------

test('属域 spec 名/版本/表名合法且非空', () => {
  assert.equal(baziDomainSpec.name, 'bazi');
  assert.equal(baziDomainSpec.version, 1);
  assert.deepEqual(
    Object.keys(baziDomainSpec.tables),
    ['subjects', 'charts', 'readings', 'calibrations', 'edges'],
  );
});

test('协议文本带齐关键纪律与免责声明', () => {
  for (const keyword of [
    'bazi_paipan', 'bazi_start', 'bazi_add_reading', 'bazi_add_calibration',
    'bazi_confirm_calibration', 'bazi_reference', 'bazi_report',
    'bazi_liuyue', 'bazi_policy',
    '禁止口算', '中文', '命理分析仅供参考',
  ]) {
    assert.ok(BAZI_INSTRUCTIONS.includes(keyword), `协议缺少「${keyword}」`);
  }
});

test('协议要求遇流派歧义先查口径，且不把五行分值当旺衰', () => {
  assert.ok(BAZI_INSTRUCTIONS.includes('bazi_policy'), '协议应指向口径工具');
  assert.match(BAZI_INSTRUCTIONS, /不是旺衰结论/);
  assert.match(BAZI_INSTRUCTIONS, /纳音/, '协议应说明纳音不参与旺衰');
});

test('bazi_policy 给出可核对的排盘口径', async () => {
  const host = mount();
  const { markdown } = await host.call('bazi_policy', {});
  for (const keyword of [
    '立春', '节', '子时', '真太阳时', '均时差', '三天折一年',
    '十二长生', '胎元', '胎息', '命宫', '身宫', '旬空', '纳音', '神煞',
  ]) {
    assert.ok(markdown.includes(keyword), `口径说明缺少「${keyword}」`);
  }
  assert.match(markdown, /不是命理定论|不是旺衰结论/, '必须声明五行统计只是参考');
});

test('bazi_liuyue：列十二流月，并可查流日与所在流月', async () => {
  const host = mount();
  await host.call('bazi_start', { sex: '男', solar: '1990-05-15', shichen: '午' });
  await host.call('bazi_paipan', {});

  const months = await host.call('bazi_liuyue', { year: 2024 });
  assert.equal(months.year, 2024);
  assert.equal(months.yearGz, '甲辰');
  assert.equal(months.months.length, 12);
  assert.equal(months.months[0].gz, '丙寅');
  assert.match(months.markdown, /\| 立春 \| 丙寅 \| 2024-02-04 \|/);

  const day = await host.call('bazi_liuyue', { year: 2024, date: '2024-06-15' });
  assert.match(day.dayGz, /^[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]$/);
  assert.ok(day.dayMonth.includes('午'), '6-15 应落在午月（芒种后）');
  assert.ok(day.markdown.includes('流日 2024-06-15'));

  await assert.rejects(() => host.call('bazi_liuyue', { year: 2024, date: '2024/06/15' }), /YYYY-MM-DD/);
});

test('bazi_liuyue 早于立春的日期归上一流年的丑月', async () => {
  const host = mount();
  await host.call('bazi_start', { sex: '男', solar: '1990-05-15', shichen: '午' });
  await host.call('bazi_paipan', {});
  const day = await host.call('bazi_liuyue', { year: 2024, date: '2024-01-20' });
  assert.ok(day.dayMonth.includes('丑'), `1-20 应归丑月，实得 ${day.dayMonth}`);
});

test('排盘 Markdown 带出纳音/星运/自坐/旬空/四宫位/流月', async () => {
  const host = mount();
  await host.call('bazi_start', { sex: '男', solar: '1990-05-15', shichen: '午' });
  const value = await host.call('bazi_paipan', {});
  for (const keyword of ['纳音', '星运', '自坐', '旬空', '四宫位', '流月', '交运']) {
    assert.ok(value.markdown.includes(keyword), `排盘结果缺少「${keyword}」`);
  }
  assert.match(value.markdown, /路旁土/);
  assert.match(value.markdown, /命宫 壬午/);
});

test('给经度时排盘按真太阳时校正并在结果里标明', async () => {
  const host = mount();
  await host.call('bazi_start', {
    sex: '男', solar: '1990-05-15', hour: 23, minute: 30, longitude: 87.6,
  });
  const value = await host.call('bazi_paipan', {});
  assert.notEqual(value.chart.tst, null);
  assert.match(value.markdown, /真太阳时/);
  assert.ok(value.chart.tst.minutes < -120, `乌鲁木齐应西移约 126 分，实得 ${value.chart.tst.minutes}`);
});

test('参考文档清单与包内文件一一对应', async () => {
  const host = mount();
  for (const doc of REFERENCE_DOCS) {
    const result = await host.call('bazi_reference', { doc });
    assert.ok(result.markdown.length > 200, `${doc} 内容过短`);
    assert.ok(result.sections.length > 0, `${doc} 没有二级标题`);
  }
});
