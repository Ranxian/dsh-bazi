/**
 * 结构化命理分析表 + 机械推算（五行统计、十二长生、干支关系）。
 *
 * 这些是**可机械判定**的量：手工数五行、找地支刑冲合害极容易出错，
 * 因此由插件算好交给模型解释。所有度量都带口径说明，模型应把它当作
 * 「参考统计」而非唯一真理——命理流派对力量权重并无统一定论。
 *
 * @module dsh-bazi/tables
 */

import { CANGGAN, GAN, GAN_WUXING, ZHI } from './engine.js';

/** 五行顺序（相生序）。 */
export const WUXING = ['木', '火', '土', '金', '水'];

/** 十二长生阶段名（长生起，阳干顺行、阴干逆行）。 */
export const CHANGSHENG_STAGES = [
  '长生', '沐浴', '冠带', '临官', '帝旺', '衰',
  '病', '死', '墓', '绝', '胎', '养',
];

/** 各天干的长生支。戊从丙、己从丁。 */
const CHANGSHENG_START = new Map([
  ['甲', '亥'], ['乙', '午'], ['丙', '寅'], ['丁', '酉'], ['戊', '寅'],
  ['己', '酉'], ['庚', '巳'], ['辛', '子'], ['壬', '申'], ['癸', '卯'],
]);

/** 天干阴阳五行、方位、季节。 */
export const GAN_INFO = new Map([
  ['甲', { yinyang: '阳', wuxing: '木', direction: '东', season: '春' }],
  ['乙', { yinyang: '阴', wuxing: '木', direction: '东', season: '春' }],
  ['丙', { yinyang: '阳', wuxing: '火', direction: '南', season: '夏' }],
  ['丁', { yinyang: '阴', wuxing: '火', direction: '南', season: '夏' }],
  ['戊', { yinyang: '阳', wuxing: '土', direction: '中', season: '四季末' }],
  ['己', { yinyang: '阴', wuxing: '土', direction: '中', season: '四季末' }],
  ['庚', { yinyang: '阳', wuxing: '金', direction: '西', season: '秋' }],
  ['辛', { yinyang: '阴', wuxing: '金', direction: '西', season: '秋' }],
  ['壬', { yinyang: '阳', wuxing: '水', direction: '北', season: '冬' }],
  ['癸', { yinyang: '阴', wuxing: '水', direction: '北', season: '冬' }],
]);

/** 地支阴阳五行、方位、生肖、农历月、时辰范围。 */
export const ZHI_INFO = new Map([
  ['子', { yinyang: '阳', wuxing: '水', direction: '北', zodiac: '鼠', lunarMonth: '十一月', hours: '23:00-01:00' }],
  ['丑', { yinyang: '阴', wuxing: '土', direction: '东北', zodiac: '牛', lunarMonth: '十二月', hours: '01:00-03:00' }],
  ['寅', { yinyang: '阳', wuxing: '木', direction: '东北', zodiac: '虎', lunarMonth: '正月', hours: '03:00-05:00' }],
  ['卯', { yinyang: '阴', wuxing: '木', direction: '东', zodiac: '兔', lunarMonth: '二月', hours: '05:00-07:00' }],
  ['辰', { yinyang: '阳', wuxing: '土', direction: '东南', zodiac: '龙', lunarMonth: '三月', hours: '07:00-09:00' }],
  ['巳', { yinyang: '阴', wuxing: '火', direction: '东南', zodiac: '蛇', lunarMonth: '四月', hours: '09:00-11:00' }],
  ['午', { yinyang: '阳', wuxing: '火', direction: '南', zodiac: '马', lunarMonth: '五月', hours: '11:00-13:00' }],
  ['未', { yinyang: '阴', wuxing: '土', direction: '西南', zodiac: '羊', lunarMonth: '六月', hours: '13:00-15:00' }],
  ['申', { yinyang: '阳', wuxing: '金', direction: '西南', zodiac: '猴', lunarMonth: '七月', hours: '15:00-17:00' }],
  ['酉', { yinyang: '阴', wuxing: '金', direction: '西', zodiac: '鸡', lunarMonth: '八月', hours: '17:00-19:00' }],
  ['戌', { yinyang: '阳', wuxing: '土', direction: '西北', zodiac: '狗', lunarMonth: '九月', hours: '19:00-21:00' }],
  ['亥', { yinyang: '阴', wuxing: '水', direction: '西北', zodiac: '猪', lunarMonth: '十月', hours: '21:00-23:00' }],
]);

/** 十神含义与六亲代表。 */
export const SHISHEN_INFO = new Map([
  ['比肩', { relation: '同我，阴阳相同', people: '兄弟、朋友、同辈、竞争者' }],
  ['劫财', { relation: '同我，阴阳不同', people: '姐妹、竞争对手、损财者' }],
  ['食神', { relation: '我生，阴阳相同', people: '子女（女命）、才华、口福' }],
  ['伤官', { relation: '我生，阴阳不同', people: '子女（女命）、才艺、叛逆' }],
  ['偏财', { relation: '我克，阴阳相同', people: '偏财、父（男命）、情人' }],
  ['正财', { relation: '我克，阴阳不同', people: '正财、妻（男命）、稳定收入' }],
  ['偏官', { relation: '克我，阴阳相同', people: '偏权、压力、小人之类' }],
  ['正官', { relation: '克我，阴阳不同', people: '正权、上级、夫（女命）' }],
  ['偏印', { relation: '生我，阴阳相同', people: '偏学术、继母、孤独' }],
  ['正印', { relation: '生我，阴阳不同', people: '母亲、学业、贵人' }],
]);

const PILLAR_LABELS = ['年', '月', '日', '时'];

/**
 * 天干在指定地支的长生状态。
 * @param {string} gan - 天干。
 * @param {string} zhi - 地支。
 * @returns {string} 十二长生阶段名；参数非法返回「—」。
 */
export function changshengOf(gan, zhi) {
  const start = CHANGSHENG_START.get(gan);
  if (start === undefined || !ZHI.includes(zhi)) return '—';
  const forward = GAN.indexOf(gan) % 2 === 0;
  const delta = forward ? 1 : -1;
  const offset = ((ZHI.indexOf(zhi) - ZHI.indexOf(start)) * delta % 12 + 12) % 12;
  return CHANGSHENG_STAGES[offset];
}

/** 单个地支的藏干权重（本气 0.6 / 中气 0.3 / 余气 0.1，按实际藏干数归一）。 */
function cangganWeights(zhi) {
  const parts = CANGGAN.get(zhi) ?? [];
  const base = [0.6, 0.3, 0.1].slice(0, parts.length);
  const total = base.reduce((sum, w) => sum + w, 0) || 1;
  return parts.map(([gan], i) => [gan, base[i] / total]);
}

/**
 * 五行力量参考统计。
 *
 * 口径（可复现、可质疑，非命理定论）：
 * - 天干：每个计 1.0 分，计入其五行。
 * - 地支：每个地支总计 1.0 分，按藏干以 本气 0.6 / 中气 0.3 / 余气 0.1
 *   分配后归一到 1.0（只有一个藏干的地支整分归它）。
 * - 时柱未知时只统计年月日三柱（`pillarCount` 会标明）。
 *
 * @param {object} pillars - {@link import('./engine.js').compute} 的 `pillars`。
 * @returns {object} 统计结果（含分值、计数与口径说明）。
 */
export function wuxingStats(pillars) {
  const score = Object.fromEntries(WUXING.map((w) => [w, 0]));
  const counts = Object.fromEntries(WUXING.map((w) => [w, 0]));
  const stems = [];
  const branches = [];

  for (const key of ['year', 'month', 'day', 'hour']) {
    const pillar = pillars[key];
    if (pillar === undefined) continue;
    if (pillar.gan !== '未知') {
      const wx = GAN_WUXING[GAN.indexOf(pillar.gan)];
      if (wx !== undefined) {
        score[wx] += 1;
        counts[wx] += 1;
        stems.push({ pillar: key, gan: pillar.gan, wuxing: wx });
      }
    }
    if (pillar.zhi !== '未知') {
      for (const [gan, weight] of cangganWeights(pillar.zhi)) {
        const wx = GAN_WUXING[GAN.indexOf(gan)];
        if (wx === undefined) continue;
        score[wx] += weight;
        counts[wx] += 1;
        branches.push({ pillar: key, zhi: pillar.zhi, gan, wuxing: wx, weight });
      }
    }
  }

  for (const w of WUXING) score[w] = Math.round(score[w] * 1000) / 1000;
  const total = WUXING.reduce((sum, w) => sum + score[w], 0);
  const share = Object.fromEntries(
    WUXING.map((w) => [w, total === 0 ? 0 : Math.round((score[w] / total) * 1000) / 10]),
  );
  const present = WUXING.filter((w) => counts[w] > 0);
  const missing = WUXING.filter((w) => counts[w] === 0);
  const sorted = [...WUXING].sort((a, b) => score[b] - score[a]);

  return {
    score,
    share,
    counts,
    present,
    missing,
    strongest: sorted[0],
    weakest: sorted[sorted.length - 1],
    total: Math.round(total * 1000) / 1000,
    pillarCount: stems.length === 0 ? 0 : new Set(stems.map((s) => s.pillar)).size,
    stems,
    branches,
    method: '天干每干 1.0 分；地支每支 1.0 分按藏干（本气0.6/中气0.3/余气0.1）归一分配。参考统计，非命理定论。',
  };
}

/** 地支六冲。 */
const LIU_CHONG = [['子', '午'], ['丑', '未'], ['寅', '申'], ['卯', '酉'], ['辰', '戌'], ['巳', '亥']];
/** 地支六合（附化气）。 */
const LIU_HE = [
  [['子', '丑'], '土'], [['寅', '亥'], '木'], [['卯', '戌'], '火'],
  [['辰', '酉'], '金'], [['巳', '申'], '水'], [['午', '未'], '火/土'],
];
/** 地支相害（相穿）。 */
const XIANG_HAI = [['子', '未'], ['丑', '午'], ['寅', '巳'], ['卯', '辰'], ['申', '亥'], ['酉', '戌']];
/** 天干五合（附化气）。 */
const GAN_HE = [
  [['甲', '己'], '土'], [['乙', '庚'], '金'], [['丙', '辛'], '水'],
  [['丁', '壬'], '木'], [['戊', '癸'], '火'],
];
/** 三合局（三字全见方成局）。 */
const SAN_HE = [
  [['申', '子', '辰'], '水'], [['亥', '卯', '未'], '木'],
  [['寅', '午', '戌'], '火'], [['巳', '酉', '丑'], '金'],
];
/** 三会方局。 */
const SAN_HUI = [
  [['寅', '卯', '辰'], '木', '东方'], [['巳', '午', '未'], '火', '南方'],
  [['申', '酉', '戌'], '金', '西方'], [['亥', '子', '丑'], '水', '北方'],
];
/** 相刑：三刑与自刑。 */
const XIANG_XING = [
  [['寅', '巳', '申'], '无恩之刑'],
  [['丑', '戌', '未'], '持势之刑'],
  [['子', '卯'], '无礼之刑'],
];
const SELF_XING = ['辰', '午', '酉', '亥'];

/** 收集命局四柱（跳过未知时柱）的干支与位置标签。 */
function collectPillars(pillars) {
  const out = [];
  for (const key of ['year', 'month', 'day', 'hour']) {
    const pillar = pillars[key];
    if (pillar === undefined) continue;
    if (pillar.gan === '未知' || pillar.zhi === '未知') continue;
    out.push({ key, label: `${PILLAR_LABELS[['year', 'month', 'day', 'hour'].indexOf(key)]}柱`, gan: pillar.gan, zhi: pillar.zhi });
  }
  return out;
}

/**
 * 扫描命局中的干支关系（冲、合、害、刑、三合、三会、天干五合）。
 *
 * 全部关系按「哪些柱之间存在」列出，不做力量强弱判定——那是格局取用的工作。
 * @param {object} pillars - {@link import('./engine.js').compute} 的 `pillars`。
 * @returns {{branch: object[], stem: object[]}} 地支关系与天干关系。
 */
export function ganZhiRelations(pillars) {
  const items = collectPillars(pillars);
  const branch = [];
  const stem = [];

  const pairs = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) pairs.push([items[i], items[j]]);
  }

  /** 两字关系命中判定（顺序无关）。 */
  const pairHit = (a, b, p, q) => (p === a && q === b) || (p === b && q === a);

  for (const [x, y] of pairs) {
    if (LIU_CHONG.some(([p, q]) => pairHit(x.zhi, y.zhi, p, q))) {
      branch.push({ kind: '六冲', detail: `${x.label}${x.zhi} ↔ ${y.label}${y.zhi}`, pillars: [x.label, y.label] });
    }
    for (const [pair, hua] of LIU_HE) {
      if (pairHit(x.zhi, y.zhi, pair[0], pair[1])) {
        branch.push({ kind: '六合', detail: `${x.label}${x.zhi} ↔ ${y.label}${y.zhi}，合化${hua}`, pillars: [x.label, y.label] });
      }
    }
    if (XIANG_HAI.some(([p, q]) => pairHit(x.zhi, y.zhi, p, q))) {
      branch.push({ kind: '相害', detail: `${x.label}${x.zhi} ↔ ${y.label}${y.zhi}`, pillars: [x.label, y.label] });
    }
    if (x.zhi === y.zhi && SELF_XING.includes(x.zhi)) {
      branch.push({ kind: '自刑', detail: `${x.label}${x.zhi} ↔ ${y.label}${y.zhi}`, pillars: [x.label, y.label] });
    }
    for (const [pair, hua] of GAN_HE) {
      if (pairHit(x.gan, y.gan, pair[0], pair[1])) {
        stem.push({ kind: '天干五合', detail: `${x.label}${x.gan} ↔ ${y.label}${y.gan}，合化${hua}`, pillars: [x.label, y.label] });
      }
    }
  }

  /** 命局中是否三字全见。 */
  const trioHit = (trio) => {
    const hit = trio.map((z) => items.find((it) => it.zhi === z)).filter(Boolean);
    return hit.length === 3 ? hit : null;
  };

  for (const [trio, hua] of SAN_HE) {
    const hit = trioHit(trio);
    if (hit !== null) {
      branch.push({ kind: '三合局', detail: `${trio.join('')}合${hua}局`, pillars: hit.map((h) => h.label) });
    }
  }
  for (const [trio, hua, direction] of SAN_HUI) {
    const hit = trioHit(trio);
    if (hit !== null) {
      branch.push({ kind: '三会局', detail: `${trio.join('')}会${direction}${hua}局`, pillars: hit.map((h) => h.label) });
    }
  }
  // 相刑：两字（子卯）逐对判，三字（寅巳申、丑戌未）需全见
  for (const [set, name] of XIANG_XING) {
    if (set.length === 2) {
      for (const [x, y] of pairs) {
        if (pairHit(x.zhi, y.zhi, set[0], set[1])) {
          branch.push({ kind: '相刑', detail: `${x.label}${x.zhi} ↔ ${y.label}${y.zhi}（${name}）`, pillars: [x.label, y.label] });
        }
      }
      continue;
    }
    const hit = trioHit(set);
    if (hit !== null) {
      branch.push({ kind: '三刑', detail: `${set.join('')}—${name}`, pillars: hit.map((h) => h.label) });
    }
  }

  return { branch, stem };
}

/**
 * 四柱宫位（六亲 / 年龄段），供断事定位。
 */
export const PALACE_INFO = [
  { pillar: '年柱', represents: '祖上、父母、家族背景', ages: '1-16岁' },
  { pillar: '月柱', represents: '父母、兄弟、工作环境', ages: '17-32岁' },
  { pillar: '日柱', represents: '自己（日干）、配偶（日支）', ages: '33-48岁' },
  { pillar: '时柱', represents: '子女、晚年、事业成果', ages: '49岁以后' },
];
