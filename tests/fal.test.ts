import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { falRoute, falModels, submitFal } from '../lib/studio/fal.ts';
import { assetInventory, assetReferences, requireAssetMasters } from '../lib/studio/assets.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import { demoScreenplay } from '../lib/studio/screenplay.ts';
import { submitMedia } from '../lib/studio/providers.ts';
import type { Project } from '../lib/studio/types.ts';
void test('fal routing enforces model reference limits',()=>{
 assert.equal(falRoute([]),falModels.generate);assert.equal(falRoute(['a']),falModels.edit);assert.equal(falRoute(['a','b'],true),falModels.compose);assert.equal(falRoute(Array(5).fill('a')),falModels.compose);assert.throws(()=>falRoute(Array(11).fill('a')),/10/);
});
void test('asset approvals and versions feed actual fal composition, and invalidate downstream renders',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'frame-fal-')),config={STUDIO_DATA_DIR:dir,FAL_API_KEY:'dummy-fal',IMAGE_PROVIDER:'fal',LLM_BASE_URL:'https://llm.example',LLM_API_KEY:'dummy-llm',LLM_MODEL:'test'};
 const previous=Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]));Object.assign(process.env,config);t.after(()=>{for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const p:Project={id:'project',revision:1,idea:'女孩在车站找到信',title:'信',createdAt:0,updatedAt:0,duration:12,ratio:'16:9',mode:'live',phase:'planned',questions:[],answers:{},jobs:[],production:initialProduction()};
 p.plan=demoPlan(p);p.production!.script=demoScreenplay(p);p.production!.assets={bible:p.plan.bible,seed:42,locked:true};p.production!.node='storyboard';
 await writeFile(path.join(dir,'projects.json'),JSON.stringify([p]));
 let posts=0;const inputs:{url:string;body:{image_urls?:string[]}}[]=[];
 t.mock.method(globalThis,'fetch',async(url:unknown,init:RequestInit)=>{
  if(String(url).includes('llm.example'))return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({assets:[...(p.production!.script!.characters??[]).map(c=>({kind:'character',name:c.name,evidence:c.name,description:'黑色短发，蓝色制服，身材修长',renderStyle:'photographic',colors:[],lighting:''})),...(p.production!.script!.scenes??[]).map(c=>({kind:'background',name:c.location,evidence:c.location,description:'无人建筑，门窗与座椅结构清晰',renderStyle:'photographic',colors:[],lighting:'顶部日光灯，冷色温'}))]})}}]}));
  assert.equal((init.headers as Record<string,string>).Authorization,'Key dummy-fal');
  if(init.method==='POST'){posts++;inputs.push({url:String(url),body:JSON.parse(init.body as string)});return new Response(JSON.stringify({request_id:String(posts),status_url:'https://queue.fal.run/task/'+posts+'/status',response_url:'https://queue.fal.run/task/'+posts+'/result'}));}
  if(String(url).endsWith('/status'))return new Response(JSON.stringify({status:'COMPLETED'}));
  return new Response(JSON.stringify({images:[{url:'https://v3.fal.media/test/'+String(url).split('/').at(-2)+'.png'}]}));
 });
 const {dispatch}=await import('../lib/studio/server.ts');let current=await dispatch({action:'asset_inventory',id:p.id,revision:1}) as Project;
 assert.throws(()=>requireAssetMasters(current),/确认|资产库/);
 for(const a of current.production!.library!){
  current=await dispatch({action:'asset_generate',id:p.id,revision:current.revision,assetId:a.id}) as Project;
  await assert.rejects(dispatch({action:'asset_save_bible',id:p.id,revision:current.revision,bible:p.plan.bible}),/正在生成/);
  current=await dispatch({action:'asset_poll',id:p.id,revision:current.revision,assetId:a.id}) as Project;
  current=await dispatch({action:'asset_approve',id:p.id,revision:current.revision,assetId:a.id}) as Project;
 }
 requireAssetMasters(current);assert.ok(assetReferences(current).length>=2);
 const parent=current.production!.library![0];
 current=await dispatch({action:'asset_views',id:p.id,revision:current.revision,assetId:parent.id}) as Project;
 const views=current.production!.library!.filter(a=>a.viewId);assert.equal(views.length,9);assert.equal(new Set(views.map(a=>a.id)).size,9);assert.ok(views.every(a=>a.referenceIds[0]===parent.id));
 current=await dispatch({action:'asset_generate',id:p.id,revision:current.revision,assetId:views[0].id}) as Project;
 current=await dispatch({action:'asset_poll',id:p.id,revision:current.revision,assetId:views[0].id}) as Project;
 const original=current.production!.library!.find(a=>a.id===views[0].id)!;
 assert.equal(original.approved,false);
 const beforeRegenerate=posts;
 current=await dispatch({action:'asset_regenerate',id:p.id,revision:current.revision,assetId:original.id}) as Project;
 const regenerated=current.production!.library!.at(-1)!;
 assert.notEqual(regenerated.id,original.id);assert.equal(regenerated.approved,false);assert.equal(regenerated.status,'running');
 assert.equal(regenerated.viewId,original.viewId);assert.equal(regenerated.sourceAssetId,parent.id);
 assert.deepEqual(inputs.at(-1)!.body.image_urls,[parent.url]);assert.equal(posts,beforeRegenerate+1);
 assert.deepEqual(current.production!.library!.find(a=>a.id===original.id),original);
 await assert.rejects(dispatch({action:'asset_regenerate',id:p.id,revision:current.revision,assetId:original.id}),/正在生成/);
 assert.equal(posts,beforeRegenerate+1);
 current=await dispatch({action:'asset_poll',id:p.id,revision:current.revision,assetId:regenerated.id}) as Project;
 assert.equal(current.production!.library!.at(-1)!.status,'ready');assert.equal(current.production!.library!.at(-1)!.approved,false);
 current=await dispatch({action:'asset_approve',id:p.id,revision:current.revision,assetId:views[0].id}) as Project;
 assert.equal(current.production!.library!.find(a=>a.id===parent.id)!.approved,true);
 assert.ok(!assetReferences(current).includes(current.production!.library!.find(a=>a.id===views[0].id)!.url!));

 current=await dispatch({action:'asset_variant',id:p.id,revision:current.revision,assetId:parent.id,notes:'保持身份，制作三视图',referenceIds:[]}) as Project;
 const candidate=current.production!.library!.at(-1)!;assert.equal(candidate.parentId,parent.id);assert.equal(candidate.approved,false);assert.ok(assetReferences(current).includes(parent.url!));
 current=await dispatch({action:'asset_generate',id:p.id,revision:current.revision,assetId:candidate.id}) as Project;
 assert.equal(inputs.at(-1)!.url,'https://queue.fal.run/'+falModels.edit);assert.deepEqual(inputs.at(-1)!.body.image_urls,[parent.url]);
 current=await dispatch({action:'asset_poll',id:p.id,revision:current.revision,assetId:candidate.id}) as Project;
 current=await dispatch({action:'asset_approve',id:p.id,revision:current.revision,assetId:candidate.id}) as Project;
 assert.equal(current.production!.library![0].approved,false);assert.equal(current.production!.renderApprovedRevision,undefined);
 await submitMedia(current,{id:'job',kind:'image',shotId:current.plan!.shots[0].id,status:'running',revision:current.revision,createdAt:0,mode:'live'});
 assert.equal(inputs.at(-1)!.url,'https://queue.fal.run/'+falModels.compose);assert.ok(inputs.at(-1)!.body.image_urls?.length);
 // Provider-returned tracking URLs cannot exfiltrate the fal key.
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({request_id:'x',status_url:'https://evil.example/status',response_url:'https://queue.fal.run/result'})));
 await assert.rejects(submitFal('test',[]),/不可信/);
});

void test('asset prompts isolate subjects and split props instead of sending a full scene bible',()=>{
 const p:Project={id:'isolated',revision:1,idea:'test',title:'test',createdAt:0,updatedAt:0,duration:12,ratio:'16:9',mode:'demo',phase:'planned',questions:[],answers:{},jobs:[],production:initialProduction()};
 p.production!.assets={seed:42,locked:false,bible:{character:'楚子航',appearance:'黑发、蓝色校服',location:'暴雨中的空荡教室',props:'翻盖手机，银色钥匙，裤兜，教室窗户，暴雨，操场积水',lighting:'背后顶灯',palette:'低饱和冷色',style:'写实电影',negative:'避免换脸'}};
 const assets=assetInventory(p),character=assets.find(a=>a.kind==='character')!,background=assets.find(a=>a.kind==='background')!,props=assets.filter(a=>a.kind==='prop');
 assert.match(character.prompt,/楚子航/);assert.ok(!character.prompt.includes('空荡教室'));assert.ok(!character.prompt.includes('翻盖手机'));
 assert.match(background.prompt,/空荡教室/);assert.ok(!background.prompt.includes('楚子航'));assert.ok(!background.prompt.includes('蓝色校服'));
 assert.deepEqual(props.map(a=>a.name),['翻盖手机','银色钥匙']);assert.ok(!props[0].prompt.includes('银色钥匙'));assert.ok(!props[0].prompt.includes('楚子航'));
 assert.ok(assets.every(a=>!a.prompt.includes('bible')&&!a.prompt.includes('FLUX')));
});
