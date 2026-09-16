import { useRef, useState, type ChangeEvent, type RefObject } from 'react';
import {
  alignStaples,
  parsePositionList,
  validateStapleInput,
  type StapleDiagnosis,
  type StapleField,
  type StapleIssue,
  type StapleMatch,
} from '../lib/stapleInspection';

/**
 * 钉位检测区：成册下线后把质检员沿书脊自上而下量到的一串实测钉痕，
 * 与计划钉位做全局动态规划配对（非逐点最近邻），展示配对连线、毫米偏差、
 * 漏钉与多余钉痕。本区独立于拼版核版与走纸演练，不读取也不改写它们。
 *
 * 交互三态：
 *   - 录入态（diagnosis 为 null、issues 为空）：等待“分析钉位”；
 *   - 待修正态（issues 非空）：留在录入表单，逐项定位问题（不产生诊断）；
 *   - 诊断态（diagnosis 非空）：展示连线与结论。
 * 任一输入在分析后被改动，立即撤销旧诊断回到录入态；“清空检测”清空全部。
 */

type FieldDef = {
  readonly field: StapleField;
  readonly label: string;
  readonly testid: string;
  readonly placeholder: string;
  readonly hint: string;
};

const FIELDS: readonly FieldDef[] = [
  {
    field: 'spineLength',
    label: '书脊长度（毫米）',
    testid: 'staple-spine-input',
    placeholder: '例如 300',
    hint: '书脊自上而下的总长度，顶端为 0',
  },
  {
    field: 'tolerance',
    label: '允许偏差（毫米）',
    testid: 'staple-tolerance-input',
    placeholder: '例如 3',
    hint: '单侧容差；漏一个计划位或多一个实测痕各罚两倍容差',
  },
  {
    field: 'planned',
    label: '计划钉位（自上而下，毫米）',
    testid: 'staple-planned-input',
    placeholder: '例如 30, 100, 170, 240',
    hint: '用空格、逗号或顿号分隔，自上而下严格递增',
  },
  {
    field: 'measured',
    label: '实测钉痕（自上而下，毫米）',
    testid: 'staple-measured-input',
    placeholder: '例如 31, 99, 169, 200',
    hint: '质检员沿书脊量到的实际钉痕，可夹漏钉与误识别',
  },
];

const TOKEN_SPLIT_RE = /[\s,，、;；]+/;

/** 毫米数显示：去掉二进制浮点尾巴（0.1+0.2 之类），保留最多 2 位小数。 */
function formatMm(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function tokenize(raw: string): string[] {
  return raw.trim() === '' ? [] : raw.trim().split(TOKEN_SPLIT_RE).filter((t) => t !== '');
}

/** 列表输入下方逐项渲染已录入的毫米项；越界 / 非数 / 顺序问题定位到具体项。 */
function PositionTokens({
  raw,
  issues,
  testid,
}: {
  raw: string;
  issues: readonly StapleIssue[];
  testid: string;
}) {
  const tokens = tokenize(raw);
  if (tokens.length === 0) {
    return null;
  }
  const invalidIndexes = new Set(issues.map((x) => x.itemIndex).filter((x): x is number => x !== null));
  const notNumeric = parsePositionList(raw);
  if (!notNumeric.ok && notNumeric.itemIndex !== null) {
    invalidIndexes.add(notNumeric.itemIndex);
  }
  return (
    <ol className="staple-tokens" data-testid={`${testid}-tokens`} aria-hidden="true">
      {tokens.map((token, i) => (
        <li
          key={`${i}-${token}`}
          className={
            invalidIndexes.has(i) ? 'staple-token staple-token--bad' : 'staple-token'
          }
          data-token-index={i}
        >
          <span className="staple-token__index">{i + 1}</span>
          <span className="staple-token__value">{token}</span>
        </li>
      ))}
    </ol>
  );
}

const PAIR_ROW_TESTID = 'staple-pair-row';
const MISSING_ROW_TESTID = 'staple-missing-row';
const EXTRA_ROW_TESTID = 'staple-extra-row';

/** 配对连线图：左侧计划钉位列、右侧实测钉痕列，自上而下按毫米坐标定位。 */
function PairingDiagram({ diagnosis }: { diagnosis: StapleDiagnosis }) {
  const WIDTH = 340;
  const ROW_H = 320;
  const PAD_TOP = 18;
  const PAD_BOTTOM = 18;
  const PLANNED_X = 96;
  const MEASURED_X = WIDTH - 96;
  const { spineLength } = diagnosis;

  const yOf = (mm: number): number => {
    const ratio = spineLength <= 0 ? 0 : Math.min(Math.max(mm / spineLength, 0), 1);
    return PAD_TOP + ratio * (ROW_H - PAD_TOP - PAD_BOTTOM);
  };

  return (
    <svg
      className="staple-diagram"
      data-testid="staple-diagram"
      viewBox={`0 0 ${WIDTH} ${ROW_H}`}
      role="img"
      aria-label="计划钉位与实测钉痕配对连线图"
    >
      {/* 书脊中线参考 */}
      <line
        x1={WIDTH / 2}
        y1={PAD_TOP}
        x2={WIDTH / 2}
        y2={ROW_H - PAD_BOTTOM}
        className="staple-diagram__spine"
      />
      <text x={WIDTH / 2} y={12} textAnchor="middle" className="staple-diagram__scale">
        0 mm（顶端）
      </text>
      <text x={WIDTH / 2} y={ROW_H - 4} textAnchor="middle" className="staple-diagram__scale">
        {formatMm(spineLength)} mm（底端）
      </text>

      {/* 配对连线 */}
      {diagnosis.matches.map((match) => (
        <line
          key={`${match.plannedIndex}-${match.measuredIndex}`}
          data-testid="staple-pair-line"
          data-pair={`${match.plannedIndex}-${match.measuredIndex}`}
          x1={PLANNED_X}
          y1={yOf(match.plannedMm)}
          x2={MEASURED_X}
          y2={yOf(match.measuredMm)}
          className={
            match.withinTolerance
              ? 'staple-diagram__line staple-diagram__line--ok'
              : 'staple-diagram__line staple-diagram__line--over'
          }
        />
      ))}

      {/* 计划钉位（左列） */}
      {diagnosis.planned.map((mm, i) => {
        const paired = diagnosis.matches.some((m) => m.plannedIndex === i);
        return (
          <g key={`p-${i}`}>
            <circle
              cx={PLANNED_X}
              cy={yOf(mm)}
              r={5}
              className={
                paired
                  ? 'staple-diagram__dot staple-diagram__dot--planned'
                  : 'staple-diagram__dot staple-diagram__dot--missing'
              }
            />
            <text x={PLANNED_X - 12} y={yOf(mm) + 4} textAnchor="end" className="staple-diagram__label">
              {formatMm(mm)}
            </text>
          </g>
        );
      })}

      {/* 实测钉痕（右列） */}
      {diagnosis.measured.map((mm, i) => {
        const paired = diagnosis.matches.some((m) => m.measuredIndex === i);
        return (
          <g key={`m-${i}`}>
            <circle
              cx={MEASURED_X}
              cy={yOf(mm)}
              r={5}
              className={
                paired
                  ? 'staple-diagram__dot staple-diagram__dot--measured'
                  : 'staple-diagram__dot staple-diagram__dot--extra'
              }
            />
            <text x={MEASURED_X + 12} y={yOf(mm) + 4} textAnchor="start" className="staple-diagram__label">
              {formatMm(mm)}
            </text>
          </g>
        );
      })}

      <text x={PLANNED_X} y={ROW_H - 4} textAnchor="middle" className="staple-diagram__colhint">
        计划
      </text>
      <text x={MEASURED_X} y={ROW_H - 4} textAnchor="middle" className="staple-diagram__colhint">
        实测
      </text>
    </svg>
  );
}

function deviationText(match: StapleMatch): string {
  const sign = match.deviationMm > 0 ? '+' : '';
  return `${sign}${formatMm(match.deviationMm)}`;
}

export function StapleInspection() {
  const [raw, setRaw] = useState({
    spineLength: '',
    tolerance: '',
    planned: '',
    measured: '',
  });
  // null = 当前没有已确认诊断（录入态或待修正态）。
  const [diagnosis, setDiagnosis] = useState<StapleDiagnosis | null>(null);
  const [issues, setIssues] = useState<readonly StapleIssue[]>([]);
  const spineRef = useRef<HTMLInputElement>(null);
  const toleranceRef = useRef<HTMLInputElement>(null);
  const plannedRef = useRef<HTMLTextAreaElement>(null);
  const measuredRef = useRef<HTMLTextAreaElement>(null);

  const update = (field: StapleField, value: string) => {
    setRaw((prev) => ({ ...prev, [field]: value }));
    // 分析后改动任一输入：立即撤销旧诊断与待修正提示，回到录入态。
    if (diagnosis !== null || issues.length > 0) {
      setDiagnosis(null);
      setIssues([]);
    }
  };

  const analyze = () => {
    const validation = validateStapleInput(raw);
    if (!validation.ok) {
      // 待修正态：不产生任何诊断，定位第一个问题字段 / 列表项。
      setIssues(validation.issues);
      setDiagnosis(null);
      const first = validation.issues[0];
      const refs: Record<StapleField, RefObject<HTMLElement | null>> = {
        spineLength: spineRef,
        tolerance: toleranceRef,
        planned: plannedRef,
        measured: measuredRef,
      };
      refs[first.field].current?.focus();
      return;
    }
    setIssues([]);
    setDiagnosis(alignStaples(validation.input));
  };

  const clearAll = () => {
    setRaw({ spineLength: '', tolerance: '', planned: '', measured: '' });
    setDiagnosis(null);
    setIssues([]);
    spineRef.current?.focus();
  };

  const fieldIssues = (field: StapleField): readonly StapleIssue[] =>
    issues.filter((issue) => issue.field === field);

  const renderFieldError = (field: StapleField) => {
    const list = fieldIssues(field);
    if (list.length === 0) {
      return null;
    }
    return (
      <ul className="staple-field-errors" data-testid={`staple-${field}-errors`}>
        {list.map((issue, i) => (
          <li
            key={i}
            data-testid="staple-error-item"
            data-field={field}
            data-item-index={issue.itemIndex ?? ''}
            data-reason={issue.reason}
          >
            {issue.message}
          </li>
        ))}
      </ul>
    );
  };

  const analysed = diagnosis !== null;

  return (
    <section className="staple" aria-label="钉位检测区" data-testid="staple-inspection">
      <header className="staple__header">
        <h2>钉位检测区</h2>
        <p className="staple__intro">
          成册下线后，把沿书脊自上而下量到的实测钉痕与计划钉位按顺序配对。配对采用自上而下的
          <strong>全局动态规划</strong>（非逐点最近邻）：配对代价为绝对毫米偏差，漏掉一个计划位或
          多出一个实测痕各罚两倍容差；等代价时优先未配对更少、再优先较早实测痕。本区独立于
          拼版核版与走纸演练。
        </p>
      </header>

      <div className="staple-form">
        {FIELDS.map((def) => {
          const listIssues = fieldIssues(def.field);
          const invalid = listIssues.length > 0;
          const className = invalid
            ? 'staple-input staple-input--invalid'
            : 'staple-input';
          const sharedProps = {
            id: def.testid,
            'data-testid': def.testid,
            'aria-invalid': invalid || undefined,
            className,
            placeholder: def.placeholder,
            autoComplete: 'off' as const,
            value: raw[def.field],
            onChange: (
              e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
            ) => update(def.field, e.target.value),
          };
          return (
            <div className="staple-field" key={def.field}>
              <label htmlFor={def.testid}>{def.label}</label>
              {def.field === 'spineLength' ? (
                <input ref={spineRef} type="text" inputMode="decimal" {...sharedProps} />
              ) : def.field === 'tolerance' ? (
                <input ref={toleranceRef} type="text" inputMode="decimal" {...sharedProps} />
              ) : def.field === 'planned' ? (
                <textarea ref={plannedRef} rows={2} {...sharedProps} />
              ) : (
                <textarea ref={measuredRef} rows={2} {...sharedProps} />
              )}
              <span className="staple-field__hint">{def.hint}</span>
              <PositionTokens raw={raw[def.field]} issues={listIssues} testid={def.testid} />
              {renderFieldError(def.field)}
            </div>
          );
        })}
      </div>

      <div className="staple-controls" role="group" aria-label="钉位检测操作">
        <button
          type="button"
          className="staple-button staple-button--analyze"
          data-testid="staple-analyze"
          onClick={analyze}
        >
          分析钉位
        </button>
        <button
          type="button"
          className="staple-button staple-button--clear"
          data-testid="staple-clear"
          onClick={clearAll}
        >
          清空检测
        </button>
      </div>

      {!analysed && issues.length === 0 && (
        <p className="notice notice-empty" data-testid="staple-entry-hint" role="status">
          按顺序填好书脊长度、允许偏差、计划钉位与实测钉痕，点击「分析钉位」查看配对连线、
          毫米偏差、漏钉与多余钉痕。
        </p>
      )}

      {issues.length > 0 && (
        <div className="notice notice-error" data-testid="staple-invalid-panel" role="alert">
          <strong>请先修正以下 {issues.length} 项后再分析：</strong>
          <ul className="staple-invalid-list">
            {issues.map((issue, i) => (
              <li key={i} data-testid="staple-invalid-item">
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysed && diagnosis !== null && (
        <div className="staple-result" data-testid="staple-result">
          <p
            className={
              diagnosis.passed
                ? 'staple-verdict staple-verdict--pass'
                : 'staple-verdict staple-verdict--fail'
            }
            data-testid="staple-verdict"
            data-pass={diagnosis.passed ? 'true' : 'false'}
            role="status"
          >
            {diagnosis.passed
              ? `钉位合格：${diagnosis.matches.length} 个钉全部在 ±${formatMm(diagnosis.tolerance)} mm 容差内，无漏钉、无多余钉痕。`
              : '钉位不合格：存在超差配对、漏钉或多余钉痕，详见下方连线与清单。'}
          </p>

          <div className="staple-summary" data-testid="staple-summary">
            <span>
              配对 <strong data-testid="staple-summary-pairs">{diagnosis.matches.length}</strong> 处
            </span>
            <span>
              漏钉 <strong data-testid="staple-summary-missing">{diagnosis.missing.length}</strong> 个
            </span>
            <span>
              多余钉痕 <strong data-testid="staple-summary-extra">{diagnosis.extra.length}</strong> 个
            </span>
            <span>
              DP 总代价 <strong data-testid="staple-summary-cost">{formatMm(diagnosis.totalCost)}</strong>
            </span>
          </div>

          <PairingDiagram diagnosis={diagnosis} />

          <div className="staple-legend" aria-hidden="true">
            <span className="staple-legend__item">
              <i className="staple-swatch staple-swatch--planned" /> 计划钉位
            </span>
            <span className="staple-legend__item">
              <i className="staple-swatch staple-swatch--measured" /> 实测钉痕
            </span>
            <span className="staple-legend__item">
              <i className="staple-swatch staple-swatch--missing" /> 漏钉
            </span>
            <span className="staple-legend__item">
              <i className="staple-swatch staple-swatch--extra" /> 多余钉痕
            </span>
          </div>

          <div className="staple-tables">
            <table className="staple-table" data-testid="staple-pair-table">
              <thead>
                <tr>
                  <th>计划位（自上而下）</th>
                  <th>实测痕（自上而下）</th>
                  <th>毫米偏差</th>
                  <th>判定</th>
                </tr>
              </thead>
              <tbody>
                {diagnosis.matches.map((match) => (
                  <tr
                    key={`${match.plannedIndex}-${match.measuredIndex}`}
                    data-testid={PAIR_ROW_TESTID}
                    data-pair={`${match.plannedIndex}-${match.measuredIndex}`}
                    className={match.withinTolerance ? '' : 'staple-table__row--over'}
                  >
                    <td>
                      第 {match.plannedIndex + 1} 个 · {formatMm(match.plannedMm)} mm
                    </td>
                    <td>
                      第 {match.measuredIndex + 1} 痕 · {formatMm(match.measuredMm)} mm
                    </td>
                    <td data-testid="staple-pair-deviation">
                      {deviationText(match)} mm（|Δ| {formatMm(match.absDeviationMm)}）
                    </td>
                    <td data-testid="staple-pair-status">
                      {match.withinTolerance ? '合格' : `超差（容差 ${formatMm(diagnosis.tolerance)}）`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="staple-side-lists">
              <div>
                <h3 data-testid="staple-missing-title">漏钉（计划有、实测无）</h3>
                {diagnosis.missing.length === 0 ? (
                  <p className="staple-empty-note" data-testid="staple-missing-empty">
                    无漏钉
                  </p>
                ) : (
                  <ul className="staple-item-list">
                    {diagnosis.missing.map((item) => (
                      <li key={item.index} data-testid={MISSING_ROW_TESTID} data-index={item.index}>
                        第 {item.index + 1} 个计划位 · {formatMm(item.mm)} mm 无对应实测钉痕
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 data-testid="staple-extra-title">多余钉痕（实测有、计划无）</h3>
                {diagnosis.extra.length === 0 ? (
                  <p className="staple-empty-note" data-testid="staple-extra-empty">
                    无多余钉痕
                  </p>
                ) : (
                  <ul className="staple-item-list">
                    {diagnosis.extra.map((item) => (
                      <li key={item.index} data-testid={EXTRA_ROW_TESTID} data-index={item.index}>
                        第 {item.index + 1} 痕 · {formatMm(item.mm)} mm 疑似误识别的多余钉痕
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
