import test from 'node:test';
import assert from 'node:assert/strict';
import {miniMaxTiming} from '../lib/studio/render-timing.ts';
import {videoPreflight,videoProfile} from '../lib/studio/video-profile.ts';
import {prepareMiniMax,submitMiniMax} from '../lib/studio/minimax-video.ts';
import {demoPlan} from '../lib/studio/domain.ts';
import type {Project,Job} from '../lib/studio/types.ts';
void test('integer request duration never rewrites fractional editorial time',()=>{
 for(const value of [4,4.1,11.5,14.99,15]){const timing=miniMaxTiming(value);assert.equal(timing.requestSeconds,Math.ceil(value));assert.equal(timing.trimEnd,value);assert.equal(timing.editSeconds,value);assert.ok(timing.requestSeconds<=15);}
 for(const value of [NaN,Infinity,3.9,15.01])assert.throws(()=>miniMaxTiming(value),/4–15/);
 assert.throws(()=>miniMaxTiming(4.5,'MiniMax-H3-Max'),/5–15/);
});
void test('11.5s submits as 12s while camera, dialogue and first-last references stay unchanged',async()=>{
 const p={id:'fraction',revision:1,title:'test',idea:'test',duration:30,ratio:'16:9',mode:'live',answers:{},jobs:[]} as unknown as Project;p.plan=demoPlan(p);const s=p.plan.shots[0];s.duration=11.5;s.dialogue='保留原台词';s.referenceUrl='https://example.com/start.png';s.videoInput={mode:'first_last',lastFrameUrl:'https://example.com/end.png'};const before=structuredClone(p),j={shotId:s.id,kind:'video'} as Job;
 assert.deepEqual(videoPreflight(p,s,videoProfile({provider:'minimax',model:'MiniMax-H3'})),[]);
 const prepared=prepareMiniMax(p,j,'MiniMax-H3');assert.equal(prepared.timing.tailSeconds,.5);assert.match(prepared.prompt,/11.5/);assert.match(prepared.prompt,/不增加对白/);
 await submitMiniMax(p,j,'https://api.minimax.io','MiniMax-H3','test',async(_url,body)=>{const request=body as {duration:number;content:{role?:string}[]};assert.equal(request.duration,12);assert.deepEqual(request.content.slice(1).map(c=>c.role),['first_frame','last_frame']);return {task_id:'task'};});
 assert.deepEqual(p,before);assert.deepEqual(j.renderTiming,{editSeconds:11.5,requestSeconds:12,trimStart:0,trimEnd:11.5,tailSeconds:.5});
});
