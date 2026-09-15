/**
 * 骑马订拼版纯映射逻辑（左侧装订，每张物理纸承载 4 页）。
 *
 * 纸张按 i = 0, 1, 2, … 由“外层 → 内层”排列（骑马订套帖：
 * 第 0 张包住第 1 张，第 1 张包住第 2 张……）。
 *
 * 第 i 张的页序（页码为 1-based 印刷页码）：
 *   正面（沿竖直中线折叠后朝外的一面）：左页 N-2i，右页 1+2i
 *   背面（沿纸张竖直中线翻转后看到的阅读方向）：左页 2+2i，右页 N-1-2i
 *
 * “沿竖直中线翻转”是绕竖直轴的翻面：正面右页的印张翻到背面后
 * 位于观察者左侧，因此背面左页紧跟封面（正面右页 = 第 1 页），
 * 即背面左页 = 2、背面右页 = N-1。
 */

export const MIN_PAGES = 4;
export const MAX_PAGES = 64;
export const PAGES_PER_SHEET = 4;
export const PAGES_PER_SIDE = 2;

/** 展示面：正面 / 背面。 */
export type Side = 'front' | 'back';

/** 一个展示面上左右两个页码槽。 */
export interface SideSpread {
  /** 当前面的左页页码（1-based）。 */
  readonly left: number;
  /** 当前面的右页页码（1-based）。 */
  readonly right: number;
}

/** 一张物理纸（对折后成为书帖的一层）。 */
export interface ImpositionSheet {
  /** 纸张序号，0 = 最外层，向内递增。 */
  readonly index: number;
  /** 由外到内的人读位置，从 1 开始（index + 1）。 */
  readonly position: number;
  readonly front: SideSpread;
  readonly back: SideSpread;
}

/** 合法输入对应的完整拼版结果。 */
export interface ImpositionResult {
  readonly kind: 'valid';
  readonly totalPages: number;
  /** 由外层到内层的全部纸张。 */
  readonly sheets: readonly ImpositionSheet[];
  readonly sheetCount: number;
}

/** 输入被拒绝的原因；reason 为稳定的机器码，message 为中文说明。 */
export interface InvalidImposition {
  readonly kind: 'invalid';
  readonly reason:
    | 'empty'
    | 'not-integer'
    | 'out-of-range'
    | 'not-divisible-by-4';
  readonly message: string;
}

/** 输入框尚未形成可接受结果时的状态（等价于“无结果”，用于首屏）。 */
export interface EmptyImposition {
  readonly kind: 'empty';
}

export type ImpositionState =
  | ImpositionResult
  | InvalidImposition
  | EmptyImposition;

const INTEGER_RE = /^[+-]?\d+$/;

/** 单张纸的纯页码映射，i 从 0 起、由外到内。 */
export function sheetAt(totalPages: number, i: number): ImpositionSheet {
  return {
    index: i,
    position: i + 1,
    front: { left: totalPages - 2 * i, right: 1 + 2 * i },
    back: { left: 2 + 2 * i, right: totalPages - 1 - 2 * i },
  };
}

/** 由总页数构建由外层到内层的全部纸张。totalPages 必须合法，否则抛错。 */
export function buildSheets(totalPages: number): readonly ImpositionSheet[] {
  assertValidTotalPages(totalPages);
  const sheetCount = totalPages / PAGES_PER_SHEET;
  return Array.from({ length: sheetCount }, (_unused, i) =>
    sheetAt(totalPages, i),
  );
}

/** 合法参数直接构造结果；非法参数抛 RangeError（供需要严格抛错的调用方使用）。 */
export function buildImposition(totalPages: number): ImpositionResult {
  return {
    kind: 'valid',
    totalPages,
    sheets: buildSheets(totalPages),
    sheetCount: totalPages / PAGES_PER_SHEET,
  };
}

/** 校验总页数：整数、4..64、可被 4 整除；不合法时抛 RangeError。 */
export function assertValidTotalPages(totalPages: number): asserts totalPages is number {
  if (!Number.isInteger(totalPages)) {
    throw new RangeError('总页数必须是整数');
  }
  if (totalPages < MIN_PAGES || totalPages > MAX_PAGES) {
    throw new RangeError(`总页数必须在 ${MIN_PAGES} 至 ${MAX_PAGES} 之间`);
  }
  if (totalPages % PAGES_PER_SHEET !== 0) {
    throw new RangeError(`总页数必须能被 ${PAGES_PER_SHEET} 整除`);
  }
}

/**
 * 直接解析输入框原文，得到当前拼版状态。
 * 非法输入不会产生任何残留结果（调用方据此清除旧拼版）。
 */
export function parseTotalPages(raw: string): ImpositionState {
  const text = raw.trim();
  if (text === '') {
    return { kind: 'empty' };
  }
  if (!INTEGER_RE.test(text)) {
    return {
      kind: 'invalid',
      reason: 'not-integer',
      message: '总页数必须是整数，不能输入小数或非数字字符',
    };
  }
  const n = Number(text);
  if (!Number.isSafeInteger(n)) {
    return {
      kind: 'invalid',
      reason: 'not-integer',
      message: '总页数超出可精确表示的整数范围',
    };
  }
  if (n < MIN_PAGES || n > MAX_PAGES) {
    return {
      kind: 'invalid',
      reason: 'out-of-range',
      message: `总页数必须在 ${MIN_PAGES} 至 ${MAX_PAGES} 之间`,
    };
  }
  if (n % PAGES_PER_SHEET !== 0) {
    return {
      kind: 'invalid',
      reason: 'not-divisible-by-4',
      message: `总页数必须能被 ${PAGES_PER_SHEET} 整除（骑马订每张纸承载 ${PAGES_PER_SHEET} 页）`,
    };
  }
  return buildImposition(n);
}

/** 取某张纸指定面的左右页（翻面只读映射，不改折手顺序）。 */
export function spreadOf(sheet: ImpositionSheet, side: Side): SideSpread {
  return side === 'front' ? sheet.front : sheet.back;
}
