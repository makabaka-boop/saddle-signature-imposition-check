import { useMemo, useState } from 'react';
import {
  parseTotalPages,
  type ImpositionSheet,
  type Side,
} from './lib/imposition';
import { SheetCard } from './components/SheetCard';
import { PaperDrill } from './components/PaperDrill';

export function App() {
  const [raw, setRaw] = useState('');
  const [sides, setSides] = useState<Record<number, Side>>({});

  // 纯函数派生拼版；翻面只改 sides，不会重新生成结果。
  const state = useMemo(() => parseTotalPages(raw), [raw]);

  const handleChange = (value: string) => {
    setRaw(value);
    // 总页数一变（合法值改变或变为非法/空），各纸展示面重置为正面，
    // 避免上一本书的翻面状态串到新结果上。
    setSides({});
  };

  const flip = (index: number, side: Side) => {
    setSides((prev) => ({ ...prev, [index]: side }));
  };

  return (
    <main className="page">
      <header className="page-header">
        <h1>骑马订核版台</h1>
        <p className="subtitle">
          左侧装订 · 每张纸承载 4 页 · 纸张由外层到内层套帖
        </p>
      </header>

      <section className="input-panel" aria-label="总页数输入">
        <label htmlFor="pages-input">总页数 N</label>
        <input
          id="pages-input"
          data-testid="pages-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="例如 16"
          value={raw}
          onChange={(e) => handleChange(e.target.value)}
        />
        <span className="input-rule">
          4–64 之间的整数，且能被 4 整除
        </span>
      </section>

      {state.kind === 'empty' && (
        <p className="notice notice-empty" data-testid="empty-hint" role="status">
          尚未输入总页数：请输入 4–64 之间、可被 4 整除的整数。当前没有任何拼版。
        </p>
      )}

      {state.kind === 'invalid' && (
        <p className="notice notice-error" data-testid="error-panel" role="alert">
          <strong>拼版已清除：</strong>
          <span data-testid="error-message">{state.message}</span>
        </p>
      )}

      {state.kind === 'valid' && (
        <section className="result" aria-label="拼版结果">
          <div className="summary" data-testid="summary">
            <span>
              总页数 <strong data-testid="summary-pages">{state.totalPages}</strong>
            </span>
            <span>
              纸张数{' '}
              <strong data-testid="summary-sheets">{state.sheetCount}</strong> 张
            </span>
            <span className="summary-note">
              排列方向：第 1 张为最外层，向内依次套入（折叠后外层包住内层）
            </span>
          </div>

          <ol className="sheet-list" data-testid="sheet-list">
            {state.sheets.map((sheet: ImpositionSheet) => (
              <li key={sheet.index}>
                <SheetCard
                  sheet={sheet}
                  totalPages={state.totalPages}
                  side={sides[sheet.index] ?? 'front'}
                  onFlip={flip}
                />
              </li>
            ))}
          </ol>
        </section>
      )}

      <PaperDrill />

      <footer className="page-footer">
        <p>
          第 i 张（i 从 0 起，由外到内）：正面 左 N−2i / 右 1+2i；背面（沿竖直中线翻转后的阅读方向）
          左 2+2i / 右 N−1−2i。
        </p>
      </footer>
    </main>
  );
}
