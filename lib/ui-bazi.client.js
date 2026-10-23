/**
 * dsh-bazi 浏览器半边：`conversation.view` 里的「八字」页签。
 *
 * 纯投影视图——命主、命盘、论断链与校准全部来自宿主折出的 `bazi` 会话投影
 * （`useProjection('bazi')`），页签自己不带 store、不发 RPC。投影为
 * `undefined`（宿主没组合本能力）或 `null`（本会话还没调 `bazi_start`）
 * 时渲染引导空态。
 *
 * 页签按会话挂载：当前会话（或其任一祖先）带 `bazi` 预设、或本会话自己的
 * 日志里出现过 `bazi_*` 工具调用（`baziMounted` 投影值）时注册，两者都不成
 * 立即注销。
 *
 * 本文件是**手写的浏览器产物**，不经过打包：模块表格式与
 * `@howmp/dsh-pentest` 的编译产物一致（`window.__ModuleLoader__.load`
 * + `factory(require)`），`require` 只取平台种子字（react），所以不需要
 * 构建步骤，也不需要 `dsh.client.external`。工厂 id 必须等于包名
 * `dsh-bazi`——`cordis.patch.yml` 里那一行的行名正是包根。
 */

window.__ModuleLoader__.load({
  id: 'dsh-bazi',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    // react 在模块表里可能是命名空间对象，也可能被 __toESM 包成 { default }。
    const reactRaw = require('react');
    const react = reactRaw !== null && typeof reactRaw === 'object' && typeof reactRaw.useState === 'function'
      ? reactRaw
      : (reactRaw !== null && typeof reactRaw === 'object' && reactRaw.default !== undefined ? reactRaw.default : reactRaw);
    const h = react.createElement;
    const useState = react.useState;

    // -----------------------------------------------------------------------
    // 样式
    // -----------------------------------------------------------------------

    /**
     * 组件内样式：作为 React 元素渲染在页签根节点内，卸载时随节点一起消失。
     * 颜色一律用 `currentColor` 的透明度变体或语义色，不写死背景色，
     * 以便继承宿主的亮/暗主题。
     */
    const CSS = `
.bazi-root { display: flex; flex-direction: column; gap: 14px; padding: 16px 18px 24px; font-size: 13px; line-height: 1.6; }
.bazi-card { border: 1px solid rgba(128,128,128,.24); border-radius: 10px; padding: 12px 14px; }
.bazi-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 12px; margin: 0; }
.bazi-name { font-size: 16px; font-weight: 600; margin: 0; }
.bazi-meta { opacity: .72; }
.bazi-counts { margin: 6px 0 0; opacity: .72; }
.bazi-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.bazi-tab { border: 1px solid rgba(128,128,128,.3); border-radius: 999px; background: transparent; color: inherit;
  font: inherit; padding: 4px 12px; cursor: pointer; }
.bazi-tab[aria-pressed="true"] { border-color: currentColor; font-weight: 600; }
.bazi-tab:hover { border-color: currentColor; }
.bazi-content { display: flex; flex-direction: column; gap: 14px; }
.bazi-grid { display: grid; grid-template-columns: 56px repeat(4, minmax(56px, 1fr)); gap: 1px;
  background: rgba(128,128,128,.24); border: 1px solid rgba(128,128,128,.24); border-radius: 10px; overflow: hidden; }
.bazi-cell { background: var(--dsh-surface, rgba(127,127,127,.06)); padding: 6px 8px; text-align: center; }
.bazi-label { opacity: .66; }
.bazi-gan, .bazi-zhi { font-size: 19px; font-weight: 600; }
.bazi-cang { font-size: 12px; opacity: .8; }
.bazi-wx { display: flex; flex-direction: column; gap: 6px; }
.bazi-wx-row { display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 10px; }
.bazi-wx-name { font-weight: 600; }
.bazi-wx-track { height: 8px; border-radius: 999px; background: rgba(128,128,128,.2); overflow: hidden; }
.bazi-wx-fill { height: 100%; border-radius: 999px; }
.bazi-wx-value { opacity: .72; font-variant-numeric: tabular-nums; }
.bazi-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.bazi-chip { border: 1px solid rgba(128,128,128,.3); border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.bazi-list { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.bazi-item { display: flex; flex-wrap: wrap; gap: 8px; }
.bazi-kind { opacity: .66; min-width: 62px; }
.bazi-dayun { display: flex; flex-wrap: wrap; gap: 6px; }
.bazi-step { border: 1px solid rgba(128,128,128,.28); border-radius: 8px; padding: 4px 9px; text-align: center; }
.bazi-step-ages { display: block; font-size: 11px; opacity: .66; }
.bazi-step-gz { font-weight: 600; }
.bazi-month-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }
.bazi-month { border: 1px solid rgba(128,128,128,.24); border-radius: 8px; padding: 5px 8px; }
.bazi-month-gz { display: block; font-weight: 600; }
.bazi-month-meta { display: block; font-size: 11px; opacity: .66; }
.bazi-warn { margin: 0; padding-left: 18px; }
.bazi-h3 { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
.bazi-reading { display: flex; flex-direction: column; gap: 4px; }
.bazi-reading-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.bazi-section { border: 1px solid rgba(128,128,128,.3); border-radius: 999px; padding: 1px 9px; font-size: 12px; opacity: .8; }
.bazi-reading-title { font-weight: 600; }
.bazi-citation { font-size: 12px; opacity: .66; }
.bazi-body { margin: 0; white-space: pre-wrap; word-break: break-word; opacity: .92; }
.bazi-edges { margin: 6px 0 0; padding-left: 18px; opacity: .72; font-size: 12px; }
.bazi-table { width: 100%; border-collapse: collapse; }
.bazi-th, .bazi-td { border-bottom: 1px solid rgba(128,128,128,.24); padding: 6px 8px; text-align: left; vertical-align: top; }
.bazi-th { font-weight: 600; opacity: .72; white-space: nowrap; }
.bazi-pending { opacity: .66; }
.bazi-empty { border: 1px dashed rgba(128,128,128,.36); border-radius: 10px; padding: 20px;
  text-align: center; opacity: .76; }
`;

    // -----------------------------------------------------------------------
    // 字典
    // -----------------------------------------------------------------------

    /** 本插件拥有的字典命名空间。 */
    const NS = 'bazi';

    /** 简体中文（键集的事实来源）。 */
    const zh = {
      'view.bazi': '八字',
      'view.empty': '当前会话还没有八字记录。在「八字模式」预设下确认出生信息并排盘后，这里会显示命盘与论断链。',
      'counts': '论断 {readings} 条 · 校准 {calibrations} 条 · 已核对 {confirmed} 条',
      'view.tab.chart': '命盘',
      'view.tab.readings': '论断链',
      'view.tab.calibrations': '校准',
      'subject.formerName': '曾用名',
      'subject.place': '出生地',
      'chart.solar': '阳历',
      'chart.lunar': '农历',
      'chart.shichen': '时辰',
      'chart.timeUnknown': '时辰未知（按六字论断）',
      'chart.dayunForward': '大运顺排',
      'chart.dayunBackward': '大运逆排',
      'chart.qiyun': '起运',
      'chart.jie': '月令节气',
      'chart.current': '当前流年',
      'chart.zishi': '子时',
      'col.pillar': '柱位',
      'col.gan': '天干',
      'col.zhi': '地支',
      'col.shishen': '十神',
      'col.canggan': '藏干',
      'col.nayin': '纳音',
      'col.dishi': '星运',
      'col.zizuo': '自坐',
      'col.kongwang': '旬空',
      'chart.palaces': '四宫位',
      'chart.taiyuan': '胎元',
      'chart.taixi': '胎息',
      'chart.minggong': '命宫',
      'chart.shengong': '身宫',
      'chart.jiaoyun': '交运',
      'chart.liuyue': '流月',
      'chart.liuyueStart': '起于',
      'chart.tst': '真太阳时',
      'chart.tstCrossed': '（跨日）',
      'pillar.year': '年柱',
      'pillar.month': '月柱',
      'pillar.day': '日柱',
      'pillar.hour': '时柱',
      'chart.wuxing': '五行力量',
      'chart.shensha': '神煞',
      'chart.relations': '干支关系',
      'chart.dayun': '大运',
      'chart.warnings': '排盘警告',
      'chart.none': '尚未排盘。让 agent 调用 bazi_paipan 后这里会显示四柱与五行统计。',
      'chart.noShensha': '本命局未见所收录的神煞。',
      'chart.noRelations': '四柱之间未见冲合刑害。',
      'readings.empty': '还没有论断。让 agent 按经典逐节论断（日主强弱、十神、神煞、五行平衡、格局、大运、流年、历史校准、综合建议）后逐条记录。',
      'readings.citation': '依据：{text}',
      'readings.edges': '与其他记录的关系',
      'calibrations.empty': '还没有校准记录。agent 应给出可核对的过往年份预测，由你确认后再回填。',
      'cal.th.years': '年份',
      'cal.th.ages': '年龄',
      'cal.th.domain': '领域',
      'cal.th.prediction': '预测',
      'cal.th.outcome': '核对结果',
      'cal.th.feedback': '反馈',
      'cal.pending': '待核对',
      'edge.spawns': '衍生',
      'edge.derived_from': '依据',
      'edge.calibrates': '校准',
    };

    /** English dictionary (same key set). */
    const en = {
      'view.bazi': 'BaZi',
      'view.empty': 'This session has no BaZi record yet. Under the BaZi preset, confirm the birth details and cast the chart — the chart and reading chain appear here.',
      'counts': '{readings} readings · {calibrations} calibrations · {confirmed} confirmed',
      'view.tab.chart': 'Chart',
      'view.tab.readings': 'Readings',
      'view.tab.calibrations': 'Calibration',
      'subject.formerName': 'Former name',
      'subject.place': 'Birthplace',
      'chart.solar': 'Solar',
      'chart.lunar': 'Lunar',
      'chart.shichen': 'Hour',
      'chart.timeUnknown': 'Hour unknown (six characters)',
      'chart.dayunForward': 'Luck cycles forward',
      'chart.dayunBackward': 'Luck cycles backward',
      'chart.qiyun': 'Onset',
      'chart.jie': 'Month solar term',
      'chart.current': 'Current year',
      'chart.zishi': 'Zi hour',
      'col.pillar': 'Pillar',
      'col.gan': 'Stem',
      'col.zhi': 'Branch',
      'col.shishen': 'Ten Gods',
      'col.canggan': 'Hidden stems',
      'col.nayin': 'Na Yin',
      'col.dishi': 'Star phase',
      'col.zizuo': 'Self seat',
      'col.kongwang': 'Void',
      'chart.palaces': 'Four palaces',
      'chart.taiyuan': 'Conception',
      'chart.taixi': 'Breath',
      'chart.minggong': 'Life palace',
      'chart.shengong': 'Body palace',
      'chart.jiaoyun': 'Handover',
      'chart.liuyue': 'Monthly cycles',
      'chart.liuyueStart': 'Starts',
      'chart.tst': 'True solar time',
      'chart.tstCrossed': ' (crosses midnight)',
      'pillar.year': 'Year',
      'pillar.month': 'Month',
      'pillar.day': 'Day',
      'pillar.hour': 'Hour',
      'chart.wuxing': 'Five phases',
      'chart.shensha': 'Auspices',
      'chart.relations': 'Branch relations',
      'chart.dayun': 'Luck cycles',
      'chart.warnings': 'Warnings',
      'chart.none': 'No chart yet. Once the agent calls bazi_paipan, the four pillars and phase statistics appear here.',
      'chart.noShensha': 'No catalogued auspice is present.',
      'chart.noRelations': 'No clash, combination, harm or punishment among the four pillars.',
      'readings.empty': 'No readings yet. The agent records one per classical section (day master strength, Ten Gods, auspices, phase balance, structure, luck cycles, annual years, historical calibration, synthesis).',
      'readings.citation': 'Source: {text}',
      'readings.edges': 'Related records',
      'calibrations.empty': 'No calibration yet. The agent states checkable past-year predictions; you confirm them and the outcome is recorded.',
      'cal.th.years': 'Years',
      'cal.th.ages': 'Ages',
      'cal.th.domain': 'Domain',
      'cal.th.prediction': 'Prediction',
      'cal.th.outcome': 'Outcome',
      'cal.th.feedback': 'Feedback',
      'cal.pending': 'Pending',
      'edge.spawns': 'spawns',
      'edge.derived_from': 'derived from',
      'edge.calibrates': 'calibrates',
    };

    // -----------------------------------------------------------------------
    // 展示辅助
    // -----------------------------------------------------------------------

    /** 五行顺序与本命局一致的语义色（属「图形」而非宿主主题的一部分）。 */
    const WUXING_ORDER = ['木', '火', '土', '金', '水'];
    const WUXING_COLOR = { 木: '#2f9e6b', 火: '#d4553a', 土: '#b08334', 金: '#8a9096', 水: '#3f7fd4' };

    const PILLARS = ['year', 'month', 'day', 'hour'];

    /** 数值表单：去掉浮点尾巴。 */
    function fmt(value) {
      if (typeof value !== 'number') return '';
      return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
    }

    /** 一行「标签 + 值」，值为空则不渲染。 */
    function metaItem(label, value, key) {
      if (value === undefined || value === null || value === '') return null;
      return h('span', { className: 'bazi-meta', key }, `${label} ${value}`);
    }

    // -----------------------------------------------------------------------
    // 子视图
    // -----------------------------------------------------------------------

    /** 四柱表：柱位 / 天干 / 地支 / 十神 / 藏干 / 纳音 / 星运 / 自坐 / 旬空。 */
    function PillarGrid({ chart, t }) {
      const rows = [
        ['col.gan', (p) => h('span', { className: 'bazi-gan' }, p.gan)],
        ['col.zhi', (p) => h('span', { className: 'bazi-zhi' }, p.zhi)],
        ['col.shishen', (p) => p.shishen],
        ['col.canggan', (p) => h('span', { className: 'bazi-cang' }, p.canggan)],
        ['col.nayin', (p) => p.nayin ?? '—'],
        ['col.dishi', (p) => p.dishi ?? '—'],
        ['col.zizuo', (p) => p.zizuo ?? '—'],
        ['col.kongwang', (p) => p.kongwang ?? '—'],
      ];
      const cells = [h('div', { className: 'bazi-cell bazi-label', key: 'corner' }, '')];
      for (const key of PILLARS) {
        cells.push(h('div', { className: 'bazi-cell bazi-label', key: `h-${key}` }, t(`pillar.${key}`)));
      }
      for (const [labelKey, render] of rows) {
        cells.push(h('div', { className: 'bazi-cell bazi-label', key: `l-${labelKey}` }, t(labelKey)));
        for (const key of PILLARS) {
          cells.push(h('div', { className: 'bazi-cell', key: `${labelKey}-${key}` }, render(chart.pillars[key])));
        }
      }
      return h('div', { className: 'bazi-grid', 'data-testid': 'bazi-pillars' }, cells);
    }

    /** 五行力量条：宽度取 `share` 百分比。 */
    function WuxingBars({ chart, t }) {
      const rows = WUXING_ORDER.map((wx) => {
        const share = chart.share[wx] ?? 0;
        const width = `${Math.max(0, Math.min(100, share))}%`;
        return h('div', { className: 'bazi-wx-row', key: wx }, [
          h('span', { className: 'bazi-wx-name', key: 'n' }, wx),
          h('span', { className: 'bazi-wx-track', key: 'tr' },
            h('span', { className: 'bazi-wx-fill', style: { width, background: WUXING_COLOR[wx] } })),
          h('span', { className: 'bazi-wx-value', key: 'v' }, `${share}%（${fmt(chart.score[wx])} 分）`),
        ]);
      });
      return h('div', { className: 'bazi-card' }, [
        h('h3', { className: 'bazi-h3', key: 't' }, t('chart.wuxing')),
        h('div', { className: 'bazi-wx', key: 'b', 'data-testid': 'bazi-wuxing' }, rows),
      ]);
    }

    /** 无序字符串列表卡片；空则显示给定的空态文案。 */
    function StringCard({ titleKey, items, emptyKey, t, testId, chips }) {
      const body = items.length === 0
        ? h('p', { className: 'bazi-pending' }, t(emptyKey))
        : (chips
          ? h('div', { className: 'bazi-chips' }, items.map((text, i) => h('span', { className: 'bazi-chip', key: i }, text)))
          : h('ul', { className: 'bazi-list' }, items.map((text, i) => h('li', { key: i }, text))));
      return h('div', { className: 'bazi-card', 'data-testid': testId }, [
        h('h3', { className: 'bazi-h3', key: 't' }, t(titleKey)),
        body,
      ]);
    }

    /** 带依据的标签列表（神煞）：名做标签，依据放 title 里悬停可见。 */
    function TagCard({ titleKey, items, emptyKey, t, testId }) {
      const body = items.length === 0
        ? h('p', { className: 'bazi-pending' }, t(emptyKey))
        : h('div', { className: 'bazi-chips' }, items.map((item, i) => h('span', {
          className: 'bazi-chip', key: i, title: item.detail || undefined,
        }, item.name)));
      return h('div', { className: 'bazi-card', 'data-testid': testId }, [
        h('h3', { className: 'bazi-h3', key: 't' }, t(titleKey)),
        body,
      ]);
    }

    /** 命盘页签。 */
    function ChartTab({ chart, t }) {
      if (chart === null) {
        return h('p', { className: 'bazi-empty', 'data-testid': 'bazi-chart-empty' }, t('chart.none'));
      }
      const meta = h('ul', { className: 'bazi-list' }, [
        h('li', { key: 'solar' }, `${t('chart.solar')}：${chart.solarText}`),
        h('li', { key: 'lunar' }, `${t('chart.lunar')}：${chart.lunarText}`),
        h('li', { key: 'shichen' }, chart.hourUnknown === true
          ? t('chart.timeUnknown')
          : `${t('chart.shichen')}：${chart.shichenText}`),
        chart.tst == null ? null : h('li', { key: 'tst' },
          `${t('chart.tst')}：${chart.tst.corrected}（${chart.tst.minutes >= 0 ? '+' : ''}${chart.tst.minutes}′${chart.tst.crossedDay ? t('chart.tstCrossed') : ''}）`),
        h('li', { key: 'dayun' }, `${chart.forward ? t('chart.dayunForward') : t('chart.dayunBackward')} · ${t('chart.qiyun')}：${chart.qiyunText}`),
        chart.qiyunReceipt == null ? null : h('li', { key: 'jiaoyun' }, `${t('chart.jiaoyun')}：${chart.qiyunReceipt.jiaoyun}`),
        chart.palaces == null ? null : h('li', { key: 'palaces' }, `${t('chart.palaces')}：${t('chart.taiyuan')} ${chart.palaces.taiyuan} · ${t('chart.taixi')} ${chart.palaces.taixi} · ${t('chart.minggong')} ${chart.palaces.minggong} · ${t('chart.shengong')} ${chart.palaces.shengong}`),
        chart.jieName === '' ? null : h('li', { key: 'jie' }, `${t('chart.jie')}：${chart.jieName}`),
        chart.zishi === '' ? null : h('li', { key: 'zishi' }, `${t('chart.zishi')}：${chart.zishi}`),
        h('li', { key: 'cur' }, `${t('chart.current')}：${chart.currentYear}${chart.currentGz}`),
      ].filter(Boolean));

      const relCard = h('div', { className: 'bazi-card', 'data-testid': 'bazi-relations' }, [
        h('h3', { className: 'bazi-h3', key: 't' }, t('chart.relations')),
        chart.relations.length === 0
          ? h('p', { className: 'bazi-pending', key: 'e' }, t('chart.noRelations'))
          : h('ul', { className: 'bazi-list', key: 'l' }, chart.relations.map((rel, i) => h('li', {
            className: 'bazi-item', key: i,
          }, [
            h('span', { className: 'bazi-kind', key: 'k' }, rel.kind),
            h('span', { key: 'd' }, rel.detail),
          ]))),
      ]);

      const dayunCard = chart.dayun.length === 0 ? null : h('div', { className: 'bazi-card', 'data-testid': 'bazi-dayun' }, [
        h('h3', { className: 'bazi-h3', key: 't' }, t('chart.dayun')),
        h('div', { className: 'bazi-dayun', key: 'd' }, chart.dayun.map((step, i) => h('div', {
          className: 'bazi-step', key: i,
        }, [
          h('span', { className: 'bazi-step-gz', key: 'g' }, step.gz),
          h('span', { className: 'bazi-step-ages', key: 'a' }, step.ages),
        ]))),
      ]);

      const warnCard = chart.warnings.length === 0 ? null : h('div', { className: 'bazi-card', 'data-testid': 'bazi-warnings' }, [
        h('h3', { className: 'bazi-h3', key: 't' }, t('chart.warnings')),
        h('ul', { className: 'bazi-warn', key: 'l' }, chart.warnings.map((w, i) => h('li', { key: i }, w))),
      ]);

      const liuyueCard = chart.liuyue == null || chart.liuyue.length === 0 ? null : h('div', { className: 'bazi-card', 'data-testid': 'bazi-liuyue' }, [
        h('h3', { className: 'bazi-h3', key: 't' }, `${t('chart.liuyue')}（${chart.currentYear}）`),
        h('div', { className: 'bazi-month-grid', key: 'g' }, chart.liuyue.map((row, i) => h('div', {
          className: 'bazi-month', key: i,
        }, [
          h('span', { className: 'bazi-month-gz', key: 'g' }, row.gz),
          h('span', { className: 'bazi-month-meta', key: 'm' }, `${row.name} · ${row.start}`),
        ]))),
      ]);

      return h('div', { className: 'bazi-content' }, [
        h('div', { className: 'bazi-card', key: 'meta' }, meta),
        h(PillarGrid, { chart, t, key: 'grid' }),
        h(WuxingBars, { chart, t, key: 'wx' }),
        h(TagCard, { titleKey: 'chart.shensha', items: chart.shensha, emptyKey: 'chart.noShensha', t, testId: 'bazi-shensha', key: 'ss' }),
        relCard,
        dayunCard,
        liuyueCard,
        warnCard,
      ]);
    }

    /** 论断链页签：按录入顺序列论断，并附该条与其他记录的关系。 */
    function ReadingsTab({ readings, edges, t }) {
      if (readings.length === 0) {
        return h('p', { className: 'bazi-empty', 'data-testid': 'bazi-readings-empty' }, t('readings.empty'));
      }
      return h('div', { className: 'bazi-content', 'data-testid': 'bazi-readings' }, readings.map((r, i) => {
        const related = edges.filter((e) => e.sourceId === r.id || e.targetId === r.id);
        return h('div', { className: 'bazi-card bazi-reading', key: r.id || i }, [
          h('div', { className: 'bazi-reading-head', key: 'h' }, [
            h('span', { className: 'bazi-section', key: 's' }, r.section),
            h('span', { className: 'bazi-reading-title', key: 't' }, r.title),
            r.citation === '' ? null : h('span', { className: 'bazi-citation', key: 'c' }, t('readings.citation', { text: r.citation })),
          ].filter(Boolean)),
          h('p', { className: 'bazi-body', key: 'b' }, r.content),
          related.length === 0 ? null : h('ul', { className: 'bazi-edges', key: 'e' }, related.map((e, j) => {
            const other = e.sourceId === r.id ? e.targetId : e.sourceId;
            return h('li', { key: j }, `${t(`edge.${e.kind}`)} ${other}`);
          })),
        ].filter(Boolean));
      }));
    }

    /** 校准页签：年份/年龄/领域/预测/结果/反馈 表。 */
    function CalibrationsTab({ calibrations, t }) {
      if (calibrations.length === 0) {
        return h('p', { className: 'bazi-empty', 'data-testid': 'bazi-calibrations-empty' }, t('calibrations.empty'));
      }
      const head = h('tr', {}, [
        h('th', { className: 'bazi-th', key: 'y' }, t('cal.th.years')),
        h('th', { className: 'bazi-th', key: 'a' }, t('cal.th.ages')),
        h('th', { className: 'bazi-th', key: 'd' }, t('cal.th.domain')),
        h('th', { className: 'bazi-th', key: 'p' }, t('cal.th.prediction')),
        h('th', { className: 'bazi-th', key: 'o' }, t('cal.th.outcome')),
        h('th', { className: 'bazi-th', key: 'f' }, t('cal.th.feedback')),
      ]);
      const rows = calibrations.map((c, i) => h('tr', { key: c.id || i }, [
        h('td', { className: 'bazi-td', key: 'y' }, c.years),
        h('td', { className: 'bazi-td', key: 'a' }, c.ages),
        h('td', { className: 'bazi-td', key: 'd' }, c.domain),
        h('td', { className: 'bazi-td', key: 'p' }, c.prediction),
        h('td', { className: 'bazi-td', key: 'o' }, c.outcome === '' ? h('span', { className: 'bazi-pending' }, t('cal.pending')) : c.outcome),
        h('td', { className: 'bazi-td', key: 'f' }, c.feedback === '' ? '—' : c.feedback),
      ]));
      return h('table', { className: 'bazi-table', 'data-testid': 'bazi-calibrations' }, [
        h('thead', { key: 'h' }, head),
        h('tbody', { key: 'b' }, rows),
      ]);
    }

    // -----------------------------------------------------------------------
    // 页签本体
    // -----------------------------------------------------------------------

    /** 三个子页签。 */
    const TABS = ['chart', 'readings', 'calibrations'];
    const TAB_LABELS = {
      chart: 'view.tab.chart',
      readings: 'view.tab.readings',
      calibrations: 'view.tab.calibrations',
    };

    /**
     * 八字页签。
     * @param props - `conversation.view` 条目属性，含 `useProjection` 与绑定的 `t`。
     */
    function BaziView({ useProjection, t }) {
      const read = typeof useProjection === 'function' ? useProjection : () => undefined;
      const state = read('bazi');
      const [tab, setTab] = useState('chart');

      if (state === undefined || state === null) {
        return h('div', { className: 'bazi-root', 'data-testid': 'bazi-view' },
          h('p', { className: 'bazi-empty' }, t('view.empty')));
      }

      const subject = state.subject;
      const shichenText = subject.timeUnknown ? t('chart.timeUnknown') : `${subject.shichen}时`;
      // 命主只报了阳历时农历是排盘时由内核推的，此时回落到命盘上的值
      const lunarText = subject.lunar || (state.chart === null ? '' : state.chart.lunarText);
      const header = h('header', { className: 'bazi-card', key: 'head' }, [
        h('h2', { className: 'bazi-title', key: 't' }, [
          h('span', { className: 'bazi-name', key: 'n' }, subject.name === '' ? '（未提供姓名）' : subject.name),
          h('span', { className: 'bazi-meta', key: 'x' }, subject.sex),
          metaItem(t('subject.formerName'), subject.formerName, 'f'),
          metaItem(t('subject.place'), subject.birthPlace, 'p'),
        ].filter(Boolean)),
        h('p', { className: 'bazi-meta', key: 'l' }, `${t('chart.solar')}：${subject.solar || '未知'} · ${t('chart.lunar')}：${lunarText || '未知'} · ${t('chart.shichen')}：${shichenText}`),
        h('p', { className: 'bazi-counts', key: 'c' }, t('counts', {
          readings: state.counts.readings,
          calibrations: state.counts.calibrations,
          confirmed: state.counts.confirmed,
        })),
      ]);

      const tabs = h('nav', { className: 'bazi-tabs', 'data-testid': 'bazi-tabs', key: 'nav' }, TABS.map((key) => h('button', {
        type: 'button',
        className: 'bazi-tab',
        'aria-pressed': tab === key,
        'data-testid': `bazi-tab-${key}`,
        onClick: () => { setTab(key); },
        key,
      }, [
        t(TAB_LABELS[key]),
        key === 'calibrations' ? ` (${state.counts.calibrations})` : '',
      ].join(''))));

      const body = tab === 'chart'
        ? h(ChartTab, { chart: state.chart, t, key: 'chart' })
        : (tab === 'readings'
          ? h(ReadingsTab, { readings: state.readings, edges: state.edges, t, key: 'readings' })
          : h(CalibrationsTab, { calibrations: state.calibrations, t, key: 'calibrations' }));

      return h('section', { className: 'bazi-root', 'data-testid': 'bazi-view' }, [
        h('style', { key: 'css', dangerouslySetInnerHTML: { __html: CSS } }),
        header,
        tabs,
        h('div', { className: 'bazi-content', key: 'body' }, body),
      ]);
    }

    // -----------------------------------------------------------------------
    // 挂载门与注册
    // -----------------------------------------------------------------------

    /** 携带本能力的 agent 预设 id。 */
    const BAZI_PRESET = 'bazi';
    /** 预设副本沿用 `bazi-` 前缀（约定）。 */
    const BAZI_PRESET_PREFIX = `${BAZI_PRESET}-`;
    /** 客户端可见标记：本会话自己的日志证明了这行已挂载。 */
    const BAZI_MOUNTED_KEY = 'baziMounted';

    /** 当前会话 id；没有选中会话时为 undefined。 */
    function currentSessionOf(snapshot) {
      if (snapshot === undefined || snapshot === null) return undefined;
      return snapshot.current !== undefined && snapshot.current !== null
        ? snapshot.current
        : Object.entries(snapshot.byId ?? {})
          .find(([, row]) => (row && row.retainedBy && row.retainedBy.mainView > 0) === true)?.[0];
    }

    /** 一行会话携带的预设 id（兼容两种线上形态）。 */
    function presetOf(row) {
      const projected = row?.projectionValues?.agentPreset;
      if (typeof projected === 'string') return projected;
      return row?.agentPreset;
    }

    /** 该预设 id 是否指名八字组合或其副本。 */
    function isBaziPresetId(id) {
      return id === BAZI_PRESET || (id !== undefined && typeof id === 'string' && id.startsWith(BAZI_PRESET_PREFIX));
    }

    /** 该行自己的日志里是否出现过 `bazi_*` 工具调用。 */
    function mountedOf(row) {
      const marker = row?.projectionValues?.[BAZI_MOUNTED_KEY];
      return typeof marker === 'boolean' && marker;
    }

    /** 本会话（或其任一祖先）是否携带八字能力。 */
    function isBaziSession(snapshot, id) {
      let cursor = id;
      const seen = new Set();
      const byId = snapshot?.byId ?? {};
      while (cursor !== undefined && cursor !== null && !seen.has(cursor)) {
        seen.add(cursor);
        const row = byId[cursor];
        if (isBaziPresetId(presetOf(row)) || mountedOf(row)) return true;
        cursor = row?.parentId;
      }
      return false;
    }

    /** 视图注册与副本所需的服务。 */
    const inject = ['slots', 'locale', 'sessions'];

    /**
     * 客户端插件体：`conversation.view` 里的八字页签，按会话挂载。
     * @param ctx - 客户端根上下文。
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-bazi: dictionaries');
      // 注册期文本（页签标题）通过绑定后的翻译以 thunk 读取，
      // 因此跟随当前语言而无需重新注册。
      const t = ctx.locale.bind(NS);
      const sessions = ctx.sessions;

      ctx.slots.inject('conversation.view', () => {
        let disposeEntry;
        let sessionId;
        let sessionBazi;

        const sync = () => {
          const snapshot = sessions.list.getSnapshot();
          const current = currentSessionOf(snapshot);
          const bazi = current === undefined ? undefined : isBaziSession(snapshot, current);
          if (current === sessionId && bazi === sessionBazi) return;
          disposeEntry?.();
          disposeEntry = undefined;
          sessionId = current;
          sessionBazi = bazi;
          if (current === undefined || bazi !== true) return;
          disposeEntry = ctx.slots.register({
            name: 'conversation.view',
            id: 'bazi',
            order: 25,
            locale: NS,
            label: () => t('view.bazi'),
          }, BaziView);
        };

        sync();
        const offList = sessions.list.subscribe(sync);
        return () => {
          offList();
          disposeEntry?.();
        };
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
