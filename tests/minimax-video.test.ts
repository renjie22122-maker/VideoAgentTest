import test from 'node:test';
import assert from 'node:assert/strict';
import { miniMaxBase, submitMiniMax, pollMiniMax } from '../lib/studio/minimax-video.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import type { Project, Job } from '../lib/studio/types.ts';
void test('H3 uses V2 native content and persistent query route, rejects invalid durations',async()=>{
 const p:Project={id:'h3',revision:1,title:'test',idea:'test',duration:30,ratio:'16:9',mode:'live',phase:'planned',questions:[],answers:{},jobs:[],createdAt:0,updatedAt:0};p.plan=demoPlan(p);p.plan.shots[0].referenceUrl='https://example.com/frame.png';
 const j:Job={id:'j',shotId:'shot-1',kind:'video',status:'running',revision:1,createdAt:0,mode:'live'};
 let calls=0;const request=async(url:string,body:unknown,key:string,method?:string)=>{calls++;assert.equal(key,'dummy');if(!method){assert.equal(url,'https://api.minimax.io/v2/video_generation');const input=body as {content:{role?:string;image_url?:{url:string}}[];duration:number};assert.equal(input.content[1].image_url?.url,p.plan!.shots[0].referenceUrl);assert.equal(input.content[1].role,'first_frame');assert.equal(input.duration,6);return {task_id:'task'};}assert.equal(url,'https://api.minimax.io/v2/query/video_generation/task');return {task:{status:'succeeded',content:{url:'https://example.com/video.mp4'}}};};
 assert.equal(miniMaxBase('https://api.minimax.io/v1'),'https://api.minimax.io');assert.equal(miniMaxBase('https://api.minimax.io.evil.test'),null);
 const id=await submitMiniMax(p,j,'https://api.minimax.io','MiniMax-H3','dummy',request);assert.equal((await pollMiniMax(id,'dummy',request)).status,'succeeded');
 p.plan.shots[0].duration=3;await assert.rejects(submitMiniMax(p,j,'https://api.minimax.io','MiniMax-H3','dummy',request),/4–15/);assert.equal(calls,2);
 await assert.rejects(pollMiniMax('minimax-h3:'+encodeURIComponent('https://evil.test')+':x','dummy',request),/来源/);
});
