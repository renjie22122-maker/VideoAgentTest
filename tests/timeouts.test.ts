import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fetchJSON } from '../lib/studio/http.ts';
import { studioRequest } from '../lib/studio/client.ts';

void test('deadline covers response body after headers arrive',async t=>{
 t.mock.method(globalThis,'fetch',async (_url:unknown,init:RequestInit)=>new Response(new ReadableStream({start(controller){init.signal!.addEventListener('abort',()=>controller.error(init.signal!.reason),{once:true});}})));
 await assert.rejects(fetchJSON('https://example.test',{},20),{name:'TimeoutError'});
});
void test('HTTP errors retain their status when body is not JSON',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('gateway timeout',{status:504}));
 assert.equal((await fetchJSON('https://example.test',{},1000)).response.status,504);
});
void test('client translates body timeouts without retrying',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return {ok:true,json:async()=>{throw new DOMException('The operation was aborted due to timeout','TimeoutError');}};});
 await assert.rejects(studioRequest('plan'),/服务端可能仍在处理/);
 assert.equal(calls,1);
});
void test('long generation does not block reads or queue duplicate writes; failure releases lock',async t=>{
 const config={STUDIO_DATA_DIR:mkdtempSync(path.join(tmpdir(),'frame-timeout-')),LLM_BASE_URL:'https://llm.example',LLM_API_KEY:'test',LLM_MODEL:'test'};
 const previous=Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]));Object.assign(process.env,config);
 t.after(()=>{for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 let release!:()=>void,started!:()=>void;
 const startedPromise=new Promise<void>(r=>{started=r;});const gate=new Promise<void>(r=>{release=r;});
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;started();await gate;return {ok:true,json:async()=>{throw new DOMException('timeout','TimeoutError');}};});
 const {dispatch}=await import('../lib/studio/server.ts');
 const command={action:'create',idea:'一个女孩在车站找到信',duration:30,ratio:'16:9' as const,mode:'live' as const};
 const pending=dispatch(command);const failure=assert.rejects(pending,/连接 llm.example 超时/);
 await startedPromise;
 try{
  assert.deepEqual(await dispatch({action:'list'}),[]);
  assert.ok(await dispatch({action:'settings'}));
  await assert.rejects(dispatch(command),/正在处理上一项操作/);
  assert.equal(calls,1);
 }finally{release();}
 await failure;
 assert.ok(await dispatch({...command,mode:'demo'}));
});
