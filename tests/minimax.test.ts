import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { roleJSON, languageOptions } from '../lib/studio/providers.ts';

void test('MiniMax separates reasoning, avoids unsupported JSON-mode assumption and parses fallback think blocks',async t=>{
 const config={STUDIO_DATA_DIR:mkdtempSync(path.join(tmpdir(),'frame-minimax-')),LLM_BASE_URL:'https://api.minimax.cn/v1',LLM_API_KEY:'test-only',LLM_MODEL:'MiniMax-M3'};
 const old=Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]));Object.assign(process.env,config);t.after(()=>{for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 t.mock.method(globalThis,'fetch',async (_url:URL,options:RequestInit)=>{assert.equal(typeof options.body,'string');const body=JSON.parse(options.body as string);assert.equal(body.reasoning_split,true);assert.equal(body.response_format,undefined);return new Response(JSON.stringify({choices:[{message:{content:'<think>internal draft</think>\n```json\n{"title":"测试"}\n```'}}]}));});
 assert.deepEqual(await roleJSON('编剧','输出标题',{}),{title:'测试'});
 assert.deepEqual(languageOptions('deepseek-v4-flash'),{response_format:{type:'json_object'}});
});
