import {withIntent} from './intent-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateDirectorPlan } from '../lib/studio/director.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import { demoScreenplay } from '../lib/studio/screenplay.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import type { Project } from '../lib/studio/types.ts';

function fixture():Project{
 const p:Project={id:'director',revision:1,title:'信',idea:'主角读信',duration:24,ratio:'16:9',mode:'live',phase:'planned',questions:[],answers:{},jobs:[],createdAt:0,updatedAt:0,production:initialProduction()};
 p.production!.script=demoScreenplay(p);p.production!.assets={bible:demoPlan(p).bible,seed:42,locked:true};return p;
}
void test('director identifies shot, scene, order and timing errors while preserving confirmed metadata',()=>{
 const p=fixture(),plan=demoPlan(p);
 assert.equal(validateDirectorPlan({shots:plan.shots,bible:{},title:'改写'},p).title,p.production!.script!.title);
 const invalid=structuredClone(plan);invalid.shots[1].duration=3601;assert.throws(()=>validateDirectorPlan(invalid,p),/第 2 镜.*镜头时长/);
 invalid.shots[1].duration=6;invalid.shots[1].scene='教室';assert.throws(()=>validateDirectorPlan(invalid,p),/第 2 镜.*未知场次/);
 invalid.shots[1].scene='scene-1';invalid.shots[1].duration=5;assert.throws(()=>validateDirectorPlan(invalid,p),/scene-1.*23 秒.*24 秒/);
 const first=p.production!.script!.scenes![0];p.production!.script!.scenes=[{...first,duration:12},{...first,id:'scene-2',duration:12}];
 invalid.shots=plan.shots.map((s,i)=>({...s,scene:i===0?'scene-2':'scene-1'}));assert.throws(()=>validateDirectorPlan(invalid,p),/第 2 镜.*顺序/);
});
void test('director repairs one malformed response, caps retries and leaves input untouched',async t=>{
 const config={STUDIO_DATA_DIR:await mkdtemp(path.join(tmpdir(),'frame-director-')),LLM_BASE_URL:'https://director.example',LLM_API_KEY:'dummy',LLM_MODEL:'test'};
 const old=Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]));Object.assign(process.env,config);
 t.after(()=>{for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 const p=fixture(),before=structuredClone(p);let calls=0,alwaysInvalid=false;
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{
  calls++;const input=JSON.parse(init.body as string);assert.match(input.messages[0].content,/wide\/medium\/close/);
  if(calls%2===0)assert.match(input.messages.at(-1).content,/JSON 不完整/);
  return new Response(JSON.stringify({choices:[{message:{content:alwaysInvalid||calls%2===1?'invalid JSON':JSON.stringify({shots:withIntent(demoPlan(p).shots,p.production!.script!)})}}]}));
 });
 const {generatePlan}=await import('../lib/studio/providers.ts');
 const result=await generatePlan(p);assert.equal(result.shots.length,4);assert.equal(calls,2);assert.deepEqual(p,before);
 alwaysInvalid=true;await assert.rejects(generatePlan(p),/自动修正一次.*JSON 不完整/);assert.equal(calls,4);assert.deepEqual(p,before);
});
