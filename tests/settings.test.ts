import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publicSettings, saveSettings, setting } from '../lib/studio/settings.ts';
import { capabilities } from '../lib/studio/providers.ts';

void test('API settings persist, redact keys, preserve blank keys and explicitly clear env fallback',t=>{
 const old=process.env.STUDIO_DATA_DIR,oldKey=process.env.LLM_API_KEY;
 const dir=mkdtempSync(path.join(tmpdir(),'frame-settings-'));process.env.STUDIO_DATA_DIR=dir;process.env.LLM_API_KEY='env-secret';
 t.after(()=>{if(old===undefined)delete process.env.STUDIO_DATA_DIR;else process.env.STUDIO_DATA_DIR=old;if(oldKey===undefined)delete process.env.LLM_API_KEY;else process.env.LLM_API_KEY=oldKey;});
 let view=publicSettings();assert.equal(view.secrets.LLM_API_KEY,true);assert.ok(!JSON.stringify(view).includes('env-secret'));
 view=saveSettings({revision:view.revision,values:{LLM_BASE_URL:'https://provider.example/v1/',LLM_API_KEY:'new-secret',LLM_MODEL:'test-model'}});
 assert.equal(view.values.LLM_BASE_URL,'https://provider.example/v1');assert.equal(setting('LLM_API_KEY'),'new-secret');assert.equal(capabilities().llm,true);assert.ok(!JSON.stringify(view).includes('new-secret'));
 view=saveSettings({revision:view.revision,values:{LLM_API_KEY:'',LLM_MODEL:'new-model'}});assert.equal(setting('LLM_API_KEY'),'new-secret');
 assert.throws(()=>saveSettings({revision:0,values:{}}),/其他窗口/);
 assert.throws(()=>saveSettings({revision:view.revision,values:{LLM_BASE_URL:'https://another.example'}}),/重新填写/);
 assert.throws(()=>saveSettings({revision:view.revision,values:{LLM_BASE_URL:'https://provider.example?key=secret'}}),/查询参数/);
 assert.throws(()=>saveSettings({revision:view.revision,values:{UNEXPECTED:'value'}}),/字段/);
 assert.throws(()=>saveSettings({revision:view.revision,values:{LLM_API_KEY:'bad\nkey'}}),/字段/);
 view=saveSettings({revision:view.revision,values:{},clearSecrets:['LLM_API_KEY']});assert.equal(setting('LLM_API_KEY'),'');assert.equal(view.secrets.LLM_API_KEY,false);assert.equal(capabilities().llm,false);
 const disk=JSON.parse(readFileSync(path.join(dir,'api-settings.json'),'utf8')) as {revision:number;values:Record<string,string>};assert.equal(disk.values.LLM_API_KEY,'');assert.equal(disk.revision,view.revision);
});
