import { describe, expect, it } from 'vitest';
import {
  EMPTY_TRAIL,
  MAX_TRAIL_STEPS,
  START_POSE,
  allPoses,
  appendAction,
  applyAction,
  arrowAngleOf,
  currentPose,
  flip,
  poseKey,
  replayActions,
  replayTrail,
  rotate,
  samePose,
  viewOf,
  type Compass,
  type DrillAction,
  type DrillStep,
  type DrillTrail,
  type Pose,
} from './paperDrill';

const ACTIONS: readonly DrillAction[] = ['rotate', 'flip'];

function applyAll(pose: Pose, actions: readonly DrillAction[]): Pose {
  return actions.reduce(applyAction, pose);
}

describe('起点姿态与可观测量', () => {
  it('起点：正面朝上、进纸箭头朝北、角标 A–D 归位', () => {
    const view = viewOf(START_POSE);
    expect(view.faceUp).toBe('front');
    expect(view.arrow).toBe('N');
    expect(view.corners).toEqual({ A: 'NW', B: 'NE', C: 'SE', D: 'SW' });
  });

  it('连续旋转时箭头依次朝东、南、西、北', () => {
    let pose = START_POSE;
    const arrows: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      pose = rotate(pose);
      arrows.push(viewOf(pose).arrow);
    }
    expect(arrows).toEqual(['E', 'S', 'W', 'N']);
  });

  it('沿进纸轴翻纸：正背面互换，朝北的箭头仍朝北', () => {
    const view = viewOf(flip(START_POSE));
    expect(view.faceUp).toBe('back');
    expect(view.arrow).toBe('N');
    // 沿南北轴翻转：东西互换，A↔B、D↔C 落位
    expect(view.corners).toEqual({ A: 'NE', B: 'NW', C: 'SW', D: 'SE' });
  });
});

describe('八姿态闭包', () => {
  it('allPoses 恰为八种两两不同的姿态', () => {
    const poses = allPoses();
    expect(poses).toHaveLength(8);
    expect(new Set(poses.map(poseKey)).size).toBe(8);
  });

  it('两个动作在八姿态集合上封闭', () => {
    const keys = new Set(allPoses().map(poseKey));
    for (const pose of allPoses()) {
      for (const action of ACTIONS) {
        expect(keys.has(poseKey(applyAction(pose, action)))).toBe(true);
      }
    }
  });

  it('从起点出发经任意动作序列只能到达八种姿态（BFS 恰好穷尽）', () => {
    const seen = new Map<string, Pose>();
    const queue: Pose[] = [START_POSE];
    seen.set(poseKey(START_POSE), START_POSE);
    while (queue.length > 0) {
      const pose = queue.shift() as Pose;
      for (const action of ACTIONS) {
        const next = applyAction(pose, action);
        if (!seen.has(poseKey(next))) {
          seen.set(poseKey(next), next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(8);
    // 与 allPoses 是同一集合
    for (const pose of allPoses()) {
      expect(seen.has(poseKey(pose))).toBe(true);
    }
  });
});

describe('逆变换', () => {
  it('连续四次旋转回到原姿态（对全部八姿态成立）', () => {
    for (const pose of allPoses()) {
      const back = applyAll(pose, ['rotate', 'rotate', 'rotate', 'rotate']);
      expect(samePose(back, pose)).toBe(true);
    }
  });

  it('连续两次翻纸回到原姿态（对全部八姿态成立）', () => {
    for (const pose of allPoses()) {
      const back = applyAll(pose, ['flip', 'flip']);
      expect(samePose(back, pose)).toBe(true);
    }
  });

  it('每个动作都可逆：rotate 的逆是三次 rotate，flip 自逆', () => {
    for (const pose of allPoses()) {
      const rotated = applyAction(pose, 'rotate');
      expect(samePose(applyAll(rotated, ['rotate', 'rotate', 'rotate']), pose)).toBe(
        true,
      );
      const flipped = applyAction(pose, 'flip');
      expect(samePose(applyAction(flipped, 'flip'), pose)).toBe(true);
    }
  });

  it('从起点出发：四次旋转、两次翻纸分别回到起点的可观测画面', () => {
    expect(viewOf(applyAll(START_POSE, ['rotate', 'rotate', 'rotate', 'rotate']))).toEqual(
      viewOf(START_POSE),
    );
    expect(viewOf(applyAll(START_POSE, ['flip', 'flip']))).toEqual(viewOf(START_POSE));
  });
});

describe('不可交换顺序', () => {
  it('rotate→flip 与 flip→rotate 落到不同姿态', () => {
    const rf = replayActions(['rotate', 'flip']);
    const fr = replayActions(['flip', 'rotate']);
    expect(samePose(rf, fr)).toBe(false);
  });

  it('两种顺序呈现不同的角标布局与箭头指向', () => {
    const rf = viewOf(replayActions(['rotate', 'flip']));
    const fr = viewOf(replayActions(['flip', 'rotate']));

    // 先转后翻：箭头朝西，角标 A 回西北、B 落西南
    expect(rf.faceUp).toBe('back');
    expect(rf.arrow).toBe('W');
    expect(rf.corners).toEqual({ A: 'NW', B: 'SW', C: 'SE', D: 'NE' });

    // 先翻后转：箭头朝东，角标 A 落东南、B 落东北
    expect(fr.faceUp).toBe('back');
    expect(fr.arrow).toBe('E');
    expect(fr.corners).toEqual({ A: 'SE', B: 'NE', C: 'NW', D: 'SW' });

    expect(rf.corners).not.toEqual(fr.corners);
  });

  it('群关系 flip·rotate = rotate⁻¹·flip 在全部姿态上成立', () => {
    for (const pose of allPoses()) {
      const lhs = applyAll(pose, ['rotate', 'flip']);
      const rhs = applyAll(pose, ['flip', 'rotate', 'rotate', 'rotate']);
      expect(samePose(lhs, rhs)).toBe(true);
    }
  });
});

describe('箭头累计显示角度', () => {
  const ARROW_DEG: Record<Compass, number> = { N: 0, E: 90, S: 180, W: 270 };

  function trailOf(actions: readonly DrillAction[]): DrillStep[] {
    let pose = START_POSE;
    return actions.map((action) => {
      pose = applyAction(pose, action);
      return { action, pose };
    });
  }

  it('连续旋转时角度单调前进（不倒转回 0°）', () => {
    const steps = trailOf(['rotate', 'rotate', 'rotate', 'rotate']);
    expect(arrowAngleOf(steps.slice(0, 1))).toBe(90);
    expect(arrowAngleOf(steps.slice(0, 2))).toBe(180);
    expect(arrowAngleOf(steps.slice(0, 3))).toBe(270);
    // 第四次旋转继续顺时针前进到 360°，而非跳回 0°
    expect(arrowAngleOf(steps)).toBe(360);
  });

  it('翻纸沿进纸轴镜像角度，且与姿态箭头方位模 360 一致', () => {
    const sequences: DrillAction[][] = [
      ['rotate', 'flip'],
      ['flip', 'rotate'],
      ['rotate', 'rotate', 'flip', 'rotate'],
      ['flip', 'flip', 'rotate'],
    ];
    for (const seq of sequences) {
      const steps = trailOf(seq);
      const angle = ((arrowAngleOf(steps) % 360) + 360) % 360;
      expect(angle).toBe(ARROW_DEG[viewOf(replayActions(seq)).arrow]);
    }
  });
});

describe('轨迹与确定性重放', () => {  it('正常追加：增量姿态与重放一致，轨迹逐步增长', () => {
    let trail = EMPTY_TRAIL;
    const sequence: DrillAction[] = ['rotate', 'flip', 'rotate', 'rotate', 'flip'];
    for (const action of sequence) {
      const result = appendAction(trail, action);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('应当追加成功');
      trail = result.trail;
    }
    expect(trail.steps).toHaveLength(sequence.length);
    expect(samePose(currentPose(trail), replayActions(sequence))).toBe(true);
    expect(samePose(replayTrail(trail.steps), currentPose(trail))).toBe(true);
  });

  it('重放是确定性的：同一动作序列重放结果相同', () => {
    const sequence: DrillAction[] = ['flip', 'rotate', 'rotate', 'flip', 'rotate'];
    expect(samePose(replayActions(sequence), replayActions(sequence))).toBe(true);
    expect(samePose(replayActions(sequence), replayActions([...sequence]))).toBe(true);
  });

  it('轨迹记录被污染时拒绝本次动作，保留最后可信轨迹', () => {
    const first = appendAction(EMPTY_TRAIL, 'rotate');
    if (!first.ok) throw new Error('应当追加成功');

    // 污染：动作是 rotate，姿态记录却被改回起点
    const tampered: DrillTrail = {
      steps: [{ action: 'rotate', pose: START_POSE }],
    };
    const result = appendAction(tampered, 'flip');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('应当被拒绝');
    expect(result.reason).toBe('invalid-trail');
    // 原轨迹原样保留（最后可信画面），不接收新动作
    expect(result.trail).toBe(tampered);
    expect(result.trail.steps).toHaveLength(1);
  });

  it('多步轨迹中任意一步被污染都会被重放检出', () => {
    let trail = EMPTY_TRAIL;
    for (const action of ['rotate', 'flip', 'rotate'] as const) {
      const result = appendAction(trail, action);
      if (!result.ok) throw new Error('应当追加成功');
      trail = result.trail;
    }
    // 把第 2 步的记录姿态换成别的合法姿态（动作序列不变）
    const polluted: DrillTrail = {
      steps: trail.steps.map((step, i) =>
        i === 1 ? { ...step, pose: { turns: 2, flipped: true } } : step,
      ),
    };
    const result = appendAction(polluted, 'flip');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('应当被拒绝');
    expect(result.reason).toBe('invalid-trail');
    expect(result.trail).toBe(polluted);
  });

  it('轨迹达到 24 步后不再接收动作', () => {
    let trail = EMPTY_TRAIL;
    for (let i = 0; i < MAX_TRAIL_STEPS; i += 1) {
      const result = appendAction(trail, 'rotate');
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('应当追加成功');
      trail = result.trail;
    }
    expect(trail.steps).toHaveLength(MAX_TRAIL_STEPS);
    // 24 = 6 × 4 次旋转，恰好回到起点
    expect(samePose(currentPose(trail), START_POSE)).toBe(true);

    const rejected = appendAction(trail, 'flip');
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error('应当被拒绝');
    expect(rejected.reason).toBe('trail-full');
    expect(rejected.trail).toBe(trail);
    expect(rejected.trail.steps).toHaveLength(MAX_TRAIL_STEPS);
  });
});
