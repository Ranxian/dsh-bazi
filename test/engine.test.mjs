/**
 * 排盘内核回归测试：把 references 里的黄金用例与边界规则固化成断言，
 * 不依赖 Python 参考实现就能跑（交叉验证见 scripts/golden.mjs）。
 *
 * 用例来源：原 skill 的 scripts/test_pai_pan.py，逐条对应。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compute,
  formatReport,
  computeShensha,
  hourToShichen,
  normalizeShichen,
  kongwangZhi,
  jdn,
  jdnToYmd,
  lunarToSolar,
  solarToLunar,
  shishenOf,
  GAN,
  ZHI,
  formatCanggan,
  NAYIN,
  nayinOf,
  xunOf,
  taiyuanOf,
  taixiOf,
  minggongOf,
  shengongOf,
  liuyueRows,
  liunianGz,
  equationOfTimeMinutes,
  trueSolarCorrection,
  addYearsMonths,
  jdFromBeijing,
  solarTermUtcJd,
  beijingFromJd,
} from '../lib/engine.js';
import { changshengOf, ganZhiRelations, wuxingStats } from '../lib/tables.js';

/** 从报告里抠出四柱。 */
function pillarsOf(result) {
  return [result.pillars.year, result.pillars.month, result.pillars.day, result.pillars.hour]
    .map((p) => `${p.gan}${p.zhi}`);
}

// ---------------------------------------------------------------------------
// 黄金用例与日界
// ---------------------------------------------------------------------------

test('黄金用例：1990-05-15 午时男 → 庚午/辛巳/庚辰/壬午，顺排', () => {
  const result = compute({ solar: { y: 1990, m: 5, d: 15 }, shichen: '午', sex: '男' });
  assert.deepEqual(pillarsOf(result), ['庚午', '辛巳', '庚辰', '壬午']);
  assert.equal(result.forward, true);
  assert.equal(result.qiyun_text, '7岁3个月');
  assert.equal(result.jie_name, '立夏');
  assert.deepEqual(result.warnings, []);
});

test('立春前：1990-02-03 10:00 年柱己巳而不是庚午', () => {
  const result = compute({ solar: { y: 1990, m: 2, d: 3 }, hour: 10, minute: 0, sex: '男' });
  assert.equal(pillarsOf(result)[0], '己巳');
});

// 旧版用 Meeus 25 章三中心差简式，黄经差 10″ 上下，换成时刻就是偏早 5–8 分钟。
// 立春偏早 6 分 42 秒，足以把交节前几分钟出生的人判进下一年。这条守住那个回归。
test('节气时刻与历书对得上：2024 立春 16:26:53', () => {
  const anchors = [
    // [年, 黄经, 历书北京时]
    [2024, 315, [2024, 2, 4, 16, 26, 53]], // 立春
    [2024, 0, [2024, 3, 20, 11, 6, 12]], // 春分
    [2024, 180, [2024, 9, 22, 20, 43, 27]], // 秋分
    [2024, 270, [2024, 12, 21, 17, 20, 34]], // 冬至
    [2020, 315, [2020, 2, 4, 17, 3, 12]], // 立春
  ];
  const fmt = (t) => `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')} `
    + `${String(t.h).padStart(2, '0')}:${String(t.mi).padStart(2, '0')}:${String(t.s).padStart(2, '0')}`;
  for (const [year, lon, [y, m, d, h, mi, s]] of anchors) {
    const got = beijingFromJd(solarTermUtcJd(year, lon));
    const diff = Math.abs(Date.UTC(got.y, got.m - 1, got.d, got.h, got.mi, got.s) - Date.UTC(y, m - 1, d, h, mi, s)) / 1000;
    assert.ok(diff <= 30, `${year} 黄经 ${lon}° 应约 ${y}-${m}-${d} ${h}:${mi}:${s}，实得 ${fmt(got)}，差 ${diff} 秒`);
  }
});

test('夜子时 23:30 用次日日柱，时支仍为子', () => {
  const result = compute({ solar: { y: 1990, m: 5, d: 15 }, hour: 23, minute: 30, sex: '男' });
  assert.equal(pillarsOf(result)[2], '辛巳');
  assert.equal(result.pillars.hour.zhi, '子');
  assert.equal(result.zishi, '夜子时');
});

test('早子时 00:30 保持当日日柱', () => {
  const result = compute({ solar: { y: 1990, m: 5, d: 15 }, hour: 0, minute: 30, sex: '男' });
  assert.equal(pillarsOf(result)[2], '庚辰');
  assert.equal(result.pillars.hour.zhi, '子');
  assert.equal(result.zishi, '早子时');
});

test('边界整点：23:00 算夜子时，00:00 算早子时', () => {
  assert.equal(compute({ solar: { y: 1990, m: 5, d: 15 }, hour: 23, minute: 0, sex: '男' }).zishi, '夜子时');
  assert.equal(compute({ solar: { y: 1990, m: 5, d: 15 }, hour: 0, minute: 0, sex: '男' }).zishi, '早子时');
});

// ---------------------------------------------------------------------------
// 大运顺逆
// ---------------------------------------------------------------------------

test('阴年男 1991-06-15 逆排', () => {
  const result = compute({ solar: { y: 1991, m: 6, d: 15 }, shichen: '午', sex: '男' });
  assert.equal(pillarsOf(result)[0], '辛未');
  assert.equal(result.forward, false);
});

test('阳年女 1990-05-15 逆排', () => {
  const result = compute({ solar: { y: 1990, m: 5, d: 15 }, shichen: '午', sex: '女' });
  assert.equal(pillarsOf(result)[0], '庚午');
  assert.equal(result.forward, false);
});

test('大运从月柱下一柱起排，月柱本身是起运前小运', () => {
  const result = compute({ solar: { y: 1990, m: 5, d: 15 }, shichen: '午', sex: '男' });
  const rows = result.dayun_rows;
  assert.equal(rows[0].seq, '起运前');
  assert.equal(rows[0].gz, '辛巳（小运）');
  assert.equal(rows[1].gz, '壬午', '月柱辛巳顺推一位');
  assert.equal(rows[1].ages, '7-16岁');
  assert.equal(rows[8].gz, '己丑');
});

test('逆排时大运从月柱上一柱起', () => {
  const result = compute({ solar: { y: 1990, m: 5, d: 15 }, shichen: '午', sex: '女' });
  assert.equal(result.dayun_rows[1].gz, '庚辰', '月柱辛巳逆推一位');
});

// ---------------------------------------------------------------------------
// 时辰未知 / 农历
// ---------------------------------------------------------------------------

test('无时辰：时柱未知，年月日柱完整，警告「时辰未知」', () => {
  const result = compute({ solar: { y: 1990, m: 5, d: 15 }, sex: '男' });
  const p = pillarsOf(result);
  assert.deepEqual(p.slice(0, 3), ['庚午', '辛巳', '庚辰']);
  assert.equal(p[3], '未知未知');
  assert.equal(result.shichen_text, '未知');
  assert.equal(result.zishi, '无');
  assert.ok(result.warnings.includes('时辰未知'));
  assert.equal(result.hour_unknown, true);
});

test('农历非闰：1990-04-21 与阳历 1990-05-15 四柱一致', () => {
  const fromLunar = compute({ lunar: { y: 1990, m: 4, d: 21 }, shichen: '午', sex: '男' });
  const fromSolar = compute({ solar: { y: 1990, m: 5, d: 15 }, shichen: '午', sex: '男' });
  assert.deepEqual(pillarsOf(fromLunar), pillarsOf(fromSolar));
  assert.equal(fromLunar.lunar_text, '1990年四月廿一');
});

test('农历闰月：1990 年闰五月可正反换算', () => {
  const nonLeap = lunarToSolar(1990, 5, 1, false);
  const leap = lunarToSolar(1990, 5, 1, true);
  assert.notDeepEqual(nonLeap, leap);
  assert.deepEqual(solarToLunar(leap.y, leap.m, leap.d), { year: 1990, month: 5, day: 1, leap: true });
  assert.deepEqual(solarToLunar(nonLeap.y, nonLeap.m, nonLeap.d), { year: 1990, month: 5, day: 1, leap: false });
});

test('不存在的农历日期会抛错', () => {
  // 1991 年无闰五月；1990 年闰五月只有 29 天
  assert.throws(() => lunarToSolar(1991, 5, 1, true), /没有闰五月/);
  assert.throws(() => lunarToSolar(1990, 5, 31), /只有 30 天/);
  assert.throws(() => lunarToSolar(1990, 5, 30, true), /只有 29 天/);
});

// ---------------------------------------------------------------------------
// 节气与警告
// ---------------------------------------------------------------------------

test('节气交界 24 小时内给出警告', () => {
  // 1990 立夏约在 5 月 5-6 日；取紧邻时刻
  const result = compute({ solar: { y: 1993, m: 6, d: 6 }, hour: 6, minute: 0, sex: '男' });
  assert.ok(
    result.warnings.includes('节气交界') || result.warnings.includes('立春前后'),
    `应给出临界警告，实得 ${JSON.stringify(result.warnings)}`,
  );
});

test('出生地在时辰边界 15 分钟内给出真太阳时提示', () => {
  // 时辰整点边界为 01:00/03:00/…；12:55 距 13:00 仅 5 分钟
  const near = compute({ solar: { y: 1990, m: 5, d: 15 }, hour: 12, minute: 55, sex: '男', place: '辽宁省丹东市' });
  assert.ok(near.warnings.includes('校正后可能跨时辰'));
  const far = compute({ solar: { y: 1990, m: 5, d: 15 }, hour: 11, minute: 30, sex: '男', place: '辽宁省丹东市' });
  assert.ok(!far.warnings.includes('校正后可能跨时辰'));
  // 没给出生地就不提示
  const noPlace = compute({ solar: { y: 1990, m: 5, d: 15 }, hour: 12, minute: 55, sex: '男' });
  assert.ok(!noPlace.warnings.includes('校正后可能跨时辰'));
});

test('已故年份：流年只推到该年', () => {
  const result = compute({ solar: { y: 1990, m: 5, d: 15 }, hour: 12, sex: '男', deceasedYear: 2010 });
  assert.equal(result.current_year, 2010);
  assert.equal(result.liunian_years.at(-1), 2010);
  assert.ok(!result.liunian_years.includes(2011));
});

// ---------------------------------------------------------------------------
// 神煞
// ---------------------------------------------------------------------------

test('黄金命例的神煞命中与未命中', () => {
  const result = compute({ solar: { y: 1990, m: 5, d: 15 }, shichen: '午', sex: '男' });
  const text = result.shensha_lines.join('\n');
  assert.match(text, /天乙贵人/);
  assert.match(text, /将星/);
  assert.ok(!text.includes('驿马'), '地支无申，不应有驿马');
  assert.ok(!text.includes('桃花'), '地支无卯，不应有桃花');
  // 与 Python 参考实现的输出逐条一致
  assert.deepEqual(result.shensha_lines, [
    '- 天乙贵人 — 见于年支、时支 — 年干/日干查地支',
    '- 天德 — 见于月干 — 月支查天干',
    '- 月德 — 见于年干、日干 — 月支三合',
    '- 学堂 — 见于月支 — 日干长生',
    '- 将星 — 见于年支、时支 — 年支/日支三合',
    '- 华盖 — 见于日支 — 年支/日支',
    '- 天医 — 见于日支 — 月支前一位',
    '- 劫煞 — 见于月支 — 年支/日支',
    '- 灾煞 — 见于年支、时支 — 年支/日支',
    '- 亡神 — 见于月支 — 年支/日支',
    '- 寡宿 — 见于日支 — 年支',
  ]);
});

test('神煞表驱动：日干甲见丑为天乙；日柱甲子旬空戌亥', () => {
  const text = computeShensha('乙', '亥', '戊', '丑', '甲', '寅', null, null, '男').join('\n');
  assert.match(text, /天乙贵人/);

  const kong = computeShensha('甲', '戌', '乙', '亥', '甲', '子', null, null, '男').join('\n');
  assert.match(kong, /空亡/);
  assert.deepEqual(kongwangZhi('甲', '子'), ['戌', '亥']);
  assert.deepEqual(kongwangZhi('甲', '戌'), ['申', '酉']);
});

test('时柱未知时不参与神煞（时支/时干都不查）', () => {
  const known = compute({ solar: { y: 1990, m: 5, d: 15 }, shichen: '午', sex: '男' });
  const unknown = compute({ solar: { y: 1990, m: 5, d: 15 }, sex: '男' });
  assert.match(known.shensha_lines.join('\n'), /天乙贵人 — 见于年支、时支/);
  assert.match(unknown.shensha_lines.join('\n'), /天乙贵人 — 见于年支 —/);
});

// ---------------------------------------------------------------------------
// 干支工具
// ---------------------------------------------------------------------------

test('jdn 与公历互转自洽', () => {
  assert.equal(jdn(1990, 5, 15) % 60, (jdn(1990, 5, 15) + 49 - 49 + 60) % 60);
  for (const [y, m, d] of [[1990, 5, 15], [2000, 1, 1], [1901, 1, 15], [2099, 12, 31]]) {
    assert.deepEqual(jdnToYmd(jdn(y, m, d)), { y, m, d });
  }
});

test('hourToShichen 覆盖十二时辰边界', () => {
  const cases = [
    [23, 0, '子'], [0, 30, '子'], [1, 0, '丑'], [3, 0, '寅'], [5, 0, '卯'],
    [7, 0, '辰'], [9, 0, '巳'], [11, 0, '午'], [13, 0, '未'], [15, 0, '申'],
    [17, 0, '酉'], [19, 0, '戌'], [21, 0, '亥'], [22, 59, '亥'],
  ];
  for (const [h, mi, expected] of cases) {
    assert.equal(hourToShichen(h, mi), expected, `${h}:${mi} 应为 ${expected}`);
  }
});

test('十神：日干那一格为破折号，四组关系正确', () => {
  assert.equal(shishenOf(GAN.indexOf('庚'), null), '—');
  // 庚为日主：庚见庚=比肩，见辛=劫财，见壬=食神，见甲=偏财，见丙=偏官(七杀)，见戊=偏印
  assert.equal(shishenOf(GAN.indexOf('庚'), GAN.indexOf('庚')), '比肩');
  assert.equal(shishenOf(GAN.indexOf('庚'), GAN.indexOf('辛')), '劫财');
  assert.equal(shishenOf(GAN.indexOf('庚'), GAN.indexOf('壬')), '食神');
  assert.equal(shishenOf(GAN.indexOf('庚'), GAN.indexOf('甲')), '偏财');
  assert.equal(shishenOf(GAN.indexOf('庚'), GAN.indexOf('丙')), '偏官');
  assert.equal(shishenOf(GAN.indexOf('庚'), GAN.indexOf('戊')), '偏印');
  assert.equal(shishenOf(GAN.indexOf('庚'), GAN.indexOf('癸')), '伤官');
  assert.equal(shishenOf(GAN.indexOf('庚'), GAN.indexOf('乙')), '正财');
  assert.equal(shishenOf(GAN.indexOf('庚'), GAN.indexOf('丁')), '正官');
  assert.equal(shishenOf(GAN.indexOf('庚'), GAN.indexOf('己')), '正印');
});

test('藏干串与参考表一致', () => {
  assert.equal(formatCanggan('子'), '癸水');
  assert.equal(formatCanggan('午'), '丁火、己土');
  assert.equal(formatCanggan('申'), '庚金、壬水、戊土');
});

// ---------------------------------------------------------------------------
// 分析表
// ---------------------------------------------------------------------------

test('五行统计：分值归一、占比合计 100%、缺五行被标出', () => {
  const result = compute({ solar: { y: 1990, m: 5, d: 15 }, shichen: '午', sex: '男' });
  const stats = wuxingStats(result.pillars);
  const sum = stats.score['木'] + stats.score['火'] + stats.score['土'] + stats.score['金'] + stats.score['水'];
  assert.ok(Math.abs(sum - stats.total) < 1e-9);
  const shareSum = ['木', '火', '土', '金', '水'].reduce((acc, wx) => acc + stats.share[wx], 0);
  assert.ok(Math.abs(shareSum - 100) < 0.5, `占比合计应接近 100，实得 ${shareSum}`);
  assert.equal(stats.pillarCount, 4);
  assert.equal(stats.strongest, '金');
});

test('五行统计：时柱未知只统计三柱', () => {
  const result = compute({ solar: { y: 1990, m: 5, d: 15 }, sex: '男' });
  const stats = wuxingStats(result.pillars);
  assert.equal(stats.pillarCount, 3);
  assert.equal(stats.stems.length, 3, '只应统计年月日三干');
  // branches 每项对应一个藏干，故按柱去重后应恰为三柱
  assert.equal(new Set(stats.branches.map((b) => b.pillar)).size, 3, '只应统计年月日三支的藏干');
  assert.ok(!stats.branches.some((b) => b.pillar === 'hour'), '时支不应参与统计');
});

test('十二长生：阳干顺行、阴干逆行', () => {
  // 甲长生亥，顺行：亥长生、子沐浴、丑冠带、寅临官、卯帝旺
  assert.equal(changshengOf('甲', '亥'), '长生');
  assert.equal(changshengOf('甲', '子'), '沐浴');
  assert.equal(changshengOf('甲', '卯'), '帝旺');
  assert.equal(changshengOf('甲', '未'), '墓');
  // 乙长生午，逆行：午长生、巳沐浴、辰冠带
  assert.equal(changshengOf('乙', '午'), '长生');
  assert.equal(changshengOf('乙', '巳'), '沐浴');
  assert.equal(changshengOf('乙', '辰'), '冠带');
  // 戊从丙、己从丁
  assert.equal(changshengOf('戊', '寅'), changshengOf('丙', '寅'));
  assert.equal(changshengOf('己', '酉'), changshengOf('丁', '酉'));
});

test('干支关系：黄金命例检出年时支自刑（午午）', () => {
  const result = compute({ solar: { y: 1990, m: 5, d: 15 }, shichen: '午', sex: '男' });
  const relations = ganZhiRelations(result.pillars);
  const selfXing = relations.branch.filter((r) => r.kind === '自刑');
  assert.equal(selfXing.length, 1);
  assert.match(selfXing[0].detail, /年柱午 ↔ 时柱午/);
});

test('干支关系：六冲/六合/三合/三会都能检出', () => {
  const make = (year, month, day, hour) => ({
    year: { gan: '甲', zhi: year, shishen: '—', canggan: '' },
    month: { gan: '甲', zhi: month, shishen: '—', canggan: '' },
    day: { gan: '甲', zhi: day, shishen: '—', canggan: '' },
    hour: { gan: '甲', zhi: hour, shishen: '—', canggan: '' },
  });
  const chong = ganZhiRelations(make('子', '午', '寅', '申'));
  assert.equal(chong.branch.filter((r) => r.kind === '六冲').length, 2, '子午冲 + 寅申冲');

  const sanhe = ganZhiRelations(make('申', '子', '辰', '丑'));
  assert.ok(sanhe.branch.some((r) => r.kind === '三合局' && r.detail.includes('水')), '申子辰合水局');

  const sanhui = ganZhiRelations(make('寅', '卯', '辰', '子'));
  assert.ok(sanhui.branch.some((r) => r.kind === '三会局' && r.detail.includes('东方木')), '寅卯辰会东方木');

  const liuhe = ganZhiRelations(make('子', '丑', '戌', '卯'));
  assert.ok(liuhe.branch.some((r) => r.kind === '六合' && r.detail.includes('合化土')), '子丑合化土');

  const stemHe = ganZhiRelations({
    year: { gan: '甲', zhi: '子', shishen: '—', canggan: '' },
    month: { gan: '己', zhi: '丑', shishen: '—', canggan: '' },
    day: { gan: '丙', zhi: '寅', shishen: '—', canggan: '' },
    hour: { gan: '辛', zhi: '卯', shishen: '—', canggan: '' },
  });
  assert.equal(stemHe.stem.length, 2, '甲己合 + 丙辛合');
});

test('干支关系：相害与相刑（回归：平铺两字表曾整体失效）', () => {
  const make = (year, month, day, hour) => ({
    year: { gan: '甲', zhi: year, shishen: '—', canggan: '' },
    month: { gan: '甲', zhi: month, shishen: '—', canggan: '' },
    day: { gan: '甲', zhi: day, shishen: '—', canggan: '' },
    hour: { gan: '甲', zhi: hour, shishen: '—', canggan: '' },
  });

  // 六冲（平铺表）
  const chong = ganZhiRelations(make('子', '午', '寅', '申'));
  assert.equal(chong.branch.filter((r) => r.kind === '六冲').length, 2, '子午冲 + 寅申冲');

  // 相害（平铺表）：酉戌害、子未害
  const hai = ganZhiRelations(make('酉', '戌', '子', '未'));
  const haiHits = hai.branch.filter((r) => r.kind === '相害');
  assert.equal(haiHits.length, 2, `酉戌害 + 子未害，实得 ${JSON.stringify(haiHits)}`);
  assert.ok(haiHits.some((r) => /酉 ↔ .*戌/.test(r.detail)));

  // 无冲无害时不误报（子丑寅卯仅子丑六合）
  const none = ganZhiRelations(make('子', '丑', '寅', '卯'));
  assert.equal(none.branch.filter((r) => r.kind === '相害').length, 0, '子丑寅卯无相害');
  assert.equal(none.branch.filter((r) => r.kind === '六冲').length, 0, '子丑寅卯无六冲');
  assert.equal(none.branch.filter((r) => r.kind === '六合').length, 1, '仅子丑六合');

  // 相刑：子卯无礼之刑（两字表）
  const xing = ganZhiRelations(make('子', '卯', '寅', '戌'));
  assert.ok(xing.branch.some((r) => r.kind === '相刑' && r.detail.includes('无礼之刑')), '子卯相刑');
  // 三刑：寅巳申全见
  const sanXing = ganZhiRelations(make('寅', '巳', '申', '丑'));
  assert.ok(sanXing.branch.some((r) => r.kind === '三刑' && r.detail.includes('无恩之刑')), '寅巳申三刑');
  // 三刑不全（只两字）不成立
  const partial = ganZhiRelations(make('寅', '巳', '子', '丑'));
  assert.equal(partial.branch.filter((r) => r.kind === '三刑').length, 0, '寅巳不全，不成三刑');
});

test('时辰写法归一：地支、带「时」、区间都能接受', () => {
  const base = { solar: { y: 1990, m: 5, d: 15 }, sex: '男' };
  const expected = '壬午';
  for (const shichen of ['午', '午时', ' 午 ', '11:00-13:00', '11:00–13:00', '11:00~13:00']) {
    const result = compute({ ...base, shichen });
    assert.equal(`${result.pillars.hour.gan}${result.pillars.hour.zhi}`, expected, `shichen=${shichen}`);
    assert.equal(result.shichen_text, '午', `shichen=${shichen} 应归一到地支`);
  }
  // 子时区间跨日：23:00-01:00 取起点 23:00
  const zi = compute({ ...base, shichen: '23:00-01:00' });
  assert.equal(zi.shichen_text, '子');
  assert.equal(`${zi.pillars.hour.gan}${zi.pillars.hour.zhi}`, '丙子');
  // 与直接给钟点同盘
  const byClock = compute({ ...base, hour: 12, minute: 0 });
  assert.deepEqual(pillarsOf(byClock), pillarsOf(compute({ ...base, shichen: '午时' })));
});

test('无法识别的时辰给出可读错误，而不是 TypeError', () => {
  const base = { solar: { y: 1990, m: 5, d: 15 }, sex: '男' };
  for (const shichen of ['不存在的', '25:00-27:00', '十三时', '午 时 分']) {
    assert.throws(
      () => compute({ ...base, shichen }),
      (error) => error instanceof RangeError && /无法识别的时辰/.test(error.message),
      `shichen=${JSON.stringify(shichen)} 应给出 RangeError`,
    );
  }
  // 空串等同未给：走六字路径而不是报错
  const blank = compute({ ...base, shichen: '' });
  assert.equal(blank.pillars.hour.gan, '未知');
  assert.ok(blank.warnings.includes('时辰未知'));
});

test('normalizeShichen 对非字符串与空值返回 null', () => {
  for (const bad of [null, undefined, 12, {}, [], '']) {
    assert.equal(normalizeShichen(bad), null, `${JSON.stringify(bad)} 应为 null`);
  }
  assert.equal(normalizeShichen('午'), '午');
  assert.equal(normalizeShichen('亥时'), '亥');
});

// ---------------------------------------------------------------------------
// 报告格式（与 Python 原实现 stdout 同形）
// ---------------------------------------------------------------------------

test('formatReport 结构符合原 skill 的输出契约', () => {
  const report = formatReport(compute({ solar: { y: 1990, m: 5, d: 15 }, shichen: '午', sex: '男' }));
  for (const heading of ['## 输入', '## 四柱', '## 大运', '## 流年', '## 神煞', '## 警告']) {
    assert.ok(report.includes(heading), `报告缺少 ${heading}`);
  }
  assert.match(report, /- 阳历：1990-05-15/);
  assert.match(report, /- 农历：1990年四月廿一/);
  assert.match(report, /- 时辰：午$/m);
  assert.match(report, /\| 天干 \| 庚 \| 辛 \| 庚 \| 壬 \|/);
  assert.match(report, /\| 十神 \| 比肩 \| 劫财 \| — \| 食神 \|/);
  assert.match(report, /- 当前：\d{4}年/);
  assert.match(report, /## 警告\n- 无$/m);
});

test('ZHI 顺序与六十甲子一致', () => {
  assert.equal(ZHI.length, 12);
  for (let i = 0; i < 60; i += 1) {
    assert.equal(GAN[i % 10] + ZHI[i % 12], (() => {
      const index = i % 60;
      return GAN[index % 10] + ZHI[index % 12];
    })());
  }
});

// ---------------------------------------------------------------------------
// 命盘附属：纳音 / 旬空 / 四宫位 / 十二长生
// ---------------------------------------------------------------------------

test('纳音表覆盖六十甲子，且相邻两干支同名', () => {
  assert.equal(NAYIN.size, 60);
  assert.equal(nayinOf('甲', '子'), '海中金');
  assert.equal(nayinOf('乙', '丑'), '海中金');
  assert.equal(nayinOf('壬', '戌'), '大海水');
  assert.equal(nayinOf('癸', '亥'), '大海水');
  assert.equal(nayinOf('庚', '午'), '路旁土');
  assert.equal(nayinOf('甲', '丑'), '—', '非六十甲子内的组合应给占位符');
  for (let i = 0; i < 60; i += 2) {
    const a = GAN[i % 10] + ZHI[i % 12];
    const b = GAN[(i + 1) % 10] + ZHI[(i + 1) % 12];
    assert.equal(nayinOf(a[0], a[1]), nayinOf(b[0], b[1]), `${a} 与 ${b} 应同一纳音`);
  }
});

test('旬与旬空：甲子旬戌亥，甲戌旬申酉', () => {
  assert.equal(xunOf('甲', '子'), '甲子');
  assert.equal(xunOf('乙', '丑'), '甲子');
  assert.equal(xunOf('甲', '戌'), '甲戌');
  assert.equal(xunOf('庚', '辰'), '甲戌');
  assert.deepEqual(kongwangZhi('甲', '子'), ['戌', '亥']);
  assert.deepEqual(kongwangZhi('庚', '辰'), ['申', '酉']);
  assert.equal(xunOf('nope', '子'), '—');
});

test('四宫位：1990-05-15 午时 → 胎元壬申 / 胎息乙酉 / 命宫壬午 / 身宫戊子', () => {
  assert.equal(taiyuanOf('辛', '巳'), '壬申');
  assert.equal(taixiOf('庚', '辰'), '乙酉');
  assert.equal(minggongOf('庚', '巳', '午'), '壬午');
  assert.equal(shengongOf('庚', '巳', '午'), '戊子');
  // 非法输入给占位符而不是抛错
  assert.equal(taiyuanOf('X', '巳'), '—');
  assert.equal(minggongOf('庚', '巳', 'X'), '—');
});

test('十二长生：阳干顺行、阴干逆行，戊从丙、己从丁', () => {
  assert.equal(changshengOf('甲', '亥'), '长生');
  assert.equal(changshengOf('甲', '子'), '沐浴');
  assert.equal(changshengOf('乙', '午'), '长生');
  assert.equal(changshengOf('乙', '巳'), '沐浴', '阴干逆行');
  assert.equal(changshengOf('戊', '寅'), '长生');
  assert.equal(changshengOf('己', '酉'), '长生');
  assert.equal(changshengOf('庚', '午'), '沐浴');
  assert.equal(changshengOf('X', '子'), '—');
});

test('命盘逐柱带齐纳音、星运、自坐、旬与旬空', () => {
  const r = compute({ solar: { y: 1990, m: 5, d: 15 }, shichen: '午', sex: '男' });
  assert.deepEqual(
    ['year', 'month', 'day', 'hour'].map((k) => r.pillars[k].nayin),
    ['路旁土', '白蜡金', '白蜡金', '杨柳木'],
  );
  assert.deepEqual(
    ['year', 'month', 'day', 'hour'].map((k) => r.pillars[k].dishi),
    ['沐浴', '长生', '养', '沐浴'],
  );
  assert.deepEqual(
    ['year', 'month', 'day', 'hour'].map((k) => r.pillars[k].zizuo),
    ['沐浴', '死', '养', '胎'],
  );
  assert.deepEqual(
    ['year', 'month', 'day', 'hour'].map((k) => r.pillars[k].xun),
    ['甲子', '甲戌', '甲戌', '甲戌'],
  );
  assert.deepEqual(
    ['year', 'month', 'day', 'hour'].map((k) => r.pillars[k].kongwang),
    ['戌亥', '申酉', '申酉', '申酉'],
  );
  assert.deepEqual(r.palaces, {
    taiyuan: '壬申', taixi: '乙酉', minggong: '壬午', shengong: '戊子',
  });
});

test('时柱未知时，命宫与身宫给「未知」而不是硬凑', () => {
  const r = compute({ solar: { y: 1990, m: 5, d: 15 }, sex: '男' });
  assert.equal(r.hour_unknown, true);
  assert.equal(r.palaces.minggong, '未知');
  assert.equal(r.palaces.shengong, '未知');
  assert.equal(r.palaces.taiyuan, '壬申', '胎元只依赖月柱，仍应给出');
  assert.equal(r.palaces.taixi, '乙酉', '胎息只依赖日柱，仍应给出');
  assert.equal(r.pillars.hour.nayin, '未知');
});

// ---------------------------------------------------------------------------
// 流月 / 真太阳时 / 起运回执
// ---------------------------------------------------------------------------

test('流月：甲辰年十二节气月，五虎遁起丙寅', () => {
  const rows = liuyueRows(2024);
  assert.equal(rows.length, 12);
  assert.equal(liunianGz(2024), '甲辰');
  assert.deepEqual(rows.map((r) => r.gz), [
    '丙寅', '丁卯', '戊辰', '己巳', '庚午', '辛未',
    '壬申', '癸酉', '甲戌', '乙亥', '丙子', '丁丑',
  ]);
  assert.equal(rows[0].name, '立春');
  assert.equal(rows[0].start, '2024-02-04');
  assert.equal(rows[11].name, '小寒');
  assert.equal(rows[11].start, '2025-01-05', '丑月属次年初的小寒');
});

test('五虎遁：年干与寅月干的对应关系', () => {
  const cases = [
    [2024, '甲', '丙寅'], [2025, '乙', '戊寅'], [2026, '丙', '庚寅'],
    [2027, '丁', '壬寅'], [2028, '戊', '甲寅'], [2029, '己', '丙寅'],
  ];
  for (const [year, gan, expect] of cases) {
    assert.equal(liunianGz(year)[0], gan, `${year} 年干应为 ${gan}`);
    assert.equal(liuyueRows(year)[0].gz, expect);
  }
});

test('均时差：2 月中旬约 -14 分、5 月中旬约 +4 分、11 月初约 +16 分', () => {
  assert.ok(equationOfTimeMinutes(2024, 2, 11) < -13, '2 月中旬均时差应在 -14 分附近');
  assert.ok(equationOfTimeMinutes(2024, 5, 15) > 3, '5 月中旬均时差应在 +4 分附近');
  assert.ok(equationOfTimeMinutes(2024, 11, 3) > 15, '11 月初均时差应在 +16 分附近');
  for (let m = 1; m <= 12; m += 1) {
    const v = equationOfTimeMinutes(2024, m, 15);
    assert.ok(v > -17 && v < 17, `${m} 月均时差应在 ±17 分内，实得 ${v}`);
  }
  // 9 月初与冬至后过零点。旧 Spencer 近似式在这里分别偏 +0.96 / -1.32 分钟，
  // 刚好够把时辰判错，所以单独立断言。
  assert.ok(Math.abs(equationOfTimeMinutes(2024, 9, 1)) < 0.2, '9 月初均时差应过零');
  assert.ok(Math.abs(equationOfTimeMinutes(2024, 12, 25)) < 0.2, '冬至后均时差应过零');
});

test('真太阳时：经度差按每度 4 分钟，西移为负', () => {
  const bei = trueSolarCorrection({ y: 1990, m: 5, d: 15 }, 12, 0, 116.4);
  assert.equal(bei.longitudeMinutes, -14.4);
  assert.equal(bei.crossedDay, false);
  assert.match(bei.corrected, /^1990-05-15 11:4\d$/);

  const shanghai = trueSolarCorrection({ y: 1990, m: 5, d: 15 }, 12, 0, 121.5);
  assert.equal(shanghai.longitudeMinutes, 6);

  const urumqi = trueSolarCorrection({ y: 1990, m: 5, d: 15 }, 12, 0, 87.6);
  assert.equal(urumqi.longitudeMinutes, -129.6);
});

test('真太阳时跨日：乌鲁木齐 00:10 校正后回到前一日', () => {
  const r = trueSolarCorrection({ y: 1990, m: 5, d: 15 }, 0, 10, 87.6);
  assert.equal(r.crossedDay, true);
  assert.match(r.corrected, /^1990-05-14 2\d:\d\d$/);
});

test('给经度后排盘用校正时刻，并标出跨日警告', () => {
  const plain = compute({ solar: { y: 1990, m: 5, d: 15 }, hour: 23, minute: 30, sex: '男' });
  const corrected = compute({
    solar: { y: 1990, m: 5, d: 15 }, hour: 23, minute: 30, sex: '男', longitude: 87.6,
  });
  assert.equal(plain.tst, null, '不给经度不做校正');
  assert.notEqual(corrected.tst, null);
  // 乌鲁木齐 23:30 真太阳时约 21:24，仍属亥时；未校正时是晚子时归次日
  assert.ok(corrected.pillars.day.gan + corrected.pillars.day.zhi
    !== plain.pillars.day.gan + plain.pillars.day.zhi);
  assert.equal(corrected.shichen_text.startsWith('亥'), true);
  assert.ok(corrected.warnings.includes('真太阳时校正后跨日') === false, '同一日内不应报跨日');
});

test('经度越界要报错', () => {
  assert.throws(
    () => compute({ solar: { y: 1990, m: 5, d: 15 }, hour: 12, sex: '男', longitude: 200 }),
    /经度/,
  );
});

test('起运回执：规则、锚定节气、天数与交运日期一致', () => {
  const r = compute({ solar: { y: 1990, m: 5, d: 15 }, shichen: '午', sex: '男' });
  const receipt = r.qiyun_receipt;
  assert.equal(receipt.rule, 'DAYS_TO_YEARS_V1');
  assert.equal(receipt.status, 'CALCULATED');
  assert.equal(receipt.forward, true);
  // 顺排数的是出生后的下一个节（芒种），不是月令所在的立夏：
  // 差值 21.78 天只能对上芒种，若标成立夏，回执就会自相矛盾。
  assert.equal(r.jie_name, '立夏');
  assert.equal(receipt.anchorJie, '芒种');
  const birthJd = jdFromBeijing(1990, 5, 15, 12, 0);
  assert.ok(
    Math.abs(receipt.days - Math.abs(solarTermUtcJd(1990, 75) - birthJd)) < 0.01,
    '回执天数应等于到芒种的间隔',
  );
  assert.equal(receipt.years, r.qiyun_years);
  assert.equal(receipt.months, r.qiyun_months);
  assert.match(receipt.jiaoyun, /^\d{4}-\d{2}-\d{2}$/);
  // 起运 7 岁 3 个月 → 交运落在 1997-08-15
  assert.equal(receipt.jiaoyun, addYearsMonths({ y: 1990, m: 5, d: 15 }, receipt.years, receipt.months)
    .y + '-' + String(addYearsMonths({ y: 1990, m: 5, d: 15 }, receipt.years, receipt.months).m).padStart(2, '0')
    + '-' + String(addYearsMonths({ y: 1990, m: 5, d: 15 }, receipt.years, receipt.months).d).padStart(2, '0'));
});

test('加年月：月末溢出取当月最后一天', () => {
  assert.deepEqual(addYearsMonths({ y: 2024, m: 1, d: 31 }, 0, 1), { y: 2024, m: 2, d: 29 });
  assert.deepEqual(addYearsMonths({ y: 2023, m: 1, d: 31 }, 0, 1), { y: 2023, m: 2, d: 28 });
  assert.deepEqual(addYearsMonths({ y: 1990, m: 12, d: 15 }, 1, 1), { y: 1992, m: 1, d: 15 });
  assert.deepEqual(addYearsMonths({ y: 1990, m: 5, d: 15 }, 8, 3), { y: 1998, m: 8, d: 15 });
});

test('命盘带 schema 版本号', () => {
  const r = compute({ solar: { y: 1990, m: 5, d: 15 }, shichen: '午', sex: '男' });
  assert.equal(r.schema_version, 'dsh-bazi/chart@2');
  assert.equal(r.liuyue.length, 12);
});
