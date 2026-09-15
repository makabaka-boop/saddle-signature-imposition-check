import { spreadOf, type ImpositionSheet, type Side } from '../lib/imposition';

interface SheetCardProps {
  sheet: ImpositionSheet;
  totalPages: number;
  side: Side;
  onFlip: (index: number, side: Side) => void;
}

const SIDE_LABEL: Record<Side, string> = {
  front: '正面',
  back: '背面',
};

/**
 * 单张纸的预览卡。翻面只切换当前这一张展示的是 front 还是 back，
 * 页码全部来自预先生成的不可变 sheet 数据。
 */
export function SheetCard({ sheet, totalPages, side, onFlip }: SheetCardProps) {
  const spread = spreadOf(sheet, side);

  return (
    <article
      className={`sheet-card sheet-card--${side}`}
      data-testid="sheet-card"
      data-index={sheet.index}
    >
      <header className="sheet-card__header">
        <h2>
          第 <span data-testid="sheet-position">{sheet.position}</span> 张
          <span className="sheet-card__index">（i = {sheet.index}）</span>
        </h2>
        <div className="flip-controls" role="group" aria-label="正反面切换">
          <button
            type="button"
            data-testid="show-front"
            aria-pressed={side === 'front'}
            disabled={side === 'front'}
            onClick={() => onFlip(sheet.index, 'front')}
          >
            正面
          </button>
          <button
            type="button"
            data-testid="show-back"
            aria-pressed={side === 'back'}
            disabled={side === 'back'}
            onClick={() => onFlip(sheet.index, 'back')}
          >
            背面
          </button>
        </div>
      </header>

      <p className="sheet-card__sidenote">
        当前展示：
        <strong data-testid="current-side">{SIDE_LABEL[side]}</strong>
        （沿纸张竖直中线翻转）
      </p>

      <div className="sheet-spread" data-testid="sheet-spread">
        <div className="page-slot page-slot--left" data-testid="page-left">
          <span className="page-slot__tag">{SIDE_LABEL[side]} · 左页</span>
          <span className="page-slot__number">{spread.left}</span>
        </div>
        <div className="fold-line" aria-hidden="true">
          <span>装订侧（竖直中线对折）</span>
        </div>
        <div className="page-slot page-slot--right" data-testid="page-right">
          <span className="page-slot__tag">{SIDE_LABEL[side]} · 右页</span>
          <span className="page-slot__number">{spread.right}</span>
        </div>
      </div>

      {side === 'back' && (
        <p className="sheet-card__hint">
          核对要点：从正面绕竖直轴翻到背面后，原正面右页（第{' '}
          {sheet.front.right} 页）一侧转到观察者左边，因此本面左页为第{' '}
          {sheet.back.left} 页——不是 {sheet.back.right} 页。
        </p>
      )}
      {side === 'front' && totalPages === sheet.front.left && sheet.index === 0 && (
        <p className="sheet-card__hint">
          最外层正面：左页是全书最后一页（封面底），右页是第 1 页（封面）。
        </p>
      )}
    </article>
  );
}
