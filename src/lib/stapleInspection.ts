/**
 * 成册下线后的钉位检测：把质检员沿书脊自上而下量到的一串实测钉痕，
 * 与拼版阶段给出的一串计划钉位做有序配对，区分合格配对、漏钉与多余钉痕。
 *
 * 核心约束：计划位与实测痕都按自上而下的空间顺序排列，因此配对是一个
 * 序列对齐问题（order-preserving alignment），**不能用逐点最近邻代替**——
 * 最近邻只看局部距离，可能让一个计划位抢走本应配给前一个计划位的钉痕，
 * 使后续整体错配。这里对两条序列做全局动态规划：
 *
 *   - 计划位 i 与实测痕 j 配对：代价 |planned[i] − measured[j]|（毫米偏差）；
 *   - 漏掉一个计划位（无实测痕与之配对）：罚 MISS_PENALTY_FACTOR × 容差；
 *   - 多出一个实测痕（无计划位与之配对）：罚 MISS_PENALTY_FACTOR × 容差。
 *
 * 决胜（总代价相同的多条路径之间，依次比较）：
 *   1. 未配对项（漏钉 + 多余钉痕）总数更少者优先；
 *   2. 仍相同则“较早使用实测痕”的路径优先：逐对比较配对所用实测痕
 *      的自上而下序号（0-based 下标），首个较小者优先；
 *   3. 仍相同则逐对比较配对计划位序号，首个较小者优先（确定性兜底）。
 *
 * 第 2 条在 DP 网格中只需比较配对实测痕下标序列的字典序：配对数相同
 * （未配对总数相同）且配对集合一一对应时，字典序小的路径更早把第 k
 * 个配对落给序号更小（更靠上）的实测痕。
 *
 * ## 精确十进制语义
 *
 * 质检员可以录入远超 `Number.MAX_SAFE_INTEGER` 的毫米数（如书脊长度
 * 9007199254740993）。IEEE-754 双精度无法逐位表示这种整数：直接
 * `Number(text)` 会静默把合法原值改小、把两个数学上严格递增的大整数
 * 舍入成同一个数（误判重复），超大容差下还会让 DP 的总代价溢出成
 * `Infinity` 并选错路径。因此本模块从解析、校验、动态规划到结果展示
 * 全部走**十进制原文 → 定点 BigInt** 的精确路径，`number` 仅用于 SVG
 * 比例换算等不需要精确值的场合。
 *
 * 本模块是纯函数模块，不读取也不改写拼版（imposition）与走纸演练
 * （paperDrill）的任何状态。
 */

/** 漏一个计划位 / 多一个实测痕的罚分相对容差的倍数（罚两倍容差）。 */
export const MISS_PENALTY_FACTOR = 2;

/**
 * 精确十进制值：用「整数 mantissa × 10^−scale」表示录入原文，
 * 不经过二进制浮点。scale 是小数位数（非负整数）。
 */
export interface Decimal {
  /** 去掉小数点后的十进制整数（可带负号），如 "1.50" → 15n、scale 2。 */
  readonly mantissa: bigint;
  /** 小数位数（如 "1.5" 为 1、"12" 为 0）。 */
  readonly scale: number;
  /** 归一化后的十进制原文（用于结果展示时保留精确长度）。 */
  readonly text: string;
}

/** 书脊自上而下的一个毫米坐标（顶端为 0，底端为书脊长度）。 */
export interface StapleInput {
  /** 书脊长度（毫米），> 0。 */
  readonly spineLength: number;
  /** 单侧允许偏差（毫米），> 0；配对偏差不超过它即判该钉合格。 */
  readonly tolerance: number;
  /** 计划钉位（毫米），自上而下严格递增、均在 [0, spineLength] 内。 */
  readonly planned: readonly number[];
  /** 实测钉痕（毫米），自上而下严格递增、均在 [0, spineLength] 内。 */
  readonly measured: readonly number[];
}

/** 精确版本的 {@link StapleInput}：所有数值均保留十进制精确语义。 */
export interface ExactStapleInput {
  readonly spineLength: Decimal;
  readonly tolerance: Decimal;
  readonly planned: readonly Decimal[];
  readonly measured: readonly Decimal[];
}

/** 可定位的录入字段。 */
export type StapleField = 'spineLength' | 'tolerance' | 'planned' | 'measured';

/** 标量字段（书脊长度 / 允许偏差）的拒绝原因。 */
export type ScalarReason = 'empty' | 'not-number' | 'not-positive';

/** 列表项（计划钉位 / 实测钉痕）的拒绝原因。 */
export type ItemReason =
  | 'empty'
  | 'not-number'
  | 'not-strictly-increasing'
  | 'duplicate'
  | 'out-of-spine';

/** 一个待修正问题：字段级问题 itemIndex 为 null；列表项问题定位到 0-based 项。 */
export interface StapleIssue {
  readonly field: StapleField;
  readonly itemIndex: number | null;
  readonly reason: ScalarReason | ItemReason;
  readonly message: string;
}

/** 录入校验失败：停留在待修正态，不产生任何诊断。 */
export interface StapleInvalid {
  readonly kind: 'invalid';
  readonly issues: readonly StapleIssue[];
}

/** 一组成对的计划钉位与实测钉痕。 */
export interface StapleMatch {
  /** 计划钉位在输入列表中的 0-based 下标（自上而下序号）。 */
  readonly plannedIndex: number;
  /** 实测钉痕在输入列表中的 0-based 下标。 */
  readonly measuredIndex: number;
  readonly plannedMm: number;
  readonly measuredMm: number;
  /** 实测 − 计划的带符号毫米偏差（正：比计划靠下；负：比计划靠上）。 */
  readonly deviationMm: number;
  /** 绝对毫米偏差 |实测 − 计划|。 */
  readonly absDeviationMm: number;
  /** 绝对偏差是否在允许偏差（含边界）内。 */
  readonly withinTolerance: boolean;
}

/** 全局最优对齐诊断。 */
export interface StapleDiagnosis {
  readonly kind: 'ok';
  readonly spineLength: number;
  readonly tolerance: number;
  readonly planned: readonly number[];
  readonly measured: readonly number[];
  /** 自上而下顺序的配对连线（计划位下标递增）。 */
  readonly matches: readonly StapleMatch[];
  /** 漏钉：未配对的计划钉位（自上而下）。 */
  readonly missing: readonly { readonly index: number; readonly mm: number }[];
  /** 多余钉痕：未配对的实测钉痕（自上而下）。 */
  readonly extra: readonly { readonly index: number; readonly mm: number }[];
  /** DP 最优总代价（毫米与罚分同尺度）。 */
  readonly totalCost: number;
  /** 配对代价之和（毫米偏差绝对值之和）。 */
  readonly matchedCost: number;
  /** 罚分总额（漏钉 + 多余钉痕，每个罚两倍容差）。 */
  readonly penaltyCost: number;
  /** 是否合格：无漏钉、无多余钉痕且每个配对偏差都不超过容差。 */
  readonly passed: boolean;

  // —— 精确十进制伴随字段（与上面的 number 字段一一对应，全程不丢精度）——
  /** 精确书脊长度原文。 */
  readonly spineLengthText: string;
  /** 精确允许偏差原文。 */
  readonly toleranceText: string;
  /** 各计划钉位精确原文（与 planned 同序）。 */
  readonly plannedTexts: readonly string[];
  /** 各实测钉痕精确原文（与 measured 同序）。 */
  readonly measuredTexts: readonly string[];
  /** 每对的带符号偏差精确文本（与 matches 同序，正数带 +）。 */
  readonly matchDeviationTexts: readonly string[];
  /** 每对的绝对偏差精确文本（与 matches 同序）。 */
  readonly matchAbsDeviationTexts: readonly string[];
  /** DP 最优总代价精确文本。 */
  readonly totalCostText: string;
  /** 配对代价之和精确文本。 */
  readonly matchedCostText: string;
  /** 罚分总额精确文本。 */
  readonly penaltyCostText: string;
}

export type StapleResult = StapleDiagnosis | StapleInvalid;

const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const TOKEN_SPLIT_RE = /[\s,，、;；]+/;

const FIELD_LABEL: Record<StapleField, string> = {
  spineLength: '书脊长度',
  tolerance: '允许偏差',
  planned: '计划钉位',
  measured: '实测钉痕',
};

/* ------------------------------------------------------------------ */
/* 精确十进制工具                                                      */
/* ------------------------------------------------------------------ */

/** 归一化十进制原文：去前导零 / 多余小数点尾零 / 前导 + 号；保留纯整数原值。 */
export function normalizeDecimalText(text: string): string {
  let t = text.trim();
  let sign = '';
  if (t[0] === '+' || t[0] === '-') {
    if (t[0] === '-') {
      sign = '-';
    }
    t = t.slice(1);
  }
  let intPart: string;
  let fracPart: string;
  const dot = t.indexOf('.');
  if (dot === -1) {
    intPart = t;
    fracPart = '';
  } else {
    intPart = t.slice(0, dot);
    fracPart = t.slice(dot + 1);
  }
  intPart = intPart.replace(/^0+(?=\d)/, '');
  if (intPart === '') {
    intPart = '0';
  }
  if (fracPart !== '') {
    fracPart = fracPart.replace(/0+$/, '');
  }
  // "-0"、"-0.0" 统一为 "0"
  if (intPart === '0' && fracPart === '') {
    sign = '';
  }
  return fracPart === '' ? `${sign}${intPart}` : `${sign}${intPart}.${fracPart}`;
}

/** 把十进制原文解析成 {@link Decimal}；不合法（科学计数法 / 文本 / 空）返回 null。 */
export function parseDecimal(raw: string): Decimal | null {
  const text = raw.trim();
  if (text === '' || !DECIMAL_RE.test(text)) {
    return null;
  }
  let signPart = '';
  let body = text;
  if (body[0] === '+' || body[0] === '-') {
    if (body[0] === '-') {
      signPart = '-';
    }
    body = body.slice(1);
  }
  const dot = body.indexOf('.');
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? '' : body.slice(dot + 1);
  const digits = `${signPart}${intPart}${fracPart}`;
  let mantissa: bigint;
  try {
    mantissa = BigInt(digits);
  } catch {
    return null;
  }
  // 规范化负零
  if (mantissa === 0n) {
    mantissa = 0n;
  }
  const scale = fracPart.length;
  return { mantissa, scale, text: normalizeDecimalText(text) };
}

/** 把 number 转成与其十进制显示一致的 {@link Decimal}（仅用于既有 number 入口）。 */
function decimalFromNumber(value: number): Decimal {
  if (Number.isInteger(value)) {
    return { mantissa: BigInt(value), scale: 0, text: String(value) };
  }
  const parsed = parseDecimal(String(value));
  if (parsed === null) {
    // Infinity / NaN 等不应出现在合法输入中；兜底成 0。
    return { mantissa: 0n, scale: 0, text: '0' };
  }
  return parsed;
}

/** 把 Decimal 放大到指定 scale：返回该尺度下的整数 BigInt。 */
function rescale(value: Decimal, scale: number): bigint {
  if (value.scale === scale) {
    return value.mantissa;
  }
  if (value.scale < scale) {
    return value.mantissa * 10n ** BigInt(scale - value.scale);
  }
  // 同一次分析内所有值都会先统一到最大 scale，正常不会走这里。
  return value.mantissa / 10n ** BigInt(value.scale - scale);
}

/** 安全地把同尺度整数 BigInt 转回 number（超出安全整数时返回 null）。 */
function bigintToNumber(value: bigint): number | null {
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(value);
}

/** 把 Decimal 转成 number；精度不足以精确表示时返回 null。 */
export function decimalToNumber(value: Decimal): number | null {
  const scaled = rescale(value, 0);
  if (value.scale === 0) {
    return bigintToNumber(scaled);
  }
  const intPart = value.mantissa / 10n ** BigInt(value.scale);
  const fracPart =
    (value.mantissa < 0n ? -value.mantissa : value.mantissa) % 10n ** BigInt(value.scale);
  // 小数部分超出双精度可安全表达的整数范围时，整体已无法精确还原。
  if (
    intPart > BigInt(Number.MAX_SAFE_INTEGER) ||
    intPart < BigInt(Number.MIN_SAFE_INTEGER) ||
    fracPart > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }
  const result = Number(value.text);
  // 回读校验：双精度必须恰好能表达该十进制值。
  return result.toString() === value.text || normalizeDecimalText(result.toString()) === value.text
    ? result
    : null;
}

/** 精确文本的有限 number 镜像：溢出时退化到 MAX_VALUE（UI 一律用精确文本）。 */
function finiteNumberOf(scaled: bigint, scale: number): number {
  const n = Number(formatScaled(scaled, scale));
  return Number.isFinite(n) ? n : (scaled < 0n ? -Number.MAX_VALUE : Number.MAX_VALUE);
}

/** 把非负同尺度 BigInt 格式化为十进制文本（scale = 小数位数）。 */
function formatScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  let body: string;
  if (scale === 0) {
    body = digits;
  } else if (digits.length <= scale) {
    body = `0.${'0'.repeat(scale - digits.length)}${digits}`;
  } else {
    body = `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
  }
  body = normalizeDecimalText(body);
  return negative && body !== '0' ? `-${body}` : body;
}

/* ------------------------------------------------------------------ */
/* 兼容 number 的解析入口（小规模输入时与旧行为完全一致）              */
/* ------------------------------------------------------------------ */

/** 解析一个标量毫米参数原文；空串 / 空白给 'empty'，非十进制文本给 'not-number'。 */
export function parseScalar(raw: string):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: ScalarReason } {
  const text = raw.trim();
  if (text === '') {
    return { ok: false, reason: 'empty' };
  }
  const decimal = parseDecimal(text);
  if (decimal === null) {
    return { ok: false, reason: 'not-number' };
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: 'not-number' };
  }
  return { ok: true, value };
}

/**
 * 把列表原文切成数字序列（分隔符：空白、半角/全角逗号、顿号、分号）。
 * 每个 token 单独给结论：无法解析时 reason 为 'empty'（整列为空）或 'not-number'，
 * 不抛错、不丢项，itemIndex 与输入中的自上而下位置一一对应。
 */
export function parsePositionList(raw: string):
  | { readonly ok: true; readonly values: number[] }
  | {
      readonly ok: false;
      readonly reason: 'empty' | 'not-number';
      /** 出错 token 的 0-based 项序号（'empty' 时为 null）。 */
      readonly itemIndex: number | null;
    } {
  const text = raw.trim();
  if (text === '') {
    return { ok: false, reason: 'empty', itemIndex: null };
  }
  const tokens = text.split(TOKEN_SPLIT_RE).filter((token) => token !== '');
  const values: number[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (parseDecimal(token) === null || !Number.isFinite(Number(token))) {
      return { ok: false, reason: 'not-number', itemIndex: i };
    }
    values.push(Number(token));
  }
  return { ok: true, values };
}

/* ------------------------------------------------------------------ */
/* 精确解析（内部使用：大整数全程保留十进制原文）                      */
/* ------------------------------------------------------------------ */

type ExactScalarResult =
  | { readonly ok: true; readonly value: Decimal }
  | { readonly ok: false; readonly reason: ScalarReason };

function parseExactScalar(raw: string): ExactScalarResult {
  const text = raw.trim();
  if (text === '') {
    return { ok: false, reason: 'empty' };
  }
  const decimal = parseDecimal(text);
  if (decimal === null) {
    return { ok: false, reason: 'not-number' };
  }
  return { ok: true, value: decimal };
}

type ExactListResult =
  | { readonly ok: true; readonly values: Decimal[] }
  | { readonly ok: false; readonly reason: 'empty' | 'not-number'; readonly itemIndex: number | null };

function parseExactPositionList(raw: string): ExactListResult {
  const text = raw.trim();
  if (text === '') {
    return { ok: false, reason: 'empty', itemIndex: null };
  }
  const tokens = text.split(TOKEN_SPLIT_RE).filter((token) => token !== '');
  const values: Decimal[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const decimal = parseDecimal(tokens[i]);
    if (decimal === null) {
      return { ok: false, reason: 'not-number', itemIndex: i };
    }
    values.push(decimal);
  }
  return { ok: true, values };
}

/** 标量字段的中文待修正说明。 */
function scalarMessage(field: StapleField, reason: ScalarReason): string {
  const label = FIELD_LABEL[field];
  switch (reason) {
    case 'empty':
      return `${label}尚未填写`;
    case 'not-number':
      return `${label}必须是十进制毫米数，不能输入文本或科学计数法`;
    case 'not-positive':
      return `${label}必须大于 0`;
  }
}

/** 列表项字段的中文待修正说明。 */
function itemMessage(field: StapleField, reason: ItemReason, itemIndex: number): string {
  const label = FIELD_LABEL[field];
  const ordinal = `第 ${itemIndex + 1} 项`;
  switch (reason) {
    case 'empty':
      return `${label}尚未填写`;
    case 'not-number':
      return `${label}${ordinal}不是合法的毫米数`;
    case 'not-strictly-increasing':
      return `${label}${ordinal}未严格递增（钉位必须自上而下严格增大，不能相等或倒挂）`;
    case 'duplicate':
      return `${label}${ordinal}与上一项重复（钉位必须自上而下严格递增）`;
    case 'out-of-spine':
      return `${label}${ordinal}超出书脊范围（必须在 0 到书脊长度之间）`;
  }
}

/** 精确校验结果：合法时同时给出精确输入与其 number 镜像。 */
type ExactValidation =
  | { readonly ok: true; readonly exact: ExactStapleInput; readonly input: StapleInput }
  | { readonly ok: false; readonly issues: StapleIssue[] };

/**
 * 校验四个录入字段（精确十进制）。任何一项不完整或不合法都停留在待修正态：
 * 标量需为正数；两个列表各自要求可解析、自上而下严格递增、无重复、
 * 不超出 [0, spineLength]。每个问题都带字段（列表项还带项序号），
 * 供界面定位。比较全部走 BigInt，超大整数也不会被舍入。
 */
function validateExact(raw: {
  spineLength: string;
  tolerance: string;
  planned: string;
  measured: string;
}): ExactValidation {
  const issues: StapleIssue[] = [];

  let spineLength: Decimal | null = null;
  const spineParsed = parseExactScalar(raw.spineLength);
  if (!spineParsed.ok) {
    issues.push({
      field: 'spineLength',
      itemIndex: null,
      reason: spineParsed.reason,
      message: scalarMessage('spineLength', spineParsed.reason),
    });
  } else if (spineParsed.value.mantissa <= 0n) {
    issues.push({
      field: 'spineLength',
      itemIndex: null,
      reason: 'not-positive',
      message: scalarMessage('spineLength', 'not-positive'),
    });
  } else {
    spineLength = spineParsed.value;
  }

  let tolerance: Decimal | null = null;
  const toleranceParsed = parseExactScalar(raw.tolerance);
  if (!toleranceParsed.ok) {
    issues.push({
      field: 'tolerance',
      itemIndex: null,
      reason: toleranceParsed.reason,
      message: scalarMessage('tolerance', toleranceParsed.reason),
    });
  } else if (toleranceParsed.value.mantissa <= 0n) {
    issues.push({
      field: 'tolerance',
      itemIndex: null,
      reason: 'not-positive',
      message: scalarMessage('tolerance', 'not-positive'),
    });
  } else {
    tolerance = toleranceParsed.value;
  }

  const parseList = (field: StapleField, rawList: string): Decimal[] | null => {
    const parsed = parseExactPositionList(rawList);
    if (!parsed.ok) {
      issues.push({
        field,
        itemIndex: parsed.itemIndex,
        reason: parsed.reason,
        message: itemMessage(field, parsed.reason, parsed.itemIndex ?? 0),
      });
      return null;
    }
    return parsed.values;
  };

  const planned = parseList('planned', raw.planned);
  const measured = parseList('measured', raw.measured);

  // 顺序/重复始终精确判定（不依赖书脊是否合法）；范围判定仅在书脊可用时进行。
  const checkOrderAndRange = (field: StapleField, values: Decimal[] | null): void => {
    if (values === null) {
      return;
    }
    // 顺序判定只需把各值统一到本列表自身的小数位数。
    const orderScale = Math.max(...values.map((v) => v.scale));
    // 范围判定还要与书脊长度同尺度。
    const rangeScale =
      spineLength !== null
        ? Math.max(orderScale, spineLength.scale)
        : orderScale;
    const spineAtScale = spineLength !== null ? rescale(spineLength, rangeScale) : null;
    for (let i = 0; i < values.length; i += 1) {
      if (spineAtScale !== null) {
        const currentForRange = rescale(values[i], rangeScale);
        if (currentForRange < 0n || currentForRange > spineAtScale) {
          issues.push({
            field,
            itemIndex: i,
            reason: 'out-of-spine',
            message: itemMessage(field, 'out-of-spine', i),
          });
        }
      }
      if (i > 0) {
        const current = rescale(values[i], orderScale);
        const prev = rescale(values[i - 1], orderScale);
        if (current === prev) {
          issues.push({
            field,
            itemIndex: i,
            reason: 'duplicate',
            message: itemMessage(field, 'duplicate', i),
          });
        } else if (current < prev) {
          issues.push({
            field,
            itemIndex: i,
            reason: 'not-strictly-increasing',
            message: itemMessage(field, 'not-strictly-increasing', i),
          });
        }
      }
    }
  };

  checkOrderAndRange('planned', planned);
  checkOrderAndRange('measured', measured);

  if (issues.length > 0 || planned === null || measured === null || tolerance === null) {
    return { ok: false, issues };
  }

  const exact: ExactStapleInput = {
    spineLength: spineLength as Decimal,
    tolerance: tolerance as Decimal,
    planned,
    measured,
  };
  return { ok: true, exact, input: toNumberInput(exact) };
}

/** 精确输入的 number 镜像：安全范围内逐位一致；超范围时给出最接近的有限近似值。 */
function toNumberInput(exact: ExactStapleInput): StapleInput {
  const approx = (d: Decimal): number => {
    const exactNumber = decimalToNumber(d);
    if (exactNumber !== null) {
      return exactNumber;
    }
    const rounded = Number(d.text);
    return Number.isFinite(rounded) ? rounded : Number.MAX_VALUE;
  };
  return {
    spineLength: approx(exact.spineLength),
    tolerance: approx(exact.tolerance),
    planned: exact.planned.map(approx),
    measured: exact.measured.map(approx),
  };
}

/**
 * 校验四个录入字段。任何一项不完整或不合法都停留在待修正态：
 * 标量需为正数；两个列表各自要求可解析、自上而下严格递增、无重复、
 * 不超出 [0, spineLength]。每个问题都带字段（列表项还带项序号），
 * 供界面定位。
 */
export function validateStapleInput(raw: {
  spineLength: string;
  tolerance: string;
  planned: string;
  measured: string;
}): { readonly ok: true; readonly input: StapleInput } | { readonly ok: false; readonly issues: StapleIssue[] } {
  const validation = validateExact(raw);
  if (!validation.ok) {
    return { ok: false, issues: validation.issues };
  }
  return { ok: true, input: validation.input };
}

/* ------------------------------------------------------------------ */
/* 全局动态规划（精确 BigInt 算术）                                    */
/* ------------------------------------------------------------------ */

interface CellState {
  /** 到达该格的最小总代价（统一尺度下的非负整数）。 */
  cost: bigint;
  /** 该路径上的未配对项（漏计划位 + 多实测痕）总数。 */
  unpaired: number;
  /** 该路径上配对所用 (计划位下标, 实测痕下标)，按下标递增排列。 */
  pairs: number[][];
  /** 回溯来源：配对 / 漏计划位（上方） / 多实测痕（左方）。 */
  from: 'diag' | 'up' | 'left' | 'start';
}

/** 两条路径的决胜：先总代价，再未配对更少，再较早实测痕，最后较早计划位。 */
function preferCandidate(candidate: CellState, current: CellState): boolean {
  if (candidate.cost < current.cost) {
    return true;
  }
  if (candidate.cost > current.cost) {
    return false;
  }
  if (candidate.unpaired !== current.unpaired) {
    return candidate.unpaired < current.unpaired;
  }
  // 未配对总数相同：配对数必然相同。逐对比较实测痕下标（更早实测痕优先），
  // 再比较计划位下标（确定性兜底）。
  for (let k = 0; k < candidate.pairs.length; k += 1) {
    const a = candidate.pairs[k];
    const b = current.pairs[k];
    if (a[1] !== b[1]) {
      return a[1] < b[1];
    }
    if (a[0] !== b[0]) {
      return a[0] < b[0];
    }
  }
  return false;
}

/**
 * 全局最优有序对齐（动态规划，BigInt 精确代价）。
 *
 * dp[i][j] 表示 planned[0..i) 与 measured[0..j) 对齐的最优状态，
 * 三种转移：
 *   diag — planned[i-1] 配 measured[j-1]，代价 |p − m|；
 *   up   — planned[i-1] 漏钉，罚两倍容差；
 *   left — measured[j-1] 多余，罚两倍容差。
 *
 * 不做任何逐点最近邻贪心：每个格子都比较全部三种来源，
 * 由 {@link preferCandidate} 按总代价与稳定决胜取唯一最优路径。
 */
function alignExact(exact: ExactStapleInput, input: StapleInput): StapleDiagnosis {
  const planned = exact.planned;
  const measured = exact.measured;
  const m = planned.length;
  const n = measured.length;

  // 全部数值统一到同一位数尺度：偏差、容差、罚分才能在同一整数格点上相加。
  const scale = Math.max(
    exact.spineLength.scale,
    exact.tolerance.scale,
    ...planned.map((d) => d.scale),
    ...measured.map((d) => d.scale),
  );
  const plannedS = planned.map((d) => rescale(d, scale));
  const measuredS = measured.map((d) => rescale(d, scale));
  const toleranceS = rescale(exact.tolerance, scale);
  const penalty = BigInt(MISS_PENALTY_FACTOR) * toleranceS;

  const dp: CellState[][] = [];
  for (let i = 0; i <= m; i += 1) {
    dp.push(new Array<CellState>(n + 1));
  }
  dp[0][0] = { cost: 0n, unpaired: 0, pairs: [], from: 'start' };
  for (let i = 1; i <= m; i += 1) {
    dp[i][0] = {
      cost: BigInt(i) * penalty,
      unpaired: i,
      pairs: [],
      from: 'up',
    };
  }
  for (let j = 1; j <= n; j += 1) {
    dp[0][j] = {
      cost: BigInt(j) * penalty,
      unpaired: j,
      pairs: [],
      from: 'left',
    };
  }

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const diagPrev = dp[i - 1][j - 1];
      const diff = plannedS[i - 1] - measuredS[j - 1];
      const pairCost = diff < 0n ? -diff : diff;
      const diag: CellState = {
        cost: diagPrev.cost + pairCost,
        unpaired: diagPrev.unpaired,
        pairs: [...diagPrev.pairs, [i - 1, j - 1]],
        from: 'diag',
      };

      const upPrev = dp[i - 1][j];
      const up: CellState = {
        cost: upPrev.cost + penalty,
        unpaired: upPrev.unpaired + 1,
        pairs: upPrev.pairs,
        from: 'up',
      };

      const leftPrev = dp[i][j - 1];
      const left: CellState = {
        cost: leftPrev.cost + penalty,
        unpaired: leftPrev.unpaired + 1,
        pairs: leftPrev.pairs,
        from: 'left',
      };

      // 固定候选顺序 + 严格“更优才替换”，保证决胜稳定（等同时保持先入选择）。
      let best = diag;
      if (preferCandidate(up, best)) {
        best = up;
      }
      if (preferCandidate(left, best)) {
        best = left;
      }
      dp[i][j] = best;
    }
  }

  // 回溯重建配对、漏钉与多余钉痕。
  const pairList: number[][] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const cell = dp[i][j];
    if (cell.from === 'diag') {
      pairList.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (cell.from === 'up') {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  pairList.reverse();

  interface MatchRecord {
    readonly plannedIndex: number;
    readonly measuredIndex: number;
    readonly deviation: bigint;
    readonly absDeviation: bigint;
    readonly withinTolerance: boolean;
  }
  const matchRecords: MatchRecord[] = pairList.map(([pi, mj]) => {
    const deviation = measuredS[mj] - plannedS[pi];
    const absDeviation = deviation < 0n ? -deviation : deviation;
    return {
      plannedIndex: pi,
      measuredIndex: mj,
      deviation,
      absDeviation,
      withinTolerance: absDeviation <= toleranceS,
    };
  });

  const matches: StapleMatch[] = matchRecords.map((record) => {
    const deviationNumber = finiteNumberOf(record.deviation, scale);
    const absNumber = finiteNumberOf(record.absDeviation, scale);
    return {
      plannedIndex: record.plannedIndex,
      measuredIndex: record.measuredIndex,
      plannedMm: input.planned[record.plannedIndex],
      measuredMm: input.measured[record.measuredIndex],
      deviationMm: deviationNumber,
      absDeviationMm: absNumber,
      withinTolerance: record.withinTolerance,
    };
  });

  const pairedPlanned = new Set(pairList.map(([pi]) => pi));
  const pairedMeasured = new Set(pairList.map(([, mj]) => mj));

  const missing = planned
    .map((_d, index) => ({ index, mm: input.planned[index] }))
    .filter(({ index }) => !pairedPlanned.has(index));
  const extra = measured
    .map((_d, index) => ({ index, mm: input.measured[index] }))
    .filter(({ index }) => !pairedMeasured.has(index));

  let matchedCostS = 0n;
  for (const record of matchRecords) {
    matchedCostS += record.absDeviation;
  }
  const finalCell = dp[m][n];
  const penaltyCostS = finalCell.cost - matchedCostS;

  const signText = (value: bigint): string => {
    if (value > 0n) {
      return `+${formatScaled(value, scale)}`;
    }
    return formatScaled(value, scale);
  };

  return {
    kind: 'ok',
    spineLength: input.spineLength,
    tolerance: input.tolerance,
    planned: input.planned,
    measured: input.measured,
    matches,
    missing,
    extra,
    totalCost: finiteNumberOf(finalCell.cost, scale),
    matchedCost: finiteNumberOf(matchedCostS, scale),
    penaltyCost: finiteNumberOf(penaltyCostS, scale),
    passed:
      missing.length === 0 &&
      extra.length === 0 &&
      matchRecords.every((record) => record.withinTolerance),

    spineLengthText: exact.spineLength.text,
    toleranceText: exact.tolerance.text,
    plannedTexts: planned.map((d) => d.text),
    measuredTexts: measured.map((d) => d.text),
    matchDeviationTexts: matchRecords.map((record) => signText(record.deviation)),
    matchAbsDeviationTexts: matchRecords.map((record) => formatScaled(record.absDeviation, scale)),
    totalCostText: formatScaled(finalCell.cost, scale),
    matchedCostText: formatScaled(matchedCostS, scale),
    penaltyCostText: formatScaled(penaltyCostS, scale),
  };
}

/**
 * 全局最优有序对齐（动态规划）。
 *
 * @deprecated 直接传 number 无法表达超出安全整数范围的精确值；页面流程走
 * {@link analyzeStaples}（从十进制原文解析）。此入口保留给既有调用，
 * 内部把 number 还原为十进制后仍走同一条精确 DP。
 */
export function alignStaples(input: StapleInput): StapleDiagnosis {
  const exact: ExactStapleInput = {
    spineLength: decimalFromNumber(input.spineLength),
    tolerance: decimalFromNumber(input.tolerance),
    planned: input.planned.map(decimalFromNumber),
    measured: input.measured.map(decimalFromNumber),
  };
  return alignExact(exact, input);
}

/**
 * 录入态分析入口：先校验，任一问题都停留在待修正态（不产生诊断）；
 * 全部合法后做动态规划对齐。从原文到 DP 全程保留十进制精度。
 */
export function analyzeStaples(raw: {
  spineLength: string;
  tolerance: string;
  planned: string;
  measured: string;
}): StapleResult {
  const validation = validateExact(raw);
  if (!validation.ok) {
    return { kind: 'invalid', issues: validation.issues };
  }
  return alignExact(validation.exact, validation.input);
}
