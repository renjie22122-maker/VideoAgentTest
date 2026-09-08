import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeClarification, demoClarification, validateClarification } from '../lib/studio/clarification.ts';
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
 assert.equal(validateClarification({...raw,known:[{topic:'片长',value:'30 秒',evidence:'30 秒'},{topic:'画幅',value:'16:9',evidence:'16:9'}]},p,[]).brief.known.length,2);
 assert.throws(()=>validateClarification({...raw,known:[{topic:'场景',value:'车站',evidence:'女孩在车站…信'}]},p,[]),/连续原文/);
 assert.throws(()=>validateClarification({...raw,known:[{topic:'人物',value:'男孩',evidence:'男孩'}]},p,[]),/依据/);
 assert.throws(()=>validateClarification({...raw,ready:false},p,[]),/就绪状态/);
});
void test('open questions tolerate omitted fields; optional questions become suggestions',()=>{
 const p=fixture('女孩在车站找到一封信');const q={id:'origin',label:'信是谁写的？',why:'影响人物关系'};
 const raw={summary:'女孩找到信',known:[],assumptions:[],ready:false,questions:[q]};
 const open=validateClarification(raw,p,[]);assert.deepEqual(open.questions[0].options,[]);assert.equal(open.questions[0].required,true);
 assert.equal(validateClarification({...raw,questions:[{...q,options:null,required:'true'}]},p,[]).questions.length,1);
 const optional=validateClarification({...raw,questions:[{...q,required:false}]},p,[]);assert.equal(optional.brief.ready,true);assert.equal(optional.questions.length,0);assert.match(optional.brief.assumptions[0],/信是谁写的/);
 assert.equal(validateClarification({...raw,questions:[{...q,options:['甲','乙','丙','丁']}]},p,[]).questions[0].options!.length,4);
 assert.throws(()=>validateClarification({...raw,questions:[{...q,options:{a:'甲'}}]},p,[]),/第 1.*options/);
 assert.throws(()=>validateClarification({...raw,questions:[{...q,required:'maybe'}]},p,[]),/required/);
 assert.throws(()=>validateClarification({...raw,ready:true},p,[]),/就绪状态/);
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
 let repairCalls=0,alwaysBad=false;
 const before=structuredClone(p);
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{
  repairCalls++;const body=JSON.parse(init.body as string),input=JSON.parse(body.messages[1].content);
  assert.ok(input.citationSources.some((v:{id:string})=>v.id==='duration'));
  if(repairCalls%2===0)assert.match(input.validationError,/第 1 项事实依据/);
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({summary:'女孩在车站',known:[{topic:'场景',value:'车站',evidence:alwaysBad||repairCalls%2===1?'不存在的引用':'车站'}],assumptions:[],questions:[],ready:true})}}]}));
 });
 const analyzed=await analyzeClarification(p);assert.equal(repairCalls,2);assert.equal(analyzed.brief.known[0].evidence,'车站');assert.equal(analyzed.brief.round,p.brief!.round+1);assert.deepEqual(p,before);
 alwaysBad=true;await assert.rejects(analyzeClarification(p),/自动修正一次.*第 1 项/);assert.equal(repairCalls,4);assert.deepEqual(p,before);

});
