import { describe, expect, it } from 'vitest';
import {
  MISS_PENALTY_FACTOR,
  alignStaples,
  analyzeStaples,
  parsePositionList,
  parseScalar,
  validateStapleInput,
  type StapleInput,
} from './stapleInspection';

function input(
  planned: number[],
  measured: number[],
  tolerance = 3,
  spineLength = 300,
): StapleInput {
  return { spineLength, tolerance, planned, measured };
}

/**
 * 参照实现：穷举两条序列之间全部保序单调匹配（每个计划位至多配一个、
 * 每个实测痕至多配一个、配对保持自上而下顺序），对每种匹配计算
 * “配对绝对偏差 + 未配对项 × 两倍容差”的总代价。用于交叉验证 DP
 * 取到的是全局最小代价。
 */
function bruteForceOptimalCost(inp: StapleInput): number {
  const { planned, measured, tolerance } = inp;
  const penalty = MISS_PENALTY_FACTOR * tolerance;
  const m = planned.length;
  const n = measured.length;

  let best = Infinity;
  const dfs = (i: number, j: number, cost: number): void => {
    if (i === m) {
      // 剩余实测痕全部判为多余
      best = Math.min(best, cost + (n - j) * penalty);
      return;
    }
    // 计划位 i 判为漏钉
    dfs(i + 1, j, cost + penalty);
    // 计划位 i 配给某个实测痕 k >= j（保持顺序）；j..k-1 的实测痕在此选择下全部多余
    for (let k = j; k < n; k += 1) {
      dfs(
        i + 1,
        k + 1,
        cost + (k - j) * penalty + Math.abs(planned[i] - measured[k]),
      );
    }
  };
  dfs(0, 0, 0);
  return best;
}

describe('解析与待修正态', () => {
  it('parseScalar：空、非十进制文本、负数、小数分类', () => {
    expect(parseScalar('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseScalar('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(parseScalar('abc')).toEqual({ ok: false, reason: 'not-number' });
    expect(parseScalar('1e2')).toEqual({ ok: false, reason: 'not-number' });
    expect(parseScalar('297mm')).toEqual({ ok: false, reason: 'not-number' });
    expect(parseScalar('-4')).toEqual({ ok: true, value: -4 });
    expect(parseScalar('2.5')).toEqual({ ok: true, value: 2.5 });
    expect(parseScalar('.5')).toEqual({ ok: true, value: 0.5 });
  });

  it('parsePositionList：支持空白、半角/全角逗号、顿号、分号分隔', () => {
    expect(parsePositionList('30, 80 130，180、230；280')).toEqual({
      ok: true,
      values: [30, 80, 130, 180, 230, 280],
    });
    expect(parsePositionList('')).toEqual({
      ok: false,
      reason: 'empty',
      itemIndex: null,
    });
    expect(parsePositionList('30, xx, 80')).toEqual({
      ok: false,
      reason: 'not-number',
      itemIndex: 1,
    });
    expect(parsePositionList('30, 1e2').ok).toBe(false);
  });

  it('参数不完整：四个空字段都被定位为 empty', () => {
    const result = validateStapleInput({
      spineLength: '',
      tolerance: '',
      planned: '',
      measured: '',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('应当校验失败');
    expect(result.issues.map((x) => x.field)).toEqual([
      'spineLength',
      'tolerance',
      'planned',
      'measured',
    ]);
    expect(result.issues.every((x) => x.reason === 'empty')).toBe(true);
  });

  it('书脊长度 / 允许偏差为 0 或负数：not-positive', () => {
    const result = validateStapleInput({
      spineLength: '0',
      tolerance: '-2',
      planned: '10',
      measured: '10',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('应当校验失败');
    expect(result.issues).toEqual([
      expect.objectContaining({ field: 'spineLength', reason: 'not-positive' }),
      expect.objectContaining({ field: 'tolerance', reason: 'not-positive' }),
    ]);
  });

  it('列表未严格递增 / 重复：定位到对应项（0-based 下标）', () => {
    const result = validateStapleInput({
      spineLength: '300',
      tolerance: '3',
      planned: '30, 80, 80, 200, 190, 260',
      measured: '30',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('应当校验失败');
    expect(result.issues).toEqual([
      expect.objectContaining({ field: 'planned', itemIndex: 2, reason: 'duplicate' }),
      expect.objectContaining({
        field: 'planned',
        itemIndex: 4,
        reason: 'not-strictly-increasing',
      }),
    ]);
  });

  it('超出书脊（含负值与 > 书脊长度）：定位到对应项', () => {
    const result = validateStapleInput({
      spineLength: '300',
      tolerance: '3',
      planned: '10',
      measured: '-1, 10, 300.5',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('应当校验失败');
    expect(result.issues).toEqual([
      expect.objectContaining({ field: 'measured', itemIndex: 0, reason: 'out-of-spine' }),
      expect.objectContaining({ field: 'measured', itemIndex: 2, reason: 'out-of-spine' }),
    ]);
  });

  it('边界值 0 与书脊长度合法', () => {
    const result = validateStapleInput({
      spineLength: '300',
      tolerance: '3',
      planned: '0, 300',
      measured: '0, 300',
    });
    expect(result.ok).toBe(true);
  });

  it('书脊不合法时不做范围判定，但列表顺序/重复/解析问题仍逐项报出', () => {
    const result = validateStapleInput({
      spineLength: '',
      tolerance: '3',
      planned: '10, 9',
      measured: 'x',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('应当校验失败');
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: 'spineLength', reason: 'empty' }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: 'planned', itemIndex: 1 }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: 'measured', itemIndex: 0, reason: 'not-number' }),
    );
  });

  it('analyzeStaples：非法时停留在 invalid，不产生诊断', () => {
    const result = analyzeStaples({
      spineLength: '300',
      tolerance: '3',
      planned: '30, 30',
      measured: '30',
    });
    expect(result.kind).toBe('invalid');
  });
});

describe('动态规划全局最优（贪心会错配的样本）', () => {
  it('样本 B：顺序最近邻先配 0→11，DP 改为漏 0、10→11', () => {
    // 计划 0/10，实测 11；容差 3（单项罚 6）。
    // 逐点顺序贪心（按计划位取最近且未占用的实测痕）：0→11(11)，漏 10(罚6) = 17；
    // 全局 DP：漏 0(罚6)，10→11(1) = 7。
    const inp = input([0, 10], [11], 3);
    const diag = alignStaples(inp);
    expect(diag.totalCost).toBeCloseTo(7, 9);
    expect(diag.totalCost).toBeCloseTo(bruteForceOptimalCost(inp), 9);
    expect(diag.matches.map((x) => [x.plannedIndex, x.measuredIndex])).toEqual([[1, 0]]);
    expect(diag.missing.map((x) => x.index)).toEqual([0]);
    expect(diag.matches[0].absDeviationMm).toBeCloseTo(1, 9);
  });

  it('样本 C：三点混合——贪心 20→26，DP 漏掉 20 改配 30→26', () => {
    // 计划 10/20/30；实测 9/26；容差 2（单项罚 4）。
    // 顺序贪心：10→9(1)，20→26(6)，漏 30(罚4) = 11；
    // 全局 DP：10→9(1)，漏 20(罚4)，30→26(4) = 9。
    const inp = input([10, 20, 30], [9, 26], 2);
    const diag = alignStaples(inp);
    expect(diag.totalCost).toBeCloseTo(9, 9);
    expect(diag.totalCost).toBeCloseTo(bruteForceOptimalCost(inp), 9);
    expect(diag.matches.map((x) => [x.plannedIndex, x.measuredIndex])).toEqual([
      [0, 0],
      [2, 1],
    ]);
    expect(diag.missing.map((x) => x.index)).toEqual([1]);
    expect(diag.extra).toHaveLength(0);
  });

  it('逐点最近邻反例：0/6/12 对 2/10，DP 跳过中间计划位', () => {
    // 独立最近邻会把同一实测痕同时判给两侧计划位（2 距 0 与 6 都近、
    // 10 距 6 与 12 都近）；顺序贪心：0→2(2)、6→10(4)、漏12(罚4)=10；
    // DP：0→2(2)、漏6(罚4)、12→10(2)=8。
    const inp = input([0, 6, 12], [2, 10], 2);
    const diag = alignStaples(inp);
    expect(diag.totalCost).toBeCloseTo(8, 9);
    expect(diag.totalCost).toBeCloseTo(bruteForceOptimalCost(inp), 9);
    expect(diag.matches.map((x) => [x.plannedIndex, x.measuredIndex])).toEqual([
      [0, 0],
      [2, 1],
    ]);
  });

  it('与穷举参照在多组输入上代价一致（含空表、单侧、超长偏差）', () => {
    const cases: StapleInput[] = [
      input([], []),
      input([10], []),
      input([], [10]),
      input([10, 20], [10, 20]),
      input([10, 20], [15], 3),
      input([10, 20, 30], [12, 18, 31], 5),
      input([0, 50, 100, 150], [48, 103, 148], 4),
      input([5, 15, 25], [4, 16, 24, 26], 2, 100),
      input([1, 2, 99], [1, 50, 99], 1, 100),
      input([10, 20, 30, 40], [11, 31, 39, 50], 3, 60),
      input([10, 16], [10, 28], 3, 40),
      input([10], [4, 16], 3),
    ];
    for (const inp of cases) {
      const diag = alignStaples(inp);
      expect(diag.totalCost, JSON.stringify(inp)).toBeCloseTo(
        bruteForceOptimalCost(inp),
        9,
      );
    }
  });

  it('配对偏差与罚分拆分正确', () => {
    const diag = alignStaples(input([30, 80, 130], [31, 79, 130], 3));
    expect(diag.matches).toHaveLength(3);
    expect(diag.missing).toHaveLength(0);
    expect(diag.extra).toHaveLength(0);
    expect(diag.penaltyCost).toBeCloseTo(0, 9);
    expect(diag.matchedCost).toBeCloseTo(2, 9);
    expect(diag.totalCost).toBeCloseTo(2, 9);
    expect(diag.matches[0].deviationMm).toBeCloseTo(1, 9);
    expect(diag.matches[1].deviationMm).toBeCloseTo(-1, 9);
    expect(diag.matches[2].withinTolerance).toBe(true);
  });

  it('漏钉与多余钉痕的罚分均为两倍容差', () => {
    const tolerance = 2;
    // 计划 10/20，实测 10/40：40 距 20 偏差 20 > 两端各罚 4（共 8），
    // 故 20 判漏钉、40 判多余（1 漏 1 多），优于偏差 20 的硬配对。
    const diag = alignStaples(input([10, 20], [10, 40], tolerance, 60));
    expect(diag.missing).toHaveLength(1);
    expect(diag.extra).toHaveLength(1);
    expect(diag.penaltyCost).toBeCloseTo(
      (diag.missing.length + diag.extra.length) * MISS_PENALTY_FACTOR * tolerance,
      9,
    );
  });

  it('超差配对 / 漏钉 / 多余钉痕任一存在即不合格', () => {
    const over = alignStaples(input([10, 20], [10, 25], 3));
    expect(over.passed).toBe(false);
    expect(over.matches[1].withinTolerance).toBe(false);

    const miss = alignStaples(input([10, 20], [10], 3));
    expect(miss.passed).toBe(false);
    expect(miss.missing).toEqual([{ index: 1, mm: 20 }]);

    const extra = alignStaples(input([10], [10, 20], 3));
    expect(extra.passed).toBe(false);
    expect(extra.extra).toEqual([{ index: 1, mm: 20 }]);
  });
});

describe('稳定决胜：等代价时未配对更少，再较早实测痕', () => {
  it('等代价路径中先选未配对项更少的路径', () => {
    // 计划 10/16，实测 10/28；容差 3（单项罚 6，少配一对共罚 12），书脊 40。
    //   全配路径：10→10(0)，16→28(12)，总代价 12，未配对 0；
    //   少配路径：10→10(0)，漏 16(罚6)，多 28(罚6)，总代价也是 12，未配对 2。
    // 总代价相同 → 必须选未配对更少的全配路径（即便该对偏差 12 超差）。
    const inp = input([10, 16], [10, 28], 3, 40);
    const diag = alignStaples(inp);
    expect(diag.totalCost).toBeCloseTo(12, 9);
    expect(diag.totalCost).toBeCloseTo(bruteForceOptimalCost(inp), 9);
    expect(diag.matches).toHaveLength(2);
    expect(diag.missing).toHaveLength(0);
    expect(diag.extra).toHaveLength(0);
    expect(diag.passed).toBe(false);
  });

  it('等代价且未配对相同、实测痕平手时：先选较早计划位（确定性兜底）', () => {
    // 计划 10/20，实测 15；容差 3（罚 6）。
    //   10→15(5)+漏20(6)=11；漏10(6)+20→15(5)=11。未配对都为 1、实测痕下标
    //   集合都为 {0}，实测痕维度平手 → 计划位兜底，配给更早计划位 10。
    const diag = alignStaples(input([10, 20], [15], 3));
    expect(diag.totalCost).toBeCloseTo(11, 9);
    expect(diag.matches.map((x) => [x.plannedIndex, x.measuredIndex])).toEqual([[0, 0]]);
    expect(diag.missing.map((x) => x.index)).toEqual([1]);
  });

  it('等代价且未配对相同时：先选使用较早实测痕的路径', () => {
    // 计划 10，实测 4/16；容差 3（罚 6）。
    //   10→4(6)+多16(6)=12；10→16(6)+多4(6)=12。未配对都为 1，
    //   配对实测痕下标 {0} 早于 {1} → 配给 j=0（4mm），16 判多余。
    const diag = alignStaples(input([10], [4, 16], 3));
    expect(diag.totalCost).toBeCloseTo(12, 9);
    expect(diag.matches.map((x) => [x.plannedIndex, x.measuredIndex])).toEqual([[0, 0]]);
    expect(diag.extra.map((x) => x.index)).toEqual([1]);
  });

  it('多点等代价：优先把较早实测痕纳入配对（结果确定且可重复）', () => {
    // 计划 10/20，实测 9/15/25；容差 3（罚 6），书脊 40。
    // 10 固定配 9（偏差 1）；15 与 25 距 20 都是 5mm：
    //   20 配 15、25 多余：1 + 5 + 6 = 12，配对实测痕下标 [[0,0],[1,1]]；
    //   20 配 25、15 多余：1 + 6 + 5 = 12，配对实测痕下标 [[0,0],[1,2]]。
    // 代价与未配对数都相同 → 优先较早实测痕 j=1（15mm），25 判多余。
    const inp = input([10, 20], [9, 15, 25], 3, 40);
    const a = alignStaples(inp);
    const b = alignStaples(inp);
    expect(a).toEqual(b);
    expect(a.totalCost).toBeCloseTo(bruteForceOptimalCost(inp), 9);
    expect(a.totalCost).toBeCloseTo(12, 9);
    expect(a.matches.map((x) => [x.plannedIndex, x.measuredIndex])).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(a.extra.map((x) => [x.index, x.mm])).toEqual([[2, 25]]);
  });
});

describe('完整录入流程 analyzeStaples', () => {
  it('合法混合漏钉与多余钉痕：端到端给出全部结论字段', () => {
    const result = analyzeStaples({
      spineLength: '300',
      tolerance: '3',
      planned: '30, 100, 170, 240',
      measured: '31, 169, 200',
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('应当合法');
    expect(result.matches.map((x) => [x.plannedIndex, x.measuredIndex])).toEqual([
      [0, 0],
      [2, 1],
    ]);
    expect(result.missing.map((x) => [x.index, x.mm])).toEqual([
      [1, 100],
      [3, 240],
    ]);
    expect(result.extra.map((x) => [x.index, x.mm])).toEqual([[2, 200]]);
    expect(result.passed).toBe(false);
  });

  it('全合格：passed=true', () => {
    const result = analyzeStaples({
      spineLength: '300',
      tolerance: '2',
      planned: '30,150,270',
      measured: '31,150,269',
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('应当合法');
    expect(result.passed).toBe(true);
  });
});

describe('精确十进制语义（超过安全整数范围不丢精度）', () => {
  it('书脊长度超过安全整数：合法原值全程保留，不被静默改小', () => {
    // 9007199254740993 = 2^53+1，Number 会舍入成 9007199254740992。
    const result = analyzeStaples({
      spineLength: '9007199254740993',
      tolerance: '3',
      planned: '0, 9007199254740993',
      measured: '0, 9007199254740993',
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('应当合法');
    expect(result.spineLengthText).toBe('9007199254740993');
    expect(result.plannedTexts).toEqual(['0', '9007199254740993']);
    expect(result.measuredTexts).toEqual(['0', '9007199254740993']);
    // 末端计划位 == 书脊长度（含边界合法），且两对完全吻合。
    expect(result.matches).toHaveLength(2);
    expect(result.passed).toBe(true);
    expect(result.totalCostText).toBe('0');
  });

  it('两个数学上严格递增的大整数计划位不被误判为重复', () => {
    // 9007199254740993 与 9007199254740994 数学上严格递增，
    // 但 Number 会把前者舍入成 9007199254740992、把后者精确表示，
    // 另一组 9007199254740995/9007199254740996 更会双双舍入为同一数。
    for (const planned of [
      '9007199254740993, 9007199254740994',
      '9007199254740995, 9007199254740996',
    ]) {
      const result = analyzeStaples({
        spineLength: '100000000000000000000',
        tolerance: '3',
        planned,
        measured: planned,
      });
      expect(result.kind, planned).toBe('ok');
      if (result.kind !== 'ok') throw new Error('应当合法');
      expect(result.matches).toHaveLength(2);
      expect(result.passed).toBe(true);
    }
  });

  it('真正相等的大整数仍判重复', () => {
    const result = analyzeStaples({
      spineLength: '100000000000000000000',
      tolerance: '3',
      planned: '9007199254740993, 9007199254740993',
      measured: '9007199254740993',
    });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') throw new Error('应当校验失败');
    expect(result.issues).toEqual([
      expect.objectContaining({ field: 'planned', itemIndex: 1, reason: 'duplicate' }),
    ]);
  });

  it('超大容差下末端完全吻合：选择成本更低的末位匹配，总代价精确', () => {
    // 计划 2^53+1 / 2^53+3，实测仅 2^53+3（与末端严格相等）。
    // 末位匹配代价 0 + 漏首位罚两倍容差；首位匹配偏差 2 + 漏末位罚两倍容差。
    // 容差极大时旧 number DP 会因溢出/舍入错配首位并给出 Infinity 总代价。
    const hugeTolerance = '1000000000000000000000000000000000000';
    const result = analyzeStaples({
      spineLength: '100000000000000000000000',
      tolerance: hugeTolerance,
      planned: '9007199254740993, 9007199254740995',
      measured: '9007199254740995',
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('应当合法');
    expect(result.matches.map((m) => [m.plannedIndex, m.measuredIndex])).toEqual([[1, 0]]);
    expect(result.missing.map((m) => m.index)).toEqual([0]);
    expect(result.matchAbsDeviationTexts).toEqual(['0']);
    expect(result.penaltyCostText).toBe(`2${'0'.repeat(36)}`);
    expect(result.totalCostText).toBe(result.penaltyCostText);
    expect(Number.isFinite(result.totalCost)).toBe(true);
  });

  it('大整数超出书脊仍精确定位 out-of-spine', () => {
    const result = analyzeStaples({
      spineLength: '9007199254740993',
      tolerance: '3',
      planned: '9007199254740994',
      measured: '1',
    });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') throw new Error('应当校验失败');
    expect(result.issues).toEqual([
      expect.objectContaining({ field: 'planned', itemIndex: 0, reason: 'out-of-spine' }),
    ]);
  });

  it('不同小数位的精确十进制在同一尺度下比较（2.5001 > 2.50 判超差）', () => {
    const result = analyzeStaples({
      spineLength: '300',
      tolerance: '2.50',
      planned: '200.5',
      measured: '203.0001',
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('应当合法');
    expect(result.matchDeviationTexts).toEqual(['+2.5001']);
    expect(result.matches[0].withinTolerance).toBe(false);
  });
});
