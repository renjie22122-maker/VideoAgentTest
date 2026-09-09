import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePerformances,validatePerformance} from '../lib/studio/performance.ts';
import {soundTimeline,validateSoundCues} from '../lib/studio/sound-plan.ts';
import {demoPlan} from '../lib/studio/domain.ts';
import {initialProduction} from '../lib/studio/graph.ts';
import {demoScreenplay} from '../lib/studio/screenplay.ts';
import type {Project} from '../lib/studio/types.ts';
void test('one utterance crosses a cut and off-screen scene with stable identity and global timing',()=>{
 const p:Project={id:'s',title:'s',idea:'对话',duration:24,ratio:'16:9',mode:'demo',phase:'planned',revision:1,createdAt:0,updatedAt:0,questions:[],answers:{},jobs:[],production:initialProduction()};p.production!.script=demoScreenplay(p);p.production!.script.scenes![0].dialogue=[{characterId:'character-1',delivery:'迟疑',line:'等等，别走。',afterAction:0}];const shots=demoPlan(p).shots.slice(0,2);
 shots.forEach((s,i)=>{s.dialogue=i?'别走。':'等等，';s.performance=validatePerformance([{sourceSceneId:'scene-1',dialogueIndex:1,characterId:'character-1',text:s.dialogue,start:0,end:3,mode:i?'off_screen':'on_screen',delivery:'迟疑',pace:'正常',emphasis:'别走',pauses:'逗号稍停',breath:'自然',listener:'对方'}]);});shots[1].scene='scene-2';validatePerformances(shots,p,true);
 const timeline=soundTimeline(shots).filter(v=>"utteranceId" in v);assert.equal(timeline[0].utteranceId,timeline[1].utteranceId);assert.equal(timeline[1].start,shots[0].duration);
 shots[1].performance![0].mode='on_screen';assert.throws(()=>validatePerformances(shots,p,true),/跨场声桥/);shots[1].performance![0].mode='off_screen';shots[1].performance![0].end=50;assert.throws(()=>validatePerformances(shots,p,true),/超出/);
 assert.throws(()=>validateSoundCues([{id:'rain',layer:'ambience',world:'unknown',source:'雨',sourceSceneId:'scene-1',start:0,end:3,bridge:'L',mix:'压低'}]),/类型/);
});
