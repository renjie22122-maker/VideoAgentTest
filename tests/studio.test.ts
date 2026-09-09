import {withIntent} from './intent-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { demoPlan, validatePlan, checkContinuity, invalidateFrom, shotPrompt } from '../lib/studio/domain.ts';
import { initialProduction, transition } from '../lib/studio/graph.ts';
import { cameraPosition, locateShot } from '../lib/studio/animatic.ts';
import type { Project } from '../lib/studio/types.ts';
import { demoScreenplay } from '../lib/studio/screenplay.ts';

const answers={subject:'短发女孩，深蓝色风衣',location:'雨后的旧车站，黄昏',ending:'收好信件，微笑着离开',tone:'写实温暖，无对白'};
function fixture():Project{return {id:'fixture',revision:1,idea:'一封寄给未来的信',title:'信',createdAt:0,updatedAt:0,duration:30,ratio:'16:9',mode:'demo',phase:'clarify',questions:[],answers,jobs:[],production:initialProduction()};}
void test('demo plans preserve exact durations, character locks and adjacent action states',()=>{
 for(const duration of [12,24,30,31,60,90,120]){const p=fixture();p.duration=duration;const plan=validatePlan(demoPlan(p));assert.equal(plan.shots.reduce((n,s)=>n+s.duration,0),duration);assert.deepEqual(checkContinuity(plan,duration),[]);for(let i=1;i<plan.shots.length;i++)assert.deepEqual(plan.shots[i-1].endState,plan.shots[i].startState);}
});
void test('camera, continuity and malformed model output are rejected or flagged',()=>{
 const plan=demoPlan(fixture());plan.shots[1].camera.end.z=12;plan.shots[1].startState.wardrobe='红色外套';plan.shots[1].startState.axis='B';
 const codes=checkContinuity(plan).map(i=>i.code);assert.ok(codes.includes('push-direction'));assert.ok(codes.includes('continuity-wardrobe'));assert.ok(codes.includes('axis'));
 assert.throws(()=>validatePlan({...plan,shots:[{...plan.shots[0],duration:NaN},plan.shots[1]]}));
});
void test('only changed shot and downstream outputs are invalidated',()=>{
 const p=fixture();p.plan=demoPlan(p);for(const s of p.plan.shots){s.referenceUrl='https://example.com/'+s.id+'.png';s.videoUrl='https://example.com/'+s.id+'.mp4';}
 invalidateFrom(p,2);assert.ok(p.plan.shots[1].videoUrl);assert.equal(p.plan.shots[2].videoUrl,undefined);assert.equal(p.revision,2);assert.match(shotPrompt(p,1),/previousEndState/);
});
void test('state graph refuses to skip approvals',()=>{const p=fixture();assert.throws(()=>transition(p,'generation','skip'));transition(p,'script','writer');assert.throws(()=>transition(p,'prompts','skip'));});
void test('previsualization uses exact shot boundary and camera endpoints',()=>{const plan=demoPlan(fixture());assert.equal(locateShot(plan.shots,plan.shots[0].duration).index,1);const s=plan.shots[1];assert.deepEqual(cameraPosition(s,0),s.camera.start);assert.deepEqual(cameraPosition(s,1),s.camera.end);});

void test('persistent workflow: HITL, queue deduplication, QA retry, assembly and revision guard',async(t)=>{
 const dir=await mkdtemp(path.join(tmpdir(),'frame-test-'));process.env.STUDIO_DATA_DIR=dir;
 const {dispatch}=await import('../lib/studio/server.ts');let clock=Date.now();t.mock.method(Date,'now',()=>clock);
 let p=await dispatch({action:'create',idea:'旧车站的一封信',duration:12,ratio:'16:9',mode:'demo'}) as Project;
 const run=async(action:string,extra:Record<string,unknown>={})=>{p=await dispatch({action,id:p.id,revision:p.revision,...extra}) as Project;return p;};
 await assert.rejects(()=>run('enqueue',{kind:'video'}),/阶段/);
 await assert.rejects(()=>run('plan',{answers}),/澄清/);
 await run('clarify_answers',{answers:Object.fromEntries(p.questions.map(q=>[q.id,q.options?.[0]||'由编剧决定']))});
 assert.equal(p.brief!.ready,true);
 await run('plan',{answers});assert.equal(p.production!.node,'script');assert.equal(p.plan,undefined);
 await run('approve_script',{script:p.production!.script});assert.equal(p.production!.node,'assets');
 await run('approve_assets',{bible:p.production!.assets!.bible,seed:42});assert.equal(p.plan!.shots.length,3);
 await assert.rejects(()=>run('enqueue',{kind:'image'}),/阶段/);
 await run('continuity_review');await run('compile');await run('approve_render');
 await assert.rejects(()=>run('enqueue',{kind:'video'}),/参考图/);
 await run('enqueue',{kind:'image'});await run('enqueue',{kind:'image'});assert.equal(p.jobs.length,3);
 for(let n=0;n<6;n++){clock+=2000;await run('poll');}assert.ok(p.plan!.shots.every(s=>s.referenceMode==='demo'));
 await run('enqueue',{kind:'video'});for(let n=0;n<6;n++){clock+=2000;await run('poll');}assert.equal(p.production!.node,'qa');
 await assert.rejects(()=>run('complete'),/阶段/);
 await run('review',{shotId:'shot-2',verdict:'rejected',notes:'动作衔接不够明确，请保持手部位置。'});assert.equal(p.production!.node,'generation');assert.equal(p.plan!.shots[1].videoMode,undefined);assert.equal(p.plan!.shots[0].videoMode,'demo');
 for(let n=0;n<4;n++){clock+=2000;await run('poll');}assert.equal(p.production!.qa[1].attempt,1);
 const retried=p.jobs.findLast(j=>j.shotId==='shot-2'&&j.kind==='video')!;assert.match(JSON.stringify(retried.input),/保持手部位置/);
 for(const s of p.plan!.shots)await run('review',{shotId:s.id,verdict:'passed',notes:'人工确认预演节奏。'});
 assert.equal(p.production!.node,'assembly');await run('prepare_assembly');await run('complete');assert.equal(p.production!.node,'complete');
 const before=p.revision;await run('shot',{shot:{...p.plan!.shots[1],title:'新版本镜头'}});assert.equal(p.production!.node,'storyboard');assert.equal(p.production!.renderApprovedRevision,undefined);
 await assert.rejects(()=>dispatch({action:'shot',id:p.id,revision:before,shot:p.plan!.shots[1]}),/其他窗口/);
 const saved=JSON.parse(await readFile(path.join(dir,'projects.json'),'utf8')) as Project[];assert.equal(saved[0].revision,p.revision);assert.ok(saved[0].production!.events.length>8);
 const prior=p.production!.script;await run('rewrite_script',{answers});assert.equal(p.production!.node,'script');assert.equal(p.plan,undefined);assert.equal(p.production!.scriptApproved,false);assert.deepEqual(p.production!.scriptHistory!.at(-1)!.script,prior);assert.ok(p.jobs.every(j=>j.status==='cancelled'));
});

void test('live adapters: role separation, persisted media ids and automatic QA retry ceiling',async(t)=>{
 const {dispatch}=await import('../lib/studio/server.ts');
 const values={LLM_BASE_URL:'https://llm.example',LLM_API_KEY:'test-key',LLM_MODEL:'test-model',MEDIA_GATEWAY_URL:'https://media.example',MEDIA_API_KEY:'test-key',IMAGE_MODEL:'image-model',VIDEO_MODEL:'video-model',QA_GATEWAY_URL:'https://qa.example',QA_API_KEY:'test-key'};
 const before=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);t.after(()=>{for(const[k,v]of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const roles:string[]=[];const requests:Record<string,unknown>[]=[];let qaCalls=0;let clock=Date.now();t.mock.method(Date,'now',()=>clock);
 const template=demoPlan(fixture());template.shots=withIntent(template.shots,demoScreenplay(fixture()));
 t.mock.method(globalThis,'fetch',async(url:URL,options:RequestInit)=>{
   const target=String(url);const data=typeof options.body==='string'?JSON.parse(options.body):null;
   if(target.includes('llm.example')){const system=data.messages[0].content;roles.push(system);const content=system.includes('你是电影制作团队的创意开发编辑')?{summary:'理解创意',known:[],assumptions:[],questions:[],ready:true}:system.includes('你是电影制作团队的场记')?{summary:'无语义冲突',findings:[]}:system.includes('你是电影制作团队的提示词编译师')?{shots:template.shots.map(s=>({shotId:s.id,positive:s.description,negative:'避免角色变化',continuityAnchors:[s.startState.pose],capabilityNotes:['网关能力未知']}))}:system.includes('美术指导')?template.bible:system.includes('你是电影制作团队的编剧')?demoScreenplay(fixture()):template;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}));}
   if(target.endsWith('/review')){qaCalls++;return new Response(JSON.stringify({verdict:'rejected',notes:'真实协议桩：角色手中的信消失，需要保持道具。'}));}
   if(options.method==='POST'){requests.push(data);return new Response(JSON.stringify({id:data.idempotencyKey}));}
   return new Response(JSON.stringify({status:'succeeded',outputUrl:'https://outputs.example/'+target.split('/').pop()+'.mp4'}));
 });
 let p=await dispatch({action:'create',idea:'未来的信',duration:30,ratio:'16:9',mode:'live'}) as Project;
 const run=async(action:string,extra:Record<string,unknown>={})=>{p=await dispatch({action,id:p.id,revision:p.revision,...extra}) as Project;};
 await run('plan',{answers});await run('approve_script',{script:p.production!.script});await run('approve_assets',{bible:p.production!.assets!.bible,seed:42});
 assert.equal(roles.length,4);assert.match(roles[0],/创意开发编辑/);assert.match(roles[1],/编剧/);assert.match(roles[2],/美术/);assert.match(roles[3],/导演/);
 await run('continuity_review');await run('compile');await run('approve_render');await run('enqueue',{kind:'image'});
 for(let i=0;i<10;i++){clock+=2000;await run('poll');}assert.ok(p.plan!.shots.every(s=>s.referenceMode==='live'));
 await run('enqueue',{kind:'video'});for(let i=0;i<15;i++){clock+=2000;await run('poll');}
 assert.equal(qaCalls,3);assert.equal(requests.filter(r=>r.kind==='video').length,3);assert.equal(p.plan!.shots[0].videoMode,undefined);
 assert.ok(p.jobs.some(j=>j.status==='failed'&&j.error?.includes('重试上限')));assert.ok(requests.filter(r=>r.kind==='video').slice(1).every(r=>String(r.reflection).includes('保持道具')));
 await assert.rejects(()=>run('enqueue',{kind:'video'}),/重试上限/);
});

