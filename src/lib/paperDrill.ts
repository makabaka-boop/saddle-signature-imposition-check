/**
 * 走纸方向演练的纯空间变换模型。
 *
 * 现场问题：换纸或背印重上机时，“顺时针转台”与“沿机器进纸轴翻纸”的
 * 先后效果不可交换，操作员容易凭直觉把两步当成可交换，从而误判纸张的
 * 空间朝向。本模型把纸张在机器台面上的朝向归一为八种姿态（二面体群
 * D4：4 个旋转量 × 正/背面），两个现场动作对应两个群生成元：
 *
 *   rotate —— 在台面上顺时针旋转 90°（从上方看，绕竖直轴）
 *   flip   —— 沿机器进纸轴（南北轴）把纸翻转，正背面互换
 *
 * 群关系：rotate⁴ = flip² = id，且 flip·rotate = rotate⁻¹·flip，
 * 因此旋转与翻纸不可交换：rotate→flip 与 flip→rotate 落到不同姿态，
 * 角标布局不同。
 *
 * 起点（规范姿态）：正面朝上、进纸箭头朝北（机器进纸方向）、
 * 四色角标 A–D 归位（A 西北、B 东北、C 东南、D 西南）。
 *
 * 本模块不读取也不改写拼版结果（imposition），仅复用其正/背面语义。
 */

import type { Side } from './imposition';

/** 机器坐标方位：北 = 机器进纸方向。 */
export type Compass = 'N' | 'E' | 'S' | 'W';

/** 纸面角标落位的机器方位角。 */
export type CornerPosition = 'NW' | 'NE' | 'SE' | 'SW';

/** 四色角标。 */
export type CornerMark = 'A' | 'B' | 'C' | 'D';

/** 演练允许的两种现场动作。 */
export type DrillAction = 'rotate' | 'flip';

/**
 * 纸张姿态（二面体群 D4，共 8 种）。
 * 规范形式：pose = FLIP^flipped ∘ ROTATE^turns
 * （从起点先顺时针旋转 turns 步，若 flipped 再沿进纸轴翻转一次）。
 */
export interface Pose {
  /** 顺时针旋转步数，0–3。 */
  readonly turns: number;
  /** 是否处于翻面（背面朝上）分量。 */
  readonly flipped: boolean;
}

/** 姿态的可观测表现：朝上面、进纸箭头指向、四角标落位。 */
export interface PoseView {
  readonly faceUp: Side;
  readonly arrow: Compass;
  readonly corners: Readonly<Record<CornerMark, CornerPosition>>;
}

/** 起点姿态：正面朝上、箭头朝北、角标归位。 */
export const START_POSE: Pose = { turns: 0, flipped: false };

/** 轨迹步数上限：达到后不再接收动作。 */
export const MAX_TRAIL_STEPS = 24;

const COMPASS_CW: readonly Compass[] = ['N', 'E', 'S', 'W'];
const CORNERS_CW: readonly CornerPosition[] = ['NW', 'NE', 'SE', 'SW'];

/** 起点角标归位：A 西北、B 东北、C 东南、D 西南（正面看顺时针 A→B→C→D）。 */
const HOME_CORNERS: Readonly<Record<CornerMark, CornerPosition>> = {
  A: 'NW',
  B: 'NE',
  C: 'SE',
  D: 'SW',
};

const CORNER_MARKS: readonly CornerMark[] = ['A', 'B', 'C', 'D'];

function mod4(n: number): number {
  return ((n % 4) + 4) % 4;
}

/** 沿南北轴（进纸轴）翻转时方向的东西互换：N/S 不变，E↔W。 */
function flipCompassEW(c: Compass): Compass {
  switch (c) {
    case 'E':
      return 'W';
    case 'W':
      return 'E';
    default:
      return c;
  }
}

/** 沿南北轴翻转时角位置的东西互换：NW↔NE，SW↔SE。 */
function flipCornerEW(c: CornerPosition): CornerPosition {
  switch (c) {
    case 'NW':
      return 'NE';
    case 'NE':
      return 'NW';
    case 'SW':
      return 'SE';
    case 'SE':
      return 'SW';
  }
}

/** 姿态的稳定键，用于集合去重与相等判断。 */
export function poseKey(pose: Pose): string {
  return `${mod4(pose.turns)}:${pose.flipped ? 1 : 0}`;
}

export function samePose(a: Pose, b: Pose): boolean {
  return poseKey(a) === poseKey(b);
}

/** 全部八种姿态（旋转 0–3 步 × 正/背面），动作群在此集合上封闭。 */
export function allPoses(): readonly Pose[] {
  const poses: Pose[] = [];
  for (const turns of [0, 1, 2, 3]) {
    poses.push({ turns, flipped: false }, { turns, flipped: true });
  }
  return poses;
}

/**
 * 顺时针旋转 90°（从台面上方看）。
 * 背面朝上时，从上方看的顺时针在规范形式中反向合成：
 * R·(F·R^k) = (R·F)·R^k = (F·R⁻¹)·R^k = F·R^(k−1)。
 */
export function rotate(pose: Pose): Pose {
  return {
    turns: mod4(pose.turns + (pose.flipped ? 3 : 1)),
    flipped: pose.flipped,
  };
}

/** 沿机器进纸轴（南北轴）翻纸：正背面互换，旋转分量不变。 */
export function flip(pose: Pose): Pose {
  return { turns: mod4(pose.turns), flipped: !pose.flipped };
}

/** 施加一个现场动作，得到新姿态（纯函数，不改入参）。 */
export function applyAction(pose: Pose, action: DrillAction): Pose {
  return action === 'rotate' ? rotate(pose) : flip(pose);
}

/** 由姿态推导可观测量：朝上面、箭头指向、四角标落位。 */
export function viewOf(pose: Pose): PoseView {
  const turns = mod4(pose.turns);
  const arrowBase = COMPASS_CW[turns];
  const corners = {} as Record<CornerMark, CornerPosition>;
  for (const mark of CORNER_MARKS) {
    const home = CORNERS_CW.indexOf(HOME_CORNERS[mark]);
    const rotated = CORNERS_CW[mod4(home + turns)];
    corners[mark] = pose.flipped ? flipCornerEW(rotated) : rotated;
  }
  return {
    faceUp: pose.flipped ? 'back' : 'front',
    arrow: pose.flipped ? flipCompassEW(arrowBase) : arrowBase,
    corners,
  };
}

/** 轨迹中的一步：现场动作 + 该步之后（增量合成）的姿态记录。 */
export interface DrillStep {
  readonly action: DrillAction;
  readonly pose: Pose;
}

/** 动作轨迹：从起点出发的有序步骤序列。 */
export interface DrillTrail {
  readonly steps: readonly DrillStep[];
}

export const EMPTY_TRAIL: DrillTrail = { steps: [] };

/** 轨迹记录的当前姿态（空轨迹即起点）。 */
export function currentPose(trail: DrillTrail): Pose {
  const last = trail.steps[trail.steps.length - 1];
  return last === undefined ? START_POSE : last.pose;
}

/** 只由动作序列从起点确定性重放，不依赖任何增量记录。 */
export function replayActions(actions: readonly DrillAction[]): Pose {
  let pose = START_POSE;
  for (const action of actions) {
    pose = applyAction(pose, action);
  }
  return pose;
}

/** 从轨迹的动作序列确定性重放（忽略各步记录的姿态）。 */
export function replayTrail(steps: readonly DrillStep[]): Pose {
  return replayActions(steps.map((step) => step.action));
}

/**
 * 箭头的累计显示角度（从北起顺时针度数），供界面连续动画使用：
 * rotate 永远顺时针前进 90°，flip 沿进纸轴镜像（角度取负）。
 * 与 viewOf 的箭头方位在模 360 意义下一致，但不归一到 0–270，
 * 保证连续旋转在视觉上始终沿同一方向转动（不会倒转回 0°）。
 */
export function arrowAngleOf(steps: readonly DrillStep[]): number {
  let angle = 0;
  for (const step of steps) {
    angle = step.action === 'rotate' ? angle + 90 : -angle;
  }
  return angle;
}

/** 追加动作的失败原因：轨迹已满 / 增量与重放不一致（轨迹无效）。 */
export type AppendFailure = 'trail-full' | 'invalid-trail';

export type AppendResult =
  | { readonly ok: true; readonly trail: DrillTrail }
  | { readonly ok: false; readonly reason: AppendFailure; readonly trail: DrillTrail };

/**
 * 向轨迹追加一个现场动作。
 *
 * 每一步都按不可交换的空间变换增量合成；同时把轨迹的动作序列从起点
 * 逐步确定性重放，并核对既有每一步与新步的增量姿态记录。任何一处
 * 不一致（例如轨迹记录被污染）都拒绝本次动作，原轨迹原样保留
 * （最后可信画面）。轨迹达到 24 步后不再接收动作。
 */
export function appendAction(trail: DrillTrail, action: DrillAction): AppendResult {
  if (trail.steps.length >= MAX_TRAIL_STEPS) {
    return { ok: false, reason: 'trail-full', trail };
  }
  // 确定性重放：只由动作序列从起点重算，逐步核对轨迹记录的姿态。
  let replayed = START_POSE;
  for (const step of trail.steps) {
    replayed = applyAction(replayed, step.action);
    if (!samePose(replayed, step.pose)) {
      return { ok: false, reason: 'invalid-trail', trail };
    }
  }
  // 增量合成新步，并与重放结果比对。
  const incremental = applyAction(currentPose(trail), action);
  const replayedNext = applyAction(replayed, action);
  if (!samePose(replayedNext, incremental)) {
    return { ok: false, reason: 'invalid-trail', trail };
  }
  return {
    ok: true,
    trail: { steps: [...trail.steps, { action, pose: incremental }] },
  };
}
