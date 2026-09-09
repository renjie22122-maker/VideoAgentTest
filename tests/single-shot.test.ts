import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {demoPlan} from '../lib/studio/domain.ts';
import {initialProduction} from '../lib/studio/graph.ts';
import type {Project} from '../lib/studio/types.ts';
void test('single-shot text video skips missing upstream images and regeneration preserves other shots',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'single-shot-'));const old=process.env.STUDIO_DATA_DIR;process.env.STUDIO_DATA_DIR=dir;t.after(()=>{if(old===undefined)delete process.env.STUDIO_DATA_DIR;else process.env.STUDIO_DATA_DIR=old;});
 let now=10000;t.mock.method(Date,'now',()=>now);
 const p={id:'single',revision:1,idea:'test',duration:30,ratio:'16:9',mode:'demo',answers:{},jobs:[],production:initialProduction()} as unknown as Project;p.plan=demoPlan(p);p.production!.node='generation';p.production!.renderApprovedRevision=1;p.plan.shots[1].videoInput={mode:'text'};
 await writeFile(path.join(dir,'projects.json'),JSON.stringify([p]));const {dispatch}=await import('../lib/studio/server.ts');const act=(action:string,extra={})=>dispatch({id:p.id,revision:1,action,...extra}) as Promise<Project>;
 let next=await act('enqueue',{kind:'video',shotId:'shot-2'});assert.equal(next.jobs.length,1);assert.equal(next.jobs[0].independent,true);
 await act('poll');now+=2000;next=await act('poll');assert.equal(next.jobs[0].status,'succeeded');assert.equal(next.plan!.shots[0].videoMode,undefined);
 next.plan!.shots[1].videoUrl='https://example.com/old.mp4';next.jobs[0].outputUrl=next.plan!.shots[1].videoUrl;await writeFile(path.join(dir,'projects.json'),JSON.stringify([next]));
 next=await act('enqueue',{kind:'video',shotId:'shot-2',regenerate:true});assert.equal(next.jobs.length,2);assert.equal(next.jobs[0].outputUrl,'https://example.com/old.mp4');assert.equal(next.plan!.shots[1].videoMode,undefined);assert.equal(next.plan!.shots[0].referenceUrl,undefined);
 await assert.rejects(act('enqueue',{kind:'video',shotId:'shot-2',regenerate:true}),/正在生成/);
});
