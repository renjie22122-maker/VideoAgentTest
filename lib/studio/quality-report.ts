import { cameraPosition } from './animatic.ts';
import { motionAt } from './motion.ts';
import type { LinePerformance } from './performance.ts';
import type { ScriptScene } from './screenplay.ts';
import type { Project, Shot } from './types.ts';

export type QualityStrictness = 'compatible' | 'standard' | 'strict';
export type QualityCategory = 'coverage' | 'narrative' | 'camera' | 'space' | 'physics' | 'dialogue' | 'sound';
export type QualityOwner = 'writer' | 'storyboard' | 'camera' | 'continuity' | 'action' | 'art' | 'sound' | 'editor';
export type QualityFinding = {
  /** Stable across runs and revisions; suitable for linking a repair to its originating finding. */
  id: string;
  code: string;
  category: QualityCategory;
  severity: 'error' | 'warning' | 'info';
  kind: 'contradiction' | 'risk' | 'missing_data';
  owner: QualityOwner;
  shotIds: string[];
  sceneId?: string;
  message: string;
  evidence: string;
  suggestion: string;
};
export type ProfessionalQualityReport = {
  version: 1;
  projectId: string;
  revision: number;
  strictness: QualityStrictness;
  scope: 'text_preflight';
  status: 'needs_revision' | 'needs_review' | 'incomplete' | 'ready_for_review';
  blockingCount: number;
  warningCount: number;
  infoCount: number;
  findings: QualityFinding[];
  coverage: { shots: number; plannedShots: number; performanceShots: number; soundPlannedShots: number; narrativeShots: number };
  limitations: string[];
};

type FindingInput = Omit<QualityFinding, 'id'> & { key?: string };
type Context = {
  project: Project;
  shots: Shot[];
  scenes: ScriptScene[];
  strictness: QualityStrictness;
  add: (finding: FindingInput) => void;
};
type SpokenPart = { shot: Shot; shotIndex: number; line: LinePerformance };
const normalized = (value: string) => value.replace(/[\s\p{P}]/gu, '');
const nonempty = (value: string | undefined) => Boolean(value?.trim());
const tolerance = 0.001;
const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const absentLevel = (ctx: Context): QualityFinding['severity'] => ctx.strictness === 'strict' ? 'warning' : 'info';

function checkPlanningData(ctx: Context) {
  const { shots, scenes, add } = ctx;
  if (!shots.length) add({ code: 'storyboard-missing', category: 'coverage', severity: 'info', kind: 'missing_data', owner: 'storyboard', shotIds: [], message: '尚无分镜，暂不能进行镜头预检。', evidence: '分镜数量为 0。', suggestion: '先确认剧本，再生成分镜设计。' });
  if (!scenes.length) add({ code: 'structured-script-missing', category: 'coverage', severity: 'info', kind: 'missing_data', owner: 'writer', shotIds: [], message: '缺少结构化剧本，无法核对动作和对白来源。', evidence: '剧本中没有结构化 scenes。', suggestion: '补充场次、动作和逐字对白；旧版文字仍可继续查看。' });
  const requirements = [
    { code: 'intent-missing', category: 'coverage', owner: 'storyboard', label: '叙事依据与调度', missing: shots.filter(s => !s.intent), suggestion: '修订这些镜头，补充动作引用、视听目的、动作分拍与运镜动机；不要改写已确认剧情。' },
    { code: 'scale-plan-missing', category: 'space', owner: 'art', label: '尺度参照', missing: shots.filter(s => !s.intent?.scaleAnchors?.some(nonempty)), suggestion: '注明主体与手掌、门框、人物等参照物的相对比例、空间关系与依据；没有实测尺寸时保留不确定性。' },
    { code: 'physics-plan-missing', category: 'physics', owner: 'action', label: '物理风险预防', missing: shots.filter(s => !s.intent?.physicsChecks?.some(nonempty)), suggestion: '按本镜动作补充接触、持握、支撑、惯性、遮挡后恒常性等具体约束；有剧情依据的超常能力可明确为例外。' },
    { code: 'performance-missing', category: 'dialogue', owner: 'sound', label: '对白表演与时间窗', missing: shots.filter(s => nonempty(s.dialogue) && s.performance === undefined), suggestion: '保留原文和说话人，补充语气、语速、停顿、呼吸及镜内时间窗；跨镜台词保持同一来源编号。' },
    { code: 'sound-plan-missing', category: 'sound', owner: 'sound', label: '分层声音设计', missing: shots.filter(s => s.soundCues === undefined), suggestion: '分别登记有源环境声、拟音、效果与配乐的来源、时间窗、声桥和混音；设计为静默时显式保留空数组。' },
  ] as const;
  for (const rule of requirements) if (rule.missing.length) add({ code: rule.code, category: rule.category, severity: absentLevel(ctx), kind: 'missing_data', owner: rule.owner, shotIds: rule.missing.map(s => s.id), message: `${rule.missing.length} 镜缺少${rule.label}。`, evidence: `缺少相应结构化字段：${rule.missing.map(s => s.id).join('、')}。缺失资料不等于实际画面错误。`, suggestion: rule.suggestion });
  for (const shot of shots) if (shot.intent) {
    const absent = (['purpose', 'visualPlan', 'cutReason', 'movementReason', 'speedPlan', 'actionTiming'] as const).filter(key => !nonempty(shot.intent![key]));
    if (absent.length) add({ code: 'intent-detail-missing', category: 'camera', severity: absentLevel(ctx), kind: 'missing_data', owner: 'storyboard', shotIds: [shot.id], message: '镜头设计尚未说明完整的表达和执行方式。', evidence: `空字段：${absent.join('、')}。`, suggestion: '补充镜头目的、切点依据、运镜动机以及动作和摄影机各自的时间安排；固定机位可以有明确的观察或等待目的。' });
  }
}

function checkCoverage(ctx: Context) {
  const { shots, scenes, project, add } = ctx;
  const knownScenes = new Set(scenes.map(s => s.id));
  const seenShots = new Set<string>();
  for (const shot of shots) {
    if (seenShots.has(shot.id)) add({ code: 'shot-id-duplicate', category: 'coverage', severity: 'error', kind: 'contradiction', owner: 'storyboard', shotIds: [shot.id], message: '镜头编号重复，会使引用和修订指向不明。', evidence: `${shot.id} 在播放顺序中出现多次。`, suggestion: '为各镜分配唯一编号，并同步更新叙事线接续引用。' });
    seenShots.add(shot.id);
    if (scenes.length && !knownScenes.has(shot.scene)) add({ code: 'scene-reference-invalid', category: 'coverage', severity: 'error', kind: 'contradiction', owner: 'storyboard', shotIds: [shot.id], sceneId: shot.scene, message: '镜头引用了剧本中不存在的场次。', evidence: `镜头 scene=${shot.scene}；剧本场次：${[...knownScenes].join('、')}。`, suggestion: '改为正确的已确认场次 ID，不以新建场次掩盖引用错误。' });
  }
  if (!shots.length) return;
  const total = shots.reduce((sum, shot) => sum + shot.duration, 0);
  if (Number.isFinite(total) && Math.abs(total - project.duration) > 0.5) add({ code: 'total-duration', category: 'coverage', severity: 'warning', kind: 'risk', owner: 'editor', shotIds: [], message: '分镜播放总长与项目预期时长不同。', evidence: `分镜 ${total} 秒；项目 ${project.duration} 秒。`, suggestion: '核对预期时长与剪辑节奏；保留必要对白、动作和留白后重新分配，不直接删减原文。' });
  for (const scene of scenes) {
    const group = shots.filter(shot => shot.scene === scene.id);
    if (!group.length) {
      add({ code: 'scene-uncovered', category: 'coverage', severity: 'error', kind: 'contradiction', owner: 'storyboard', shotIds: [], sceneId: scene.id, message: '已确认场次尚未安排画面。', evidence: `${scene.id}「${scene.location}」有 ${scene.action.length} 个动作，分镜引用数为 0。`, suggestion: '为该场次安排必要画面；若希望完全以画外事件表达，先交由导演和编剧确认叙事改编。' });
      continue;
    }
    const covered = new Set<number>();
    for (const shot of group) for (const index of shot.intent?.actionIndices ?? []) {
      if (!Number.isInteger(index) || index < 1 || index > scene.action.length) add({ code: 'action-reference-invalid', category: 'coverage', severity: 'error', kind: 'contradiction', owner: 'storyboard', shotIds: [shot.id], sceneId: scene.id, key: String(index), message: '动作引用超出该场次的范围。', evidence: `${shot.id} 引用动作 ${index}；${scene.id} 共有 ${scene.action.length} 个动作，编号从 1 开始。`, suggestion: '按已确认剧本重新关联动作编号，不增造动作来满足格式。' });
      else covered.add(index);
    }
    if (group.every(shot => shot.intent)) {
      const missing = scene.action.map((value, index) => ({ value, index: index + 1 })).filter(item => !covered.has(item.index));
      if (missing.length) add({ code: 'actions-uncovered', category: 'coverage', severity: ctx.strictness === 'compatible' ? 'warning' : 'error', kind: 'contradiction', owner: 'storyboard', shotIds: group.map(s => s.id), sceneId: scene.id, message: '分镜动作覆盖表遗漏了已确认动作。', evidence: missing.map(item => `动作 ${item.index}：${item.value}`).join('\n'), suggestion: '将遗漏的动作安排到合适镜头或分拍中；可通过视听设计表达，但须保留动作的叙事事实和因果。' });
    }
  }
}

function checkNarrative(ctx: Context) {
  const { shots, project, add } = ctx;
  const parallel = project.storyContext?.guide.editingMode === 'parallel';
  const anyLinks = shots.some(shot => shot.narrative);
  const lastByThread = new Map<string, Shot>();
  const actionsByThread = new Map<string, Set<number>>();
  const missingLinks = shots.filter(shot => !shot.narrative);
  if ((parallel || anyLinks) && missingLinks.length) add({ code: 'narrative-link-missing', category: 'narrative', severity: parallel || ctx.strictness === 'strict' ? 'warning' : 'info', kind: 'missing_data', owner: 'continuity', shotIds: missingLinks.map(s => s.id), message: '交叉剪辑的叙事线与时间关系尚未记录完整。', evidence: `未声明叙事线的镜头：${missingLinks.map(s => s.id).join('、')}。`, suggestion: '逐镜登记稳定 threadId、该线最近前镜、时间关系与声音归属；切回来应恢复本线状态。' });
  shots.forEach((shot, index) => {
    const link = shot.narrative;
    const thread = link?.threadId ?? `scene:${shot.scene}`;
    const previous = lastByThread.get(thread);
    if (link && link.resumeFromShotId !== (previous?.id ?? null)) add({ code: 'narrative-predecessor', category: 'narrative', severity: 'error', kind: 'contradiction', owner: 'continuity', shotIds: [shot.id], sceneId: shot.scene, message: '镜头没有接回本叙事线的最近前镜。', evidence: `${thread} 的最近前镜为 ${previous?.id ?? '首次出现，无前镜'}；当前引用 ${link.resumeFromShotId ?? 'null'}。`, suggestion: `将接续引用改为 ${previous?.id ?? 'null'}，并核对该线人物、道具、动作进度和时间；不要继承另一条线。` });
    if (previous && previous.scene === shot.scene && (!link || link.timeRelation === 'continuous')) {
      if (previous.endState.axis !== shot.startState.axis) add({ code: 'declared-axis-change', category: 'space', severity: 'warning', kind: 'risk', owner: 'camera', shotIds: [previous.id, shot.id], sceneId: shot.scene, message: '同线连续镜头声明了轴线换侧，需要复核空间表达。', evidence: `${previous.id} endState.axis=${previous.endState.axis}；${shot.id} startState.axis=${shot.startState.axis}。`, suggestion: '核对视线和出入画关系。若有意越轴，在动作、运动或重新建立空间的画面中说明动机；相机 x 坐标过零本身不构成越轴。' });
      const intercut = shots[index - 1];
      if (link && intercut && intercut !== previous && intercut.narrative?.threadId !== thread) {
        const copied = (['wardrobe', 'props'] as const).filter(key => {
          const value = shot.startState[key].trim();
          return value.length > 4 && value === intercut.endState[key].trim() && value !== previous.endState[key].trim();
        });
        if (copied.length) add({ code: 'intercut-state-source', category: 'narrative', severity: 'warning', kind: 'risk', owner: 'continuity', shotIds: [previous.id, intercut.id, shot.id], sceneId: shot.scene, message: '切回镜头的状态文字与另一叙事线完全相同，需要核对是否误继承。', evidence: copied.map(key => `${key}：本线前镜「${previous.endState[key]}」；另一线「${intercut.endState[key]}」；切回「${shot.startState[key]}」`).join('\n'), suggestion: '以本线前镜和经过时间为依据核对持有人、服装与道具状态。相同文字可能合理，此提示不能直接认定穿帮。' });
      }
    }
    const actionKey = `${thread}:${shot.scene}`;
    const already = actionsByThread.get(actionKey) ?? new Set<number>();
    const newActions = (shot.intent?.actionIndices ?? []).filter(n => !already.has(n));
    const highest = Math.max(0, ...already);
    if (newActions.some(n => n < highest) && link?.timeRelation !== 'earlier') add({ code: 'action-order-review', category: 'narrative', severity: 'warning', kind: 'risk', owner: 'storyboard', shotIds: [...(previous ? [previous.id] : []), shot.id], sceneId: shot.scene, message: '本线新出现的动作编号回到了已展示动作之前。', evidence: `${thread} 已展示至动作 ${highest}；${shot.id} 首次展示动作 ${newActions.join('、')}。`, suggestion: '按该线因果顺序检查动作。若为回忆、延迟揭示或重叠动作，明确时间关系和切点；不要把另一线的顺序套到本线。' });
    (shot.intent?.actionIndices ?? []).forEach(n => already.add(n));
    actionsByThread.set(actionKey, already);
    lastByThread.set(thread, shot);
  });
}

function checkCamera(ctx: Context) {
  const { shots, add } = ctx;
  for (const shot of shots) {
    if (!Number.isFinite(shot.duration) || shot.duration <= 0) {
      add({ code: 'shot-duration-invalid', category: 'camera', severity: 'error', kind: 'contradiction', owner: 'editor', shotIds: [shot.id], message: '镜头时长无效，无法安排动作和运镜。', evidence: `duration=${shot.duration}。`, suggestion: '设置有限的正数秒数，再核对对白和动作时间。' });
      continue;
    }
    try {
      const frames = Array.from({ length: 61 }, (_, i) => {
        if (shot.motion) return motionAt(shot, i / 60);
        return { camera: cameraPosition(shot, i / 60), subject: { x: 0, y: 0, z: 0 } };
      });
      if (frames.some(f => [...Object.values(f.camera), ...Object.values(f.subject)].some(v => !Number.isFinite(v)))) throw new Error('坐标不是有限数字');
      const steps = frames.slice(1).map((frame, i) => distance(frame.camera, frames[i].camera));
      const travel = steps.reduce((sum, value) => sum + value, 0);
      const peak = Math.max(...steps) * 60 / shot.duration;
      if (shot.camera.movement === 'fixed' && travel > 0.01) add({ code: 'fixed-camera-motion', category: 'camera', severity: shot.motion ? 'warning' : 'error', kind: shot.motion ? 'risk' : 'contradiction', owner: 'camera', shotIds: [shot.id], message: '固定机位标签与实际设计路径不一致。', evidence: `采样路径长约 ${travel.toFixed(2)} 米；movement=fixed${shot.motion ? `，运动程序 mode=${shot.motion.camera.mode}` : ''}。`, suggestion: '若相机随主体移动，改成相应跟拍表达；若确为固定机位，使世界坐标路径静止。固定镜头有叙事动机时无需改为运动。' });
      if (shot.camera.movement !== 'fixed' && travel <= 0.01) add({ code: 'stationary-motion-path', category: 'camera', severity: 'warning', kind: 'risk', owner: 'camera', shotIds: [shot.id], message: '运动镜头的设计路径没有产生可见位移。', evidence: `movement=${shot.camera.movement}，路径长约 ${travel.toFixed(3)} 米。`, suggestion: '核对是否希望固定观察，或补充与表达动机一致的起终点、环绕角度和启动时间。' });
      const first = frames[0], last = frames.at(-1)!;
      const startDistance = distance(first.camera, first.subject), endDistance = distance(last.camera, last.subject);
      if ((shot.camera.movement === 'push' && endDistance >= startDistance - 0.01) || (shot.camera.movement === 'pull' && endDistance <= startDistance + 0.01)) add({ code: 'movement-distance-intent', category: 'camera', severity: 'warning', kind: 'risk', owner: 'camera', shotIds: [shot.id], message: '推拉名称与相机到主体的距离变化可能不符。', evidence: `movement=${shot.camera.movement}；相机到主体点距离 ${startDistance.toFixed(2)} → ${endDistance.toFixed(2)} 米。`, suggestion: '区分摄影机位移、主体运动与焦距变化，再核对推拉意图；跟随主体保持恒定距离可改为跟拍。' });
      if (peak > 8) add({ code: 'camera-speed-review', category: 'camera', severity: 'warning', kind: 'risk', owner: 'camera', shotIds: [shot.id], message: '设计路径具有较高的相机速度，需要结合拍摄方式复核。', evidence: `采样峰值约 ${peak.toFixed(1)} 米/秒；镜长 ${shot.duration} 秒。这是路径估算，不是生成视频测速。`, suggestion: '核对是否为载具、航拍或快速运动，并明确启动、停止、遮挡与运动模糊。高速本身不是错误，不应一律改为缓慢或固定。' });
      const nearest = Math.min(...frames.map(frame => distance(frame.camera, frame.subject)));
      if (shot.motion && nearest < 0.25) add({ code: 'camera-subject-proximity', category: 'physics', severity: 'warning', kind: 'risk', owner: 'camera', shotIds: [shot.id], message: '相机路径接近主体参考点，需要检查碰撞与构图。', evidence: `采样最小距离约 ${nearest.toFixed(3)} 米；主体坐标仅为参考点，没有身体或场景碰撞体。`, suggestion: '核对主体体积、镜头最近对焦距离和遮挡；微距有意设计可保留并注明，不把点距离当作已确认穿模。' });
    } catch {
      add({ code: 'camera-geometry-invalid', category: 'camera', severity: 'error', kind: 'contradiction', owner: 'camera', shotIds: [shot.id], message: '运镜几何数据无法解析。', evidence: '相机或主体路径包含无效坐标或不支持的运动程序。', suggestion: '重新保存有效坐标和运动程序；不得以文字速度掩盖无效路径。' });
    }
  }
}

/** Readability estimate only. Latin words are counted as words, not as Chinese characters. */
export function dialogueLoad(text: string, seconds: number) {
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const words = (text.replace(/\p{Script=Han}/gu, ' ').match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) ?? []).length;
  return { han, words, overloaded: seconds > 0 && han / 4.5 + words / 3.5 > seconds };
}

function checkDialogue(ctx: Context) {
  const { shots, scenes, add } = ctx;
  const utterances = new Map<string, SpokenPart[]>();
  const haveAllPerformance = shots.every(shot => shot.performance !== undefined || !nonempty(shot.dialogue));
  shots.forEach((shot, shotIndex) => {
    // Array order is not playback order when time windows arrive unsorted.
    // Copy before sorting: a read-only diagnostic must not rewrite the design.
    const lines = [...(shot.performance ?? [])].sort((a, b) => a.start - b.start || a.end - b.end);
    if (shot.performance !== undefined && normalized(lines.map(l => l.text).join('')) !== normalized(shot.dialogue)) add({ code: 'shot-performance-text', category: 'dialogue', severity: 'error', kind: 'contradiction', owner: 'sound', shotIds: [shot.id], message: '本镜对白与表演分段文字不一致。', evidence: `镜头对白：「${shot.dialogue}」；表演分段：「${lines.map(l => l.text).join('')}」。`, suggestion: '保留已确认原文，将本镜实际说出的片段完整登记，避免画面描述与配音使用不同台词。' });
    if (shot.performance === undefined && nonempty(shot.dialogue)) {
      const load = dialogueLoad(shot.dialogue, shot.duration);
      if (load.overloaded) add({ code: 'dialogue-density', category: 'dialogue', severity: 'warning', kind: 'risk', owner: 'sound', shotIds: [shot.id], message: '对白可能超过本镜可自然表达的时间。', evidence: `${load.han} 个汉字、${load.words} 个其他词；镜长 ${shot.duration} 秒。仅粗估，未计停顿与表演。`, suggestion: '朗读计时，保留呼吸与动作留白；必要时跨镜延续原句，不删除关键台词或强制加速。' });
    }
    for (const [lineIndex, line] of lines.entries()) {
      const sceneId = line.sourceSceneId ?? shot.scene;
      const key = `${sceneId}:${line.dialogueIndex}`;
      const source = scenes.find(scene => scene.id === sceneId)?.dialogue[line.dialogueIndex - 1];
      const list = utterances.get(key) ?? [];
      list.push({ shot, shotIndex, line });
      utterances.set(key, list);
      if (scenes.length && (!source || source.characterId !== line.characterId || !normalized(line.text) || !normalized(source.line).includes(normalized(line.text)))) add({ code: 'dialogue-source-invalid', category: 'dialogue', severity: 'error', kind: 'contradiction', owner: 'sound', shotIds: [shot.id], sceneId, key: `${line.dialogueIndex}:${lineIndex}`, message: '台词片段或说话人不能对应已确认剧本。', evidence: `来源 ${key}；人物 ${line.characterId}；片段「${line.text}」；原文${source ? `为 ${source.characterId}：「${source.line}」` : '不存在'}。`, suggestion: '恢复准确的场次、对白编号、说话人和原文片段；语气设计可以细化，原文不可擅改。' });
      if (!Number.isFinite(line.start) || !Number.isFinite(line.end) || line.start < 0 || line.end <= line.start || line.end > shot.duration + tolerance) add({ code: 'dialogue-window-invalid', category: 'dialogue', severity: 'error', kind: 'contradiction', owner: 'sound', shotIds: [shot.id], sceneId, key: `${line.dialogueIndex}:${lineIndex}`, message: '对白时间窗无效或超出镜长。', evidence: `台词 ${key}：${line.start}–${line.end} 秒；镜长 ${shot.duration} 秒。`, suggestion: '在镜内分配可执行的时间窗，或将原句按原文顺序延续到相邻镜头。' });
      else {
        const load = dialogueLoad(line.text, line.end - line.start);
        if (load.overloaded) add({ code: 'performance-density', category: 'dialogue', severity: 'warning', kind: 'risk', owner: 'sound', shotIds: [shot.id], sceneId, key: `${line.dialogueIndex}:${lineIndex}`, message: '台词分段的表演时间可能不足。', evidence: `「${line.text}」含 ${load.han} 个汉字、${load.words} 个其他词；时间窗 ${(line.end - line.start).toFixed(2)} 秒。粗估未计停顿、呼吸和情绪变化。`, suggestion: '结合 delivery、pace、pauses 朗读计时，再调整窗口或跨镜分配，保持台词原意和清晰度。' });
      }
      if (sceneId !== shot.scene && line.mode === 'on_screen' && !scenes.find(scene => scene.id === shot.scene)?.characters.includes(line.characterId)) add({ code: 'cross-scene-lipsync', category: 'dialogue', severity: 'error', kind: 'contradiction', owner: 'sound', shotIds: [shot.id], sceneId, key: `${line.dialogueIndex}:${lineIndex}`, message: '跨场台词的说话人未登记在当前场次，却被标成画内表演。', evidence: `画面场次 ${shot.scene}；台词来源 ${sceneId}；mode=on_screen。`, suggestion: '若为 J/L-cut 或跨线声桥，标明画外声与原说话人，禁止其他人物代说；若同一人物边说话边进入新空间，应先在当前剧本场次登记该人物，并交代进入动作。' });
      const overlaps = lines.slice(0, lineIndex).filter(other => other.characterId === line.characterId && other.mode === line.mode && other.end > line.start + tolerance && line.end > other.start + tolerance);
      if (overlaps.length) add({ code: 'speaker-window-overlap', category: 'dialogue', severity: 'warning', kind: 'risk', owner: 'sound', shotIds: [shot.id], sceneId, key: `${line.dialogueIndex}:${lineIndex}`, message: '同一说话人的两个表演时间窗重叠。', evidence: `${line.characterId} ${line.start}–${line.end} 秒，与 ${overlaps.map(l => `${l.start}–${l.end} 秒`).join('、')} 重叠，声源方式均为 ${line.mode}。`, suggestion: '检查是否为重复分配。若有意叠加内心声或录音，使用明确的声音层与声源，避免同一嘴型同时说两句。' });
    }
  });
  for (const scene of scenes) for (const [index, source] of scene.dialogue.entries()) {
    const key = `${scene.id}:${index + 1}`;
    const parts = utterances.get(key) ?? [];
    if (haveAllPerformance && shots.length && normalized(parts.map(p => p.line.text).join('')) !== normalized(source.line)) add({ code: 'utterance-coverage', category: 'dialogue', severity: 'error', kind: 'contradiction', owner: 'sound', shotIds: [...new Set(parts.map(p => p.shot.id))], sceneId: scene.id, key: String(index + 1), message: '跨镜台词没有按原文完整且唯一地分配。', evidence: `台词 ${key} 原文：「${source.line}」；按播放顺序合并：「${parts.map(p => p.line.text).join('')}」。`, suggestion: '逐句保留稳定来源编号，并按原文连续片段拆分；消除漏字、重说和片段顺序错误，不在切镜处从头配音。' });
    const first = parts[0];
    if (!first || first.line.mode !== 'on_screen' || first.shot.narrative?.timeRelation === 'earlier') continue;
    const action = source.afterAction + 1;
    const candidates = shots.map((shot, shotIndex) => ({ shot, shotIndex })).filter(item => item.shot.scene === scene.id && item.shot.intent?.actionIndices.includes(action));
    if (candidates.length && candidates.every(item => item.shotIndex > first.shotIndex)) add({ code: 'dialogue-action-order', category: 'narrative', severity: 'warning', kind: 'risk', owner: 'storyboard', shotIds: [first.shot.id, candidates[0].shot.id], sceneId: scene.id, key: String(index + 1), message: '画内台词早于剧本规定的前置动作画面。', evidence: `${key} afterAction=${source.afterAction}，应接动作 ${action}「${scene.action[source.afterAction]}」；台词在 ${first.shot.id}，动作首次在 ${candidates[0].shot.id}。`, suggestion: '检查说话动机与动作时序；有意先声后画应明确声桥或时间关系，不应悄悄改动已确认因果。' });
  }
}

function checkSound(ctx: Context) {
  const { shots, scenes, add } = ctx;
  const firstById = new Map<string, { shot: Shot; cue: NonNullable<Shot['soundCues']>[number] }>();
  for (const shot of shots) for (const [index, cue] of (shot.soundCues ?? []).entries()) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || cue.end > shot.duration + tolerance) add({ code: 'sound-window-invalid', category: 'sound', severity: 'error', kind: 'contradiction', owner: 'sound', shotIds: [shot.id], key: `${cue.id}:${index}`, message: '声音层时间窗无效或超出镜长。', evidence: `${cue.id}：${cue.start}–${cue.end} 秒；镜长 ${shot.duration} 秒。`, suggestion: '为声音分配镜内时间；需延续时在后镜使用同一声音 ID 和明确的声桥。' });
    if (cue.world === 'diegetic' && scenes.length && !scenes.some(s => s.id === cue.sourceSceneId)) add({ code: 'sound-source-scene', category: 'sound', severity: 'error', kind: 'contradiction', owner: 'sound', shotIds: [shot.id], key: cue.id, message: '故事内有源声音没有有效的来源场次。', evidence: `${cue.id} world=diegetic，sourceSceneId=${cue.sourceSceneId}；剧本没有此场次。`, suggestion: '登记声音实际属于的故事空间；画外声仍可以是有源声，配乐等非故事内声音另行标注。' });
    if (cue.world === 'diegetic' && cue.sourceSceneId !== shot.scene && cue.bridge === 'none') add({ code: 'cross-scene-sound-bridge', category: 'sound', severity: 'warning', kind: 'risk', owner: 'sound', shotIds: [shot.id], key: cue.id, message: '跨场声音未声明先入、延续或连续声桥。', evidence: `画面 ${shot.scene}；声音 ${cue.id} 来自 ${cue.sourceSceneId}，bridge=none。`, suggestion: '说明这是来自另一空间的声音与具体衔接方式，保留声源方向、距离及混响，避免误听成当前场景声。' });
    const first = firstById.get(cue.id);
    if (first && (first.cue.layer !== cue.layer || first.cue.world !== cue.world || first.cue.sourceSceneId !== cue.sourceSceneId)) add({ code: 'sound-identity-conflict', category: 'sound', severity: 'error', kind: 'contradiction', owner: 'sound', shotIds: [first.shot.id, shot.id], key: cue.id, message: '同一个持续声音 ID 被用于不同声源身份。', evidence: `${cue.id} 原为 ${first.cue.layer}/${first.cue.world}/${first.cue.sourceSceneId}，现为 ${cue.layer}/${cue.world}/${cue.sourceSceneId}。`, suggestion: '同一声音跨镜保留身份，不同空间或类型的声源使用不同 ID；距离和混音变化可以沿用原 ID。' });
    if (!first) firstById.set(cue.id, { shot, cue });
  }
}

/** Pure, deterministic preflight. It never mutates a project or invokes a model/provider. */
export function buildQualityReport(project: Project, options: { strictness?: QualityStrictness } = {}): ProfessionalQualityReport {
  const strictness = options.strictness ?? 'standard';
  const shots = project.plan?.shots ?? [];
  const findings: QualityFinding[] = [];
  const findingIds = new Set<string>();
  const add = ({ key = '', ...finding }: FindingInput) => {
    const id = [finding.code, finding.sceneId ?? project.id, ...finding.shotIds, key].map(encodeURIComponent).join(':');
    if (!findingIds.has(id)) { findingIds.add(id); findings.push({ id, ...finding }); }
  };
  const ctx: Context = { project, shots, scenes: project.production?.script?.scenes ?? [], strictness, add };
  checkPlanningData(ctx);
  checkCoverage(ctx);
  checkNarrative(ctx);
  checkCamera(ctx);
  checkDialogue(ctx);
  checkSound(ctx);
  const rank = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
  const blockingCount = findings.filter(f => f.severity === 'error').length;
  const warningCount = findings.filter(f => f.severity === 'warning').length;
  const infoCount = findings.filter(f => f.severity === 'info').length;
  return { version: 1, projectId: project.id, revision: project.revision, strictness, scope: 'text_preflight', status: blockingCount ? 'needs_revision' : warningCount ? 'needs_review' : findings.some(f => f.kind === 'missing_data') ? 'incomplete' : 'ready_for_review', blockingCount, warningCount, infoCount, findings, coverage: { shots: shots.length, plannedShots: shots.filter(s => s.intent).length, performanceShots: shots.filter(s => s.performance !== undefined).length, soundPlannedShots: shots.filter(s => s.soundCues !== undefined).length, narrativeShots: shots.filter(s => s.narrative).length }, limitations: ['仅检查已保存的剧本、分镜、声音设计和几何数据，未观看或测量生成的视频。', '对白密度、运镜速度与状态文字相似性属于风险提示；固定镜头、有意越轴、快运动和幻想设定不自动判错。', '尺度锚点、物理约束和表演提示已填写不代表生成结果遵守它们；真实画面、口型、音色与声轨衔接仍须审片。'] };
}
