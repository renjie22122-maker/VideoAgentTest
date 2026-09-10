import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {demoPlan} from '../lib/studio/domain.ts';
import {initialProduction} from '../lib/studio/graph.ts';
import {videoProfile,videoPreflight} from '../lib/studio/video-profile.ts';
import {isReadOnlyCommand} from '../lib/studio/command-policy.ts';
import type {Project} from '../lib/studio/types.ts';
function fixture():Project{const p:Project={id:'preflight',title:'test',idea:'行走',duration:15,ratio:'16:9',mode:'live',revision:1,phase:'planned',createdAt:1,updatedAt:1,questions:[],answers:{},jobs:[],production:initialProduction()};p.plan=demoPlan(p);p.plan.shots.forEach(s=>{s.videoInput={mode:'text'};});p.production!.node='generation';p.production!.scriptApproved=true;p.production!.renderApprovedRevision=1;return p;}
void test('profiles only advertise implemented modes and preflight stays read-only',()=>{
 const p=fixture(),before=structuredClone(p),s=p.plan!.shots[0];assert.deepEqual(videoProfile({provider:'gateway'}).modes,['first']);assert.equal(isReadOnlyCommand('video_preview'),true);assert.equal(isReadOnlyCommand('quality_report'),true);assert.equal(isReadOnlyCommand('new_unknown_action'),false);assert.ok(videoPreflight(p,s,videoProfile({provider:'gateway'})).length);assert.deepEqual(videoPreflight(p,s,videoProfile({provider:'fal-kling'})),[]);assert.deepEqual(p,before);
});
void test('Kling preflight rejects before enqueue and submission marker precedes only the real POST',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'frame-preflight-'));const env={STUDIO_DATA_DIR:dir,VIDEO_PROVIDER:'fal-kling',FAL_API_KEY:'test-only-key',VIDEO_GENERATE_AUDIO:'true'};const old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);t.after(()=>{for(const[k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 const p=fixture();await writeFile(path.join(dir,'projects.json'),JSON.stringify([p]));const {dispatch}=await import('../lib/studio/server.ts');let calls=0;let clock=Date.now();t.mock.method(Date,'now',()=>clock);
 t.mock.method(globalThis,'fetch',async(url:unknown,init:RequestInit)=>{calls++;if(init.method==='POST'){const saved=JSON.parse(await readFile(path.join(dir,'projects.json'),'utf8')) as Project[];assert.equal(saved[0].jobs[0].remoteId,'fal-pending');assert.match(String(url),/kling-video\/v3\/pro\/text-to-video$/);const body=JSON.parse(init.body as string);assert.equal(body.generate_audio,true);return new Response(JSON.stringify({request_id:'task',status_url:'https://queue.fal.run/test/status',response_url:'https://queue.fal.run/test/result'}));}return new Response(JSON.stringify(String(url).endsWith('/status')?{status:'COMPLETED'}:{video:{url:'https://example.com/final.mp4'}}));});
 process.env.FAL_API_KEY='';await assert.rejects(()=>dispatch({action:'enqueue',id:p.id,revision:1,shotId:'shot-1',kind:'video'}),/未配置/);assert.equal(calls,0);assert.deepEqual((JSON.parse(await readFile(path.join(dir,'projects.json'),'utf8')) as Project[])[0].jobs,[]);
 process.env.FAL_API_KEY='test-only-key';const preview=await dispatch({action:'video_preview',id:p.id,shotId:'shot-1'}) as {issues:string[];prompt:string};assert.deepEqual(preview.issues,[]);assert.ok(preview.prompt.includes('对白'));assert.equal(calls,0);
 await dispatch({action:'enqueue',id:p.id,revision:1,shotId:'shot-1',kind:'video'});await dispatch({action:'poll',id:p.id});clock+=2000;const result=await dispatch({action:'poll',id:p.id}) as Project;assert.equal(result.plan!.shots[0].videoUrl,'https://example.com/final.mp4');assert.equal(calls,3);
});
