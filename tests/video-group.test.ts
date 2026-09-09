import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {demoPlan} from '../lib/studio/domain.ts';
import {initialProduction} from '../lib/studio/graph.ts';
import {videoGroup} from '../lib/studio/video-group.ts';
import {submitMiniMax} from '../lib/studio/minimax-video.ts';
import type {Project,Job} from '../lib/studio/types.ts';
void test('two shots generate one reference video without changing storyboard or approvals',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'group-video-'));const old=process.env.STUDIO_DATA_DIR;process.env.STUDIO_DATA_DIR=dir;t.after(()=>{if(old===undefined)delete process.env.STUDIO_DATA_DIR;else process.env.STUDIO_DATA_DIR=old;});
 const p={id:'group',revision:1,idea:'test',duration:30,ratio:'16:9',mode:'demo',answers:{},jobs:[],production:initialProduction()} as unknown as Project;p.plan=demoPlan(p);p.production!.node='storyboard';p.production!.scriptApproved=true;
 p.production!.library=[{id:'a',kind:'character',name:'人物',url:'https://example.com/a.png',status:'ready',approved:true}] as never[];
 for(const s of p.plan.shots.slice(0,2)){s.duration=2;s.videoInput={mode:'references',assetIds:['a']};}
 const before=JSON.stringify(p.plan);const group=videoGroup(p,'shot-2','shot-1');assert.equal(group.duration,4);assert.deepEqual(group.assetIds,['a']);
 let sent:Record<string,unknown>={};await submitMiniMax(p,{shotId:'shot-1',group} as Job,'https://api.minimax.io','MiniMax-H3','test',async(_url,body)=>{sent=body as Record<string,unknown>;return {task_id:'task'};});
 const content=sent.content as {role?:string;text?:string}[];assert.equal(sent.duration,4);assert.equal(content[1].role,'reference_image');const prompt=JSON.parse(content[0].text!);assert.equal(prompt.分镜时间表[1].开始秒,2);assert.match(prompt.要求,/多个镜头/);assert.equal(JSON.stringify(p.plan),before);
 await writeFile(path.join(dir,'projects.json'),JSON.stringify([p]));const {dispatch}=await import('../lib/studio/server.ts');let next=await dispatch({action:'enqueue_group',id:p.id,revision:1,shotId:'shot-1',neighborId:'shot-2'}) as Project;
 assert.equal(next.revision,1);assert.equal(next.production!.node,'storyboard');assert.equal(JSON.stringify(next.plan),before);assert.equal(next.jobs.length,1);
 for(let i=0;i<2;i++)next=await dispatch({action:'poll',id:p.id,revision:1}) as Project;
 assert.equal(next.jobs[0].status,'succeeded');assert.equal(next.plan!.shots[0].videoMode,undefined);assert.equal(next.plan!.shots[1].videoMode,undefined);
});
void test('custom range includes every intervening shot in original order and enforces limits',()=>{
 const p={idea:'test',duration:30,answers:{},production:{library:[{id:'a',name:'人物',kind:'character',approved:true,status:'ready',url:'https://example.com/a.png'}]}} as unknown as Project;p.plan=demoPlan(p);
 for(const shot of p.plan.shots){shot.duration=2;shot.videoInput={mode:'references',assetIds:['a']};}
 const before=JSON.stringify(p.plan);const g=videoGroup(p,'shot-3','shot-1');assert.equal(g.shots.length,3);assert.equal(g.duration,6);assert.deepEqual(g.shots.map(s=>s.id),['shot-1','shot-2','shot-3']);assert.deepEqual(g.assetIds,['a']);assert.equal(JSON.stringify(p.plan),before);
 assert.throws(()=>videoGroup(p,'shot-1','shot-1'),/至少两个/);assert.throws(()=>videoGroup(p,'missing','shot-3'));
 p.plan.shots[1].duration=12;assert.throws(()=>videoGroup(p,'shot-1','shot-3'),/4–15/);
});
