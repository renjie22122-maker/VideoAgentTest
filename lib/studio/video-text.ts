import {assetFallbackDesigns} from './asset-policy.ts';
import type { Project, Shot } from './types.ts';
import { motionGuidance } from './motion.ts';

/** Repair directive from the last QA round: opinions + structured findings. */
export function reflectionDirective(p: Project, shotId: string) {
  const qa = p.production?.qa?.find((q) => q.shotId === shotId);
  if (!qa) return undefined;
  return {
    意见: qa.notes,
    问题: qa.findings?.map((f) => ({
      代码: f.code,
      严重度: f.severity,
      时间点秒: f.timestamp,
      依据: f.evidence,
      修复: f.suggestion,
    })),
  };
}

export function videoText(p: Project, s: Shot): string {
  return JSON.stringify({
    未附图资产的文字设定: assetFallbackDesigns(p,[s.id]),
    画面: s.description,
    镜头目的: s.intent?.purpose,
    视听: s.intent?.visualPlan,
    尺度: s.intent?.scaleAnchors,
    动作节拍: s.intent?.actionTiming,
    运镜: {
      ...s.camera,
      动机: s.intent?.movementReason,
      速度: s.intent?.speedPlan,
      程序: motionGuidance(s),
    },
    开始: s.startState,
    结束: s.endState,
    叙事线: s.narrative,
    对白: s.dialogue,
    表演: s.performance,
    声音: s.sound,
    声音层: s.soundCues,
    物理: s.intent?.physicsChecks ?? [
      '物体与身份保持恒常；接触、持握、受力和运动有因果；遮挡后不换形；比例不因切镜改变。',
    ],
    风格: p.plan?.bible.style,
    色彩: p.plan?.bible.palette,
    世界规则: p.storyContext?.guide.canon,
    // The closed loop: previous QA findings travel into the regeneration prompt.
    返工: reflectionDirective(p, s.id),
    要求: '按动作与声音时间窗执行；不增删对白，画外说话不让画内他人动嘴；只生成单镜画面，不复制设定板。返工字段存在时优先按其中问题与修复逐项修正，其余设计保持不变。',
  });
}
