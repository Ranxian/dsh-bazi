/**
 * 四柱八字排盘内核 — `pai_pan.py` 的 JavaScript 移植（零第三方依赖）。
 *
 * 时区一律按北京时间 UTC+8，不用本机本地时区。
 * 节气用太阳视黄经定气（立春=315°），农历用定气定朔
 * （冬至所在月为十一月，无中气之月为闰月）。
 *
 * 算法锚点（与 Python 原实现逐条对齐，供 QA 对照）
 * ------------------------------------------------
 * 1. 日柱：公历儒略日（JDN）→ 六十甲子。
 *    锚点：1990-05-15 = 庚辰（序号 16：庚=6，辰=4）。
 *    公式：gz_index = (JDN + 49) % 60。
 *    日界按早晚子时：23:00 前用当日日柱；23:00 起（含）用次日日柱。
 *
 * 2. 年柱：以该年立春的精确时刻分界，不是正月初一，也不是 2 月 4 日零点。
 *    年份干支：(year - 4) % 60（1984=甲子）；若时刻 < 该年立春，用 year-1。
 *    锚点：1990-02-03 10:00 年柱必须是己巳，不是庚午。
 *
 * 3. 月柱：以十二「节」（不是中气）时刻分界：
 *    立春寅、惊蛰卯、清明辰、立夏巳、芒种午、小暑未、
 *    立秋申、白露酉、寒露戌、立冬亥、大雪子、小寒丑。
 *    天干：年上起月。甲己丙作首、乙庚戊为头、丙辛庚上、丁壬壬寅、戊癸甲寅。
 *    锚点：1990-05-15（立夏后、芒种前）= 辛巳月。
 *
 * 4. 时柱：子 23:00-01:00，丑 01-03，寅 03-05，卯 05-07，辰 07-09，巳 09-11，
 *    午 11-13，未 13-15，申 15-17，酉 17-19，戌 19-21，亥 21-23。
 *    五鼠遁元：甲己甲子、乙庚丙子、丙辛戊子、丁壬庚子、戊癸壬子。
 *    锚点：庚日午时 = 壬午。
 *
 * 5. 十神 / 藏干：与 references 同一张表，以日干为基准。日干那一格十神为「—」。
 *
 * 6. 大运：年干甲丙戊庚壬为阳年；乙丁己辛癸为阴年。
 *    阳年男/阴年女顺排；阴年男/阳年女逆排。
 *    从月柱的下一柱（顺）或上一柱（逆）开始，不要把月柱本身当作第一步大运。
 *    起运年龄 = 出生日到最近「节」的天数 ÷ 3（顺数下一节，逆数上一节）。
 *    余 1 天 ≈ 4 个月，余 2 天 ≈ 8 个月。起运前用月柱作小运。
 *    锚点：1990-05-15 男（阳年）必须顺排。
 *
 * 7. 节气时刻：太阳视黄经（Meeus 简式，等价于寿星定气）。
 *    立春=黄经 315°。精确到小时以上，覆盖 1900–2100。
 *    禁止写死「立春大约 2 月 3-5 日」。
 *
 * 8. 农历：节气+朔望。冬至所在月为十一月，无中气之月为闰月。
 *    朔用 Meeus 定朔（TT），再换北京日期。
 *    非闰月锚点：1990 农历四月廿一 = 1990-05-15。
 *
 * 9. 神煞：与 references 同一张表。只输出命局命中的条目；时柱未知则不参与。
 *
 * 真太阳时：默认钟表时间。若给了 place 且时刻距时辰整点边界 ≤15 分钟，
 * 只加警告「校正后可能跨时辰」，不查经度、不做完整真太阳时。
 *
 * @module dsh-bazi/engine
 */

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 北京时间固定偏移（小时）。排盘一律用它，不读本机时区。 */
export const BJ_OFFSET_HOURS = 8;
/** J2000.0 历元的儒略日（TT）。 */
export const J2000 = 2451545.0;
/** 1970-01-01 00:00 UTC 的儒略日。 */
export const UNIX_JD = 2440587.5;

export const GAN = '甲乙丙丁戊己庚辛壬癸';
export const ZHI = '子丑寅卯辰巳午未申酉戌亥';
export const GAN_WUXING = '木木火火土土金金水水';
export const ZHI_LIST = [...ZHI];
export const SHICHEN_SET = new Set(ZHI_LIST);

/** 十二节：黄经、名称、月支下标（寅=2 … 丑=1）。 */
export const JIE_DEFS = [
  [315, '立春', 2],
  [345, '惊蛰', 3],
  [15, '清明', 4],
  [45, '立夏', 5],
  [75, '芒种', 6],
  [105, '小暑', 7],
  [135, '立秋', 8],
  [165, '白露', 9],
  [195, '寒露', 10],
  [225, '立冬', 11],
  [255, '大雪', 0],
  [285, '小寒', 1],
];
export const JIE_LONGS = JIE_DEFS.map((item) => item[0]);
export const ZHONGQI_LONGS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

/** 年上起月：寅月天干。甲己丙、乙庚戊、丙辛庚、丁壬壬、戊癸甲。 */
export const YUE_GAN_YIN = new Map([
  [0, 2],
  [5, 2],
  [1, 4],
  [6, 4],
  [2, 6],
  [7, 6],
  [3, 8],
  [8, 8],
  [4, 0],
  [9, 0],
]);

/** 五鼠遁元：日干 -> 子时天干。 */
export const ZI_SHI_GAN = new Map([
  [0, 0],
  [5, 0],
  [1, 2],
  [6, 2],
  [2, 4],
  [7, 4],
  [3, 6],
  [8, 6],
  [4, 8],
  [9, 8],
]);

/** 地支藏干（本气、中气、余气）。 */
export const CANGGAN = new Map([
  ['子', [['癸', '水']]],
  ['丑', [['己', '土'], ['癸', '水'], ['辛', '金']]],
  ['寅', [['甲', '木'], ['丙', '火'], ['戊', '土']]],
  ['卯', [['乙', '木']]],
  ['辰', [['戊', '土'], ['乙', '木'], ['癸', '水']]],
  ['巳', [['丙', '火'], ['庚', '金'], ['戊', '土']]],
  ['午', [['丁', '火'], ['己', '土']]],
  ['未', [['己', '土'], ['丁', '火'], ['乙', '木']]],
  ['申', [['庚', '金'], ['壬', '水'], ['戊', '土']]],
  ['酉', [['辛', '金']]],
  ['戌', [['戊', '土'], ['辛', '金'], ['丁', '火']]],
  ['亥', [['壬', '水'], ['甲', '木']]],
]);

/**
 * 十神：rel = (他干五行 - 日干五行) % 5。
 * 0 同我 / 1 我生 / 2 我克 / 3 克我 / 4 生我。
 */
export const SHISHEN_SAME = ['比肩', '食神', '偏财', '偏官', '偏印'];
export const SHISHEN_DIFF = ['劫财', '伤官', '正财', '正官', '正印'];

// ── 神煞表（与 references 同一张表）────────────────────────────────────────

const TIANYI = new Map([
  ['甲', ['丑', '未']],
  ['戊', ['丑', '未']],
  ['乙', ['子', '申']],
  ['己', ['子', '申']],
  ['丙', ['亥', '酉']],
  ['丁', ['亥', '酉']],
  ['壬', ['卯', '巳']],
  ['癸', ['卯', '巳']],
  ['庚', ['丑', '未', '寅', '午']],
  ['辛', ['寅', '午']],
]);
/** 天德：['gan', 干] 查天干；['zhi', 支] 查地支。 */
const TIANDE = new Map([
  ['寅', ['gan', '丁']],
  ['卯', ['zhi', '申']],
  ['辰', ['gan', '壬']],
  ['巳', ['gan', '辛']],
  ['午', ['zhi', '亥']],
  ['未', ['gan', '甲']],
  ['申', ['gan', '癸']],
  ['酉', ['zhi', '寅']],
  ['戌', ['gan', '丙']],
  ['亥', ['gan', '乙']],
  ['子', ['gan', '己']],
  ['丑', ['gan', '庚']],
]);
const YUEDE = new Map([
  ['寅', '丙'], ['午', '丙'], ['戌', '丙'],
  ['申', '壬'], ['子', '壬'], ['辰', '壬'],
  ['亥', '甲'], ['卯', '甲'], ['未', '甲'],
  ['巳', '庚'], ['酉', '庚'], ['丑', '庚'],
]);
const WENCHANG = new Map([
  ['甲', '巳'], ['乙', '午'], ['丙', '申'], ['丁', '酉'], ['戊', '申'],
  ['己', '酉'], ['庚', '亥'], ['辛', '子'], ['壬', '寅'], ['癸', '卯'],
]);
const XUETANG = new Map([
  ['甲', '亥'], ['乙', '午'], ['丙', '寅'], ['丁', '酉'], ['戊', '寅'],
  ['己', '酉'], ['庚', '巳'], ['辛', '子'], ['壬', '申'], ['癸', '卯'],
]);
const CIGUAN = new Map([
  ['甲', '寅'], ['乙', '卯'], ['丙', '巳'], ['丁', '午'], ['戊', '巳'],
  ['己', '午'], ['庚', '申'], ['辛', '酉'], ['壬', '亥'], ['癸', '子'],
]);
const SANHE = new Map([
  ['寅', '火'], ['午', '火'], ['戌', '火'],
  ['申', '水'], ['子', '水'], ['辰', '水'],
  ['巳', '金'], ['酉', '金'], ['丑', '金'],
  ['亥', '木'], ['卯', '木'], ['未', '木'],
]);
const JIANGXING = new Map([['火', '午'], ['水', '子'], ['金', '酉'], ['木', '卯']]);
const HUAGAI = new Map([['火', '戌'], ['水', '辰'], ['金', '丑'], ['木', '未']]);
const YIMA = new Map([['火', '申'], ['水', '寅'], ['金', '亥'], ['木', '巳']]);
const JIESHA = new Map([['水', '巳'], ['火', '亥'], ['金', '寅'], ['木', '申']]);
const ZAISHA = new Map([['水', '午'], ['火', '子'], ['金', '卯'], ['木', '酉']]);
const WANGSHEN = new Map([['水', '亥'], ['火', '巳'], ['金', '申'], ['木', '寅']]);
const TAOHUA = new Map([['火', '卯'], ['水', '酉'], ['金', '午'], ['木', '子']]);
const GUCHEN = new Map([
  ['亥', '寅'], ['子', '寅'], ['丑', '寅'],
  ['寅', '巳'], ['卯', '巳'], ['辰', '巳'],
  ['巳', '申'], ['午', '申'], ['未', '申'],
  ['申', '亥'], ['酉', '亥'], ['戌', '亥'],
]);
const GUASU = new Map([
  ['亥', '戌'], ['子', '戌'], ['丑', '戌'],
  ['寅', '丑'], ['卯', '丑'], ['辰', '丑'],
  ['巳', '辰'], ['午', '辰'], ['未', '辰'],
  ['申', '未'], ['酉', '未'], ['戌', '未'],
]);
const JINYU = new Map([
  ['甲', '辰'], ['乙', '巳'], ['丙', '未'], ['丁', '申'], ['戊', '未'],
  ['己', '申'], ['庚', '戌'], ['辛', '亥'], ['壬', '丑'], ['癸', '寅'],
]);
const YANGBLADE = new Map([
  ['甲', '卯'], ['乙', '寅'], ['丙', '午'], ['丁', '巳'], ['戊', '午'],
  ['己', '巳'], ['庚', '酉'], ['辛', '子'], ['壬', '子'], ['癸', '亥'],
]);
const YUANCHEN_FORWARD = new Map([
  ['子', '未'], ['丑', '申'], ['寅', '酉'], ['卯', '戌'], ['辰', '亥'], ['巳', '子'],
  ['午', '丑'], ['未', '寅'], ['申', '卯'], ['酉', '辰'], ['戌', '巳'], ['亥', '午'],
]);
const YUANCHEN_REVERSE = new Map([
  ['子', '巳'], ['丑', '午'], ['寅', '未'], ['卯', '申'], ['辰', '酉'], ['巳', '戌'],
  ['午', '亥'], ['未', '子'], ['申', '丑'], ['酉', '寅'], ['戌', '卯'], ['亥', '辰'],
]);
const XUEREN = new Map([
  ['寅', '午'], ['卯', '未'], ['辰', '申'], ['巳', '酉'], ['午', '戌'], ['未', '亥'],
  ['申', '子'], ['酉', '丑'], ['戌', '寅'], ['亥', '卯'], ['子', '辰'], ['丑', '巳'],
]);

const GAN_LABELS = ['年干', '月干', '日干', '时干'];
const ZHI_LABELS = ['年支', '月支', '日支', '时支'];
const MDH_ZHI_LABELS = ['月支', '日支', '时支'];

/** 时辰中点（仅 shichen、无 clock 时用于节气比较与起运）。 */
export const SHICHEN_MID = new Map([
  ['子', [0, 0]], ['丑', [2, 0]], ['寅', [4, 0]], ['卯', [6, 0]],
  ['辰', [8, 0]], ['巳', [10, 0]], ['午', [12, 0]], ['未', [14, 0]],
  ['申', [16, 0]], ['酉', [18, 0]], ['戌', [20, 0]], ['亥', [22, 0]],
]);

/** 时辰整点边界（北京钟表，不含 00:00，因子时跨日在 23:00 / 01:00 换支）。 */
export const SHICHEN_BOUNDARIES_MIN = [60, 180, 300, 420, 540, 660, 780, 900, 1020, 1140, 1260, 1380];

export const LUNAR_DAY_NAMES = new Map([
  [1, '初一'], [2, '初二'], [3, '初三'], [4, '初四'], [5, '初五'],
  [6, '初六'], [7, '初七'], [8, '初八'], [9, '初九'], [10, '初十'],
  [11, '十一'], [12, '十二'], [13, '十三'], [14, '十四'], [15, '十五'],
  [16, '十六'], [17, '十七'], [18, '十八'], [19, '十九'], [20, '二十'],
  [21, '廿一'], [22, '廿二'], [23, '廿三'], [24, '廿四'], [25, '廿五'],
  [26, '廿六'], [27, '廿七'], [28, '廿八'], [29, '廿九'], [30, '三十'],
]);
export const LUNAR_MONTH_NAMES = new Map([
  [1, '正月'], [2, '二月'], [3, '三月'], [4, '四月'], [5, '五月'], [6, '六月'],
  [7, '七月'], [8, '八月'], [9, '九月'], [10, '十月'], [11, '十一月'], [12, '十二月'],
]);

// ---------------------------------------------------------------------------
// 数值工具（对齐 Python 语义）
// ---------------------------------------------------------------------------

/**
 * Python 取模：结果符号跟随除数，恒为非负（`b > 0`）。
 * @param {number} a - 被除数。
 * @param {number} b - 除数（正数）。
 * @returns {number} `[0, b)` 区间内的余数。
 */
export function pmod(a, b) {
  return ((a % b) + b) % b;
}

/**
 * Python 3 `round()`：银行家舍入（.5 取偶）。
 * @param {number} value - 待舍入值。
 * @returns {number} 舍入后的整数。
 */
export function pyRound(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** 公历日 → 格里历儒略日数（中午，整数）。 */
export function jdn(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/** 格里历儒略日数 → 公历 { y, m, d }。 */
export function jdnToYmd(jdnValue) {
  const a = jdnValue + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    y: 100 * b + d - 4800 + Math.floor(m / 10),
    m: m + 3 - 12 * Math.floor(m / 10),
    d: e - Math.floor((153 * m + 2) / 5) + 1,
  };
}

/**
 * 北京钟表时间 → UTC 儒略日。
 * @param {number} year - 公历年。
 * @param {number} month - 公历月。
 * @param {number} day - 公历日。
 * @param {number} [hour] - 时（北京钟表）。
 * @param {number} [minute] - 分。
 * @param {number} [second] - 秒。
 * @returns {number} UTC 儒略日。
 */
export function jdFromBeijing(year, month, day, hour = 0, minute = 0, second = 0) {
  const dayFraction = (hour * 3600 + minute * 60 + second) / 86400;
  return jdn(year, month, day) - 0.5 + dayFraction - BJ_OFFSET_HOURS / 24;
}

/**
 * UTC 儒略日 → 北京时间字段。
 *
 * 与 Python `datetime` 的语义对齐：时间量先四舍五入到微秒（timedelta 精度），
 * 再换算北京钟表并**截断**到秒与日历日——绝不把 23:59:59.9 进位成次日。
 * @param {number} jd - UTC 儒略日。
 * @returns {{y:number,m:number,d:number,h:number,mi:number,s:number}} 北京钟表时间。
 */
export function beijingFromJd(jd) {
  const unixSeconds = Math.round((jd - UNIX_JD) * 86400.0 * 1e6) / 1e6;
  const bjSeconds = unixSeconds + BJ_OFFSET_HOURS * 3600;
  const dayIndex = Math.floor(bjSeconds / 86400);
  let secOfDay = Math.floor(bjSeconds - dayIndex * 86400 + 1e-9);
  if (secOfDay >= 86400) secOfDay = 86399;
  if (secOfDay < 0) secOfDay = 0;
  const { y, m, d } = jdnToYmd(jdn(1970, 1, 1) + dayIndex);
  return {
    y,
    m,
    d,
    h: Math.floor(secOfDay / 3600),
    mi: Math.floor((secOfDay % 3600) / 60),
    s: secOfDay % 60,
  };
}

// ---------------------------------------------------------------------------
// 时间 / 儒略日（北京 UTC+8）
// ---------------------------------------------------------------------------

/**
 * TT−UTC 近似秒（Espenak/Meeus 分段多项式），1900–2100 足够到分钟级。
 * @param {number} year - 公历年（可含小数）。
 * @returns {number} TT−UTC 秒数。
 */
export function deltaTSeconds(year) {
  const y = Number(year);
  const t = y - 2000.0;
  if (y < 1920) {
    const t1 = y - 1900.0;
    return -2.79 + 1.494119 * t1 - 0.0598939 * t1 ** 2 + 0.0061966 * t1 ** 3 - 0.000197 * t1 ** 4;
  }
  if (y < 1941) {
    const t1 = y - 1920.0;
    return 21.2 + 0.84493 * t1 - 0.0761 * t1 ** 2 + 0.0020936 * t1 ** 3;
  }
  if (y < 1961) {
    const t1 = y - 1950.0;
    return 29.07 + 0.407 * t1 - t1 ** 2 / 233.0 + t1 ** 3 / 2547.0;
  }
  if (y < 1986) {
    const t1 = y - 1975.0;
    return 45.45 + 1.067 * t1 - t1 ** 2 / 260.0 - t1 ** 3 / 718.0;
  }
  if (y < 2005) {
    const t1 = y - 2000.0;
    return (
      63.86 +
      0.3345 * t1 -
      0.060374 * t1 ** 2 +
      0.0017275 * t1 ** 3 +
      0.000651814 * t1 ** 4 +
      0.00002373599 * t1 ** 5
    );
  }
  if (y < 2050) return 62.92 + 0.32217 * t + 0.005589 * t * t;
  return -20.0 + 32.0 * ((y - 1820.0) / 100.0) ** 2 - 0.5628 * (2150.0 - y);
}

/**
 * 力学时 JD → UTC 儒略日（先按年估算 ΔT，再扣除）。
 * @param {number} jdTT - TT 儒略日。
 * @returns {number} UTC 儒略日。
 */
export function jdTtToJdUtc(jdTT) {
  const year = 2000.0 + (jdTT - J2000) / 365.242189;
  return jdTT - deltaTSeconds(year) / 86400.0;
}

// ---------------------------------------------------------------------------
// 太阳视黄经 / 二十四节气
// ---------------------------------------------------------------------------

/**
 * 太阳视黄经（度）。Meeus AA 第 25 章简式，1900–2100 约 0.01°（十余分钟）以内。
 * @param {number} jdTT - TT 儒略日。
 * @returns {number} 视黄经，`[0, 360)`。
 */
export function sunApparentLongitude(jdTT) {
  const T = (jdTT - J2000) / 36525.0;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const mr = (M * Math.PI) / 180;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(mr) +
    (0.019993 - 0.000101 * T) * Math.sin(2.0 * mr) +
    0.000289 * Math.sin(3.0 * mr);
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin((omega * Math.PI) / 180);
  return pmod(lambda, 360.0);
}

/** actual − target，归一到 (−180, 180]。 */
function lonDelta(actual, target) {
  return pmod(actual - target + 180.0, 360.0) - 180.0;
}

const solarTermJdCache = new Map();

/**
 * 给定公历年、目标黄经，返回该年对应定气的 TT 儒略日。
 *
 * 当年 1 月 1 日太阳黄经约 280°，沿黄道正向走到 target（可跨 360°）。
 * 立春 = 315°。禁止用「大约 2 月 3–5 日」这种写死日期。
 * @param {number} year - 公历年。
 * @param {number} longitude - 目标黄经（度）。
 * @returns {number} 定气时刻（TT 儒略日）。
 */
export function solarTermJd(year, longitude) {
  const cacheKey = `${Math.trunc(year)}:${pmod(longitude, 360.0)}`;
  const cached = solarTermJdCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const target = pmod(longitude, 360.0);
  const deltaLon = pmod(target - 280.46646, 360.0);
  const jd0 = J2000 + (Math.trunc(year) - 2000) * 365.242189 + deltaLon / 0.98564736;
  let lo = jd0 - 8.0;
  let hi = jd0 + 8.0;
  for (let i = 0; i < 52; i += 1) {
    const mid = (lo + hi) / 2.0;
    if (lonDelta(sunApparentLongitude(mid), target) < 0) lo = mid;
    else hi = mid;
  }
  const result = (lo + hi) / 2.0;
  solarTermJdCache.set(cacheKey, result);
  return result;
}

/**
 * 定气时刻 → UTC 儒略日（可直接与出生时刻比较）。
 * @param {number} year - 公历年。
 * @param {number} longitude - 目标黄经（度）。
 * @returns {number} UTC 儒略日。
 */
export function solarTermUtcJd(year, longitude) {
  return jdTtToJdUtc(solarTermJd(year, longitude));
}

/** year-1 … year+1 的十二节，按时刻排序。 */
function jieEventsAround(year) {
  const events = [];
  for (const y of [year - 1, year, year + 1]) {
    for (const [lon, name, zhiIndex] of JIE_DEFS) {
      events.push({ jd: solarTermUtcJd(y, lon), name, zhiIndex, lon, year: y });
    }
  }
  events.sort((a, b) => a.jd - b.jd);
  return events;
}

// ---------------------------------------------------------------------------
// 定朔（Meeus 第 49 章）
// ---------------------------------------------------------------------------

/**
 * 新月力学时 JDE。k=0 对应 2000-01-06 附近朔。精度约 1–2 分钟。
 * @param {number} k - 朔望月序号（可为小数，取整月的相对起点）。
 * @returns {number} 定朔时刻（TT 儒略日）。
 */
export function newMoonJde(k) {
  const T = k / 1236.85;
  let jde =
    2451550.09766 +
    29.530588861 * k +
    0.00015437 * T * T -
    0.00000015 * T * T * T +
    0.00000000073 * T * T * T * T;
  const E = 1.0 - 0.002516 * T - 0.0000074 * T * T;
  const M = ((2.5534 + 29.1053567 * k - 0.0000014 * T * T - 0.00000011 * T * T * T) * Math.PI) / 180;
  const Mp =
    ((201.5643 +
      385.81693528 * k +
      0.0107582 * T * T +
      0.00001238 * T * T * T -
      0.000000058 * T * T * T * T) *
      Math.PI) /
    180;
  const F =
    ((160.7108 +
      390.67050284 * k -
      0.0016118 * T * T -
      0.00000227 * T * T * T +
      0.000000011 * T * T * T * T) *
      Math.PI) /
    180;
  const omega = ((124.7746 - 1.56375588 * k + 0.0020672 * T * T + 0.00000215 * T * T * T) * Math.PI) / 180;
  const args = [
    Mp, M, 2 * Mp, 2 * F, Mp - M, Mp + M, 2 * M, Mp - 2 * F, Mp + 2 * F,
    2 * Mp + M, 3 * Mp, M + 2 * F, M - 2 * F, 2 * Mp - M, omega, Mp + 2 * M,
    2 * Mp - 2 * F, 3 * M, Mp + M - 2 * F, 2 * Mp + 2 * F, Mp + M + 2 * F,
    Mp - M + 2 * F, Mp - M - 2 * F, 3 * Mp + M, 4 * Mp,
  ];
  const coef = [
    -0.4072,
    0.17241 * E,
    0.01608,
    0.01039,
    0.00739 * E,
    -0.00514 * E,
    0.00208 * E * E,
    -0.00111,
    -0.00057,
    0.00056 * E,
    -0.00042,
    0.00042 * E,
    0.00038 * E,
    -0.00024 * E,
    -0.00017,
    -0.00007,
    0.00004,
    0.00004,
    0.00003,
    0.00003,
    -0.00003,
    0.00003,
    -0.00002,
    -0.00002,
    0.00002,
  ];
  for (let i = 0; i < coef.length; i += 1) jde += coef[i] * Math.sin(args[i]);

  const A = [
    299.77 + 0.107408 * k - 0.009173 * T * T,
    251.88 + 0.016321 * k,
    251.83 + 26.651886 * k,
    349.42 + 36.412478 * k,
    84.66 + 18.206239 * k,
    141.74 + 53.303771 * k,
    207.14 + 2.453732 * k,
    154.84 + 7.30686 * k,
    34.52 + 27.261239 * k,
    207.19 + 0.121824 * k,
    291.34 + 1.844379 * k,
    161.72 + 24.198154 * k,
    239.56 + 25.513099 * k,
    331.55 + 3.592518 * k,
  ];
  const Ac = [325, 165, 164, 126, 110, 62, 60, 56, 47, 42, 40, 37, 35, 23];
  for (let i = 0; i < Ac.length; i += 1) {
    jde += Ac[i] * 1e-6 * Math.sin((A[i] * Math.PI) / 180);
  }
  return jde;
}

function kNear(jd) {
  return pyRound((jd - 2451550.09766) / 29.530588861);
}

function lastNewMoonKOnOrBefore(jdTT) {
  let k = kNear(jdTT);
  while (newMoonJde(k) > jdTT) k -= 1;
  while (newMoonJde(k + 1) <= jdTT) k += 1;
  return k;
}

// ---------------------------------------------------------------------------
// 农历（冬至十一月 + 无中气置闰）
// ---------------------------------------------------------------------------

function zhongqiJds(year) {
  const out = [];
  for (const y of [year - 1, year, year + 1]) {
    for (const lon of ZHONGQI_LONGS) out.push(solarTermJd(y, lon));
  }
  return out;
}

const lunarMonthsCache = new Map();

/**
 * 从「dongzhiYear 的冬至所在十一月」起到下一年冬至月之前的各农历月。
 *
 * 每项：`{ year, month, leap, startJdn, days, shuoJd }`。
 * 1990 年有闰五月；1990-04-21（非闰）= 1990-05-15。
 * @param {number} dongzhiYear - 冬至所在公历年。
 * @returns {Array<object>} 该冬至段的农历月列表。
 */
export function lunarMonthsBetweenDongzhi(dongzhiYear) {
  const cached = lunarMonthsCache.get(dongzhiYear);
  if (cached !== undefined) return cached;

  const y = Math.trunc(dongzhiYear);
  const dz0 = solarTermJd(y, 270);
  const dz1 = solarTermJd(y + 1, 270);
  const k0 = lastNewMoonKOnOrBefore(dz0);
  const k1 = lastNewMoonKOnOrBefore(dz1);
  const moons = [];
  for (let k = k0; k <= k1; k += 1) moons.push(newMoonJde(k));
  const n = moons.length - 1;
  const zhong = zhongqiJds(y);

  let leapIndex = null;
  if (n === 13) {
    for (let i = 0; i < n; i += 1) {
      let has = false;
      for (const z of zhong) {
        if (moons[i] <= z && z < moons[i + 1]) {
          has = true;
          break;
        }
      }
      if (!has) {
        leapIndex = i;
        break;
      }
    }
  }

  const months = [];
  let monthNum = 11;
  let lunarYear = y;
  for (let i = 0; i < n; i += 1) {
    const isLeap = leapIndex !== null && i === leapIndex;
    if (i > 0 && !isLeap) {
      monthNum += 1;
      if (monthNum === 13) {
        monthNum = 1;
        lunarYear = y + 1;
      }
    }
    // 朔的北京日期：朔时刻是 TT，必须先扣 ΔT 换成 UTC 再取北京日历日
    const start = beijingFromJd(jdTtToJdUtc(moons[i]));
    const next = beijingFromJd(jdTtToJdUtc(moons[i + 1]));
    const startJdn = jdn(start.y, start.m, start.d);
    const nextJdn = jdn(next.y, next.m, next.d);
    months.push({
      year: lunarYear,
      month: monthNum,
      leap: isLeap,
      startJdn,
      days: nextJdn - startJdn,
      shuoJd: moons[i],
    });
  }
  lunarMonthsCache.set(dongzhiYear, months);
  return months;
}

/** 覆盖该公历年的农历月（含前后冬至段，去重）。 */
function lunarMonthsCoveringSolarYear(solarYear) {
  const a = lunarMonthsBetweenDongzhi(solarYear - 1);
  const b = lunarMonthsBetweenDongzhi(solarYear);
  const seen = new Set();
  const out = [];
  for (const m of [...a, ...b]) {
    const key = `${m.startJdn}:${m.year}:${m.month}:${m.leap}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  out.sort((x, y) => x.startJdn - y.startJdn);
  return out;
}

/**
 * 公历日 → 农历 `{ year, month, day, leap }`。
 * @param {number} y - 公历年。
 * @param {number} m - 公历月。
 * @param {number} d - 公历日。
 * @returns {{year:number,month:number,day:number,leap:boolean}} 农历日期。
 * @throws {RangeError} 超出推算范围时。
 */
export function solarToLunar(y, m, d) {
  const target = jdn(y, m, d);
  let months = lunarMonthsCoveringSolarYear(y);
  // 跨年：1 月可能落在上一段十二月，12 月落在下一年冬至段
  if (y - 1 >= 1890) {
    months = [...lunarMonthsBetweenDongzhi(y - 2), ...months];
  }
  for (const info of months) {
    const start = info.startJdn;
    const end = start + info.days;
    if (start <= target && target < end) {
      return { year: info.year, month: info.month, day: target - start + 1, leap: info.leap };
    }
  }
  throw new RangeError(`无法把 ${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} 换成农历（超出推算范围）`);
}

/**
 * 农历日 → 公历 `{ y, m, d }`。闰月必须 `leap=true`。
 * @param {number} ly - 农历年。
 * @param {number} lm - 农历月。
 * @param {number} ld - 农历日。
 * @param {boolean} [leap] - 是否闰月。
 * @returns {{y:number,m:number,d:number}} 公历日期。
 * @throws {RangeError} 该农历月/日不存在时。
 */
export function lunarToSolar(ly, lm, ld, leap = false) {
  const months = [
    ...lunarMonthsBetweenDongzhi(ly - 1),
    ...lunarMonthsBetweenDongzhi(ly),
  ];
  const found = months.find(
    (info) => info.year === ly && info.month === lm && Boolean(info.leap) === Boolean(leap),
  );
  if (found === undefined) {
    const monthName = LUNAR_MONTH_NAMES.get(lm) ?? `${lm}月`;
    if (leap) throw new RangeError(`农历 ${ly}年没有闰${monthName}`);
    throw new RangeError(`找不到农历 ${ly}年${monthName}`);
  }
  if (ld < 1 || ld > found.days) {
    throw new RangeError(
      `农历 ${ly}年${leap ? '闰' : ''}${LUNAR_MONTH_NAMES.get(lm) ?? `${lm}月`}只有 ${found.days} 天`,
    );
  }
  return jdnToYmd(found.startJdn + ld - 1);
}

/**
 * 农历中文展示串。
 * @param {number} ly - 农历年。
 * @param {number} lm - 农历月。
 * @param {number} ld - 农历日。
 * @param {boolean} leap - 是否闰月。
 * @returns {string} 如「1990年四月廿一」。
 */
export function formatLunar(ly, lm, ld, leap) {
  return `${ly}年${leap ? '闰' : ''}${LUNAR_MONTH_NAMES.get(lm) ?? `${lm}月`}${LUNAR_DAY_NAMES.get(ld) ?? ld}`;
}

// ---------------------------------------------------------------------------
// 干支 / 十神 / 藏干
// ---------------------------------------------------------------------------

/**
 * 六十甲子序号 → 干支。
 * @param {number} index - 序号（任意整数，自动取模）。
 * @returns {[string, string]} `[天干, 地支]`。
 */
export function gzFromIndex(index) {
  const i = pmod(Math.trunc(index), 60);
  return [GAN[i % 10], ZHI[i % 12]];
}

/** 立春后的年干支序号。1984=甲子=0。 */
export function yearGzIndex(year) {
  return pmod(Math.trunc(year) - 4, 60);
}

/** 日柱序号。锚点 1990-05-15 = 16 庚辰。 */
export function dayGzIndex(year, month, day) {
  return pmod(jdn(year, month, day) + 49, 60);
}

/**
 * 十神。以日干为基准。
 * @param {number} dayGan - 日干下标。
 * @param {number|null} otherGan - 他干下标；`null` 返回「—」。
 * @returns {string} 十神名。
 */
export function shishenOf(dayGan, otherGan) {
  if (otherGan === null || otherGan === undefined) return '—';
  const rel = pmod(Math.floor(otherGan / 2) - Math.floor(dayGan / 2), 5);
  if (dayGan % 2 === otherGan % 2) return SHISHEN_SAME[rel];
  return SHISHEN_DIFF[rel];
}

/** 地支藏干展示串，如「丁火、己土」。 */
export function formatCanggan(zhi) {
  const parts = CANGGAN.get(zhi) ?? [];
  return parts.map(([g, wx]) => `${g}${wx}`).join('、');
}

function shenshaPositions(needles, values, labels) {
  const need = typeof needles === 'string' ? new Set([needles]) : new Set(needles);
  const out = [];
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] !== null && values[i] !== undefined && need.has(values[i])) out.push(labels[i]);
  }
  return out;
}

function sanheNeedles(yearZhi, dayZhi, table) {
  return new Set([table.get(SANHE.get(yearZhi)), table.get(SANHE.get(dayZhi))]);
}

/**
 * 日柱所在旬的两个空亡地支。甲子旬戌亥，余旬依次前移。
 * @param {string} dayGan - 日干。
 * @param {string} dayZhi - 日支。
 * @returns {[string, string]} 两个空亡地支。
 */
export function kongwangZhi(dayGan, dayZhi) {
  const start = pmod(ZHI.indexOf(dayZhi) - GAN.indexOf(dayGan), 12);
  return [ZHI[pmod(start - 2, 12)], ZHI[pmod(start - 1, 12)]];
}

/**
 * 命中的神煞行。口径同 references/shensha-table.md；时柱未知则 `hour*` 传 `null`。
 * @param {string} yearGan - 年干。
 * @param {string} yearZhi - 年支。
 * @param {string} monthGan - 月干。
 * @param {string} monthZhi - 月支。
 * @param {string} dayGan - 日干。
 * @param {string} dayZhi - 日支。
 * @param {string|null} hourGan - 时干（未知为 `null`）。
 * @param {string|null} hourZhi - 时支（未知为 `null`）。
 * @param {'男'|'女'} sex - 性别。
 * @returns {string[]} 命中神煞的 Markdown 行。
 */
export function computeShensha(yearGan, yearZhi, monthGan, monthZhi, dayGan, dayZhi, hourGan, hourZhi, sex) {
  const gans = [yearGan, monthGan, dayGan, hourGan];
  const zhis = [yearZhi, monthZhi, dayZhi, hourZhi];
  const mdhZhis = [monthZhi, dayZhi, hourZhi];
  const lines = [];

  const add = (name, positions, method) => {
    if (positions.length > 0) lines.push(`- ${name} — 见于${positions.join('、')} — ${method}`);
  };

  const tianyiNeed = new Set([...(TIANYI.get(yearGan) ?? []), ...(TIANYI.get(dayGan) ?? [])]);
  add('天乙贵人', shenshaPositions(tianyiNeed, zhis, ZHI_LABELS), '年干/日干查地支');

  const [tdKind, tdWord] = TIANDE.get(monthZhi);
  if (tdKind === 'gan') add('天德', shenshaPositions(tdWord, gans, GAN_LABELS), '月支查天干');
  else add('天德', shenshaPositions(tdWord, zhis, ZHI_LABELS), '月支查地支');

  add('月德', shenshaPositions(YUEDE.get(monthZhi), gans, GAN_LABELS), '月支三合');

  add('文昌', shenshaPositions(new Set([WENCHANG.get(yearGan), WENCHANG.get(dayGan)]), zhis, ZHI_LABELS), '年干/日干查地支');
  add('学堂', shenshaPositions(XUETANG.get(dayGan), zhis, ZHI_LABELS), '日干长生');
  add('词馆', shenshaPositions(CIGUAN.get(dayGan), zhis, ZHI_LABELS), '日干临官');

  add('将星', shenshaPositions(sanheNeedles(yearZhi, dayZhi, JIANGXING), zhis, ZHI_LABELS), '年支/日支三合');
  add('华盖', shenshaPositions(sanheNeedles(yearZhi, dayZhi, HUAGAI), zhis, ZHI_LABELS), '年支/日支');
  add('驿马', shenshaPositions(sanheNeedles(yearZhi, dayZhi, YIMA), zhis, ZHI_LABELS), '年支/日支');

  const tianyiPrev = ZHI[pmod(ZHI.indexOf(monthZhi) - 1, 12)];
  add('天医', shenshaPositions(tianyiPrev, zhis, ZHI_LABELS), '月支前一位');
  add('禄神', shenshaPositions(CIGUAN.get(dayGan), zhis, ZHI_LABELS), '日干');
  add('金舆', shenshaPositions(JINYU.get(dayGan), zhis, ZHI_LABELS), '日干');
  add('羊刃', shenshaPositions(YANGBLADE.get(dayGan), zhis, ZHI_LABELS), '日干');
  add('劫煞', shenshaPositions(sanheNeedles(yearZhi, dayZhi, JIESHA), zhis, ZHI_LABELS), '年支/日支');
  add('灾煞', shenshaPositions(sanheNeedles(yearZhi, dayZhi, ZAISHA), zhis, ZHI_LABELS), '年支/日支');
  add('亡神', shenshaPositions(sanheNeedles(yearZhi, dayZhi, WANGSHEN), zhis, ZHI_LABELS), '年支/日支');
  add('桃花/咸池', shenshaPositions(sanheNeedles(yearZhi, dayZhi, TAOHUA), zhis, ZHI_LABELS), '年支/日支');
  add('孤辰', shenshaPositions(GUCHEN.get(yearZhi), zhis, ZHI_LABELS), '年支');
  add('寡宿', shenshaPositions(GUASU.get(yearZhi), zhis, ZHI_LABELS), '年支');
  add('空亡/旬空', shenshaPositions(kongwangZhi(dayGan, dayZhi), zhis, ZHI_LABELS), '日柱旬空');

  const yangYear = GAN.indexOf(yearGan) % 2 === 0;
  const yuanMap = yangYear === (sex === '男') ? YUANCHEN_FORWARD : YUANCHEN_REVERSE;
  add('元辰', shenshaPositions(yuanMap.get(yearZhi), mdhZhis, MDH_ZHI_LABELS), '年支阴阳男女');
  add('血刃', shenshaPositions(XUEREN.get(monthZhi), zhis, ZHI_LABELS), '月支');
  return lines;
}

/**
 * 钟点 → 时支。23:00–01:00 子，其后每两小时一支。
 * @param {number} hour - 时。
 * @param {number} minute - 分。
 * @returns {string} 时支。
 */
export function hourToShichen(hour, minute) {
  const total = hour * 60 + minute;
  if (total >= 23 * 60 || total < 60) return '子';
  return ZHI[Math.floor((hour + 1) / 2) % 12];
}

/**
 * 把各种写法的时辰归一为地支。
 *
 * 接受：地支本身（`午`）、带「时」的写法（`午时`），以及时辰区间
 * （`11:00-13:00`、`11:00–13:00`，即 references/shichen-table.md 里那一列的写法）。
 * 认不出返回 `null`，由调用方决定是报错还是回落——不在这里抛，
 * 以免把「换了一种写法」和「程序缺陷」混成同一个异常。
 *
 * @param {string} value - 待归一的时辰写法。
 * @returns {string|null} 地支；认不出为 null。
 */
export function normalizeShichen(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  if (ZHI.includes(text)) return text;
  const bare = text.endsWith('时') ? text.slice(0, -1).trim() : text;
  if (ZHI.includes(bare)) return bare;
  const range = /^(\d{1,2}):(\d{2})\s*[-–—~至]\s*\d{1,2}:\d{2}$/.exec(text);
  if (range !== null) {
    const hour = Number(range[1]);
    const minute = Number(range[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return hourToShichen(hour, minute);
  }
  return null;
}

/**
 * 时刻是否落在时辰整点边界 ±15 分钟内（真太阳时校正提示用）。
 * @param {number} hour - 时。
 * @param {number} minute - 分。
 * @returns {boolean} 是否临近边界。
 */
export function nearShichenBoundary(hour, minute) {
  const total = hour * 60 + minute;
  return SHICHEN_BOUNDARIES_MIN.some((b) => Math.abs(total - b) <= 15);
}

// ---------------------------------------------------------------------------
// 排盘
// ---------------------------------------------------------------------------

/** 立春时刻分年。1990-02-03 10:00 → 己巳。 */
function resolveYearPillar(birthJd, calYear) {
  const lichun = solarTermUtcJd(calYear, 315);
  const yearNum = birthJd >= lichun ? calYear : calYear - 1;
  const [gan, zhi] = gzFromIndex(yearGzIndex(yearNum));
  return { yearNum, gan, zhi, lichun };
}

/** 十二节分月 + 年上起月。1990-05-15 → 辛巳。 */
function resolveMonthPillar(birthJd, yearGanIndex, calYear) {
  const events = jieEventsAround(calYear);
  let current = null;
  let nextJie = null;
  let prevJie = null;
  for (let i = 0; i < events.length; i += 1) {
    if (events[i].jd <= birthJd) {
      current = events[i];
    } else {
      nextJie = events[i];
      if (i >= 1) prevJie = events[i - 1];
      break;
    }
  }
  if (current === null) throw new RangeError('找不到出生时刻之前的节气');
  if (prevJie === null) {
    // birth 落在列表最后一节之后：向后一年找 next
    prevJie = current;
    const later = jieEventsAround(calYear + 1);
    const found = later.find((ev) => ev.jd > birthJd);
    nextJie = found ?? null;
  }
  const yueZhi = ZHI[current.zhiIndex];
  // 寅=2 对应年上起月的第 0 步
  const step = pmod(current.zhiIndex - 2, 12);
  const yueGan = GAN[pmod(YUE_GAN_YIN.get(yearGanIndex) + step, 10)];
  return { gan: yueGan, zhi: yueZhi, name: current.name, lon: current.lon, prevJieJd: prevJie.jd, nextJieJd: nextJie ? nextJie.jd : null };
}

/** 早晚子时日界。 */
function resolveDayPillar(solarJdn, hour) {
  let usedJdn = solarJdn;
  let zishi = '无';
  if (hour !== null && hour !== undefined) {
    if (hour >= 23) {
      usedJdn = usedJdn + 1;
      zishi = '夜子时';
    } else if (hour === 0) {
      zishi = '早子时';
    }
  }
  const { y, m, d } = jdnToYmd(usedJdn);
  const idx = dayGzIndex(y, m, d);
  const [gan, zhi] = gzFromIndex(idx);
  return { gan, zhi, index: idx, zishi };
}

function resolveHourPillar(dayGanIndex, shichen) {
  if (!shichen) return [null, null];
  const zhiIndex = ZHI.indexOf(shichen);
  const ganIndex = pmod(ZI_SHI_GAN.get(dayGanIndex) + zhiIndex, 10);
  return [GAN[ganIndex], ZHI[zhiIndex]];
}

/** 天数 ÷ 3 = 岁；余 1 天≈4 个月，余 2 天≈8 个月。不足一天按比例折月。 */
export function qiyunFromDays(days) {
  const value = Math.abs(Number(days));
  const whole = Math.floor(value);
  const frac = value - whole;
  let years = Math.floor(whole / 3);
  let months = (whole % 3) * 4 + pyRound(frac * 4);
  if (months >= 12) {
    years += Math.floor(months / 12);
    months %= 12;
  }
  return { years, months };
}

/** 从月柱下一柱（顺）或上一柱（逆）起排。月柱本身是起运前小运。 */
export function buildDayun(monthGan, monthZhi, forward, qiyunYears, qiyunMonths, steps = 8) {
  let gi = GAN.indexOf(monthGan);
  let zi = ZHI.indexOf(monthZhi);
  const delta = forward ? 1 : -1;
  const rows = [];
  const startAge = qiyunYears;
  if (qiyunYears > 0 || qiyunMonths > 0) {
    const preEnd = qiyunMonths === 0 ? `${qiyunYears}岁` : `${qiyunYears}岁${qiyunMonths}个月`;
    rows.push({ seq: '起运前', ages: `0岁-${preEnd}`, gz: `${monthGan}${monthZhi}（小运）` });
  }
  for (let n = 1; n <= steps; n += 1) {
    gi = pmod(gi + delta, 10);
    zi = pmod(zi + delta, 12);
    const a0 = startAge + (n - 1) * 10;
    rows.push({ seq: String(n), ages: `${a0}-${a0 + 9}岁`, gz: `${GAN[gi]}${ZHI[zi]}` });
  }
  return rows;
}

/** 某年流年干支。 */
export function liunianGz(year) {
  const [g, z] = gzFromIndex(yearGzIndex(year));
  return g + z;
}

// ---------------------------------------------------------------------------
// 核心排盘
// ---------------------------------------------------------------------------

/**
 * 核心排盘。
 *
 * `solar` 为公历年月日；`hour`/`minute` 为北京钟表时刻，可空。
 * 传 `lunar` 且不传 `solar` 时先换算公历；两者都给以 `solar` 为准。
 *
 * @param {object} input - 排盘输入。
 * @param {{y:number,m:number,d:number}} [input.solar] - 公历生日。
 * @param {{y:number,m:number,d:number,leap?:boolean}} [input.lunar] - 农历生日。
 * @param {number} [input.hour] - 出生时（北京钟表）。
 * @param {number} [input.minute] - 出生分。
 * @param {string} [input.shichen] - 时辰地支（与 hour 互斥，hour 优先）。
 * @param {'男'|'女'} [input.sex] - 性别，默认男。
 * @param {string} [input.place] - 出生地（只展示 + 边界警告）。
 * @param {number} [input.deceasedYear] - 已故年份，流年只列到该年。
 * @param {number} [input.nowYear] - 「当前年份」覆盖（测试用）。
 * @returns {object} 排盘结果。
 * @throws {RangeError} 输入无法推算时。
 */
export function compute(input) {
  const {
    solar = null,
    lunar = null,
    sex = '男',
    place = null,
    deceasedYear = null,
    nowYear = null,
  } = input ?? {};

  let solarDate = solar;
  let lunarDisplay = null;
  if (lunar !== null && lunar !== undefined) {
    const converted = lunarToSolar(lunar.y, lunar.m, lunar.d, Boolean(lunar.leap));
    lunarDisplay = formatLunar(lunar.y, lunar.m, lunar.d, Boolean(lunar.leap));
    if (solarDate === null) solarDate = converted;
  }
  if (solarDate === null) throw new RangeError('至少提供阳历或农历生日');

  const warnings = [];
  let hour = input.hour ?? null;
  let minute = input.minute ?? 0;
  let shichen = null;
  if (input.shichen !== undefined && input.shichen !== null && input.shichen !== '') {
    shichen = normalizeShichen(input.shichen);
    if (shichen === null) throw new RangeError(`无法识别的时辰：${JSON.stringify(input.shichen)}（应为地支、带「时」的写法或 11:00-13:00 这类区间）`);
  }
  const clockKnown = hour !== null && hour !== undefined;
  const shichenKnown = Boolean(shichen);

  if (clockKnown) {
    shichen = hourToShichen(hour, minute);
  } else if (shichenKnown) {
    [hour, minute] = SHICHEN_MID.get(shichen);
  } else {
    hour = 12;
    minute = 0;
    warnings.push('时辰未知');
  }

  const solarJdn = jdn(solarDate.y, solarDate.m, solarDate.d);
  const birthJd = jdFromBeijing(solarDate.y, solarDate.m, solarDate.d, hour, minute);

  const { yearNum, gan: yearGan, zhi: yearZhi, lichun } = resolveYearPillar(birthJd, solarDate.y);
  const month = resolveMonthPillar(birthJd, GAN.indexOf(yearGan), solarDate.y);

  let day;
  if (clockKnown) {
    day = resolveDayPillar(solarJdn, hour);
  } else if (shichenKnown && shichen === '子') {
    day = resolveDayPillar(solarJdn, 0);
    warnings.push('未提供具体时刻，子时按早子时（当日日柱）处理');
  } else {
    day = resolveDayPillar(solarJdn, null);
  }

  const dayGanIndex = GAN.indexOf(day.gan);
  let hourGan = null;
  let hourZhi = null;
  let hourUnknown = true;
  if (clockKnown || shichenKnown) {
    [hourGan, hourZhi] = resolveHourPillar(dayGanIndex, shichen);
    hourUnknown = false;
  } else {
    day.zishi = '无';
  }

  const pillars = {
    year: {
      gan: yearGan,
      zhi: yearZhi,
      shishen: shishenOf(dayGanIndex, GAN.indexOf(yearGan)),
      canggan: formatCanggan(yearZhi),
    },
    month: {
      gan: month.gan,
      zhi: month.zhi,
      shishen: shishenOf(dayGanIndex, GAN.indexOf(month.gan)),
      canggan: formatCanggan(month.zhi),
    },
    day: { gan: day.gan, zhi: day.zhi, shishen: '—', canggan: formatCanggan(day.zhi) },
    hour: hourUnknown
      ? { gan: '未知', zhi: '未知', shishen: '未知', canggan: '未知' }
      : {
          gan: hourGan,
          zhi: hourZhi,
          shishen: shishenOf(dayGanIndex, GAN.indexOf(hourGan)),
          canggan: formatCanggan(hourZhi),
        },
  };

  const yearGanIndex = GAN.indexOf(yearGan);
  const yangYear = yearGanIndex % 2 === 0;
  // 阳年男 / 阴年女顺排；阴年男 / 阳年女逆排。1990-05-15 男（庚午阳年）必须顺排。
  const forward = sex === '男' ? yangYear : !yangYear;

  const jieForQiyun = forward ? month.nextJieJd : month.prevJieJd;
  if (jieForQiyun === null || jieForQiyun === undefined) throw new RangeError('无法定位起运所用的节');
  const qiyunDays = Math.abs(jieForQiyun - birthJd);
  const { years: qiyunYears, months: qiyunMonths } = qiyunFromDays(qiyunDays);
  const dayunRows = buildDayun(month.gan, month.zhi, forward, qiyunYears, qiyunMonths);

  // 节气交界 / 立春前后：距节或立春 24 小时内
  if (month.nextJieJd !== null && Math.abs(birthJd - month.nextJieJd) <= 1) warnings.push('节气交界');
  if (Math.abs(birthJd - month.prevJieJd) <= 1 && !warnings.includes('节气交界')) warnings.push('节气交界');
  let nearLichun = Math.abs(birthJd - lichun) <= 1;
  if (!nearLichun) {
    for (const y of [solarDate.y - 1, solarDate.y + 1]) {
      if (Math.abs(birthJd - solarTermUtcJd(y, 315)) <= 1) {
        nearLichun = true;
        break;
      }
    }
  }
  if (nearLichun) warnings.push('立春前后');

  if (place && clockKnown && nearShichenBoundary(hour, minute)) warnings.push('校正后可能跨时辰');

  const currentYear = nowYear ?? beijingFromJd(Date.now() / 86400000 + UNIX_JD).y;
  const birthYear = solarDate.y;
  let endYear = deceasedYear !== null && deceasedYear !== undefined ? Math.trunc(deceasedYear) : currentYear;
  const showCurrentYear = endYear;
  if (endYear < birthYear) endYear = birthYear;

  const liunianYears = [];
  for (let y = birthYear; y <= endYear; y += 1) liunianYears.push(y);

  // 只给阳历时才由公开历回推农历；给了农历就用用户字串（两个都给时以阳历排盘、农历仅展示）
  if (lunar === null || lunar === undefined) {
    try {
      const { year: ly, month: lm, day: ld, leap } = solarToLunar(solarDate.y, solarDate.m, solarDate.d);
      lunarDisplay = formatLunar(ly, lm, ld, leap);
    } catch (error) {
      lunarDisplay = '未知';
      warnings.push(String(error.message ?? error));
    }
  }

  const solarText = clockKnown
    ? `${String(solarDate.y).padStart(4, '0')}-${String(solarDate.m).padStart(2, '0')}-${String(solarDate.d).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    : `${String(solarDate.y).padStart(4, '0')}-${String(solarDate.m).padStart(2, '0')}-${String(solarDate.d).padStart(2, '0')}`;
  const shichenText = clockKnown
    ? `${shichen} / ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    : shichenKnown
      ? shichen
      : '未知';

  const qiyunText = qiyunMonths ? `${qiyunYears}岁${qiyunMonths}个月` : `${qiyunYears}岁`;

  const shenshaLines = computeShensha(
    yearGan, yearZhi, month.gan, month.zhi, day.gan, day.zhi, hourGan, hourZhi, sex,
  );

  return {
    solar_text: solarText,
    lunar_text: lunarDisplay,
    shichen_text: shichenText,
    sex,
    place,
    zishi: day.zishi,
    pillars,
    forward,
    qiyun_text: qiyunText,
    qiyun_years: qiyunYears,
    qiyun_months: qiyunMonths,
    dayun_rows: dayunRows,
    liunian_years: liunianYears,
    current_year: showCurrentYear,
    current_gz: liunianGz(showCurrentYear),
    warnings: [...new Set(warnings)],
    hour_unknown: hourUnknown,
    year_num: yearNum,
    jie_name: month.name,
    shensha_lines: shenshaLines,
  };
}

/**
 * 排盘结果 → Markdown 报告（与 Python 原实现 stdout 逐字一致）。
 * @param {object} result - {@link compute} 的返回值。
 * @returns {string} Markdown 报告。
 */
export function formatReport(result) {
  const p = result.pillars;
  const lines = [];
  lines.push('## 输入');
  lines.push(`- 阳历：${result.solar_text}`);
  lines.push(`- 农历：${result.lunar_text}`);
  lines.push(`- 时辰：${result.shichen_text}`);
  lines.push(`- 性别：${result.sex}`);
  if (result.place) lines.push(`- 出生地：${result.place}`);
  lines.push(`- 子时：${result.zishi}`);
  lines.push('');
  lines.push('## 四柱');
  lines.push('| | 年柱 | 月柱 | 日柱 | 时柱 |');
  lines.push('|---|---|---|---|---|');
  lines.push(`| 天干 | ${p.year.gan} | ${p.month.gan} | ${p.day.gan} | ${p.hour.gan} |`);
  lines.push(`| 地支 | ${p.year.zhi} | ${p.month.zhi} | ${p.day.zhi} | ${p.hour.zhi} |`);
  lines.push(`| 十神 | ${p.year.shishen} | ${p.month.shishen} | ${p.day.shishen} | ${p.hour.shishen} |`);
  lines.push(`| 藏干 | ${p.year.canggan} | ${p.month.canggan} | ${p.day.canggan} | ${p.hour.canggan} |`);
  lines.push('');
  lines.push('## 大运');
  lines.push(`- 方向：${result.forward ? '顺排' : '逆排'}`);
  lines.push(`- 起运：${result.qiyun_text}`);
  lines.push('| 大运序 | 年龄范围 | 干支 |');
  lines.push('|---|---|---|');
  for (const row of result.dayun_rows) lines.push(`| ${row.seq} | ${row.ages} | ${row.gz} |`);
  lines.push('');
  lines.push('## 流年');
  lines.push(`- 当前：${result.current_year}年${result.current_gz}`);
  for (const y of result.liunian_years) lines.push(`- ${y}年${liunianGz(y)}`);
  lines.push('');
  lines.push('## 神煞');
  lines.push(...result.shensha_lines);
  lines.push('');
  lines.push('## 警告');
  if (result.warnings.length > 0) {
    for (const w of result.warnings) lines.push(`- ${w}`);
  } else {
    lines.push('- 无');
  }
  lines.push('');
  return lines.join('\n');
}
