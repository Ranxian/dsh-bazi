/**
 * 八字模式（bazi）Host 插件。
 *
 * 一个自包含的命理排盘与论断工作台：把 pai_pan 排盘内核（`engine.js`）、
 * 五行/神煞/干支关系推算（`tables.js`）、典籍参考（`references/*.md`）和
 * 逐节论断记录（storage domain `bazi`）组合成 `bazi_*` 工具集，并注入
 * `bazi:protocol` 系统提示词段与 `bazi` 会话投影（供 Web 页签读取）。
 *
 * 与 dsh-pentest 的结构同构：一个 storage domain + 一组模型工具 +
 * 一段协议 + 一对投影单元（状态视图 + 挂载标记）。差别在于
 * 1. 记录落在宿主默认 JSON 后端（数据量小，不引入 sqlite 依赖）；
 * 2. 排盘由包内 JS 内核直接算，不依赖外部脚本或 python；
 * 3. 子 agent 没有专用提交工具——命理论断由主 agent 一次完成，无需委派回填。
 *
 * @module dsh-bazi
 */

import { readFileSync } from 'node:fs';

import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { defineTool } from '@deepseek-ai/dsh-tools';

import { compute, formatReport, hourToShichen, normalizeShichen, GAN, ZHI } from './engine.js';
import { ganZhiRelations, wuxingStats, SHISHEN_INFO, GAN_INFO, ZHI_INFO, PALACE_INFO } from './tables.js';

/** Cordis 插件名。 */
export const name = 'bazi';

/** 需要的宿主服务：工具注册表与存储域设施。 */
export const inject = ['tools', 'storageDomain'];

/** `bazi:protocol` 系统提示词段的位置（与 pentest 同层）。 */
const BAZI_SECTION_ORDER = 50;

/** 论断分区（与 references/classical-texts.md 的分析框架一一对应）。 */
export const READING_SECTIONS = [
  '日主强弱', '十神', '神煞', '五行平衡', '格局', '大运', '流年', '历史校准', '综合建议', '综述',
];

/** 校准事件所涉领域。 */
export const CALIBRATION_DOMAINS = ['事业', '财运', '感情婚姻', '健康', '学业', '家庭', '迁移', '其他'];

/** 参考文档白名单（对应包内 references/*.md）。 */
export const REFERENCE_DOCS = [
  'wuxing-tables', 'shichen-table', 'dayun-rules', 'shensha-table', 'classical-texts',
];

// ---------------------------------------------------------------------------
// 系统提示词协议
// ---------------------------------------------------------------------------

const BAZI_INSTRUCTIONS = `你是中国传统四柱八字命理的专业研究者（决策 agent）。你熟读《穷通宝典》《三命通会》《滴天髓》《渊海子平》《千里命稿》《协纪辨方书》《果老星宗》《子平真诠》《神峰通考》。
输入：一位命主的出生信息。输出：可复核的命盘 + 有典可依的论断 + 经用户校准的结论。

【铁律】四柱、大运、流年、神煞、五行统计一律以 bazi_paipan 的返回为准。
禁止口算、禁止查记忆中的万年历、禁止自行推日柱/月柱/大运后覆盖内核结果。
内核给出「节气交界」「立春前后」「时辰未知」等警告时，必须照实向用户说明，
并严格采用内核给出的那一套干支；不要另算一套。

【一·收集】按顺序逐个询问，不要一次问完；有明确选项的用 ask_user_question，
姓名、日期、出生地这类自由文本直接发问等待回复：
1) 姓名 → 2) 有无曾用名（有则问改名大致年份）→ 3) 阳历生日（不知道就说不知道）→
4) 农历生日（闰月要标注；不知道就说不知道；阳历农历都未知则无法排盘，请用户查出生证明或问家人）→
5) 出生时辰（只知道大概时段也可；不确定就标未知，后续只做六字分析）→ 6) 性别（必问，决定大运顺逆）→
7) 出生省份城市（用于真太阳时提示）
默认把命主视为在世，不要主动问是否在世；仅当用户自己说明在分析已故亲友时，才追问去世年份。
八项齐了就做一次「信息确认」汇总，请用户核对；确认后再进入排盘。

【二·起盘】调用 bazi_start 记录命主信息。它是「新建或重置」：再次调用会清空本会话
已有的命盘、论断与校准（改生辰后重排必须如此），所以只在信息确认后调用。
时辰未知时传 timeUnknown。

【三·排盘】确认后必须先调用 bazi_paipan，它落地命盘并返回 Markdown 排盘结果
（四柱/大运/流年/神煞/五行统计/干支关系/警告）。用户要看盘就直接引用它的内容。
内核已算好的五行力量统计与刑冲合害关系不要再手数一遍——那是内核的活。

【四·论断】读 references 后按框架逐节分析，每节用 bazi_add_reading 记录
（section: 日主强弱 / 十神 / 神煞 / 五行平衡 / 格局 / 大运 / 流年 / 历史校准 / 综合建议 / 综述）。
每条论断必须引用典籍出处，例如「《穷通宝典》调候原则：甲木生酉月，先丁火制金，次丙火暖木」。
神煞只解释 bazi_paipan 已列出的条目，不要补算未列出的神煞。
需要查表或查典籍规则时用 bazi_reference（五行/十神表、时辰对照、大运规则、神煞表、典籍摘要），
不要凭记忆引用条款。
论断之间的派生关系用 derivedFromReadingId 说明：后一节从前一节的结论推出来时挂上它。

【五·校准】这是关键一步。排完盘先提出 3-5 个「该人已经发生过的」关键时段与性质
（如事业转折、感情变化、迁移、健康波动），逐个用 bazi_add_calibration 记录，
年份区间与年龄区间都要给，并写清推演依据。把预测讲给用户听，请他确认。
用户答复后用 bazi_confirm_calibration 回填 outcome（相符/部分相符/不符）与反馈原文，
并在 revisedModel 里写下你据此对格局或喜用神理解的修正。校准结果必须影响后续综合建议；
若校准普遍不符，要明确说明原局判断可能需要调整，而不是继续照原结论下断语。

【六·收束】调用 bazi_report 产出最终报告（命盘 + 论断链 + 校准结果 + 建议）。

纪律：
- 与用户的一切交互使用中文；报告、提问、追问都用中文。
- 命理分析仅供文化研究与参考，不是科学预测。语气保持中立、建设性，
  不给极端或恐吓性断语；涉及健康提醒以医学诊断为准，涉及财务提醒理性决策；
  报告结尾保留「命理分析仅供参考，人生在于自身的努力和选择」。
- 时柱未知时只做年月日六字分析，不推断时柱相关的任何内容，也不要用时柱去凑神煞。
- 全部记录落在 storage domain；strip 掉与本节无关的闲谈，论断要落成文本而不是留在对话里。`;

// ---------------------------------------------------------------------------
// 存储域 spec
// ---------------------------------------------------------------------------

const id = z.string().min(1);
const sexEnum = z.enum(['男', '女']);

const pillarSchema = z.object({
  gan: z.string(),
  zhi: z.string(),
  shishen: z.string(),
  canggan: z.string(),
});

const pillarsSchema = z.object({
  year: pillarSchema,
  month: pillarSchema,
  day: pillarSchema,
  hour: pillarSchema,
});

/** 五行分值的固定键集合（用显式对象而非 record，避免不同 zod 版本 record 签名差异）。 */
const wuxingMapSchema = z.object({
  木: z.number(), 火: z.number(), 土: z.number(), 金: z.number(), 水: z.number(),
});

const relationSchema = z.object({
  kind: z.string(),
  detail: z.string(),
  pillars: z.array(z.string()),
});

const dayunRowSchema = z.object({
  seq: z.string(),
  ages: z.string(),
  gz: z.string(),
});

const liunianRowSchema = z.object({
  year: z.number().int(),
  gz: z.string(),
});

const subjectSchema = z.object({
  id,
  sessionId: id,
  name: z.string().default(''),
  formerName: z.string().default(''),
  formerNameYear: z.string().default(''),
  sex: sexEnum,
  birthPlace: z.string().default(''),
  /** 阳历生日 `YYYY-MM-DD`；未提供为空串。 */
  solar: z.string().default(''),
  /** 农历生日 `YYYY-MM-DD`（数字月日）；未提供为空串。 */
  lunar: z.string().default(''),
  leap: z.boolean().default(false),
  hour: z.number().int().min(0).max(23).optional(),
  minute: z.number().int().min(0).max(59).optional(),
  shichen: z.string().default(''),
  timeUnknown: z.boolean().default(false),
  deceasedYear: z.number().int().optional(),
  note: z.string().default(''),
  createdAt: z.string(),
});

const chartSchema = z.object({
  id,
  sessionId: id,
  subjectId: id,
  solarText: z.string(),
  lunarText: z.string(),
  shichenText: z.string(),
  sex: sexEnum,
  place: z.string().default(''),
  zishi: z.string(),
  forward: z.boolean(),
  qiyunText: z.string(),
  qiyunYears: z.number().int(),
  qiyunMonths: z.number().int(),
  pillars: pillarsSchema,
  dayun: z.array(dayunRowSchema),
  liunian: z.array(liunianRowSchema),
  currentYear: z.number().int(),
  currentGz: z.string(),
  yearNum: z.number().int(),
  jieName: z.string(),
  hourUnknown: z.boolean(),
  shensha: z.array(z.string()),
  warnings: z.array(z.string()),
  stats: z.object({
    score: wuxingMapSchema,
    share: wuxingMapSchema,
    counts: wuxingMapSchema,
    present: z.array(z.string()),
    missing: z.array(z.string()),
    strongest: z.string(),
    weakest: z.string(),
    total: z.number(),
    pillarCount: z.number().int(),
    method: z.string(),
  }),
  relations: z.object({
    branch: z.array(relationSchema),
    stem: z.array(relationSchema),
  }),
  engine: z.string(),
  computedAt: z.string(),
});

const readingSchema = z.object({
  id,
  sessionId: id,
  subjectId: id,
  section: z.enum(READING_SECTIONS),
  title: z.string().min(1),
  content: z.string().min(1),
  /** 典籍出处引用（可为空串）。 */
  citation: z.string().default(''),
  createdAt: z.string(),
});

const calibrationSchema = z.object({
  id,
  sessionId: id,
  subjectId: id,
  yearFrom: z.number().int(),
  yearTo: z.number().int(),
  ageFrom: z.number().int(),
  ageTo: z.number().int(),
  domain: z.enum(CALIBRATION_DOMAINS),
  prediction: z.string().min(1),
  basis: z.string().default(''),
  outcome: z.enum(['待验证', '相符', '部分相符', '不符']).default('待验证'),
  feedback: z.string().default(''),
  revisedModel: z.string().default(''),
  createdAt: z.string(),
});

const edgeSchema = z.object({
  id,
  sessionId: id,
  /** spawns: 命主→论断；derived_from: 论断→论断；calibrates: 命盘→校准。 */
  kind: z.enum(['spawns', 'derived_from', 'calibrates']),
  sourceId: id,
  targetId: id,
});

/** 八字模式的 storage domain（版本 1）。 */
export const baziDomainSpec = defineDomain({
  name: 'bazi',
  version: 1,
  tables: {
    subjects: domainTable(subjectSchema),
    charts: domainTable(chartSchema),
    readings: domainTable(readingSchema),
    calibrations: domainTable(calibrationSchema),
    edges: domainTable(edgeSchema),
  },
});

// ---------------------------------------------------------------------------
// 会话投影（Web 页签的数据源）
// ---------------------------------------------------------------------------

const BAZI_TOOL_PREFIX = 'bazi_';

const pillarViewSchema = z.object({
  gan: z.string(),
  zhi: z.string(),
  shishen: z.string(),
  canggan: z.string(),
});

const subjectViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  formerName: z.string(),
  sex: z.string(),
  birthPlace: z.string(),
  solar: z.string(),
  lunar: z.string(),
  shichen: z.string(),
  timeUnknown: z.boolean(),
});

/**
 * 命盘视图。**唯一**一份形状声明：投影的 `viewSchema` 与 `bazi_paipan`
 * 结果里 `chart` 字段的校验都按它来，两边不可能各自漂移。
 */
const chartViewSchema = z.object({
  solarText: z.string(),
  lunarText: z.string(),
  shichenText: z.string(),
  zishi: z.string(),
  forward: z.boolean(),
  qiyunText: z.string(),
  currentYear: z.number().int(),
  currentGz: z.string(),
  jieName: z.string(),
  hourUnknown: z.boolean(),
  pillars: z.object({
    year: pillarViewSchema, month: pillarViewSchema,
    day: pillarViewSchema, hour: pillarViewSchema,
  }),
  dayun: z.array(z.object({ seq: z.string(), ages: z.string(), gz: z.string() })),
  // 神煞名与依据分开：客户端把名做成标签、依据放到悬停里，
  // 直接塞内核那行 Markdown（`- 天乙贵人 — 见于年支、时支 — …`）没法用。
  shensha: z.array(z.object({ name: z.string(), detail: z.string() })),
  warnings: z.array(z.string()),
  score: z.object({
    木: z.number(), 火: z.number(), 土: z.number(), 金: z.number(), 水: z.number(),
  }),
  share: z.object({
    木: z.number(), 火: z.number(), 土: z.number(), 金: z.number(), 水: z.number(),
  }),
  relations: z.array(z.object({ kind: z.string(), detail: z.string() })),
});

const readingViewSchema = z.object({
  id: z.string(),
  section: z.string(),
  title: z.string(),
  content: z.string(),
  citation: z.string(),
});

const calibrationViewSchema = z.object({
  id: z.string(),
  ages: z.string(),
  years: z.string(),
  domain: z.string(),
  prediction: z.string(),
  outcome: z.string(),
  feedback: z.string(),
});

const edgeViewSchema = z.object({
  id: z.string(), kind: z.string(), sourceId: z.string(), targetId: z.string(),
});

/**
 * 折叠状态。`stateSchema` 校验的是**状态**，所以它带 `counters` 而不带
 * `counts`——`counts` 是 `view` 读出来的派生量。两者混用会让持久化缓存
 * 回灌时校验失败。
 */
const baziStateSchema = z.object({
  subject: subjectViewSchema.nullable(),
  chart: chartViewSchema.nullable(),
  readings: z.array(readingViewSchema),
  calibrations: z.array(calibrationViewSchema),
  edges: z.array(edgeViewSchema),
  counters: z.object({
    reading: z.number().int().nonnegative(),
    calibration: z.number().int().nonnegative(),
    edge: z.number().int().nonnegative(),
  }),
});

/** 客户端视图：折叠状态 + 派生计数；未开始时整值为 null（页签据此隐藏）。 */
const baziProjectionSchema = z.union([
  baziStateSchema.omit({ counters: true }).extend({
    counts: z.object({
      readings: z.number().int().nonnegative(),
      calibrations: z.number().int().nonnegative(),
      confirmed: z.number().int().nonnegative(),
    }),
  }),
  z.null(),
]);

const mountedSchema = z.boolean();

const initialProjectionState = {
  subject: null,
  chart: null,
  readings: [],
  calibrations: [],
  edges: [],
  counters: { reading: 0, calibration: 0, edge: 0 },
};

/** 解析工具调用事件的参数（仅 bazi_* 工具）。 */
function argsOf(event) {
  if (event.type !== 'tool/call' || !event.data.name.startsWith(BAZI_TOOL_PREFIX)) return undefined;
  try {
    const parsed = JSON.parse(event.data.arguments);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function str(value) {
  return typeof value === 'string' ? value : '';
}

function num(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 确定性 id：`<kind>-<n>`，按会话计数。
 *
 * 与 pentest 同法——id 在日志重放中可复现，模型可跨调用引用。
 * `bazi_start` 重置整图时计数归零。
 */
function nextId(state, kind) {
  const counters = { ...state.counters, [kind]: state.counters[kind] + 1 };
  return { id: `${kind}-${counters[kind]}`, counters };
}

/** 投影侧的读法：把一次记录折叠进状态（镜像 store 的引用拒绝）。 */
function applyBaziEvent(state, event) {
  // 命盘在 bazi_paipan 内部算出，参数里没有，所以它只能从工具**结果**回来：
  // 结果事件带工具自己的 `meta` 载荷（output.presentationMeta 的产物），
  // 与参数折出来的论断/校准一样会进日志、一样能重放。
  if (event.type === 'tool/result') {
    const meta = event.data?.meta;
    if (meta === null || typeof meta !== 'object' || meta.kind !== 'bazi/chart') return state;
    if (state.subject === null || meta.subjectId !== state.subject.id) return state;
    if (meta.chart === null || typeof meta.chart !== 'object') return state;
    return { ...state, chart: meta.chart };
  }
  const args = argsOf(event);
  if (event.type !== 'tool/call' || args === undefined) return state;

  switch (event.data.name) {
    case 'bazi_start': {
      const sex = args.sex === '女' ? '女' : '男';
      return {
        subject: {
          id: 'subject-1',
          name: str(args.name),
          formerName: str(args.formerName),
          sex,
          birthPlace: str(args.birthPlace),
          solar: str(args.solar),
          lunar: str(args.lunar),
          shichen: resolveShichen(args),
          timeUnknown: args.timeUnknown === true,
        },
        chart: null,
        readings: [],
        calibrations: [],
        edges: [],
        counters: { reading: 0, calibration: 0, edge: 0 },
      };
    }
    case 'bazi_add_reading': {
      if (state.subject === null) return state;
      const title = str(args.title);
      const content = str(args.content);
      if (title === '' || content === '') return state;
      const section = READING_SECTIONS.includes(args.section) ? args.section : '综述';
      const { id: readingId, counters } = nextId(state, 'reading');
      const anchorId = str(args.derivedFromReadingId);
      const edges = anchorId === ''
        ? state.edges
        : [...state.edges, {
            id: `edge-${counters.edge + 1}`,
            kind: 'derived_from',
            sourceId: anchorId,
            targetId: readingId,
          }];
      return {
        ...state,
        counters: anchorId === '' ? counters : { ...counters, edge: counters.edge + 1 },
        readings: [...state.readings, {
          id: readingId,
          section,
          title,
          content,
          citation: str(args.citation),
        }],
        edges,
      };
    }
    case 'bazi_add_calibration': {
      if (state.subject === null) return state;
      const prediction = str(args.prediction);
      if (prediction === '') return state;
      const { id: calibrationId, counters } = nextId(state, 'calibration');
      const yearFrom = num(args.yearFrom);
      const yearTo = num(args.yearTo, yearFrom);
      const ageFrom = num(args.ageFrom);
      const ageTo = num(args.ageTo, ageFrom);
      const domain = CALIBRATION_DOMAINS.includes(args.domain) ? args.domain : '其他';
      return {
        ...state,
        counters,
        calibrations: [...state.calibrations, {
          id: calibrationId,
          ages: ageFrom === ageTo ? `${ageFrom}岁` : `${ageFrom}-${ageTo}岁`,
          years: yearFrom === yearTo ? `${yearFrom}年` : `${yearFrom}-${yearTo}年`,
          domain,
          prediction,
          outcome: '待验证',
          feedback: '',
        }],
      };
    }
    case 'bazi_confirm_calibration': {
      const calibrationId = str(args.calibrationId);
      const outcome = ['相符', '部分相符', '不符'].includes(args.outcome) ? args.outcome : '待验证';
      return {
        ...state,
        calibrations: state.calibrations.map((c) => (
          c.id === calibrationId
            ? { ...c, outcome, feedback: str(args.feedback) }
            : c
        )),
      };
    }
    default:
      return state;
  }
}

/** 该会话自身日志是否证明组合挂载了本插件。 */
function provesMounted(event) {
  const loose = event;
  if (loose.type === 'tool/call') {
    return typeof loose.data?.name === 'string' && loose.data.name.startsWith(BAZI_TOOL_PREFIX);
  }
  if (loose.type !== 'request/header') return false;
  const tools = loose.data?.header?.tools;
  return Array.isArray(tools)
    && tools.some((tool) => typeof tool?.name === 'string' && tool.name.startsWith(BAZI_TOOL_PREFIX));
}

function applyMounted(mounted, event) {
  if (mounted) return mounted;
  return provesMounted(event);
}

/** 投影状态 → 客户端视图。 */
function viewBaziState(state) {
  if (state.subject === null) return null;
  return {
    subject: state.subject,
    chart: state.chart,
    readings: state.readings,
    calibrations: state.calibrations,
    edges: state.edges,
    counts: {
      readings: state.readings.length,
      calibrations: state.calibrations.length,
      confirmed: state.calibrations.filter((c) => c.outcome === '相符' || c.outcome === '部分相符').length,
    },
  };
}

// ---------------------------------------------------------------------------
// 记录仓库
// ---------------------------------------------------------------------------

const TABLE_OF_KIND = {
  subject: 'subjects',
  chart: 'charts',
  reading: 'readings',
  calibration: 'calibrations',
  edge: 'edges',
};

/** 去掉对象里的 undefined，避免 JSON 往返与 zod 默认值打架。 */
function clean(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function recordKey(sessionId, id_) {
  return `${sessionId}:${id_}`;
}

/**
 * 记录键：命主与命盘是「每会话一行」的单例（直接以会话 id 为键，重排即覆盖），
 * 论断/校准/边是集合（按 `<会话>:<id>` 分行）。
 */
function keyOf(kind, sessionId, recordId) {
  return kind === 'subject' || kind === 'chart' ? sessionId : recordKey(sessionId, recordId);
}

/**
 * `bazi` 域的记录仓库：会话作用域的读写、确定性 id 分配、引用校验。
 *
 * 与 pentest 的 PentestStore 同构——同一会话的「读—分配—写」串行化，
 * id 计数缓存在内存里、首次触达时从持久表重建。
 */
export class BaziStore {
  constructor(ctx) {
    this.ctx = ctx;
  }

  /** 懒打开 `bazi` 域；打开后不可再开第二份。 */
  domain() {
    if (this.domainPromise === undefined) {
      this.domainPromise = this.ctx.storageDomain.open(baziDomainSpec);
    }
    return this.domainPromise;
  }

  /** 每会话一条写队列（读—分配—写串行化）。 */
  sessionQueues = new Map();

  /** 每会话的 id 序号缓存，首次触达时从持久表重建。 */
  sessionCounters = new Map();

  /** 关闭域并释放后端单元（幂等）。 */
  async dispose() {
    await Promise.all([...this.sessionQueues.values()]);
    const pending = this.domainPromise;
    if (pending !== undefined) {
      this.domainPromise = undefined;
      await (await pending).close();
    }
    this.sessionQueues.clear();
    this.sessionCounters.clear();
  }

  /** 把同一会话的读/分配/写串成一条队列。 */
  enqueue(sessionId, operation) {
    const previous = this.sessionQueues.get(sessionId) ?? Promise.resolve();
    const current = previous.then(operation);
    this.sessionQueues.set(sessionId, current.then(() => undefined, () => undefined));
    return current;
  }

  /** 写入前先按 schema 归一，保证表内记录永远合法（域只在打开时校验）。 */
  async put(sessionId, kind, record) {
    const domain = await this.domain();
    const table = domain.table(TABLE_OF_KIND[kind]);
    const schema = baziDomainSpec.tables[TABLE_OF_KIND[kind]].valueSchema;
    const normalized = schema.parse(record);
    await table.put(keyOf(kind, sessionId, normalized.id), normalized);
    return normalized;
  }

  /** 读命主行，缺失时给出可执行的引导错误。 */
  async requireSubject(sessionId) {
    const domain = await this.domain();
    const subject = domain.table('subjects').get(sessionId);
    if (subject === undefined) {
      throw new Error('八字模式尚未录入命主；请先调用 bazi_start 记录出生信息（姓名、性别、阳历或农历生日、时辰）');
    }
    return subject;
  }

  async getChart(sessionId) {
    const domain = await this.domain();
    return domain.table('charts').get(sessionId);
  }

  async requireChart(sessionId) {
    const chart = await this.getChart(sessionId);
    if (chart === undefined) {
      throw new Error('本会话尚未排盘；请先调用 bazi_paipan（它需要 bazi_start 记录过的出生信息）');
    }
    return chart;
  }

  /** 某会话某一类记录的下一个确定性 id。 */
  async nextId(sessionId, kind) {
    let counters = this.sessionCounters.get(sessionId);
    if (counters === undefined) {
      counters = new Map();
      for (const tableName of ['readings', 'calibrations', 'edges']) {
        for (const [key, row] of (await this.domain()).table(tableName).entries()) {
          if (row.sessionId !== sessionId) continue;
          const matched = /^([a-z_]+)-(\d+)$/.exec(row.id);
          if (matched === null) continue;
          counters.set(matched[1], Math.max(counters.get(matched[1]) ?? 0, Number(matched[2])));
        }
      }
      this.sessionCounters.set(sessionId, counters);
    }
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}-${next}`;
  }

  /** 删除该会话的全部记录（重起一命主）。 */
  async clearSession(sessionId) {
    const domain = await this.domain();
    for (const tableName of ['charts', 'readings', 'calibrations', 'edges']) {
      const table = domain.table(tableName);
      for (const [key, row] of table.entries()) {
        if (row.sessionId === sessionId) await table.delete(key);
      }
    }
  }

  /** 读某一类记录（按 id 序号排序）。 */
  async list(sessionId, tableName) {
    const rows = [];
    for (const [, row] of (await this.domain()).table(tableName).entries()) {
      if (row.sessionId === sessionId) rows.push(row);
    }
    rows.sort((a, b) => {
      const seqA = Number(/-(\d+)$/.exec(a.id)?.[1] ?? Number.MAX_SAFE_INTEGER);
      const seqB = Number(/-(\d+)$/.exec(b.id)?.[1] ?? Number.MAX_SAFE_INTEGER);
      return seqA - seqB;
    });
    return rows;
  }

  /** 新建或重置命主：清空本会话的命盘、论断、校准与边。 */
  async startSubject(sessionId, input) {
    return this.enqueue(sessionId, async () => {
      await this.clearSession(sessionId);
      this.sessionCounters.delete(sessionId);
      const subject = clean({
        id: 'subject-1',
        sessionId,
        name: input.name,
        formerName: input.formerName,
        formerNameYear: input.formerNameYear,
        sex: input.sex,
        birthPlace: input.birthPlace,
        solar: input.solar,
        lunar: input.lunar,
        leap: input.leap,
        hour: input.hour,
        minute: input.minute,
        shichen: resolveShichen(input),
        timeUnknown: input.timeUnknown,
        deceasedYear: input.deceasedYear,
        note: input.note,
        createdAt: new Date().toISOString(),
      });
      return this.put(sessionId, 'subject', subject);
    });
  }

  /** 排盘并落地：命盘按会话单例，重排即覆盖上一张。 */
  async saveChart(sessionId, chart) {
    return this.enqueue(sessionId, () => this.put(sessionId, 'chart', chart));
  }

  /** 记录一条论断，并按派生关系补一条边。 */
  async addReading(sessionId, input) {
    return this.enqueue(sessionId, async () => {
      const subject = await this.requireSubject(sessionId);
      const anchor = input.derivedFromReadingId ?? '';
      if (anchor !== '') await this.requireReading(sessionId, anchor);
      const readingId = await this.nextId(sessionId, 'reading');
      const reading = { ...input, derivedFromReadingId: undefined };
      const saved = await this.put(sessionId, 'reading', clean({
        id: readingId,
        sessionId,
        subjectId: subject.id,
        section: reading.section,
        title: reading.title,
        content: reading.content,
        citation: reading.citation,
        createdAt: new Date().toISOString(),
      }));
      const edges = [];
      // 无派生锚点时挂到命主；有锚点时挂到前一条论断
      const edgeId = await this.nextId(sessionId, 'edge');
      edges.push(await this.put(sessionId, 'edge', {
        id: edgeId,
        sessionId,
        kind: anchor === '' ? 'spawns' : 'derived_from',
        sourceId: anchor === '' ? subject.id : anchor,
        targetId: readingId,
      }));
      return { reading: saved, edge: edges[0] };
    });
  }

  /** 校验一条论断存在且属于本会话。 */
  async requireReading(sessionId, readingId) {
    const domain = await this.domain();
    const row = domain.table('readings').get(recordKey(sessionId, readingId));
    if (row === undefined) throw new Error(`bazi: 未知论断 ${readingId}`);
    return row;
  }

  /** 记录一条校准预测，并补一条 calibrates 边（命盘→校准）。 */
  async addCalibration(sessionId, input) {
    return this.enqueue(sessionId, async () => {
      const subject = await this.requireSubject(sessionId);
      const chart = await this.getChart(sessionId);
      const calibrationId = await this.nextId(sessionId, 'calibration');
      const saved = await this.put(sessionId, 'calibration', {
        ...input,
        id: calibrationId,
        sessionId,
        subjectId: subject.id,
        outcome: '待验证',
        feedback: '',
        revisedModel: '',
        createdAt: new Date().toISOString(),
      });
      if (chart !== undefined) {
        const edgeId = await this.nextId(sessionId, 'edge');
        await this.put(sessionId, 'edge', {
          id: edgeId,
          sessionId,
          kind: 'calibrates',
          sourceId: chart.id,
          targetId: calibrationId,
        });
      }
      return saved;
    });
  }

  /** 回填用户对某条校准的反馈。 */
  async confirmCalibration(sessionId, input) {
    return this.enqueue(sessionId, async () => {
      const domain = await this.domain();
      const table = domain.table('calibrations');
      const key = recordKey(sessionId, input.calibrationId);
      const existing = table.get(key);
      if (existing === undefined) throw new Error(`bazi: 未知校准 ${input.calibrationId}`);
      const next = {
        ...existing,
        outcome: input.outcome,
        feedback: input.feedback,
        ...(input.revisedModel === '' ? {} : { revisedModel: input.revisedModel }),
      };
      const schema = baziDomainSpec.tables.calibrations.valueSchema;
      const normalized = schema.parse(clean(next));
      await table.put(key, normalized);
      return normalized;
    });
  }

  /** 组装最终报告所需的全部行。 */
  async sessionData(sessionId) {
    return {
      subject: (await this.domain()).table('subjects').get(sessionId),
      chart: await this.getChart(sessionId),
      readings: await this.list(sessionId, 'readings'),
      calibrations: await this.list(sessionId, 'calibrations'),
      edges: await this.list(sessionId, 'edges'),
    };
  }
}

// ---------------------------------------------------------------------------
// 报告与展示
// ---------------------------------------------------------------------------

const SECTION_ORDER = new Map(READING_SECTIONS.map((section, index) => [section, index]));

function sortReadings(readings) {
  return [...readings].sort((a, b) => {
    const orderA = SECTION_ORDER.get(a.section) ?? 99;
    const orderB = SECTION_ORDER.get(b.section) ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });
}

/** 命盘区块：四柱 + 大运 + 流年 + 神煞 + 五行统计 + 干支关系 + 警告。 */
function chartMarkdown(chart) {
  const p = chart.pillars;
  const lines = [];
  lines.push('## 四柱');
  lines.push('| | 年柱 | 月柱 | 日柱 | 时柱 |');
  lines.push('|---|---|---|---|---|');
  lines.push(`| 天干 | ${p.year.gan} | ${p.month.gan} | ${p.day.gan} | ${p.hour.gan} |`);
  lines.push(`| 地支 | ${p.year.zhi} | ${p.month.zhi} | ${p.day.zhi} | ${p.hour.zhi} |`);
  lines.push(`| 十神 | ${p.year.shishen} | ${p.month.shishen} | ${p.day.shishen} | ${p.hour.shishen} |`);
  lines.push(`| 藏干 | ${p.year.canggan} | ${p.month.canggan} | ${p.day.canggan} | ${p.hour.canggan} |`);
  lines.push('');
  lines.push(`- 日主：${p.day.gan}（${GAN_INFO.get(p.day.gan)?.wuxing ?? '?'}）`);
  lines.push(`- 月令：${p.month.zhi}（${chart.jieName} 后，${ZHI_INFO.get(p.month.zhi)?.lunarMonth ?? '?'}）`);
  if (chart.hourUnknown) lines.push('- 时柱未知：仅作年月日六字分析');
  lines.push('');
  lines.push('## 大运');
  lines.push(`- 方向：${chart.forward ? '顺排' : '逆排'}`);
  lines.push(`- 起运：${chart.qiyunText}`);
  lines.push('| 大运序 | 年龄范围 | 干支 |');
  lines.push('|---|---|---|');
  for (const row of chart.dayun) lines.push(`| ${row.seq} | ${row.ages} | ${row.gz} |`);
  lines.push('');
  lines.push('## 五行力量（参考统计）');
  lines.push('| 五行 | 分值 | 占比 | 出现次数 |');
  lines.push('|---|---|---|---|');
  for (const wx of ['木', '火', '土', '金', '水']) {
    lines.push(`| ${wx} | ${chart.stats.score[wx]} | ${chart.stats.share[wx]}% | ${chart.stats.counts[wx]} |`);
  }
  lines.push('');
  lines.push(`- 最旺：${chart.stats.strongest}；最弱：${chart.stats.weakest}`);
  lines.push(`- 命局未见：${chart.stats.missing.length === 0 ? '（五行俱全）' : chart.stats.missing.join('、')}`);
  lines.push(`- 口径：${chart.stats.method}`);
  if (chart.stats.pillarCount < 4) lines.push(`- 注：仅统计 ${chart.stats.pillarCount} 柱（时柱未知）`);
  lines.push('');
  const relations = [...chart.relations.branch, ...chart.relations.stem];
  lines.push('## 干支关系');
  if (relations.length === 0) {
    lines.push('- （命局四柱之间无冲合刑害会）');
  } else {
    for (const relation of relations) lines.push(`- ${relation.kind}：${relation.detail}`);
  }
  lines.push('');
  lines.push('## 神煞');
  if (chart.shensha.length === 0) lines.push('- （无）');
  else lines.push(...chart.shensha);
  lines.push('');
  lines.push('## 流年');
  lines.push(`- 当前：${chart.currentYear}年${chart.currentGz}`);
  lines.push(`- 出生至当前共 ${chart.liunian.length} 年，明细见 bazi_chart`);
  lines.push('');
  lines.push('## 警告');
  if (chart.warnings.length === 0) lines.push('- 无');
  else for (const warning of chart.warnings) lines.push(`- ${warning}`);
  return lines.join('\n');
}

function subjectMarkdown(subject) {
  const lines = [];
  lines.push('## 命主');
  lines.push(`- 姓名：${subject.name || '（未提供）'}`);
  if (subject.formerName) {
    lines.push(`- 曾用名：${subject.formerName}（改名时间：${subject.formerNameYear || '不详'}）`);
  }
  lines.push(`- 性别：${subject.sex}`);
  lines.push(`- 阳历：${subject.solar || '未知'}`);
  lines.push(`- 农历：${subject.lunar || '未知'}${subject.leap ? '（闰月）' : ''}`);
  lines.push(`- 时辰：${subject.timeUnknown ? '未知' : (shichenLabel(subject.shichen) || '未知')}`);
  if (subject.birthPlace) lines.push(`- 出生地：${subject.birthPlace}`);
  if (subject.deceasedYear !== undefined) lines.push(`- 已故年份：${subject.deceasedYear}（流年只推到此年）`);
  if (subject.note) lines.push(`- 备注：${subject.note}`);
  return lines.join('\n');
}

/**
 * 生成最终 Markdown 报告。
 * @param {object} data - {@link BaziStore.sessionData} 的返回值。
 * @returns {string} Markdown 报告。
 */
export function buildReport(data) {
  const { subject, chart, readings, calibrations, edges } = data;
  if (subject === undefined) {
    return ['# 八字命理报告', '', '（尚未录入命主：请先调用 bazi_start。）'].join('\n');
  }
  const lines = [];
  lines.push('# 八字命理报告');
  lines.push('');
  lines.push(subjectMarkdown(subject));
  lines.push('');
  if (chart === undefined) {
    lines.push('（尚未排盘：请调用 bazi_paipan。）');
    return lines.join('\n');
  }
  lines.push('## 排盘');
  lines.push(`- 阳历：${chart.solarText}`);
  lines.push(`- 农历：${chart.lunarText}`);
  lines.push(`- 时辰：${chart.shichenText}`);
  if (chart.place) lines.push(`- 出生地：${chart.place}`);
  lines.push(`- 子时：${chart.zishi}`);
  lines.push('');
  lines.push(chartMarkdown(chart));
  lines.push('');
  lines.push('## 论断');
  if (readings.length === 0) {
    lines.push('（尚无论断记录。）');
  } else {
    const anchorOf = (targetId) => {
      const edge = edges.find((e) => e.targetId === targetId);
      return edge === undefined ? '' : `（${edge.kind === 'derived_from' ? '推导自' : '挂于'} ${edge.sourceId}）`;
    };
    let currentSection = null;
    for (const reading of sortReadings(readings)) {
      if (reading.section !== currentSection) {
        currentSection = reading.section;
        lines.push('');
        lines.push(`### ${currentSection}`);
      }
      lines.push('');
      lines.push(`#### ${reading.id}「${reading.title}」${anchorOf(reading.id)}`);
      lines.push(reading.content);
      if (reading.citation) lines.push(`- 出处：${reading.citation}`);
    }
  }
  lines.push('');
  lines.push('## 历史校准');
  if (calibrations.length === 0) {
    lines.push('（尚无校准记录。）');
  } else {
    for (const calibration of calibrations) {
      const years = calibration.yearFrom === calibration.yearTo
        ? `${calibration.yearFrom}年`
        : `${calibration.yearFrom}-${calibration.yearTo}年`;
      const ages = calibration.ageFrom === calibration.ageTo
        ? `${calibration.ageFrom}岁`
        : `${calibration.ageFrom}-${calibration.ageTo}岁`;
      lines.push('');
      lines.push(`### ${calibration.id} ${years}（${ages}）· ${calibration.domain} · ${calibration.outcome}`);
      lines.push(`- 预测：${calibration.prediction}`);
      if (calibration.basis) lines.push(`- 依据：${calibration.basis}`);
      if (calibration.feedback) lines.push(`- 用户反馈：${calibration.feedback}`);
      if (calibration.revisedModel) lines.push(`- 模型修正：${calibration.revisedModel}`);
    }
    const verified = calibrations.filter((c) => c.outcome !== '待验证');
    const hit = verified.filter((c) => c.outcome === '相符' || c.outcome === '部分相符');
    lines.push('');
    lines.push(`- 校准汇总：已反馈 ${verified.length}/${calibrations.length} 条，其中相符或部分相符 ${hit.length} 条。`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('命理分析仅供参考，人生在于自身的努力和选择。');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 参考文档
// ---------------------------------------------------------------------------

const referenceCache = new Map();

/** 读取包内 references/<doc>.md。 */
function readReference(doc) {
  if (!REFERENCE_DOCS.includes(doc)) {
    throw new Error(`bazi_reference: 未知文档 ${doc}；可选：${REFERENCE_DOCS.join(', ')}`);
  }
  const cached = referenceCache.get(doc);
  if (cached !== undefined) return cached;
  const text = readFileSync(new URL(`../references/${doc}.md`, import.meta.url), 'utf8');
  referenceCache.set(doc, text);
  return text;
}

/** 参考文档里的标题（二～四级；`shensha-table.md` 把每个神煞写在三级的 `###` 下）。 */
const HEADING_RE = /^(#{2,4})\s+(.+?)\s*$/;

/**
 * 从参考文档中截取某个标题下的内容。
 *
 * 标题级别参与判断：匹配到几级标题，就切到下一个「同级或更高级」标题之前。
 * 所以 `## 吉` 会带出它下面所有 `###` 条目，而 `### 天乙贵人` 只带出它自己那一段。
 * @param {string} text - 完整 Markdown。
 * @param {string} section - 标题文本（不含 `#`）。
 * @returns {string|null} 该节内容；找不到返回 `null`。
 */
export function sliceSection(text, section) {
  const lines = text.split(/\r?\n/);
  let startIndex = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const matched = HEADING_RE.exec(lines[i]);
    if (matched !== null && matched[2] === section) {
      startIndex = i;
      startLevel = matched[1].length;
      break;
    }
  }
  if (startIndex === -1) return null;

  const body = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const matched = HEADING_RE.exec(lines[i]);
    if (matched !== null && matched[1].length <= startLevel) break;
    body.push(lines[i]);
  }
  return body.join('\n').trim();
}

/** 列出参考文档的所有标题（二级～四级），供模型挑选 section。 */
function listSections(text) {
  return text.split(/\r?\n/)
    .map((line) => HEADING_RE.exec(line)?.[2])
    .filter((heading) => heading !== undefined);
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function sessionIdOf(exec) {
  if (!exec.agent) throw new Error('bazi_* 工具需要归属一个 agent 会话');
  return exec.agent.session.id;
}

function titledCard(title, result) {
  if (result.isError) return undefined;
  return { card: 'generic', title, content: result.content };
}

const ENGINE_VERSION = 'bazi-engine/1.0.0 (pai_pan.py 移植)';

/** 把命主行翻译成内核入参。 */
/** 时辰未给或不可识别时的取值：空串表示未知。 */
const SHICHEN_UNKNOWN = '';

/**
 * 命主记录里的时辰一律存**地支**（与内核 `shichen_text` 同一口径）。
 *
 * 调用方可能给 `shichen`（`午`／`午时`／`11:00-13:00`）或 `hour`+`minute`；
 * 也可能两者都给（此时钟点更精确，优先）。只给钟点时由 {@link hourToShichen}
 * 推出地支，否则命主信息里会留着「时辰未知」而时柱却是排出来的——
 * 两处口径必须一致。
 *
 * @param {object} args - `bazi_start` 的参数（或投影折到的同一份参数）。
 * @returns {string} 地支；未知为空串。
 */
function resolveShichen(args) {
  if (args.timeUnknown === true) return SHICHEN_UNKNOWN;
  if (typeof args.hour === 'number') {
    return hourToShichen(args.hour, typeof args.minute === 'number' ? args.minute : 0);
  }
  const named = normalizeShichen(args.shichen);
  return named === null ? SHICHEN_UNKNOWN : named;
}

/**
 * 时辰的显示串：存的是地支，显示成「午时」。
 * @param {string} shichen - 地支（或历史数据里的「午时」）。
 * @returns {string} 显示串；未知为空串。
 */
function shichenLabel(shichen) {
  const bare = normalizeShichen(shichen);
  return bare === null ? '' : `${bare}时`;
}

/** 校验调用方给的时辰写法；不可识别时抛出带可选值的错误。 */
function assertShichenUsable(args) {
  if (args.timeUnknown === true) return;
  if (typeof args.hour === 'number') return;
  if (args.shichen === undefined || args.shichen === '') return;
  if (normalizeShichen(args.shichen) === null) {
    throw new RangeError(
      `无法识别的时辰：${JSON.stringify(args.shichen)}。请用地支（午）、带「时」的写法（午时）或区间（11:00-13:00）；`
      + '不确定时改传 timeUnknown: true，或改传 hour/minute 钟点。',
    );
  }
}

function engineInputOf(subject) {
  const input = {
    sex: subject.sex,
    place: subject.birthPlace === '' ? null : subject.birthPlace,
    deceasedYear: subject.deceasedYear ?? null,
  };
  if (subject.solar !== '') {
    const [y, m, d] = subject.solar.split('-').map(Number);
    input.solar = { y, m, d };
  }
  if (subject.lunar !== '') {
    const [y, m, d] = subject.lunar.split('-').map(Number);
    input.lunar = { y, m, d, leap: subject.leap };
  }
  if (!subject.timeUnknown) {
    if (typeof subject.hour === 'number') {
      input.hour = subject.hour;
      input.minute = subject.minute ?? 0;
    } else if (subject.shichen !== '') {
      input.shichen = subject.shichen;
    }
  }
  return input;
}

/** 内核结果 → 持久化命盘行。 */
function chartRecordOf(sessionId, subject, result) {
  return {
    id: 'chart-1',
    sessionId,
    subjectId: subject.id,
    solarText: result.solar_text,
    lunarText: result.lunar_text ?? '未知',
    shichenText: result.shichen_text,
    sex: result.sex,
    place: result.place ?? '',
    zishi: result.zishi,
    forward: result.forward,
    qiyunText: result.qiyun_text,
    qiyunYears: result.qiyun_years,
    qiyunMonths: result.qiyun_months,
    pillars: result.pillars,
    dayun: result.dayun_rows,
    liunian: result.liunian_years.map((year) => ({ year, gz: gzOfYear(year) })),
    currentYear: result.current_year,
    currentGz: result.current_gz,
    yearNum: result.year_num,
    jieName: result.jie_name,
    hourUnknown: result.hour_unknown,
    shensha: result.shensha_lines,
    warnings: result.warnings,
    stats: wuxingStats(result.pillars),
    relations: ganZhiRelations(result.pillars),
    engine: ENGINE_VERSION,
    computedAt: new Date().toISOString(),
  };
}

/**
 * 内核的神煞行 → `{name, detail}`。
 *
 * 内核给的是 Markdown 列表项：`- 天乙贵人 — 见于年支、时支 — 年干/日干查地支`。
 * 名字是第一段，其余（位置与查法）合起来作依据。
 */
function shenshaOf(lines) {
  return lines.map((line) => {
    const text = line.replace(/^-\s*/, '');
    const [name, ...rest] = text.split(' — ');
    return { name, detail: rest.join(' — ') };
  });
}

/**
 * 从落地的命盘行取出投影视图形状。
 *
 * 命盘行比视图多（`stats`、`liunian`、`engine`、`sessionId` …），视图只认
 * {@link chartViewSchema} 里的字段：`score`/`share` 来自 `stats`，其余平铺。
 * 多出来的字段不能带进视图——wire schema 会拒绝，且客户端也用不上。
 *
 * @param {object} chart - {@link chartRecordOf} 的产物。
 * @returns {object} 命盘视图。
 */
function chartViewOf(chart) {
  return {
    solarText: chart.solarText,
    lunarText: chart.lunarText,
    shichenText: chart.shichenText,
    zishi: chart.zishi,
    forward: chart.forward,
    qiyunText: chart.qiyunText,
    currentYear: chart.currentYear,
    currentGz: chart.currentGz,
    jieName: chart.jieName,
    hourUnknown: chart.hourUnknown,
    pillars: chart.pillars,
    dayun: chart.dayun,
    shensha: shenshaOf(chart.shensha),
    warnings: chart.warnings,
    score: chart.stats.score,
    share: chart.stats.share,
    // 落地的关系按地支/天干分组，视图按同一张列表呈现
    relations: [...chart.relations.branch, ...chart.relations.stem]
      .map(({ kind, detail }) => ({ kind, detail })),
  };
}

/** 流年干支（避免在插件里重复实现，直接借内核的导出）。 */
function gzOfYear(year) {
  const index = ((Math.trunc(year) - 4) % 60 + 60) % 60;
  return `${GAN[index % 10]}${ZHI[index % 12]}`;
}

function registerBaziTools(ctx, store) {
  ctx.tools.register(defineTool({
    name: 'bazi_start',
    description: '录入或重置一位命主的出生信息（本工具的调用会清空本会话已有的命盘、论断与校准——改生辰后重排必须如此）。请在向用户确认信息后再调用。性别必填（决定大运顺逆）；阳历、农历至少给一个；时辰不确定时传 timeUnknown=true。',
    parameters: {
      sex: { type: 'string', required: true, enum: ['男', '女'], description: '性别（必填，决定大运顺逆）。' },
      name: { type: 'string', description: '姓名。' },
      formerName: { type: 'string', description: '曾用名（没有就省略）。' },
      formerNameYear: { type: 'string', description: '改名的大致年份；不详可填「不详」。' },
      birthPlace: { type: 'string', description: '出生省份城市，如「辽宁省丹东市」。' },
      solar: { type: 'string', description: '阳历生日 YYYY-MM-DD。' },
      lunar: { type: 'string', description: '农历生日 YYYY-MM-DD（数字月日，如四月廿一 → 1990-04-21）。' },
      leap: { type: 'boolean', description: '农历是否为闰月。' },
      hour: { type: 'integer', description: '出生时（北京钟表 0-23）；知道具体钟点时用它。' },
      minute: { type: 'integer', description: '出生分（0-59）。' },
      shichen: { type: 'string', description: '出生时辰。可写地支（午）、带「时」的写法（午时）或区间（11:00-13:00），都会归一为地支；知道具体钟点时改用 hour/minute，二者都给时 hour 优先。' },
      timeUnknown: { type: 'boolean', description: '时辰未知时置 true：只做年月日六字分析。' },
      deceasedYear: { type: 'integer', description: '已故年份；仅在用户明确在分析已故亲友时填写，流年只推到此年。' },
      note: { type: 'string', description: '备注。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          sex: { type: 'string', required: true },
          solar: { type: 'string', required: true },
          lunar: { type: 'string', required: true },
          timeUnknown: { type: 'boolean', required: true },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    presentResult: (_args, result) => titledCard('八字模式 · 命主信息', result),
    execute: async (args, exec) => {
      const sessionId = sessionIdOf(exec);
      if (args.leap === true && !args.lunar) {
        throw new Error('bazi_start: leap 只能与 lunar 同时使用');
      }
      if (!args.solar && !args.lunar) {
        throw new Error('bazi_start: 阳历（solar）与农历（lunar）至少要提供一个');
      }
      assertShichenUsable(args);
      const subject = await store.startSubject(sessionId, {
        name: args.name ?? '',
        formerName: args.formerName ?? '',
        formerNameYear: args.formerNameYear ?? '',
        sex: args.sex,
        birthPlace: args.birthPlace ?? '',
        solar: args.solar ?? '',
        lunar: args.lunar ?? '',
        leap: args.leap === true,
        hour: args.hour,
        minute: args.minute,
        shichen: args.shichen ?? '',
        timeUnknown: args.timeUnknown === true,
        deceasedYear: args.deceasedYear,
        note: args.note ?? '',
      });
      const clock = typeof subject.hour === 'number'
        ? `${subject.hour}:${String(subject.minute ?? 0).padStart(2, '0')}`
        : '';
      const shichenText = subject.timeUnknown
        ? '未知（只做六字）'
        : ([shichenLabel(subject.shichen), clock].filter(Boolean).join(' ') || '未知');
      const summary = [
        `已记录命主 ${subject.id}（本会话旧的命盘/论断/校准已清空）。`,
        `- 性别：${subject.sex}`,
        `- 阳历：${subject.solar || '未知'}`,
        `- 农历：${subject.lunar || '未知'}${subject.leap ? '（闰月）' : ''}`,
        `- 时辰：${shichenText}`,
        '',
        '下一步：调用 bazi_paipan 排盘。',
      ].join('\n');
      return {
        id: subject.id,
        sex: subject.sex,
        solar: subject.solar,
        lunar: subject.lunar,
        timeUnknown: subject.timeUnknown,
        summary,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'bazi_paipan',
    description: '按已录入的命主信息排盘：计算四柱、大运、流年、神煞、五行力量统计与干支关系，落地命盘并返回 Markdown 排盘结果。四柱/大运/流年/神煞一律以本工具返回为准，禁止口算或凭记忆中的万年历改盘。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          markdown: { type: 'string', required: true },
          pillars: { type: 'string', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          // 命盘视图随结果一起回传：Web 页签的命盘就从这里经 presentationMeta
          // 进日志，再由 bazi 投影折出来（参数里没有命盘，只有结果里有）。
          // 形状由 chartViewSchema 独占声明——工具输出的值 schema DSL 只认
          // 一个受限子集（无数值区间等关键字），所以这里声明为 JSON 值，
          // 真正的形状校验在投影的 wire viewSchema 上做。
          chart: { type: 'json', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.markdown }],
      presentationMeta: (_args, value) => ({
        kind: 'bazi/chart',
        subjectId: 'subject-1',
        chart: value.chart,
      }),
    },
    presentResult: (_args, result) => titledCard('八字命盘', result),
    execute: async (_args, exec) => {
      const sessionId = sessionIdOf(exec);
      const subject = await store.requireSubject(sessionId);
      let result;
      try {
        result = compute(engineInputOf(subject));
      } catch (error) {
        throw new Error(`bazi_paipan: 排盘失败：${error.message}。请核对出生日期/时辰，必要时用 bazi_start 更正后重排。`);
      }
      const chart = await store.saveChart(sessionId, chartRecordOf(sessionId, subject, result));
      const { pillars } = chart;
      // 时柱未知时四组仍给全，末组写「未知」——年月日六字必须照常可见
      const pillarOf = (name) => (
        pillars[name].gan === '未知' ? '未知' : `${pillars[name].gan}${pillars[name].zhi}`
      );
      const header = [
        subjectMarkdown(subject),
        '',
        chartMarkdown(chart),
      ].join('\n');
      return {
        markdown: header,
        pillars: ['year', 'month', 'day', 'hour'].map(pillarOf).join(' '),
        warnings: chart.warnings,
        chart: chartViewOf(chart),
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'bazi_add_reading',
    description: '记录一条论断（分析结论）。按框架逐节记录：日主强弱 / 十神 / 神煞 / 五行平衡 / 格局 / 大运 / 流年 / 历史校准 / 综合建议 / 综述。论断应引用典籍出处（写进 citation）。若本节结论由前面某条论断推导而来，把那条论断的 id 填进 derivedFromReadingId。',
    parameters: {
      section: { type: 'string', required: true, enum: READING_SECTIONS, description: '论断所属分析节。' },
      title: { type: 'string', required: true, description: '本条论断的短标题。' },
      content: { type: 'string', required: true, description: '论断正文（分析过程与结论）。' },
      citation: { type: 'string', description: '典籍出处，如「《穷通宝典》调候原则」。' },
      derivedFromReadingId: { type: 'string', description: '本条所依据的前序论断 id（如 reading-2）。省略则挂到命主。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          section: { type: 'string', required: true },
          title: { type: 'string', required: true },
          edgeKind: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已记录论断 ${value.id} [${value.section}]「${value.title}」（${value.edgeKind}）。`,
      }],
    },
    execute: async (args, exec) => {
      const sessionId = sessionIdOf(exec);
      const { reading, edge } = await store.addReading(sessionId, {
        section: args.section,
        title: args.title,
        content: args.content,
        citation: args.citation ?? '',
        ...(args.derivedFromReadingId !== undefined ? { derivedFromReadingId: args.derivedFromReadingId } : {}),
      });
      return {
        id: reading.id,
        section: reading.section,
        title: reading.title,
        edgeKind: edge.kind,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'bazi_add_calibration',
    description: '记录一条「历史事件校准」预测：根据排盘与经典理论，指出该人**已经发生过的**某个关键时段及其性质（事业转折/感情变化/迁移/健康波动等），供用户核对。写清年份区间、年龄区间与推演依据。提出后请把预测讲给用户听并请他确认。',
    parameters: {
      yearFrom: { type: 'integer', required: true, description: '该时段的起始公历年。' },
      yearTo: { type: 'integer', required: true, description: '该时段的结束公历年。' },
      ageFrom: { type: 'integer', required: true, description: '起始虚岁/周岁。' },
      ageTo: { type: 'integer', required: true, description: '结束年龄。' },
      domain: { type: 'string', required: true, enum: CALIBRATION_DOMAINS, description: '所涉领域。' },
      prediction: { type: 'string', required: true, description: '预测的事件性质，如「事业换轨或搬迁」。' },
      basis: { type: 'string', description: '推演依据（大运流年与原局的关系、所引典籍）。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          years: { type: 'string', required: true },
          ages: { type: 'string', required: true },
          domain: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已记录校准 ${value.id}：${value.years}（${value.ages}）· ${value.domain}。请向用户核对。`,
      }],
    },
    execute: async (args, exec) => {
      const sessionId = sessionIdOf(exec);
      const saved = await store.addCalibration(sessionId, {
        yearFrom: args.yearFrom,
        yearTo: args.yearTo,
        ageFrom: args.ageFrom,
        ageTo: args.ageTo,
        domain: args.domain,
        prediction: args.prediction,
        basis: args.basis ?? '',
      });
      const years = saved.yearFrom === saved.yearTo ? `${saved.yearFrom}年` : `${saved.yearFrom}-${saved.yearTo}年`;
      const ages = saved.ageFrom === saved.ageTo ? `${saved.ageFrom}岁` : `${saved.ageFrom}-${saved.ageTo}岁`;
      return { id: saved.id, years, ages, domain: saved.domain };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'bazi_confirm_calibration',
    description: '回填用户对某条校准预测的反馈。用户答复后必须调用：outcome 记相符/部分相符/不符，feedback 记用户原话要点。若校准结果说明原来对格局或喜用神的判断需要调整，把修正写进 revisedModel——校准必须影响后续综合建议。',
    parameters: {
      calibrationId: { type: 'string', required: true, description: 'bazi_add_calibration 返回的校准 id。' },
      outcome: { type: 'string', required: true, enum: ['相符', '部分相符', '不符'], description: '用户核对结果。' },
      feedback: { type: 'string', required: true, description: '用户反馈的要点（照实记录）。' },
      revisedModel: { type: 'string', description: '据此对格局/喜用神理解的修正；无则省略。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          outcome: { type: 'string', required: true },
          revised: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `校准 ${value.id} 已记为「${value.outcome}」${value.revised ? '，并记录了模型修正' : ''}。`,
      }],
    },
    execute: async (args, exec) => {
      const sessionId = sessionIdOf(exec);
      const saved = await store.confirmCalibration(sessionId, {
        calibrationId: args.calibrationId,
        outcome: args.outcome,
        feedback: args.feedback,
        revisedModel: args.revisedModel ?? '',
      });
      return { id: saved.id, outcome: saved.outcome, revised: args.revisedModel !== undefined };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'bazi_state',
    description: '读取本会话的八字模式状态：命主信息、命盘概要、已有论断清单、校准与核对进度。用它决定下一步该做哪一节分析。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          initialized: { type: 'boolean', required: true },
          hasChart: { type: 'boolean', required: true },
          summary: { type: 'string', required: true },
          readings: { type: 'array', required: true, items: { type: 'object', additionalProperties: true, properties: {} } },
          calibrations: { type: 'array', required: true, items: { type: 'object', additionalProperties: true, properties: {} } },
          missingSections: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    presentResult: (_args, result) => titledCard('八字模式状态', result),
    execute: async (_args, exec) => {
      const sessionId = sessionIdOf(exec);
      const data = await store.sessionData(sessionId);
      if (data.subject === undefined) {
        return {
          initialized: false,
          hasChart: false,
          summary: '八字模式尚未开始。请先向用户收集出生信息，确认后调用 bazi_start。',
          readings: [],
          calibrations: [],
          missingSections: [...READING_SECTIONS],
        };
      }
      const sections = new Set(data.readings.map((r) => r.section));
      const missingSections = READING_SECTIONS.filter((s) => !sections.has(s));
      const calibrations = data.calibrations.map((c) => ({
        id: c.id,
        years: c.yearFrom === c.yearTo ? `${c.yearFrom}年` : `${c.yearFrom}-${c.yearTo}年`,
        domain: c.domain,
        outcome: c.outcome,
      }));
      const lines = [];
      lines.push(`命主 ${data.subject.id}：${data.subject.name || '（未提供姓名）'} · ${data.subject.sex} · 阳历 ${data.subject.solar || '未知'} · 农历 ${data.subject.lunar || '未知'} · 时辰 ${data.subject.timeUnknown ? '未知' : (shichenLabel(data.subject.shichen) || '未知')}`);
      if (data.chart === undefined) {
        lines.push('尚未排盘：请调用 bazi_paipan。');
      } else {
        const p = data.chart.pillars;
        lines.push(`命盘：${p.year.gan}${p.year.zhi} ${p.month.gan}${p.month.zhi} ${p.day.gan}${p.day.zhi} ${p.hour.gan}${p.hour.zhi} · 大运${data.chart.forward ? '顺排' : '逆排'} · 起运${data.chart.qiyunText} · 当前 ${data.chart.currentYear}年${data.chart.currentGz}`);
        lines.push(`五行分值：木${data.chart.stats.score['木']} 火${data.chart.stats.score['火']} 土${data.chart.stats.score['土']} 金${data.chart.stats.score['金']} 水${data.chart.stats.score['水']}（最旺${data.chart.stats.strongest}／最弱${data.chart.stats.weakest}）`);
        if (data.chart.warnings.length > 0) lines.push(`警告：${data.chart.warnings.join('；')}`);
      }
      lines.push(`论断 ${data.readings.length} 条${data.readings.length === 0 ? '' : `：${data.readings.map((r) => `${r.id}[${r.section}]`).join(' ')}`}`);
      lines.push(`未完成的论断节：${missingSections.length === 0 ? '（已齐）' : missingSections.join('、')}`);
      lines.push(`校准 ${data.calibrations.length} 条${calibrations.length === 0 ? '' : `：${calibrations.map((c) => `${c.id}(${c.domain}/${c.outcome})`).join(' ')}`}`);
      return {
        initialized: true,
        hasChart: data.chart !== undefined,
        summary: lines.join('\n'),
        readings: data.readings.map((r) => ({ id: r.id, section: r.section, title: r.title })),
        calibrations,
        missingSections,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'bazi_chart',
    description: '导出本会话命盘的完整 JSON：命主、四柱（含十神与藏干）、大运全表、流年全表、神煞、五行统计、干支关系、警告。需要精确数值或完整流年列表时用它。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { chart: { type: 'object', additionalProperties: true, properties: {} } },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.chart) }],
    },
    presentResult: (_args, result) => titledCard('八字命盘数据', result),
    execute: async (_args, exec) => {
      const sessionId = sessionIdOf(exec);
      const chart = await store.requireChart(sessionId);
      return { chart };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'bazi_reference',
    description: '查阅命理参考资料（与排盘内核同一口径）：wuxing-tables（五行/天干地支/十神/十二长生/藏干）、shichen-table（时辰对照与五鼠遁元）、dayun-rules（大运顺逆与起运计算）、shensha-table（神煞查法与口诀）、classical-texts（九本典籍核心规则摘要）。分析时先查表再引用，不要凭记忆写条款。',
    parameters: {
      doc: { type: 'string', required: true, enum: REFERENCE_DOCS, description: '要查阅的文档。' },
      section: { type: 'string', description: '只取该文档下某个二级标题的内容；省略则返回全文。' },
      listSections: { type: 'boolean', description: '置 true 时只列出该文档的二级标题。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          doc: { type: 'string', required: true },
          sections: { type: 'array', required: true, items: { type: 'string' } },
          markdown: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.markdown }],
    },
    presentResult: (_args, result) => titledCard('命理参考', result),
    execute: async (args) => {
      const text = readReference(args.doc);
      const sections = listSections(text);
      if (args.listSections === true) {
        return {
          doc: args.doc,
          sections,
          markdown: `《${args.doc}》含以下小节：\n${sections.map((s) => `- ${s}`).join('\n')}`,
        };
      }
      if (args.section !== undefined && args.section !== '') {
        const sliced = sliceSection(text, args.section);
        if (sliced === null) {
          throw new Error(`bazi_reference: 《${args.doc}》没有小节「${args.section}」。可选：${sections.join('、')}`);
        }
        return { doc: args.doc, sections, markdown: sliced };
      }
      return { doc: args.doc, sections, markdown: text };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'bazi_report',
    description: '生成最终 Markdown 报告：命主信息、命盘（四柱/大运/五行统计/干支关系/神煞/警告）、按节组织的论断链、历史校准与用户反馈、以及校准对结论的修正。论断与校准完成、或用户叫停时调用。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { markdown: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.markdown }],
    },
    presentResult: (_args, result) => titledCard('八字命理报告', result),
    execute: async (_args, exec) => {
      const sessionId = sessionIdOf(exec);
      const data = await store.sessionData(sessionId);
      return { markdown: buildReport(data) };
    },
  }));
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------

/**
 * 挂载八字模式：注册 `bazi_*` 工具、会话投影与 `bazi:protocol` 提示词段。
 * @param {object} ctx - 插件上下文（需 `tools` / `storageDomain` / `sessions`）。
 */
export function apply(ctx) {
  const store = new BaziStore(ctx);
  ctx.effect(() => async () => {
    await store.dispose();
  }, 'bazi.domainClose');

  registerBaziTools(ctx, store);

  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register({
      key: 'bazi',
      stateSchema: baziStateSchema,
      init: () => initialProjectionState,
      apply: applyBaziEvent,
      view: viewBaziState,
      wire: {
        viewSchema: baziProjectionSchema,
        view: viewBaziState,
      },
      // 折叠语义变过（命盘改从 tool/result 的 meta 折），旧缓存行必须作废
      stateVersion: 2,
    });
    projectionCtx.sessionProjections.register({
      key: 'baziMounted',
      schema: mountedSchema,
      stateSchema: mountedSchema,
      init: () => false,
      apply: applyMounted,
      view: (mounted) => mounted,
      wire: {
        viewSchema: mountedSchema,
        view: (mounted) => mounted,
      },
      stateVersion: 1,
    });
  });

  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.section({
      name: 'bazi:protocol',
      order: BAZI_SECTION_ORDER,
      text: () => BAZI_INSTRUCTIONS,
    });
  });
}

export { BAZI_INSTRUCTIONS, BAZI_SECTION_ORDER, SHISHEN_INFO, GAN_INFO, ZHI_INFO, PALACE_INFO };

// 投影状态与视图在模块级声明，供测试直接折叠事件序列
export {
  applyBaziEvent, viewBaziState, initialProjectionState,
  baziProjectionSchema, baziStateSchema, chartViewSchema, mountedSchema,
};
