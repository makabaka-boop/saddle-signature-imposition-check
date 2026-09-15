import { describe, expect, it } from 'vitest';
import {
  MAX_PAGES,
  MIN_PAGES,
  buildImposition,
  buildSheets,
  parseTotalPages,
  sheetAt,
  spreadOf,
  type InvalidImposition,
} from './imposition';

describe('sheetAt 页码公式（i 由 0 起、由外到内）', () => {
  it('最外层 i=0：正面左 N、右 1；背面左 2、右 N-1', () => {
    const s = sheetAt(8, 0);
    expect(s.front).toEqual({ left: 8, right: 1 });
    expect(s.back).toEqual({ left: 2, right: 7 });
  });

  it('最内层 i=N/4-1：正面为中缝相邻两页', () => {
    // N=16 共 4 张，最内 i=3：正面左 16-6=10、右 1+6=7
    const s = sheetAt(16, 3);
    expect(s.front).toEqual({ left: 10, right: 7 });
    expect(s.back).toEqual({ left: 8, right: 9 });
    // 最内层背面两页与正面两页合起来恰为连续的 7,8,9,10
    expect([s.front.right, s.back.left, s.back.right, s.front.left]).toEqual([
      7, 8, 9, 10,
    ]);
  });

  it('最小合法值 N=4：单张纸正反面', () => {
    const s = sheetAt(4, 0);
    expect(s.front).toEqual({ left: 4, right: 1 });
    expect(s.back).toEqual({ left: 2, right: 3 });
  });

  it('最大合法值 N=64 的最外层与最内层', () => {
    expect(sheetAt(64, 0).front).toEqual({ left: 64, right: 1 });
    expect(sheetAt(64, 0).back).toEqual({ left: 2, right: 63 });
    const innermost = sheetAt(64, 15);
    expect(innermost.front).toEqual({ left: 34, right: 31 });
    expect(innermost.back).toEqual({ left: 32, right: 33 });
  });
});

describe('buildSheets / buildImposition', () => {
  it('纸张数为 N/4 且 position 从 1 递增', () => {
    const result = buildImposition(12);
    expect(result.sheetCount).toBe(3);
    expect(result.sheets.map((s) => s.position)).toEqual([1, 2, 3]);
    expect(result.sheets.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('N=12 的完整外层→内层序列', () => {
    const sheets = buildSheets(12);
    expect(sheets).toEqual([
      {
        index: 0,
        position: 1,
        front: { left: 12, right: 1 },
        back: { left: 2, right: 11 },
      },
      {
        index: 1,
        position: 2,
        front: { left: 10, right: 3 },
        back: { left: 4, right: 9 },
      },
      {
        index: 2,
        position: 3,
        front: { left: 8, right: 5 },
        back: { left: 6, right: 7 },
      },
    ]);
  });

  it('每张纸的四页恰好覆盖 1..N 且不重复（边界 N=4 与 N=64）', () => {
    for (const n of [4, 8, 16, 64]) {
      const all = buildSheets(n).flatMap((s) => [
        s.front.left,
        s.front.right,
        s.back.left,
        s.back.right,
      ]);
      expect([...all].sort((a, b) => a - b)).toEqual(
        Array.from({ length: n }, (_, k) => k + 1),
      );
    }
  });

  it('折手顺序：外层包内层，正面左页随 i 递减、右页随 i 递增', () => {
    const sheets = buildSheets(20);
    expect(sheets.map((s) => s.front.left)).toEqual([20, 18, 16, 14, 12]);
    expect(sheets.map((s) => s.front.right)).toEqual([1, 3, 5, 7, 9]);
    expect(sheets.map((s) => s.back.left)).toEqual([2, 4, 6, 8, 10]);
    expect(sheets.map((s) => s.back.right)).toEqual([19, 17, 15, 13, 11]);
  });

  it('spreadOf 是只读翻面映射，不改纸张数据', () => {
    const s = sheetAt(8, 1);
    expect(spreadOf(s, 'front')).toBe(s.front);
    expect(spreadOf(s, 'back')).toBe(s.back);
  });
});

describe('parseTotalPages 输入校验与即时清版', () => {
  const invalid = (raw: string) => {
    const state = parseTotalPages(raw);
    expect(state.kind).toBe('invalid');
    return state as InvalidImposition;
  };

  it('空字符串（含纯空白）返回 empty，无任何拼版残留', () => {
    expect(parseTotalPages('')).toEqual({ kind: 'empty' });
    expect(parseTotalPages('   ')).toEqual({ kind: 'empty' });
  });

  it('小数被拒绝且原因为 not-integer', () => {
    expect(invalid('8.5').reason).toBe('not-integer');
    expect(invalid('0.25').reason).toBe('not-integer');
    expect(invalid('12.0').reason).toBe('not-integer'); // 输入原文带小数点即拒绝
  });

  it('非数字文本被拒绝', () => {
    expect(invalid('abc').reason).toBe('not-integer');
    expect(invalid('12页').reason).toBe('not-integer');
    expect(invalid('1e2').reason).toBe('not-integer');
  });

  it('越界被拒绝且原因为 out-of-range', () => {
    expect(invalid('0').reason).toBe('out-of-range');
    expect(invalid('-4').reason).toBe('out-of-range');
    expect(invalid('3').reason).toBe('out-of-range');
    expect(invalid('68').reason).toBe('out-of-range');
    expect(invalid('100').reason).toBe('out-of-range');
  });

  it('边界 4 与 64 合法', () => {
    expect(parseTotalPages(String(MIN_PAGES))).toMatchObject({
      kind: 'valid',
      totalPages: 4,
      sheetCount: 1,
    });
    expect(parseTotalPages(String(MAX_PAGES))).toMatchObject({
      kind: 'valid',
      totalPages: 64,
      sheetCount: 16,
    });
  });

  it('范围内但不能被 4 整除被拒绝且原因为 not-divisible-by-4', () => {
    for (const n of [5, 6, 7, 9, 10, 11, 62, 63]) {
      expect(invalid(String(n)).reason).toBe('not-divisible-by-4');
    }
  });

  it('非法状态不携带任何纸张（旧拼版必须被清除）', () => {
    const state = invalid('6');
    expect(Object.keys(state)).not.toContain('sheets');
  });

  it('合法输入返回外层到内层全部纸张', () => {
    const state = parseTotalPages('16');
    expect(state.kind).toBe('valid');
    if (state.kind !== 'valid') throw new Error('应当合法');
    expect(state.sheetCount).toBe(4);
    expect(state.sheets[0].front).toEqual({ left: 16, right: 1 });
    expect(state.sheets[3].back).toEqual({ left: 8, right: 9 });
  });
});
