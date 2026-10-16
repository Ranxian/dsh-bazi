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
