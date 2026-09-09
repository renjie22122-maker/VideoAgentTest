import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNarrativeLinks,previousNarrativeShot,referencePredecessor} from '../lib/studio/narrative.ts';
import {demoPlan,shotPrompt,checkContinuity} from '../lib/studio/domain.ts';
import {emptyStoryGuide,nextStoryContext} from '../lib/studio/story-context.ts';
import {validateCoverage,cameraSpeedSummary} from '../lib/studio/shot-intent.ts';
import {demoScreenplay} from '../lib/studio/screenplay.ts';
import {initialProduction} from '../lib/studio/graph.ts';
import {withIntent} from './intent-fixture.ts';
import type {Project} from '../lib/studio/types.ts';
function fixture():Project{const p:Project={id:'story',title:'幕一',idea:'人物交替行动',duration:24,ratio:'16:9',mode:'demo',phase:'planned',revision:2,createdAt:0,updatedAt:0,questions:[],answers:{},jobs:[],production:initialProduction()};p.plan=demoPlan(p);p.production!.script=demoScreenplay(p);return p;}
void test('A B A resumes A state and reference, never B',()=>{
 const p=fixture(),shots=p.plan!.shots;shots.forEach((s,i)=>{const a=i%2===0;s.narrative={threadId:a?'A':'B',resumeFromShotId:i<2?null:shots[i-2].id,timeRelation:'continuous',elapsed:'紧接上一动作',handoff:'切回建立主体位置',soundSource:'本线环境声'};s.referenceUrl='https://example.com/'+s.id;s.endState.props=a?'信件':'手机';s.startState.props=a?'信件':'手机';});
 validateNarrativeLinks(shots,true);assert.equal(previousNarrativeShot(shots,2)?.id,'shot-1');assert.equal(referencePredecessor(shots,2)?.id,'shot-1');
 const prompt=JSON.parse(shotPrompt(p,2));assert.equal(prompt.previousEndState.props,'信件');assert.equal(prompt.previousReferenceImage,shots[0].referenceUrl);assert.ok(!checkContinuity(p.plan!).some(i=>i.code==='continuity-props'));
 shots[2].narrative!.resumeFromShotId='shot-2';assert.throws(()=>validateNarrativeLinks(shots,true),/最近前镜/);shots[2].narrative!.resumeFromShotId='shot-1';shots[2].narrative!.timeRelation='later';assert.equal(referencePredecessor(shots,2),undefined);
});
void test('coverage rejects omissions and altered dialogue; speed respects duration',()=>{
 const p=fixture(),shots=withIntent(p.plan!.shots,p.production!.script!);validateCoverage(shots,p,true);shots[0].intent!.actionIndices=[];assert.throws(()=>validateCoverage(shots,p,true),/遗漏/);
 const valid=withIntent(p.plan!.shots,p.production!.script!);valid[0].dialogue='新增对白';assert.throws(()=>validateCoverage(valid,p,true),/对白/);
 const s=p.plan!.shots[0];assert.equal(cameraSpeedSummary(s).distance,0);s.camera.movement='track';s.camera.easing='linear';s.camera.end.x=s.camera.start.x+6;const speed=cameraSpeedSummary(s);s.duration*=2;assert.equal(cameraSpeedSummary(s).average,speed.average/2);
});
void test('next act is independent snapshot',()=>{
 const p=fixture();p.storyContext={seriesId:p.id,actNumber:1,guide:{...emptyStoryGuide(),canon:'固定身份',handoff:'受伤的左手'}};const before=structuredClone(p),next=nextStoryContext(p);assert.equal(next.actNumber,2);assert.equal(next.parentRevision,2);next.guide.canon='新值';assert.deepEqual(p,before);assert.match(next.previousAct!.note,/不代表/);
});
