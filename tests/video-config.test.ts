import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {demoPlan} from '../lib/studio/domain.ts';
import {initialProduction} from '../lib/studio/graph.ts';
import type {Project} from '../lib/studio/types.ts';
void test('video config preserves existing text approval but never grants absent approval',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'video-config-'));const old=process.env.STUDIO_DATA_DIR;process.env.STUDIO_DATA_DIR=dir;t.after(()=>{if(old===undefined)delete process.env.STUDIO_DATA_DIR;else process.env.STUDIO_DATA_DIR=old;});
 const p={id:'config',revision:1,idea:'test',duration:30,ratio:'16:9',mode:'demo',answers:{},jobs:[],production:initialProduction()} as unknown as Project;p.plan=demoPlan(p);const g=p.production!;g.node='generation';g.renderApprovedRevision=1;g.continuityReview={revision:1,summary:'ok',findings:[]};g.prompts=[{shotId:'shot-1',prompt:'approved text'}];p.plan.shots[1].videoUrl='https://example.com/keep';
 await writeFile(path.join(dir,'projects.json'),JSON.stringify([p]));const {dispatch}=await import('../lib/studio/server.ts');
 let next=await dispatch({action:'video_config',id:p.id,revision:1,shotId:'shot-1',videoInput:{mode:'text'}}) as Project;
 assert.equal(next.production!.node,'generation');assert.equal(next.production!.renderApprovedRevision,2);assert.equal(next.production!.continuityReview!.revision,2);assert.deepEqual(next.production!.prompts,g.prompts);assert.equal(next.plan!.shots[1].videoUrl,p.plan.shots[1].videoUrl);
 next.production!.renderApprovedRevision=undefined;next.production!.node='storyboard';await writeFile(path.join(dir,'projects.json'),JSON.stringify([next]));
 next=await dispatch({action:'video_config',id:p.id,revision:2,shotId:'shot-1',videoInput:{mode:'first'}}) as Project;
 assert.equal(next.production!.renderApprovedRevision,undefined);assert.equal(next.production!.node,'storyboard');
});
