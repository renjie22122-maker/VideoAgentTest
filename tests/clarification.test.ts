import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { demoClarification, validateClarification } from '../lib/studio/clarification.ts';
import { skillCatalog } from '../lib/studio/skills.ts';
import type { Project } from '../lib/studio/types.ts';
function fixture(idea:string):Project{return {id:'test',idea,title:'test',revision:1,createdAt:0,updatedAt:0,duration:30,ratio:'16:9',mode:'demo',phase:'clarify',questions:[],answers:{},jobs:[]};}
void test('different creative ideas lead to different relevant demo questions',()=>{
 const letter=demoClarification(fixture('女孩在车站找到一封信，结尾微笑，无对白'),[]);const ad=demoClarification(fixture('咖啡产品广告，最后展示品牌，无对白'),[]);
 assert.equal(letter.questions[0].id,'letter_meaning');assert.equal(ad.questions[0].id,'product_message');assert.ok(!letter.questions.some(q=>q.id==='voice'||q.id==='ending'));
 assert.equal(skillCatalog().length,9);assert.ok(skillCatalog().every(s=>s.instructions.length>100));
});
void test('clarification validator rejects fabricated evidence and inconsistent readiness',()=>{
 const p=fixture('女孩在车站找到一封信');const raw={summary:'女孩找到信',known:[{topic:'人物',value:'女孩',evidence:'女孩'}],assumptions:[],ready:true,questions:[]};
 assert.equal(validateClarification(raw,p,[]).brief.ready,true);
 assert.throws(()=>validateClarification({...raw,known:[{topic:'人物',value:'男孩',evidence:'男孩'}]},p,[]),/依据/);
 assert.throws(()=>validateClarification({...raw,ready:false},p,[]),/就绪状态/);
});
void test('live clarification carries answers into targeted followups and caps analysis rounds',async t=>{
 const config={STUDIO_DATA_DIR:mkdtempSync(path.join(tmpdir(),'frame-brief-')),LLM_BASE_URL:'https://llm.example',LLM_API_KEY:'test',LLM_MODEL:'model'};const previous=Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]));Object.assign(process.env,config);t.after(()=>{for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 let calls=0;const inputs:Record<string,unknown>[]=[];
 t.mock.method(globalThis,'fetch',async (_url:URL,options:RequestInit)=>{const request=JSON.parse(options.body as string);inputs.push(JSON.parse(request.messages[1].content));calls++;const id=['letter_origin','mother_presence','ending_meaning'][calls-1];const labels=['这封信是谁留下的？','你说信来自妈妈，妈妈在故事当下是否在场？','结尾是告别，还是准备重逢？'];return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({summary:'围绕车站的信展开故事',known:[{topic:'地点',value:'车站',evidence:'车站'}],assumptions:[],questions:[{id,label:labels[calls-1],why:'影响故事因果和结尾',placeholder:'写下你的选择',options:[],required:true}],ready:false})}}]}));});
 const {dispatch}=await import('../lib/studio/server.ts');let p=await dispatch({action:'create',idea:'女孩在车站找到一封信',duration:30,ratio:'16:9',mode:'live'}) as Project;
 assert.equal(p.questions[0].id,'letter_origin');
 p=await dispatch({action:'clarify_answers',id:p.id,revision:p.revision,answers:{letter_origin:'妈妈留下的'}}) as Project;
 assert.equal(p.questions[0].id,'mother_presence');assert.match(JSON.stringify(inputs[1]),/妈妈留下的/);
 p=await dispatch({action:'clarify_answers',id:p.id,revision:p.revision,answers:{mother_presence:'妈妈已经离开车站'}}) as Project;
 await assert.rejects(()=>dispatch({action:'clarify_answers',id:p.id,revision:p.revision,answers:{ending_meaning:'告别'}}),/三轮/);assert.equal(calls,3);
 await assert.rejects(()=>dispatch({action:'plan',id:p.id,revision:p.revision}),/澄清/);
 p=await dispatch({action:'confirm_brief',id:p.id,revision:p.revision,answers:{ending_meaning:'告别'},notes:'不要旁白'}) as Project;
 assert.equal(p.brief!.ready,true);assert.equal(p.questions.length,0);assert.equal(p.answers.additional_requirements,'不要旁白');assert.equal(p.brief!.history.length,4);
});
