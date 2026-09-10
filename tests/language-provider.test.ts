import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildLanguageRequest, languageResponseText, parseLanguageJSON, languageReady, languageText, LanguageProviderError, type LanguageConfig, type LanguageMessage } from '../lib/studio/language-provider.ts';
import { languagePresets } from '../lib/studio/provider-catalog.ts';
import { saveSettings } from '../lib/studio/settings.ts';

const messages:LanguageMessage[]=[{role:'system',content:'返回合法 JSON。'},{role:'user',content:'设计镜头。'},{role:'assistant',content:'{}'},{role:'user',content:'补全运镜。'}];
const base:LanguageConfig={provider:'custom',protocol:'openai',baseUrl:'https://llm.example/v1',model:'test-model',apiKey:'test-secret',jsonMode:'auto'};

void test('provider registry supplies validated protocol requests while keeping model IDs customizable',()=>{
 for(const preset of languagePresets.filter(p=>p.id!=='custom')){
  const c={...base,provider:preset.id,protocol:preset.protocol,baseUrl:preset.baseUrl,model:'user-chosen-model'};
  const request=buildLanguageRequest(messages,c);
  assert.ok(request.url.href.startsWith(preset.baseUrl));
  assert.ok(JSON.stringify(request.body).includes('user-chosen-model')||request.url.href.includes('user-chosen-model'));
  assert.ok(!request.url.href.includes(c.apiKey));
 }
});

void test('wire adapters translate message history, authentication and output limits per native protocol',()=>{
 const openai=buildLanguageRequest(messages,{...base,provider:'openai',maxTokens:24000});
 assert.equal(openai.url.pathname,'/v1/chat/completions');
 assert.equal(openai.body.max_completion_tokens,24000);assert.equal(openai.body.max_tokens,undefined);
 assert.equal(openai.headers.Authorization,'Bearer test-secret');assert.deepEqual(openai.body.response_format,{type:'json_object'});
 const mini=buildLanguageRequest(messages,{...base,model:'MiniMax-M3',maxTokens:16000});
 assert.equal(mini.body.reasoning_split,true);assert.equal(mini.body.response_format,undefined);assert.equal(mini.body.max_tokens,16000);
 const promptOnly=buildLanguageRequest(messages,{...base,jsonMode:'prompt'});assert.equal(promptOnly.body.response_format,undefined);
 const anthropic=buildLanguageRequest(messages,{...base,protocol:'anthropic',workspaceId:'wrkspc_test'});
 assert.equal(anthropic.url.pathname,'/v1/messages');assert.equal(anthropic.headers['x-api-key'],'test-secret');
 assert.equal(anthropic.headers['anthropic-version'],'2023-06-01');assert.equal(anthropic.headers['anthropic-workspace-id'],'wrkspc_test');
 assert.equal(anthropic.body.max_tokens,16384);assert.equal(anthropic.body.system,messages[0].content);
 assert.deepEqual(anthropic.body.messages,messages.slice(1));assert.equal(anthropic.body.response_format,undefined);
 const gemini=buildLanguageRequest(messages,{...base,protocol:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:'models/gemini-user-model',maxTokens:24000});
 assert.equal(gemini.url.pathname,'/v1beta/models/gemini-user-model:generateContent');
 assert.equal(gemini.headers['x-goog-api-key'],'test-secret');assert.equal(gemini.url.search,'');
 assert.deepEqual(gemini.body.systemInstruction,{parts:[{text:messages[0].content}]});
 assert.deepEqual(gemini.body.generationConfig,{responseMimeType:'application/json',maxOutputTokens:24000});
 assert.deepEqual((gemini.body.contents as {role:string}[]).map(m=>m.role),['user','model','user']);
});

void test('local models work without a key but remote destinations require credentials and safe URLs',()=>{
 const local=buildLanguageRequest(messages,{...base,apiKey:'',baseUrl:'http://localhost:11434/v1'});
 assert.equal(local.headers.Authorization,undefined);
 assert.doesNotThrow(()=>buildLanguageRequest(messages,{...base,apiKey:'',baseUrl:'http://[::1]:11434/v1'}));
 assert.throws(()=>buildLanguageRequest(messages,{...base,apiKey:''}),/API 密钥/);
 for(const baseUrl of ['http://remote.example/v1','https://name:secret@remote.example/v1','https://remote.example/v1?key=secret','file:///tmp/model'])assert.throws(()=>buildLanguageRequest(messages,{...base,baseUrl}),/API 地址/);
});

void test('responses discard hidden thought parts, reject truncated/refused output and require JSON objects',()=>{
 assert.equal(languageResponseText({choices:[{message:{content:'<think>internal</think>\n{"ok":true}'},finish_reason:'stop'}]},'openai'),'{"ok":true}');
 assert.equal(languageResponseText({content:[{type:'thinking',thinking:'private'},{type:'text',text:'{"ok":true}'}],stop_reason:'end_turn'},'anthropic'),'{"ok":true}');
 assert.equal(languageResponseText({candidates:[{content:{parts:[{thought:true,text:'private'},{text:'{"ok":true}'}]},finishReason:'STOP'}]},'gemini'),'{"ok":true}');
 for(const [protocol,payload] of [
  ['openai',{choices:[{message:{content:'{}'},finish_reason:'length'}]}],
  ['anthropic',{content:[{type:'text',text:'{}'}],stop_reason:'max_tokens'}],
  ['gemini',{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{}'}]}}]}],
 ] as const)assert.throws(()=>languageResponseText(payload,protocol),(e:unknown)=>e instanceof LanguageProviderError&&e.code==='truncated');
 assert.throws(()=>languageResponseText({promptFeedback:{blockReason:'SAFETY'}},'gemini'),/拒绝或内容拦截/);
 assert.throws(()=>languageResponseText({choices:[{message:{refusal:'no'}}]},'openai'),/拒绝或内容拦截/);
 assert.deepEqual(parseLanguageJSON('```json\n{"ok":true}\n```'),{ok:true});
 for(const text of ['[]','null','{"broken":'])assert.throws(()=>parseLanguageJSON(text),/JSON 对象/);
});

void test('transport sends one request, preserves role overrides and does not echo keys from errors',async t=>{
 const names=['STUDIO_DATA_DIR','LLM_PROVIDER','LLM_PROTOCOL','LLM_BASE_URL','LLM_MODEL','LLM_API_KEY','LLM_MAX_TOKENS','LLM_JSON_MODE','LLM_WORKSPACE_ID'] as const;
 const before=names.map(n=>process.env[n]);const originalFetch=globalThis.fetch;
 t.after(()=>{globalThis.fetch=originalFetch;names.forEach((n,i)=>{if(before[i]===undefined)delete process.env[n];else process.env[n]=before[i];});});
 names.forEach(n=>delete process.env[n]);process.env.STUDIO_DATA_DIR=mkdtempSync(path.join(tmpdir(),'frame-language-'));
 let settings=saveSettings({revision:0,values:{LLM_PROVIDER:'anthropic',LLM_MODEL:'main-model',LLM_API_KEY:'secret-never-return'}});
 assert.equal(languageReady(),true);
 let calls=0;
 globalThis.fetch=async(url,init)=>{calls++;assert.equal(typeof url==='string'?url:url instanceof URL?url.href:url.url,'https://api.anthropic.com/v1/messages');assert.equal(typeof init?.body,'string');const body=JSON.parse(init?.body as string);assert.equal(body.model,'director-model');assert.equal(init?.redirect,'error');return Response.json({content:[{type:'text',text:'{"ok":true}'}],stop_reason:'end_turn'});};
 assert.equal(await languageText(messages,{model:'director-model'}),'{"ok":true}');assert.equal(calls,1);
 globalThis.fetch=async()=>{calls++;return Response.json({error:{message:'secret-never-return private debug'}},{status:429});};
 await assert.rejects(()=>languageText(messages),e=>e instanceof LanguageProviderError&&e.code==='rate_limit'&&!e.message.includes('secret-never-return'));
 assert.equal(calls,2);
 settings=saveSettings({revision:settings.revision,values:{LLM_PROVIDER:'ollama',LLM_BASE_URL:'http://localhost:11434/v1',LLM_PROTOCOL:'openai'},clearSecrets:['LLM_API_KEY']});
 assert.equal(languageReady(),true);assert.equal(settings.secrets.LLM_API_KEY,false);
});
