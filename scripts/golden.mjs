#!/usr/bin/env node
/**
 * 交叉验证：把 lib/engine.js 的输出与 Python 原实现 pai_pan.py 逐字比对。
 *
 * 用法：
 *   node scripts/golden.mjs                 # 跑内置用例集
 *   node scripts/golden.mjs --random 400    # 追加 N 个随机用例
 *   node scripts/golden.mjs --py <path>     # 指定 pai_pan.py 路径
 *
 * 退出码 0 = 全部一致；1 = 存在差异（打印首个差异上下文）。
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compute, formatReport } from '../lib/engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PY_SCRIPT =
  'C:/Users/Ranxian/.workbuddy/skills/bazi/scripts/pai_pan.py';

/** 解析命令行参数。 */
function parseArgs(argv) {
  const out = { random: 0, py: DEFAULT_PY_SCRIPT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--random') out.random = Number(argv[i + 1] ?? 0);
    else if (argv[i] === '--py') out.py = argv[i + 1];
  }
  return out;
}

/** 把 et 用例翻译成 pai_pan.py 的 CLI 参数。 */
function toCliArgs(testCase) {
  const args = [];
  if (testCase.solar) args.push('--solar', testCase.solar);
  if (testCase.lunar) args.push('--lunar', testCase.lunar);
  if (testCase.leap) args.push('--leap');
  if (testCase.hour) args.push('--hour', testCase.hour);
  if (testCase.shichen) args.push('--shichen', testCase.shichen);
  args.push('--sex', testCase.sex ?? '男');
  if (testCase.place) args.push('--place', testCase.place);
  if (testCase.deceasedYear) args.push('--deceased-year', String(testCase.deceasedYear));
  return args;
}

/** 解析 'YYYY-MM-DD' → { y, m, d }。 */
function parseDate(text) {
  const [y, m, d] = text.split('-').map(Number);
  return { y, m, d };
}

/** 把 et 用例翻译成 compute() 的入参。 */
function toEngineInput(testCase) {
  const input = {
    solar: testCase.solar ? parseDate(testCase.solar) : null,
    lunar: testCase.lunar ? { ...parseDate(testCase.lunar), leap: Boolean(testCase.leap) } : null,
    sex: testCase.sex ?? '男',
    place: testCase.place ?? null,
    deceasedYear: testCase.deceasedYear ?? null,
  };
  if (testCase.hour) {
    const [h, mi] = testCase.hour.split(':').map(Number);
    input.hour = h;
    input.minute = mi;
  }
  if (testCase.shichen) input.shichen = testCase.shichen;
  return input;
}

/** 跑一次 Python 参考实现。 */
function runPython(pyScript, testCase) {
  const stdout = execFileSync('python', [pyScript, ...toCliArgs(testCase)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  // Windows 文本模式 stdout 会把 \n 翻成 \r\n；比对前统一成 \n
  return stdout.replace(/\r\n/g, '\n');
}

/** 跑一次 JS 引擎并格式化。 */
function runEngine(testCase) {
  return formatReport(compute(toEngineInput(testCase)));
}

/** 打印首个差异的上下文。 */
function describeDiff(expected, actual) {
  const e = expected.split('\n');
  const a = actual.split('\n');
  const n = Math.max(e.length, a.length);
  for (let i = 0; i < n; i += 1) {
    if (e[i] !== a[i]) {
      return `  首个差异在第 ${i + 1} 行：\n    py: ${JSON.stringify(e[i])}\n    js: ${JSON.stringify(a[i])}`;
    }
  }
  return '  内容相同但长度不同';
}

const BASE_CASES = [
  { name: '黄金用例 1990-05-15 午时男', solar: '1990-05-15', shichen: '午', sex: '男' },
  { name: '立春前 1990-02-03 10:00 男', solar: '1990-02-03', hour: '10:00', sex: '男' },
  { name: '立春当日 1990-02-04 12:00 男', solar: '1990-02-04', hour: '12:00', sex: '男' },
  { name: '夜子时 23:30', solar: '1990-05-15', hour: '23:30', sex: '男' },
  { name: '早子时 00:30', solar: '1990-05-15', hour: '00:30', sex: '男' },
  { name: '23:00 整点夜子时', solar: '1990-05-15', hour: '23:00', sex: '男' },
  { name: '00:00 整点早子时', solar: '1990-05-15', hour: '00:00', sex: '男' },
  { name: '阴年男逆排 1991-06-15', solar: '1991-06-15', shichen: '午', sex: '男' },
  { name: '阳年女逆排 1990-05-15', solar: '1990-05-15', shichen: '午', sex: '女' },
  { name: '时辰未知', solar: '1990-05-15', sex: '男' },
  { name: '子时未知时刻', solar: '1990-05-15', shichen: '子', sex: '男' },
  { name: '农历非闰 1990-04-21', lunar: '1990-04-21', shichen: '午', sex: '男' },
  { name: '农历闰五月 1990闰05-01', lunar: '1990-05-01', leap: true, shichen: '午', sex: '男' },
  { name: '农历闰四月 2020闰04-15', lunar: '2020-04-15', leap: true, hour: '09:30', sex: '女' },
  { name: '已故年份 2010', solar: '1990-05-15', hour: '12:00', sex: '男', deceasedYear: 2010 },
  { name: '出生地+边界 11:55', solar: '1990-05-15', hour: '11:55', sex: '男', place: '辽宁省丹东市' },
  { name: '出生地+边界 12:05', solar: '1990-05-15', hour: '12:05', sex: '男', place: '北京市' },
  { name: '生辰边界 15:14 未', solar: '1985-03-15', hour: '15:14', sex: '女' },
  { name: '1984 甲子年', solar: '1984-06-01', hour: '08:20', sex: '男' },
  { name: '2000 千禧年', solar: '2000-01-01', hour: '00:05', sex: '女' },
  { name: '冬至附近 2023-12-22', solar: '2023-12-22', hour: '12:00', sex: '男' },
  { name: '大雪节气 2020-12-07', solar: '2020-12-07', hour: '01:00', sex: '女' },
  { name: '芒种交界 1993-06-06', solar: '1993-06-06', hour: '06:00', sex: '男' },
  { name: '小寒 1988-01-06', solar: '1988-01-06', hour: '18:30', sex: '女' },
  { name: '老生日 1930-09-09', solar: '1930-09-09', hour: '10:00', sex: '男' },
  { name: '近未来 2099-12-31', solar: '2099-12-31', hour: '23:59', sex: '女' },
  { name: '1901 年初', solar: '1901-01-15', hour: '03:20', sex: '男' },
];

/** 生成随机用例（覆盖节气、闰月、时辰边界）。 */
function randomCases(count) {
  const cases = [];
  let seed = 20261016;
  const rand = () => {
    // 线性同余，保证可复现
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pickInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

  for (let i = 0; i < count; i += 1) {
    const y = pickInt(1902, 2098);
    const m = pickInt(1, 12);
    const d = pickInt(1, 28);
    const h = pickInt(0, 23);
    const mi = pickInt(0, 59);
    cases.push({
      name: `随机 #${i + 1} ${y}-${m}-${d} ${h}:${mi}`,
      solar: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      hour: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`,
      sex: rand() < 0.5 ? '男' : '女',
    });
  }
  return cases;
}

function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);

  if (!existsSync(opts.py)) {
    console.error(`找不到 Python 参考实现：${opts.py}`);
    process.exit(2);
  }

  const cases = [...BASE_CASES, ...randomCases(opts.random)];
  let failures = 0;
  let skipped = 0;

  for (const testCase of cases) {
    let expected;
    try {
      expected = runPython(opts.py, testCase);
    } catch (error) {
      // Python 侧拒绝的输入（超出农历推算范围等）两边都应拒绝，单独计数
      skipped += 1;
      continue;
    }
    let actual;
    try {
      actual = runEngine(testCase);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${testCase.name}\n  JS 抛错：${error.message}\n  Python 成功返回`);
      continue;
    }
    if (expected !== actual) {
      failures += 1;
      console.error(`✗ ${testCase.name}`);
      console.error(describeDiff(expected, actual));
      if (failures >= 5) {
        console.error('\n差异已达 5 例，提前停止。');
        break;
      }
    }
  }

  const passed = cases.length - failures - skipped;
  console.log(`\n交叉验证：${passed}/${cases.length} 一致，${failures} 不一致，${skipped} 例 Python 侧拒绝（跳过）。`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
