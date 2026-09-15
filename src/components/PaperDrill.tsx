import { useState } from 'react';
import type { Side } from '../lib/imposition';
import {
  EMPTY_TRAIL,
  MAX_TRAIL_STEPS,
  appendAction,
  arrowAngleOf,
  currentPose,
  viewOf,
  type Compass,
  type CornerMark,
  type CornerPosition,
  type DrillAction,
  type DrillTrail,
} from '../lib/paperDrill';

const SIDE_LABEL: Record<Side, string> = {
  front: '正面',
  back: '背面',
};

const COMPASS_LABEL: Record<Compass, string> = {
  N: '北',
  E: '东',
  S: '南',
  W: '西',
};

const ACTION_LABEL: Record<DrillAction, string> = {
  rotate: '顺时针旋转 90°',
  flip: '沿进纸轴翻纸',
};

const CORNER_SLOTS: readonly CornerPosition[] = ['NW', 'NE', 'SE', 'SW'];
const CORNER_MARKS: readonly CornerMark[] = ['A', 'B', 'C', 'D'];

/**
 * 走纸方向演练区：独立于拼版核版的纯空间朝向演练。
 * 只消费 paperDrill 模型的不可变轨迹，不读取也不改写拼版结果；
 * 演练动作不会重算、清除或改变已有总页数与各纸展示面。
 */
export function PaperDrill() {
  const [trail, setTrail] = useState<DrillTrail>(EMPTY_TRAIL);
  const [invalid, setInvalid] = useState(false);
  const [limitHit, setLimitHit] = useState(false);

  const pose = currentPose(trail);
  const view = viewOf(pose);
  // 累计显示角度：连续旋转时箭头沿同一方向连续转动，不倒转。
  const arrowAngle = arrowAngleOf(trail.steps);
  const full = trail.steps.length >= MAX_TRAIL_STEPS;

  // 角标落位的逆映射：机器方位 → 当前在该方位的角标。
  const markAt = (slot: CornerPosition): CornerMark | null =>
    CORNER_MARKS.find((mark) => view.corners[mark] === slot) ?? null;

  const act = (action: DrillAction) => {
    const result = appendAction(trail, action);
    if (result.ok) {
      setTrail(result.trail);
      return;
    }
    if (result.reason === 'invalid-trail') {
      // 拒绝本次动作，保留最后可信画面（trail 不变）。
      setInvalid(true);
    } else {
      setLimitHit(true);
    }
  };

  return (
    <section className="drill" aria-label="走纸方向演练区" data-testid="paper-drill">
      <header className="drill__header">
        <h2>走纸方向演练区</h2>
        <p className="drill__intro">
          起点：正面朝上 · 进纸箭头朝北 · 角标 A–D 归位。只用「顺时针旋转 90°」与
          「沿进纸轴翻纸」复演现场步骤；两种动作不可交换，先后顺序决定角标布局。
          本区不读取、不改写拼版结果。
        </p>
      </header>

      <div className="drill__stage">
        <div className="drill__compass" aria-hidden="true">
          <span className="drill__compass-n">北 · 机器进纸方向</span>
          <span className="drill__compass-w">西</span>
          <span className="drill__compass-e">东</span>
          <span className="drill__compass-s">南</span>
        </div>

        <div
          className={`drill-sheet drill-sheet--${view.faceUp}`}
          data-testid="drill-sheet"
        >
          {CORNER_SLOTS.map((slot) => {
            const mark = markAt(slot);
            return (
              <span
                key={slot}
                className={`corner-slot corner-slot--${slot}`}
                data-testid={`corner-slot-${slot}`}
              >
                {mark !== null && (
                  <span className={`corner-mark corner-mark--${mark}`}>{mark}</span>
                )}
              </span>
            );
          })}
          <span
            className="drill-sheet__arrow"
            data-testid="drill-arrow-icon"
            data-direction={view.arrow}
            style={{ transform: `rotate(${arrowAngle}deg)` }}
            aria-hidden="true"
          >
            ↑
          </span>
          <span className="drill-sheet__face">{SIDE_LABEL[view.faceUp]}</span>
        </div>
      </div>

      <p className="drill__status">
        当前：
        <strong data-testid="drill-face">{SIDE_LABEL[view.faceUp]}朝上</strong>
        ・进纸箭头朝
        <strong data-testid="drill-arrow">{COMPASS_LABEL[view.arrow]}</strong>
        ・已走 <strong data-testid="drill-count">{trail.steps.length}</strong> /{' '}
        {MAX_TRAIL_STEPS} 步
      </p>

      <div className="drill__controls" role="group" aria-label="演练动作">
        <button
          type="button"
          data-testid="drill-rotate"
          disabled={full}
          onClick={() => act('rotate')}
        >
          顺时针旋转 90°
        </button>
        <button
          type="button"
          data-testid="drill-flip"
          disabled={full}
          onClick={() => act('flip')}
        >
          沿进纸轴翻纸
        </button>
      </div>

      {invalid && (
        <p className="notice notice-error" data-testid="drill-invalid" role="alert">
          <strong>演练轨迹无效：</strong>本次动作与轨迹重放不一致，已拒绝；
          画面保留在最后可信状态。
        </p>
      )}

      {(full || limitHit) && (
        <p className="notice notice-empty" data-testid="drill-limit-hint" role="status">
          轨迹已达 {MAX_TRAIL_STEPS} 步上限，不再接收动作；刷新页面可重新演练。
        </p>
      )}

      <ol className="drill__steps" data-testid="drill-steps" aria-label="动作轨迹">
        {trail.steps.map((step, i) => {
          const stepView = viewOf(step.pose);
          return (
            <li key={i} data-testid="drill-step">
              {i + 1}. {ACTION_LABEL[step.action]} → {SIDE_LABEL[stepView.faceUp]}
              朝上 · 箭头朝{COMPASS_LABEL[stepView.arrow]}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
