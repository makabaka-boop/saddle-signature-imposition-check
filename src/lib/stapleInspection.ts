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
 * 本模块是纯函数模块，不读取也不改写拼版（imposition）与走纸演练
 * （paperDrill）的任何状态。
 */

/** 漏一个计划位 / 多一个实测痕的罚分相对容差的倍数（罚两倍容差）。 */
export const MISS_PENALTY_FACTOR = 2;

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

/** 解析一个标量毫米参数原文；空串 / 空白给 'empty'，非十进制文本给 'not-number'。 */
export function parseScalar(raw: string):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: ScalarReason } {
  const text = raw.trim();
  if (text === '') {
    return { ok: false, reason: 'empty' };
  }
  if (!DECIMAL_RE.test(text)) {
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
    if (!DECIMAL_RE.test(token)) {
      return { ok: false, reason: 'not-number', itemIndex: i };
    }
    const value = Number(token);
    if (!Number.isFinite(value)) {
      return { ok: false, reason: 'not-number', itemIndex: i };
    }
    values.push(value);
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
  const issues: StapleIssue[] = [];

  let spineLength = 0;
  const spineParsed = parseScalar(raw.spineLength);
  if (!spineParsed.ok) {
    issues.push({
      field: 'spineLength',
      itemIndex: null,
      reason: spineParsed.reason,
      message: scalarMessage('spineLength', spineParsed.reason),
    });
  } else if (spineParsed.value <= 0) {
    issues.push({
      field: 'spineLength',
      itemIndex: null,
      reason: 'not-positive',
      message: scalarMessage('spineLength', 'not-positive'),
    });
  } else {
    spineLength = spineParsed.value;
  }

  let tolerance = 0;
  const toleranceParsed = parseScalar(raw.tolerance);
  if (!toleranceParsed.ok) {
    issues.push({
      field: 'tolerance',
      itemIndex: null,
      reason: toleranceParsed.reason,
      message: scalarMessage('tolerance', toleranceParsed.reason),
    });
  } else if (toleranceParsed.value <= 0) {
    issues.push({
      field: 'tolerance',
      itemIndex: null,
      reason: 'not-positive',
      message: scalarMessage('tolerance', 'not-positive'),
    });
  } else {
    tolerance = toleranceParsed.value;
  }

  const parseList = (
    field: StapleField,
    rawList: string,
  ): number[] | null => {
    const parsed = parsePositionList(rawList);
    if (!parsed.ok) {
      issues.push({
        field,
        itemIndex: parsed.itemIndex,
        reason: parsed.reason,
        message: itemMessage(
          field,
          parsed.reason,
          parsed.itemIndex ?? 0,
        ),
      });
      return null;
    }
    return parsed.values;
  };

  const planned = parseList('planned', raw.planned);
  const measured = parseList('measured', raw.measured);

  const checkOrderAndRange = (field: StapleField, values: number[] | null): void => {
    if (values === null) {
      return;
    }
    for (let i = 0; i < values.length; i += 1) {
      if (spineParsed.ok && spineParsed.value > 0) {
        if (values[i] < 0 || values[i] > spineLength) {
          issues.push({
            field,
            itemIndex: i,
            reason: 'out-of-spine',
            message: itemMessage(field, 'out-of-spine', i),
          });
        }
      }
      if (i > 0) {
        if (values[i] === values[i - 1]) {
          issues.push({
            field,
            itemIndex: i,
            reason: 'duplicate',
            message: itemMessage(field, 'duplicate', i),
          });
        } else if (values[i] < values[i - 1]) {
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

  if (issues.length > 0 || planned === null || measured === null) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    input: { spineLength, tolerance, planned, measured },
  };
}

interface CellState {
  /** 到达该格的最小总代价。 */
  cost: number;
  /** 该路径上的未配对项（漏计划位 + 多实测痕）总数。 */
  unpaired: number;
  /** 该路径上配对所用 (计划位下标, 实测痕下标)，按下标递增排列。 */
  pairs: number[][];
  /** 回溯来源：配对 / 漏计划位（上方） / 多实测痕（左方）。 */
  from: 'diag' | 'up' | 'left' | 'start';
}

const COST_EPS = 1e-9;

/** 两条路径的决胜：先总代价，再未配对更少，再较早实测痕，最后较早计划位。 */
function preferCandidate(candidate: CellState, current: CellState): boolean {
  if (candidate.cost < current.cost - COST_EPS) {
    return true;
  }
  if (candidate.cost > current.cost + COST_EPS) {
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
 * 全局最优有序对齐（动态规划）。
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
export function alignStaples(input: StapleInput): StapleDiagnosis {
  const { spineLength, tolerance, planned, measured } = input;
  const m = planned.length;
  const n = measured.length;
  const penalty = MISS_PENALTY_FACTOR * tolerance;

  const dp: CellState[][] = [];
  for (let i = 0; i <= m; i += 1) {
    dp.push(new Array<CellState>(n + 1));
  }
  dp[0][0] = { cost: 0, unpaired: 0, pairs: [], from: 'start' };
  for (let i = 1; i <= m; i += 1) {
    dp[i][0] = {
      cost: i * penalty,
      unpaired: i,
      pairs: [],
      from: 'up',
    };
  }
  for (let j = 1; j <= n; j += 1) {
    dp[0][j] = {
      cost: j * penalty,
      unpaired: j,
      pairs: [],
      from: 'left',
    };
  }

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const diagPrev = dp[i - 1][j - 1];
      const pairCost = Math.abs(planned[i - 1] - measured[j - 1]);
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

  const matches: StapleMatch[] = pairList.map(([pi, mj]) => {
    const deviation = measured[mj] - planned[pi];
    const absDeviation = Math.abs(deviation);
    return {
      plannedIndex: pi,
      measuredIndex: mj,
      plannedMm: planned[pi],
      measuredMm: measured[mj],
      deviationMm: deviation,
      absDeviationMm: absDeviation,
      withinTolerance: absDeviation <= tolerance + COST_EPS,
    };
  });

  const pairedPlanned = new Set(pairList.map(([pi]) => pi));
  const pairedMeasured = new Set(pairList.map(([, mj]) => mj));

  const missing = planned
    .map((mm, index) => ({ index, mm }))
    .filter(({ index }) => !pairedPlanned.has(index));
  const extra = measured
    .map((mm, index) => ({ index, mm }))
    .filter(({ index }) => !pairedMeasured.has(index));

  const matchedCost = matches.reduce(
    (sum, match) => sum + match.absDeviationMm,
    0,
  );
  const finalCell = dp[m][n];

  return {
    kind: 'ok',
    spineLength,
    tolerance,
    planned,
    measured,
    matches,
    missing,
    extra,
    totalCost: finalCell.cost,
    matchedCost,
    penaltyCost: finalCell.cost - matchedCost,
    passed:
      missing.length === 0 &&
      extra.length === 0 &&
      matches.every((match) => match.withinTolerance),
  };
}

/**
 * 录入态分析入口：先校验，任一问题都停留在待修正态（不产生诊断）；
 * 全部合法后做动态规划对齐。
 */
export function analyzeStaples(raw: {
  spineLength: string;
  tolerance: string;
  planned: string;
  measured: string;
}): StapleResult {
  const validation = validateStapleInput(raw);
  if (!validation.ok) {
    return { kind: 'invalid', issues: validation.issues };
  }
  return alignStaples(validation.input);
}
