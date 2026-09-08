import test from 'node:test';
import assert from 'node:assert/strict';
import { demoScreenplay, validateScreenplay, screenplayText, screenplayWarnings } from '../lib/studio/screenplay.ts';
import { generatePlan } from '../lib/studio/providers.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import type { Project } from '../lib/studio/types.ts';
function fixture():Project{return {id:'script-fixture',revision:1,title:'信',idea:'主角读完信离开',duration:24,ratio:'16:9',mode:'demo',phase:'clarify',questions:[],answers:{subject:'短发女孩',location:'车站',ending:'收好信离开',tone:'无对白'},jobs:[],createdAt:0,updatedAt:0,production:initialProduction()};}
void test('screenplay schema rejects missing structure, invalid cast references and wrong timing',()=>{
 const p=fixture(),s=demoScreenplay(p);assert.equal(validateScreenplay(s,24).scenes.length,1);
 assert.throws(()=>validateScreenplay({title:'信',logline:'故事',synopsis:'正文'},24),/结构化/);
 assert.throws(()=>validateScreenplay({...s,scenes:[{...s.scenes[0],duration:20}]},24),/时长/);
 assert.throws(()=>validateScreenplay({...s,scenes:[{...s.scenes[0],characters:['missing']}]},24),/未定义/);
 assert.throws(()=>validateScreenplay({...s,scenes:[{...s.scenes[0],dialogue:[{characterId:'missing',delivery:'',line:'你好'}]}]},24),/对白人物/);
 assert.match(screenplayText(s),/EXT\. 车站/);assert.ok(screenplayWarnings(s,24).some(v=>v.includes('占位')));
 s.scenes[0].action=['女孩打开信。','女孩离开。'];s.scenes[0].dialogue=[{characterId:'character-1',delivery:'轻声',line:'我知道了。',afterAction:0}];const formatted=screenplayText(validateScreenplay(s,24));assert.ok(formatted.indexOf('我知道了。')<formatted.indexOf('女孩离开。'));
});
void test('demo director honors separate approved scenes, action and per-scene timing',async()=>{
 const p=fixture(),s=demoScreenplay(p);s.scenes=[{...s.scenes[0],duration:12},{...s.scenes[0],id:'scene-2',duration:12,location:'家中',action:['女孩把信放在桌上。'],endState:'信留在桌上。'}];p.production!.script=s;
 const plan=await generatePlan(p);assert.equal(plan.shots.filter(s=>s.scene==='scene-1').reduce((n,s)=>n+s.duration,0),12);assert.equal(plan.shots.filter(s=>s.scene==='scene-2').reduce((n,s)=>n+s.duration,0),12);assert.equal(plan.shots.at(-1)!.endState.pose,'信留在桌上。');assert.equal(plan.shots.at(-1)!.description,'女孩把信放在桌上。');
});
