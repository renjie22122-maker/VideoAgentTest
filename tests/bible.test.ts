import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateBible, demoPlan } from '../lib/studio/domain.ts';
import { designAssets } from '../lib/studio/providers.ts';
import type { Project } from '../lib/studio/types.ts';
const p:Project={id:'test',idea:'女孩回家',title:'test',revision:1,createdAt:0,updatedAt:0,duration:12,ratio:'16:9',mode:'live',phase:'clarify',questions:[],answers:{},jobs:[]};
void test('bible validation distinguishes missing, structured and oversized fields; unwraps bible envelope',()=>{
 const b=demoPlan(p).bible;assert.deepEqual(validateBible({bible:b}),b);
 assert.throws(()=>validateBible({...b,character:undefined}),/缺少「人物身份」/);
 assert.throws(()=>validateBible({...b,character:[]}),/必须是文字/);
 assert.throws(()=>validateBible({...b,character:'人'.repeat(2001)}),/2001 字/);
});
void test('art direction repairs malformed fields once and does not modify the project on failure',async t=>{
 const config={STUDIO_DATA_DIR:mkdtempSync(path.join(tmpdir(),'frame-bible-')),LLM_BASE_URL:'https://llm.example',LLM_API_KEY:'dummy',LLM_MODEL:'test'};
 const previous=Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]));Object.assign(process.env,config);t.after(()=>{for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const b=demoPlan(p).bible;let calls=0;const before=JSON.stringify(p);
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{calls++;const request=JSON.parse(init.body as string);if(calls===2)assert.match(JSON.parse(request.messages[1].content).validationError,/人物身份/);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(calls===1?{...b,character:[]}:b)}}]}));});
 assert.deepEqual(await designAssets(p),b);assert.equal(calls,2);
 calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'{}'}}]}));});
 await assert.rejects(designAssets(p),/已尝试修复一次/);assert.equal(calls,2);assert.equal(JSON.stringify(p),before);
});
