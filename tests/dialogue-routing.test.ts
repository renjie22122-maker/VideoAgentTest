import test from 'node:test';
import assert from 'node:assert/strict';
import { demoPlan } from '../lib/studio/domain.ts';
import { validateDirectorPlan } from '../lib/studio/director.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import { demoScreenplay } from '../lib/studio/screenplay.ts';
import { emptyStoryGuide } from '../lib/studio/story-context.ts';
import { withIntent } from './intent-fixture.ts';
import type { Project } from '../lib/studio/types.ts';

function intercutFixture(): Project {
  const p: Project = { id: 'dialogue-routing', title: '桥边联络', idea: '两个人在桥两端通话', duration: 24, ratio: '16:9', mode: 'demo', phase: 'planned', revision: 1, createdAt: 0, updatedAt: 0, questions: [], answers: {}, jobs: [], production: initialProduction(), storyContext: { seriesId: 'dialogue-routing', actNumber: 1, guide: { ...emptyStoryGuide(), editingMode: 'parallel' } } };
  const script = demoScreenplay(p);
  script.characters.push({ id: 'character-2', name: '同伴', description: '深蓝外套', want: '等对方到达' });
  script.scenes[0].characters.push('character-2');
  script.scenes[0].dialogue = [{ characterId: 'character-1', delivery: '克制', line: '我已到桥边。', afterAction: 0 }, { characterId: 'character-2', delivery: '关心', line: '你再等等。', afterAction: 0 }];
  p.production!.script = script;
  p.plan = demoPlan(p);
  p.plan.shots = withIntent(p.plan.shots, script).map((shot, index) => {
    const a = index % 2 === 0;
    const text = ['我已', '你再', '到桥边。', '等等。'][index];
    return { ...shot, dialogue: text, intent: { ...shot.intent!, dialogueIndices: [a ? 1 : 2] }, narrative: { threadId: a ? 'A' : 'B', timeRelation: index < 2 ? 'simultaneous' : 'continuous', resumeFromShotId: index < 2 ? null : `shot-${index - 1}`, elapsed: '同一段对话进行中', handoff: '通过桥栏与人物方向辨认位置', soundSource: '各自画内人声与桥下水声' }, performance: [{ sourceSceneId: 'scene-1', dialogueIndex: a ? 1 : 2, characterId: a ? 'character-1' : 'character-2', text, start: 0, end: 2, mode: 'on_screen', delivery: '克制关切', pace: '自然语速', emphasis: '自然重音', pauses: '句尾短停', breath: '自然呼吸', listener: '电话另一端的同伴' }], soundCues: [] };
  });
  return p;
}

void test('director accepts A1 B1 A2 B2 in one scene when each utterance remains complete', () => {
  const p = intercutFixture();
  const plan = validateDirectorPlan({ shots: p.plan!.shots }, p, true);
  assert.equal(plan.shots.length, 4);
  assert.equal(plan.shots[2].narrative!.resumeFromShotId, 'shot-1');
});

void test('director accepts a source-scene utterance continued over another scene as offscreen sound', () => {
  const p = intercutFixture(), shots = p.plan!.shots, first = p.production!.script!.scenes![0];
  const second = { ...structuredClone(first), id: 'scene-2', duration: 12, characters: ['character-2'], action: ['同伴等待'], dialogue: [{ ...first.dialogue[1] }] };
  first.duration = 12; first.dialogue = [first.dialogue[0]];
  p.production!.script!.scenes!.push(second);
  for (const i of [1, 3]) {
    shots[i].scene = 'scene-2';
    shots[i].intent!.actionIndices = i === 1 ? [1] : [];
    shots[i].intent!.dialogueIndices = [1];
    shots[i].performance![0].sourceSceneId = 'scene-2';
    shots[i].performance![0].dialogueIndex = 1;
  }
  const continuation = shots[2].performance!.pop()!;
  shots[2].dialogue = '';
  shots[1].performance!.push({ ...continuation, start: 2, end: 4, mode: 'off_screen' });
  shots[1].dialogue += continuation.text;
  assert.doesNotThrow(() => validateDirectorPlan({ shots }, p, true));
  shots[1].performance![1].mode = 'on_screen';
  assert.throws(() => validateDirectorPlan({ shots }, p, true), /跨场声桥|当前画面/);
});

void test('director checks utterance playback timing and accepts valid windows emitted out of array order', () => {
  const p = intercutFixture(), shots = p.plan!.shots;
  const first = { ...shots[0].performance![0] };
  const second = { ...shots[2].performance![0], start: 2, end: 4 };
  shots[0].dialogue += shots[2].dialogue;
  shots[0].performance = [second, first];
  shots[2].performance = []; shots[2].dialogue = '';
  assert.doesNotThrow(() => validateDirectorPlan({ shots }, p, true));
  shots[0].performance = [{ ...first, start: 3, end: 5 }, { ...second, start: 0, end: 2 }];
  assert.throws(() => validateDirectorPlan({ shots }, p, true), /分段与原文|播放|对白|表演/);
});
void test('an on-screen character may finish one utterance after entering another registered scene', () => {
  const p = intercutFixture(), shots = p.plan!.shots, first = p.production!.script!.scenes![0];
  const second = { ...structuredClone(first), id: 'scene-2', location: '桥头值班室', duration: 18, action: ['同伴等候，信使从桥边走进值班室。'], dialogue: [{ ...first.dialogue[1] }] };
  first.duration = 6; first.dialogue = [first.dialogue[0]];
  p.production!.script!.scenes!.push(second);
  p.storyContext!.guide.editingMode = 'linear';
  for (const shot of shots) delete shot.narrative;
  for (const i of [1, 2, 3]) {
    shots[i].scene = 'scene-2';
    shots[i].intent!.actionIndices = i === 1 ? [1] : [];
    shots[i].intent!.dialogueIndices = i === 2 ? [] : [1];
    if (i !== 2) { shots[i].performance![0].sourceSceneId = 'scene-2'; shots[i].performance![0].dialogueIndex = 1; }
  }
  shots[2].description = '信使走进值班室，仍在画内说完原句。';
  assert.equal(shots[2].performance![0].sourceSceneId, 'scene-1');
  assert.equal(shots[2].performance![0].mode, 'on_screen');
  assert.doesNotThrow(() => validateDirectorPlan({ shots }, p, true));
});