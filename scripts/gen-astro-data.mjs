#!/usr/bin/env node
/**
 * 生成 lib/vsop87-earth.js 与 lib/nutation.js 两张天文数据表。
 *
 * 运行：npm i --no-save astronomia && node scripts/gen-astro-data.mjs
 * （astronomia 只用于取原始系数，不进 package.json，也不进运行时依赖。）
 *
 * 两张表都不手写：章动表 63 行系数照抄极易出错，一律由脚本从上游导出。
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const L_THRESHOLD = 1e-8;
const R_THRESHOLD = 1e-7;
const K = 365250.0; // 儒略千年
const ARCSEC = (180 / Math.PI) * 3600;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modules = resolve(root, 'node_modules/astronomia');

const vsop = (await import(pathToFileURL(resolve(modules, 'data/vsop87Dearth.js')).href)).default;
const NUTATION_PSI = await loadNutationPsi();

/** 从 astronomia 源码里取出 Meeus 22.A 表，只保留 Δψ 两列。 */
async function loadNutationPsi() {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(resolve(modules, 'src/nutation.js'), 'utf8');
  const start = source.indexOf('const tab = [');
  const end = source.indexOf('\n  ]', start) + 4;
  if (start < 0 || end < 4) throw new Error('astronomia/nutation.js 结构变了，找不到 table 22A');
  const table = JSON.parse(
    source
      .slice(start + 'const tab = '.length, end)
      .replace(/\b0,/g, '0,')
      .replace(/'/g, '"')
      .replace(/,\s*$/, ''),
  );
  return table.map(([d, m, n, f, omega, s0, s1]) => [d, m, n, f, omega, s0, s1]);
}

// ---------------------------------------------------------------------------
// VSOP87D
// ---------------------------------------------------------------------------

function truncate(series, threshold) {
  const out = {};
  for (const key of Object.keys(series)) {
    const kept = series[key].filter(([amplitude]) => Math.abs(amplitude) >= threshold);
    if (kept.length > 0) out[key] = kept;
  }
  return out;
}

function evaluate(series, tau) {
  let total = 0;
  let tPow = 1;
  for (let i = 0; i < 6; i += 1) {
    const terms = series[String(i)];
    if (terms) {
      let acc = 0;
      for (const [a, b, c] of terms) acc += a * Math.cos(b + c * tau);
      total += acc * tPow;
    }
    tPow *= tau;
  }
  return total;
}

function countTerms(series) {
  return Object.keys(series).reduce((n, k) => n + series[k].length, 0);
}

function formatSeries(name, series, doc) {
  const lines = [`/** ${doc} */`, `export const ${name} = {`];
  for (const key of Object.keys(series).sort((a, b) => Number(a) - Number(b))) {
    lines.push(`  ${key}: [`);
    for (const [a, b, c] of series[key]) lines.push(`    [${a}, ${b}, ${c}],`);
    lines.push('  ],');
  }
  lines.push('};');
  return lines.join('\n');
}

const L = truncate(vsop.L, L_THRESHOLD);
const R = truncate(vsop.R, R_THRESHOLD);

let maxErr = 0;
for (let jd = 2415020.5; jd <= 2488070.5; jd += 1) {
  const tau = (jd - 2451545.0) / K;
  let diff = (evaluate(L, tau) - evaluate(vsop.L, tau)) * ARCSEC;
  diff = ((diff + 180) % 360 + 360) % 360 - 180;
  if (Math.abs(diff) > maxErr) maxErr = Math.abs(diff);
}

const vsopHeader = `/**
 * VSOP87D 地球日心黄经 L、向径 R（黄道与春分点取当日平值）。
 *
 * 自动生成，请勿手改。重新生成：
 *   npm i --no-save astronomia && node scripts/gen-astro-data.mjs
 *
 * 数据来源：VSOP87（Bretagnon & Francou, 1988）D 版，经 astronomia@4.2.0（MIT，
 * Copyright (c) 2013 Sonia Keys / 2016 Commenthol）导出，按振幅截断后重新排列。
 * 级数形式：Σ_α τ^α Σ_i A·cos(B + C·τ)，τ = (JD − 2451545) / 365250（儒略千年）。
 *
 * 截断阈值：L ≥ ${L_THRESHOLD} rad（${countTerms(L)} 项），R ≥ ${R_THRESHOLD} rad（${countTerms(R)} 项）。
 * 1900–2100 逐日与完整级数比对，黄经最大偏差 ${maxErr.toFixed(4)}″（约 ${(maxErr * 24.35).toFixed(1)} 秒时间）。
 *
 * 向径只通过光行差进入计算，故阈值取粗一级；它不参与真太阳时（那里用均时差公式）。
 */`;

writeFileSync(
  resolve(root, 'lib/vsop87-earth.js'),
  [
    vsopHeader,
    '',
    formatSeries('EARTH_L', L, '地球日心黄经 L，单位弧度。'),
    '',
    formatSeries('EARTH_R', R, '地球向径 R，单位天文单位。'),
    '',
  ].join('\n'),
  'utf8',
);

// ---------------------------------------------------------------------------
// IAU 1980 章动
// ---------------------------------------------------------------------------

const nutHeader = `/**
 * IAU 1980 章动理论中的黄经章动 Δψ 系数表。
 *
 * 自动生成，请勿手改。重新生成：
 *   npm i --no-save astronomia && node scripts/gen-astro-data.mjs
 *
 * 数据来源：Meeus《Astronomical Algorithms》(2nd ed.) 表 22.A，经 astronomia@4.2.0
 * （MIT）导出；上游已略去振幅 < 0.0003″ 的项，共 ${NUTATION_PSI.length} 项。
 *
 * 每行 [d, m, n, f, ω, s0, s1]，s 列单位为 0.0001″：
 *   Δψ = Σ (s0 + s1·T) · sin(dD + mM + nN + fF + ωΩ)
 * 基本参数 D/M/N/F/Ω 的系数见 engine.js 的 nutationInLongitude()。
 */`;

const nutBody = [
  nutHeader,
  '',
  '/** Δψ 系数表：[d, m, n, f, ω, s0, s1]，单位 0.0001″。 */',
  'export const NUTATION_PSI = [',
  ...NUTATION_PSI.map((row) => `  [${row.join(', ')}],`),
  '];',
  '',
].join('\n');

writeFileSync(resolve(root, 'lib/nutation.js'), nutBody, 'utf8');

console.log(`lib/vsop87-earth.js  L ${countTerms(L)} 项，R ${countTerms(R)} 项`);
console.log(`lib/nutation.js      ${NUTATION_PSI.length} 项`);
console.log(`1900–2100 黄经最大截断偏差 ${maxErr.toFixed(4)}″（约 ${(maxErr * 24.35).toFixed(1)} 秒时间）`);
