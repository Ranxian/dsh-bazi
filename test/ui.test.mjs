/**
 * 浏览器半边的结构测试。
 *
 * 页签本体是手写的模块表产物，没法直接 import（它调用 `window.__ModuleLoader__.load`）。
 * 这里用最小桩替换模块表与 react：捕获工厂、注入假的 `require`，然后按
 * `conversation.view` 的真实契约渲染组件树，断言「投影 → DOM 元素树」的映射。
 *
 * 覆盖的是本插件自己的渲染与注册逻辑（页签门、三子页签、空态、字典插值、
 * 挂载/注销随会话切换），不覆盖宿主如何把投影送到 `useProjection`。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CLIENT_PATH = fileURLToPath(new URL('../lib/ui-bazi.client.js', import.meta.url));
const SOURCE = readFileSync(CLIENT_PATH, 'utf8');

// ---------------------------------------------------------------------------
// 桩：模块表 + 最小 react
// ---------------------------------------------------------------------------

/** 小程序用的元素节点。`type` 可以是字符串或组件函数。 */
function createElement(type, props, ...children) {
  const flat = [];
  for (const child of children) {
    if (Array.isArray(child)) flat.push(...child.flat(Infinity));
    else if (child !== null && child !== undefined && child !== false) flat.push(child);
  }
  const merged = { ...(props ?? {}) };
  if (flat.length > 0) merged.children = flat;
  return { type, props: merged };
}

/**
 * 可驱动的 hook 运行期。`useState` 在组件求值时读取这个持有者，
 * 所以测试既能把初始子页签设成任意值，也能记录 `setTab` 的调用。
 */
const hooks = { initial: undefined, setter: null };

const reactStub = {
  createElement,
  useState: (initial) => {
    const value = hooks.initial !== undefined
      ? hooks.initial
      : (typeof initial === 'function' ? initial() : initial);
    return [value, hooks.setter ?? (() => {})];
  },
};

/** 把 `useState` 的初值设为给定子页签，并可选地记录 setter 调用。 */
function useTab(tab, calls) {
  hooks.initial = tab;
  hooks.setter = calls === undefined ? null : (next) => { calls.push(next); };
}

/** 恢复默认：不干预初值。 */
function resetHooks() {
  hooks.initial = undefined;
  hooks.setter = null;
}

/** 载入客户端产物并取回它的 exports（apply / inject）。 */
function loadClient() {
  let captured;
  globalThis.window = {
    __ModuleLoader__: {
      load(spec) {
        captured = spec;
      },
    },
  };
  // 产物是普通脚本（无 import/export），用 typeof window 无关的方式求值。
  // eslint-disable-next-line no-new-func
  new Function('window', SOURCE)(globalThis.window);
  delete globalThis.window;
  assert.equal(captured.id, 'dsh-bazi', '工厂 id 必须等于包名');
  return captured.factory((spec) => {
    assert.equal(spec, 'react', '客户端产物只应从模块表取 react');
    return reactStub;
  });
}

/** 在元素树里按 `data-testid` 找节点。 */
function findByTestId(node, testId) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined;
  if (node.props?.['data-testid'] === testId) return node;
  for (const child of node.props?.children ?? []) {
    const hit = findByTestId(child, testId);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** 摊平元素树里的全部文本。 */
function textOf(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return (node.props?.children ?? []).map(textOf).join('');
}

/** 渲染一个元素树（组件函数就地求值）。 */
function render(node) {
  if (node === null || node === undefined || node === false) return null;
  if (typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) return node.map(render);
  if (typeof node.type === 'function') return render(node.type(node.props ?? {}));
  return { type: node.type, props: { ...node.props, children: (node.props?.children ?? []).map(render) } };
}

/** 按 key 找字典里的词条（键集必须与 zh 完全一致）。 */
function keysOf(dict) {
  return Object.keys(dict).sort();
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 一份完整的 `bazi` 投影视图。 */
function sampleProjection(overrides = {}) {
  return {
    subject: {
      id: 'subject-1',
      name: '张三',
      formerName: '',
      sex: '男',
      birthPlace: '辽宁省丹东市',
      solar: '1990-05-15',
      lunar: '1990年四月廿一',
      shichen: '午时',
      timeUnknown: false,
    },
    chart: {
      solarText: '1990-05-15 12:00',
      lunarText: '1990年四月廿一',
      shichenText: '午时',
      zishi: '',
      forward: true,
      qiyunText: '8年4个月',
      currentYear: 2026,
      currentGz: '丙午',
      jieName: '立夏',
      hourUnknown: false,
      pillars: {
        year: {
          gan: '庚', zhi: '午', shishen: '比肩', canggan: '丁己',
          nayin: '路旁土', dishi: '沐浴', zizuo: '沐浴', xun: '甲子', kongwang: '戌亥',
        },
        month: {
          gan: '辛', zhi: '巳', shishen: '劫财', canggan: '丙戊庚',
          nayin: '白蜡金', dishi: '长生', zizuo: '死', xun: '甲戌', kongwang: '申酉',
        },
        day: {
          gan: '庚', zhi: '辰', shishen: '—', canggan: '戊乙癸',
          nayin: '白蜡金', dishi: '养', zizuo: '养', xun: '甲戌', kongwang: '申酉',
        },
        hour: {
          gan: '壬', zhi: '午', shishen: '食神', canggan: '丁己',
          nayin: '杨柳木', dishi: '沐浴', zizuo: '胎', xun: '甲戌', kongwang: '申酉',
        },
      },
      palaces: { taiyuan: '壬申', taixi: '乙酉', minggong: '壬午', shengong: '戊子' },
      qiyunReceipt: {
        rule: 'DAYS_TO_YEARS_V1', status: 'CALCULATED', forward: true,
        anchorJie: '芒种', days: 21.78, years: 7, months: 3, jiaoyun: '1997-08-15',
      },
      liuyue: [
        { name: '立春', gz: '庚寅', start: '2026-02-04' },
        { name: '惊蛰', gz: '辛卯', start: '2026-03-05' },
      ],
      tst: null,
      dayun: [
        { seq: '1', ages: '8-18岁', gz: '壬午' },
        { seq: '2', ages: '18-28岁', gz: '癸未' },
      ],
      shensha: [
        { name: '天乙贵人', detail: '见于年支、时支 — 年干/日干查地支' },
        { name: '将星', detail: '见于年支、时支 — 年支/日支三合' },
      ],
      warnings: [],
      score: { 木: 0.4, 火: 3.1, 土: 2.2, 金: 3.0, 水: 1.3 },
      share: { 木: 4, 火: 31, 土: 22, 金: 30, 水: 13 },
      relations: [{ kind: '自刑', detail: '年柱午 ↔ 时柱午' }],
    },
    readings: [
      { id: 'reading-1', section: '日主强弱', title: '庚金得禄', content: '日主庚金生于巳月……', citation: '《滴天髓》' },
      { id: 'reading-2', section: '格局', title: '正官格', content: '月令巳中丙火为官……', citation: '《子平真诠》' },
    ],
    calibrations: [
      {
        id: 'calibration-1', ages: '18-28岁', years: '2008-2018年', domain: '学业',
        prediction: '此运读书有成', outcome: '相符', feedback: '确于 2010 年升学',
      },
      {
        id: 'calibration-2', ages: '28-38岁', years: '2018-2028年', domain: '事业',
        prediction: '事业多变', outcome: '', feedback: '',
      },
    ],
    edges: [
      { id: 'edge-1', kind: 'derived_from', sourceId: 'reading-2', targetId: 'reading-1' },
      { id: 'edge-2', kind: 'calibrates', sourceId: 'calibration-1', targetId: 'reading-2' },
    ],
    counts: { readings: 2, calibrations: 2, confirmed: 1 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

test('产物导出 apply 与文档化的 inject 服务', () => {
  const client = loadClient();
  assert.equal(typeof client.apply, 'function');
  assert.deepEqual(client.inject, ['slots', 'locale', 'sessions']);
});

test('字典：zh 与 en 键集一致', () => {
  const client = loadClient();
  let registered;
  const ctx = {
    effect: (fn) => { fn(); },
    locale: {
      register: (ns, dicts) => { registered = { ns, dicts }; },
      bind: () => (key) => key,
    },
    slots: { inject: () => {}, register: () => () => {} },
    sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
  };
  client.apply(ctx);
  assert.equal(registered.ns, 'bazi');
  assert.deepEqual(keysOf(registered.dicts.zh), keysOf(registered.dicts.en));
  assert.equal(registered.dicts.zh['view.bazi'], '八字');
});

test('页签只在带 bazi 预设或已挂载的会话上注册', () => {
  const client = loadClient();
  const registrations = [];
  let disposed = 0;
  let sync = () => {};
  const snapshots = {
    byId: { 'sess-plain': { projectionValues: { agentPreset: 'standard' } } },
    current: 'sess-plain',
  };
  const ctx = {
    effect: (fn) => { fn(); },
    locale: { register: () => {}, bind: () => (key) => key },
    slots: {
      inject: (_slot, body) => { body(); },
      register: (options) => { registrations.push(options); return () => { disposed += 1; }; },
    },
    sessions: { list: { getSnapshot: () => snapshots, subscribe: (fn) => { sync = fn; return () => {}; } } },
  };
  client.apply(ctx);

  assert.equal(registrations.length, 0, '普通会话不应注册页签');

  // 切到 bazi 预设的会话 → 注册
  snapshots.current = 'sess-bazi';
  snapshots.byId['sess-bazi'] = { projectionValues: { agentPreset: 'bazi' } };
  sync();
  assert.equal(registrations.length, 1, 'bazi 会话应注册页签');
  const options = registrations[0];
  assert.equal(options.name, 'conversation.view');
  assert.equal(options.id, 'bazi');
  assert.equal(options.locale, 'bazi');
  assert.equal(options.order, 25, '不占用 pentest 的 20');
  assert.equal(options.label(), 'view.bazi', 'label 走绑定后的翻译');

  // 预设副本（bazi-*）同样算数；换会话即重挂（页签按会话注册）
  snapshots.current = 'sess-copy';
  snapshots.byId['sess-copy'] = { projectionValues: { agentPreset: 'bazi-copy' } };
  sync();
  assert.equal(disposed, 1, '换会话时旧页签注销');
  assert.equal(registrations.length, 2, '新会话重新注册');

  // 回到普通会话 → 注销且不再注册
  snapshots.current = 'sess-plain';
  sync();
  assert.equal(disposed, 2, '离开 bazi 会话应注销页签');
  assert.equal(registrations.length, 2, '普通会话不再注册');

  // 子会话从祖先继承能力
  snapshots.byId['sess-child'] = { parentId: 'sess-bazi', projectionValues: { agentPreset: 'standard' } };
  snapshots.current = 'sess-child';
  sync();
  assert.equal(registrations.length, 3, '子会话继承祖先的 bazi 能力');
  assert.equal(disposed, 2, '在普通会话上时没有挂载，切走时无多余注销');

  // 状态未变时不重复注册
  const settled = registrations.length;
  sync();
  assert.equal(registrations.length, settled, '同一会话重复 sync 不应重挂');
  assert.equal(disposed, 2, '重复 sync 不应多余注销');
});

test('本会话日志证明已挂载时也注册（任意预设名）', () => {
  const client = loadClient();
  let registerArgs;
  const snapshots = {
    byId: { s1: { projectionValues: { agentPreset: 'standard', baziMounted: true } } },
    current: 's1',
  };
  const ctx = {
    effect: (fn) => { fn(); },
    locale: { register: () => {}, bind: () => (key) => key },
    slots: { inject: (_slot, body) => { body(); }, register: (options) => { registerArgs = options; return () => {}; } },
    sessions: { list: { getSnapshot: () => snapshots, subscribe: () => () => {} } },
  };
  client.apply(ctx);
  assert.ok(registerArgs !== undefined, 'baziMounted 为真即注册，不要求预设名');
  assert.equal(registerArgs.id, 'bazi');
});

test('严格读取挂载标记：非布尔真值不算证据', () => {
  const client = loadClient();
  let registerArgs;
  const snapshots = {
    byId: { s1: { projectionValues: { agentPreset: 'standard', baziMounted: 'yes' } } },
    current: 's1',
  };
  const ctx = {
    effect: (fn) => { fn(); },
    locale: { register: () => {}, bind: () => (key) => key },
    slots: { inject: (_slot, body) => { body(); }, register: (options) => { registerArgs = options; return () => {}; } },
    sessions: { list: { getSnapshot: () => snapshots, subscribe: () => () => {} } },
  };
  client.apply(ctx);
  assert.equal(registerArgs, undefined, '字符串真值不是挂载证据');
});

test('空投影渲染引导空态', () => {
  const client = loadClient();
  const { Component } = captureView(client);
  for (const empty of [undefined, null]) {
    const tree = render(Component({ useProjection: () => empty, t: (k) => k }));
    assert.equal(tree.props['data-testid'], 'bazi-view');
    assert.equal(textOf(tree), 'view.empty');
  }
});

test('命盘页签渲染四柱、五行条、神煞、关系与大运', () => {
  const client = loadClient();
  const { Component } = captureView(client);
  const tree = render(Component({ useProjection: () => sampleProjection(), t: (k, p) => (p === undefined ? k : `${k}|${JSON.stringify(p)}`) }));

  const pillarCells = textOf(findByTestId(tree, 'bazi-pillars'));
  for (const expected of [
    '庚', '午', '辛', '巳', '辰', '壬', '丁己', '丙戊庚', '戊乙癸', 'pillar.year',
    '路旁土', '白蜡金', '杨柳木', '沐浴', '长生', '养', '戌亥', '申酉',
    'col.nayin', 'col.dishi', 'col.zizuo', 'col.kongwang',
  ]) {
    assert.ok(pillarCells.includes(expected), `四柱表应含 ${expected}`);
  }

  const wuxing = textOf(findByTestId(tree, 'bazi-wuxing'));
  for (const wx of ['木', '火', '土', '金', '水']) assert.ok(wuxing.includes(wx), `五行应含 ${wx}`);
  assert.ok(wuxing.includes('31%（3.1 分）'), '火占 31%、3.1 分');
  assert.ok(wuxing.includes('4%（0.4 分）'), '木占 4%、0.4 分');

  const shensha = findByTestId(tree, 'bazi-shensha');
  assert.ok(textOf(shensha).includes('天乙贵人'), '神煞名应做成标签');
  assert.ok(textOf(shensha).includes('将星'));
  assert.ok(!textOf(shensha).includes('见于年支'), '依据不进标签正文');
  const firstChip = shensha.props.children[1].props.children[0];
  assert.match(firstChip.props.title, /年干\/日干查地支/, '依据放在悬停里');
  assert.ok(textOf(findByTestId(tree, 'bazi-relations')).includes('年柱午 ↔ 时柱午'));
  const dayun = textOf(findByTestId(tree, 'bazi-dayun'));
  assert.ok(dayun.includes('壬午') && dayun.includes('8-18岁'));
  // 无警告时不渲染警告卡片
  assert.equal(findByTestId(tree, 'bazi-warnings'), undefined);

  // 四宫位与交运日期进头部（`all` 在下方声明，故此处只查流月卡片）
  const liuyue = textOf(findByTestId(tree, 'bazi-liuyue'));
  assert.ok(liuyue.includes('庚寅') && liuyue.includes('2026-02-04'), '流月应含干支与交节日');

  // 顶部：姓名、性别、阳历、农历、计数插值
  const all = textOf(tree);
  // 四宫位与交运日期也在头部
  assert.ok(all.includes('壬申') && all.includes('乙酉') && all.includes('戊子'), '四宫位应出现在头部');
  assert.ok(all.includes('1997-08-15'), '交运日期应出现在头部');
  for (const expected of ['张三', '男', '1990-05-15', '1990年四月廿一', 'counts']) {
    assert.ok(all.includes(expected), `头部应含 ${expected}`);
  }
});

test('时柱未知时命盘头部给出六字说明', () => {
  const client = loadClient();
  const { Component } = captureView(client);
  const proj = sampleProjection();
  proj.subject.timeUnknown = true;
  proj.chart.hourUnknown = true;
  const tree = render(Component({ useProjection: () => proj, t: (k) => k }));
  assert.ok(textOf(tree).includes('chart.timeUnknown'));
});

test('未排盘时命盘页签给引导而不是抛错', () => {
  const client = loadClient();
  const { Component } = captureView(client);
  const proj = sampleProjection({ chart: null });
  const tree = render(Component({ useProjection: () => proj, t: (k) => k }));
  assert.ok(textOf(findByTestId(tree, 'bazi-chart-empty')).includes('chart.none'));
});

test('论断链页签渲染小节、标题、正文与依据，并串出记录关系', () => {
  const client = loadClient();
  const { Component, zh } = captureView(client);
  useTab('readings');
  try {
    const tree = render(Component({ useProjection: () => sampleProjection(), t: makeT(zh) }));
    const readings = findByTestId(tree, 'bazi-readings');
    const text = textOf(readings);
    for (const expected of ['日主强弱', '庚金得禄', '日主庚金生于巳月……', '《滴天髓》', '格局', '正官格']) {
      assert.ok(text.includes(expected), `论断链应含 ${expected}`);
    }
    assert.ok(text.includes('依据：《滴天髓》'), '引用应经插值成完整句子');
    // reading-2 由 reading-1 衍生（edge-1 的 target 是 reading-1）
    assert.ok(text.includes('依据 reading-1'), '应列出衍生关系');
    // calibration-1 校准 reading-2
    assert.ok(text.includes('校准 calibration-1'), '应列出校准关系');
  } finally {
    resetHooks();
  }
});

test('论断链为空时给引导', () => {
  const client = loadClient();
  const { Component } = captureView(client);
  useTab('readings');
  try {
    const proj = sampleProjection({ readings: [], edges: [], counts: { readings: 0, calibrations: 2, confirmed: 1 } });
    const tree = render(Component({ useProjection: () => proj, t: (k) => k }));
    assert.ok(textOf(findByTestId(tree, 'bazi-readings-empty')).includes('readings.empty'));
  } finally {
    resetHooks();
  }
});

test('校准页签渲染表格，未核对的行显示待核对', () => {
  const client = loadClient();
  const { Component } = captureView(client);
  useTab('calibrations');
  try {
    const tree = render(Component({ useProjection: () => sampleProjection(), t: (k) => k }));
    const table = findByTestId(tree, 'bazi-calibrations');
    assert.ok(table !== undefined, '应渲染校准表');
    const text = textOf(table);
    for (const expected of [
      'cal.th.years', 'cal.th.ages', 'cal.th.domain', 'cal.th.prediction', 'cal.th.outcome', 'cal.th.feedback',
      '2008-2018年', '18-28岁', '学业', '此运读书有成', '相符', '确于 2010 年升学',
    ]) {
      assert.ok(text.includes(expected), `校准表应含 ${expected}`);
    }
    assert.ok(text.includes('cal.pending'), '未核对的行显示待核对');
  } finally {
    resetHooks();
  }
});

test('校准页签为空时给引导', () => {
  const client = loadClient();
  const { Component } = captureView(client);
  useTab('calibrations');
  try {
    const proj = sampleProjection({ calibrations: [], edges: [], counts: { readings: 2, calibrations: 0, confirmed: 0 } });
    const tree = render(Component({ useProjection: () => proj, t: (k) => k }));
    assert.ok(textOf(findByTestId(tree, 'bazi-calibrations-empty')).includes('calibrations.empty'));
  } finally {
    resetHooks();
  }
});

test('命主只报阳历时，头部农历回落到命盘推出来的值', () => {
  const client = loadClient();
  const { Component } = captureView(client);
  const proj = sampleProjection();
  proj.subject.lunar = '';
  const withChart = render(Component({ useProjection: () => proj, t: (k) => k }));
  assert.ok(textOf(withChart).includes('1990年四月廿一'), '有命盘时用命盘推的农历');

  const noChart = render(Component({ useProjection: () => ({ ...proj, chart: null }), t: (k) => k }));
  assert.ok(textOf(noChart).includes('chart.lunar：未知'), '没命盘时仍是未知');
});

test('头部带出计数插值，且三个子页签都可点击', () => {
  const client = loadClient();
  const { Component } = captureView(client);
  const calls = [];
  useTab('chart', calls);
  try {
    const tree = render(Component({ useProjection: () => sampleProjection(), t: (k, p) => (p === undefined ? k : `${k}|${p.readings}/${p.calibrations}/${p.confirmed}`) }));
    assert.ok(textOf(tree).includes('counts|2/2/1'), '头部计数应带出论断/校准/已核对条数');

    const buttons = findByTestId(tree, 'bazi-tabs').props.children;
    assert.equal(buttons.length, 3, '应有三个子页签');
    for (const [i, key] of ['chart', 'readings', 'calibrations'].entries()) {
      assert.equal(buttons[i].props['data-testid'], `bazi-tab-${key}`);
      assert.equal(typeof buttons[i].props.onClick, 'function', `${key} 页签应可点击`);
      assert.equal(buttons[i].props['aria-pressed'], i === 0, '默认选中命盘');
    }
    assert.ok(textOf(buttons[2]).includes('(2)'), '校准页签应带条数');
    assert.ok(!textOf(buttons[0]).includes('('), '命盘页签不带条数');

    // 点击接线到 setTab
    buttons[1].props.onClick();
    buttons[2].props.onClick();
    buttons[0].props.onClick();
    assert.deepEqual(calls, ['readings', 'calibrations', 'chart']);
  } finally {
    resetHooks();
  }
});

test('styles 作为元素随页签渲染（卸载即移除）', () => {
  const client = loadClient();
  const { Component } = captureView(client);
  const tree = render(Component({ useProjection: () => sampleProjection(), t: (k) => k }));
  const style = tree.props.children.find((child) => child?.type === 'style');
  assert.ok(style !== undefined, '根节点内应有 style 元素');
  const css = style.props.dangerouslySetInnerHTML.__html;
  assert.ok(css.includes('.bazi-root'), '样式应带本插件的类前缀');
  // 所有选择器都带 .bazi- 前缀，避免影响宿主样式
  const selectors = css.split('}').map((block) => block.split('{')[0].trim()).filter((s) => s !== '');
  assert.ok(selectors.every((s) => s.split(',').every((part) => part.trim().startsWith('.bazi-'))),
    `样式选择器都应带 .bazi- 前缀，实得 ${JSON.stringify(selectors.filter((s) => !s.trim().startsWith('.bazi-')))}`);
});

/**
 * 用真实字典构造 `t`：先按键取词条，再插值 `{name}` 参数。
 * 让断言直接对着实际文案，而不是把键回显出来。
 */
function makeT(dict) {
  return (key, params) => {
    const template = dict[key] ?? key;
    if (params === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ''));
  };
}

/** 跑一次 apply 把注册的视图组件与中文字典取出来。 */
function captureView(client) {
  let captured;
  let zh;
  const snapshots = {
    byId: { s1: { projectionValues: { agentPreset: 'bazi' } } },
    current: 's1',
  };
  client.apply({
    effect: (fn) => { fn(); },
    locale: {
      register: (_ns, dicts) => { zh = dicts.zh; },
      bind: () => (key) => key,
    },
    slots: { inject: (_slot, body) => { body(); }, register: (_options, Component) => { captured = Component; return () => {}; } },
    sessions: { list: { getSnapshot: () => snapshots, subscribe: () => () => {} } },
  });
  assert.equal(typeof captured, 'function', '应注册一个视图组件');
  assert.ok(zh !== undefined, '应注册字典');
  return { Component: captured, zh };
}
