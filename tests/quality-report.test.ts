import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQualityReport, dialogueLoad } from '../lib/studio/quality-report.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import { emptyStoryGuide } from '../lib/studio/story-context.ts';
import type { Project, Shot } from '../lib/studio/types.ts';

function fixture(): Project {
  const project: Project = { id: 'quality', revision: 4, title: '渡桥', idea: '两条叙事线交替等待与过桥。', duration: 24, ratio: '16:9', mode: 'demo', phase: 'planned', questions: [], answers: {}, jobs: [], createdAt: 0, updatedAt: 0, production: initialProduction(), storyContext: { seriesId: 'quality', actNumber: 1, guide: { ...emptyStoryGuide(), editingMode: 'parallel' } } };
  project.production!.script = { schemaVersion: 2, title: '渡桥', logline: project.idea, synopsis: project.idea, theme: '信任', dramaticQuestion: '能否按时过桥？', characters: [{ id: 'runner', name: '信使', description: '灰外套', want: '带信过桥' }, { id: 'watcher', name: '守望者', description: '深蓝制服', want: '等信' }], scenes: [
    { id: 'bridge', interiorExterior: 'EXT', location: '桥边', timeOfDay: '白天', duration: 12, characters: ['runner'], purpose: '前进', conflict: '迟疑', turn: '决定过桥', action: ['信使看向桥面。', '信使握紧信封，踏上桥。'], dialogue: [{ characterId: 'runner', delivery: '坚定但不过度喊叫', line: '收到，正在过桥。', afterAction: 0 }], sound: '桥下流水', endState: '信使已上桥' },
    { id: 'tower', interiorExterior: 'INT', location: '塔内', timeOfDay: '白天', duration: 12, characters: ['watcher'], purpose: '等待', conflict: '不确定', turn: '看见信使', action: ['守望者看向窗外。', '守望者放下望远镜。'], dialogue: [], sound: '室内钟声', endState: '望远镜放在桌上' },
  ] };
  const shots: Shot[] = Array.from({ length: 4 }, (_, index) => {
    const a = index % 2 === 0, first = index < 2, scene = a ? 'bridge' : 'tower';
    const state = { pose: a ? '信使站在桥边' : '守望者在塔内', screenDirection: 'static' as const, wardrobe: a ? '信使灰色外套' : '守望者深蓝制服', props: a ? '信使右手持有信封' : '守望者双手持有望远镜', light: '自然光', axis: 'A' as const };
    const dialogue = a ? first ? '收到，' : '正在过桥。' : '';
    return { id: `shot-${index + 1}`, scene, title: a ? '桥边行动' : '塔内等待', beat: '显示人物的选择', description: a ? '信使看向桥面，握信封。' : '守望者看向窗外。', dialogue, sound: a ? '流水' : '钟声', duration: 6, size: 'medium', transition: 'cut', camera: { movement: 'fixed', lens: 50, start: { x: 0, y: 1.6, z: 5 }, end: { x: 0, y: 1.6, z: 5 }, easing: 'linear' }, startState: { ...state }, endState: { ...state }, narrative: { threadId: a ? 'A' : 'B', timeRelation: first && !a ? 'simultaneous' : 'continuous', resumeFromShotId: first ? null : `shot-${index - 1}`, elapsed: '紧接本线动作', handoff: '通过桥栏或窗框重新辨认空间', soundSource: `来自 ${scene} 的声音` }, intent: { actionIndices: [first ? 1 : 2], dialogueIndices: a ? [1] : [], purpose: '给观众明确的行动或等待信息', visualPlan: '保留人物与空间地标的关系', cutReason: '以等待和行动形成对照', movementReason: '固定观察人物作出决定', speedPlan: '全程固定', actionTiming: '0–2 秒观察，2–5 秒行动，末秒留白', physicsChecks: ['信封保持原有尺寸、边缘和持握关系，手指不可穿透。'], scaleAnchors: ['信封宽度小于信使手掌到肘部的距离，以已批准人物比例为依据。'] }, performance: a ? [{ sourceSceneId: 'bridge', dialogueIndex: 1, characterId: 'runner', text: dialogue, start: first ? 1 : 0, end: first ? 3 : 2, mode: 'on_screen', delivery: '坚定、克制', pace: '自然语速', emphasis: '过桥', pauses: '逗号短停', breath: '自然呼吸', listener: '无线电另一端的守望者' }] : [], soundCues: [{ id: a ? 'water' : 'clock', layer: 'ambience', world: 'diegetic', source: a ? '桥下流水，近处偏左' : '塔内挂钟，远处', sourceSceneId: scene, start: 0, end: 6, bridge: first ? 'none' : 'continuous', mix: '对白时压低背景，保持本空间混响' }] };
  });
  project.plan = { title: project.title, logline: project.idea, synopsis: project.idea, bible: { character: '信使与守望者', appearance: '灰外套与深蓝制服', location: '桥边、塔内', lighting: '白天自然光', palette: '中性', props: '信封与望远镜', style: '写实', negative: '不改变身份' }, shots };
  return project;
}

void test('clean intercut plan remains reviewable without claiming verified video; report is pure and stable', () => {
  const project = fixture(), before = structuredClone(project), report = buildQualityReport(project);
  assert.equal(report.blockingCount, 0);
  assert.deepEqual(report.findings, []);
  assert.equal(report.status, 'ready_for_review');
  assert.equal(report.scope, 'text_preflight');
  assert.match(report.limitations.join(''), /未观看或测量生成的视频/);
  assert.deepEqual(project, before);
  project.plan!.shots[2].narrative!.resumeFromShotId = 'shot-2';
  const firstIds = buildQualityReport(project).findings.map(f => f.id);
  project.revision += 1;
  assert.deepEqual(buildQualityReport(project).findings.map(f => f.id), firstIds);
});

void test('A B A tracks own thread, flags wrong predecessor, and does not compare unrelated space states', () => {
  const project = fixture();
  assert.ok(!buildQualityReport(project).findings.some(f => f.category === 'narrative'));
  project.plan!.shots[2].narrative!.resumeFromShotId = 'shot-2';
  project.plan!.shots[2].startState.props = project.plan!.shots[1].endState.props;
  const findings = buildQualityReport(project).findings;
  assert.equal(findings.find(f => f.code === 'narrative-predecessor')?.severity, 'error');
  const contamination = findings.find(f => f.code === 'intercut-state-source');
  assert.equal(contamination?.severity, 'warning');
  assert.deepEqual(contamination?.shotIds, ['shot-1', 'shot-2', 'shot-3']);
  project.plan!.shots[2].narrative!.timeRelation = 'later';
  assert.ok(!buildQualityReport(project).findings.some(f => f.code === 'intercut-state-source'));
});

void test('coverage separates omissions, causal order risks, and deliberate earlier-time narration', () => {
  const project = fixture(), shots = project.plan!.shots;
  shots[2].intent!.actionIndices = [];
  const omission = buildQualityReport(project).findings.find(f => f.code === 'actions-uncovered');
  assert.equal(omission?.severity, 'error');
  assert.match(omission!.evidence, /握紧信封/);
  assert.equal(buildQualityReport(project, { strictness: 'compatible' }).findings.find(f => f.code === 'actions-uncovered')?.severity, 'warning');
  shots[0].intent!.actionIndices = [2]; shots[2].intent!.actionIndices = [1];
  assert.ok(buildQualityReport(project).findings.some(f => f.code === 'action-order-review'));
  assert.ok(buildQualityReport(project).findings.some(f => f.code === 'dialogue-action-order'));
  shots[2].narrative!.timeRelation = 'earlier';
  assert.ok(!buildQualityReport(project).findings.some(f => f.code === 'action-order-review'));
});

void test('same utterance can cross scenes as offscreen sound but may not duplicate or change speaker', () => {
  const project = fixture(), shots = project.plan!.shots;
  const continuation = shots[2].performance!.pop()!;
  shots[2].dialogue = '';
  shots[1].performance = [{ ...continuation, mode: 'off_screen' }]; shots[1].dialogue = continuation.text;
  assert.equal(buildQualityReport(project).blockingCount, 0);
  shots[1].performance![0].mode = 'on_screen';
  assert.ok(buildQualityReport(project).findings.some(f => f.code === 'cross-scene-lipsync'));
  shots[1].performance![0].mode = 'off_screen';
  shots[2].performance = [{ ...continuation }]; shots[2].dialogue = continuation.text;
  const repeated = buildQualityReport(project).findings.find(f => f.code === 'utterance-coverage');
  assert.match(repeated!.evidence, /正在过桥。正在过桥。/);
  shots[2].performance![0].characterId = 'watcher';
  assert.ok(buildQualityReport(project).findings.some(f => f.code === 'dialogue-source-invalid'));
});

void test('performance and sound windows are checked against shot time, with multilingual load as advice', () => {
  const project = fixture(), shot = project.plan!.shots[0];
  shot.performance![0].end = 9;
  shot.soundCues![0].end = 9;
  const report = buildQualityReport(project);
  assert.equal(report.findings.find(f => f.code === 'dialogue-window-invalid')?.severity, 'error');
  assert.equal(report.findings.find(f => f.code === 'sound-window-invalid')?.severity, 'error');
  assert.equal(dialogueLoad('Please keep the door open.', 3).overloaded, false);
  assert.equal(dialogueLoad('赶快准备所有武器不要再等了', 1).overloaded, true);
  assert.equal(dialogueLoad('Please keep the door open.', 0.5).overloaded, true);
});

void test('sound identities remain distinct across parallel spaces without forbidding intentional sound bridges', () => {
  const project = fixture(), shots = project.plan!.shots;
  shots[1].soundCues![0] = { ...shots[0].soundCues![0], bridge: 'L', mix: '桥下水声延续至塔内画面，随后淡出' };
  assert.equal(buildQualityReport(project).blockingCount, 0);
  assert.ok(!buildQualityReport(project).findings.some(f => f.code === 'cross-scene-sound-bridge'));
  shots[1].soundCues![0].bridge = 'none';
  assert.ok(buildQualityReport(project).findings.some(f => f.code === 'cross-scene-sound-bridge'));
  shots[1].soundCues![0].sourceSceneId = 'tower';
  assert.equal(buildQualityReport(project).findings.find(f => f.code === 'sound-identity-conflict')?.severity, 'error');
});

void test('camera checks use sampled geometry, accept fixed expression, follow and complete orbit', () => {
  const project = fixture(), shot = project.plan!.shots[0];
  assert.ok(!buildQualityReport(project).findings.some(f => f.category === 'camera'));
  shot.camera.end.x = 2;
  assert.equal(buildQualityReport(project).findings.find(f => f.code === 'fixed-camera-motion')?.severity, 'error');
  shot.camera.end.x = 0; shot.camera.movement = 'orbit';
  shot.motion = { version: 1, subject: { start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 } }, camera: { mode: 'orbit', degrees: 360 } };
  assert.ok(!buildQualityReport(project).findings.some(f => f.code === 'stationary-motion-path'));
  shot.camera.movement = 'track'; shot.motion.camera.mode = 'follow'; shot.motion.camera.degrees = 0; shot.motion.subject.end.x = 12;
  assert.ok(!buildQualityReport(project).findings.some(f => f.category === 'camera'));
  shot.camera.start.x = -1; shot.camera.end.x = 1;
  assert.ok(!buildQualityReport(project).findings.some(f => /axis/.test(f.code)));
});

void test('legacy metadata is not invented or treated as physical failure; strictness only requests completion', () => {
  const project = fixture();
  for (const shot of project.plan!.shots) { delete shot.intent; delete shot.soundCues; }
  const standard = buildQualityReport(project), strict = buildQualityReport(project, { strictness: 'strict' });
  assert.equal(standard.blockingCount, 0);
  assert.equal(standard.status, 'incomplete');
  assert.equal(standard.findings.find(f => f.code === 'physics-plan-missing')?.severity, 'info');
  assert.equal(strict.findings.find(f => f.code === 'physics-plan-missing')?.severity, 'warning');
  assert.equal(strict.blockingCount, 0);
  assert.ok(project.plan!.shots.every(s => s.intent === undefined));
});

void test('malformed geometry yields actionable evidence instead of crashing report generation', () => {
  const project = fixture();
  project.plan!.shots[0].camera.start.z = Number.NaN;
  const finding = buildQualityReport(project).findings.find(f => f.code === 'camera-geometry-invalid');
  assert.equal(finding?.severity, 'error');
  assert.equal(finding?.owner, 'camera');
  assert.ok(finding?.evidence && finding.suggestion);
});

void test('two utterances in the same scene may interleave while each preserves its own words', () => {
  const project = fixture(), shots = project.plan!.shots;
  const [bridge, tower] = project.production!.script!.scenes!;
  bridge.duration = 24;
  bridge.characters.push('watcher');
  bridge.action.push(...tower.action);
  bridge.dialogue.push({ characterId: 'watcher', delivery: '担心但冷静', line: '你小心。', afterAction: 2 });
  project.production!.script!.scenes = [bridge];
  for (const i of [1, 3]) {
    const shot = shots[i];
    shot.scene = 'bridge';
    shot.intent!.actionIndices = [i === 1 ? 3 : 4];
    shot.intent!.dialogueIndices = [2];
    shot.dialogue = i === 1 ? '你' : '小心。';
    shot.performance = [{ ...shots[0].performance![0], characterId: 'watcher', dialogueIndex: 2, text: shot.dialogue }];
    shot.soundCues![0].sourceSceneId = 'bridge';
  }
  const report = buildQualityReport(project);
  assert.equal(report.blockingCount, 0);
  assert.ok(!report.findings.some(f => f.code === 'utterance-coverage'));
});

void test('dialogue coverage uses time-window playback order, not JSON array order', () => {
  const project = fixture(), shot = project.plan!.shots[0];
  const first = { ...shot.performance![0], text: '收到，', start: 0, end: 1 };
  const second = { ...shot.performance![0], text: '正在过桥。', start: 2, end: 4 };
  shot.dialogue = '收到，正在过桥。';
  shot.performance = [second, first];
  project.plan!.shots[2].dialogue = '';
  project.plan!.shots[2].performance = [];
  const before = structuredClone(project);
  assert.equal(buildQualityReport(project).blockingCount, 0);
  assert.deepEqual(project, before);
  shot.performance = [{ ...first, start: 3, end: 5 }, { ...second, start: 0, end: 2 }];
  const report = buildQualityReport(project);
  assert.ok(report.findings.some(f => f.code === 'utterance-coverage'));
  assert.ok(report.findings.some(f => f.code === 'shot-performance-text'));
});
void test('registered speaker may remain on screen while continuing a line across scene boundaries', () => {
  const project = fixture(), shots = project.plan!.shots;
  const continuation = shots[2].performance!.pop()!;
  shots[2].dialogue = '';
  shots[1].performance = [{ ...continuation, mode: 'on_screen' }]; shots[1].dialogue = continuation.text;
  assert.ok(buildQualityReport(project).findings.some(f => f.code === 'cross-scene-lipsync'));
  project.production!.script!.scenes![1].characters.push('runner');
  shots[1].description = '信使进入塔内，仍在画内说完原句。';
  assert.equal(buildQualityReport(project).blockingCount, 0);
});