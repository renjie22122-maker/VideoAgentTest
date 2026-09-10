import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssetViews, createCostumeSet, createPropState, reviewAssetSet, selectCostume, approvedAssets, requireAssetSets } from '../lib/studio/assets.ts';
import { validateAssetDesigns, compileAssetDesign } from '../lib/studio/asset-design.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import type { Project } from '../lib/studio/types.ts';
void test('one multi-panel board can be reviewed without separate views',()=>{
 const p:Project={id:'board',revision:1,idea:'test',title:'test',createdAt:0,updatedAt:0,duration:12,ratio:'16:9',mode:'live',phase:'planned',questions:[],answers:{},jobs:[],production:initialProduction()};
 const design={description:'黑发校服',renderStyle:'photographic' as const,colors:[],lighting:''};
 for(const kind of ['character','background','prop'] as const){
  const prompt=compileAssetDesign(kind,'asset',design),spec=JSON.parse(prompt);
  assert.equal(spec.任务,'单张多面板资产设定板');assert.ok(spec.版面设计.length>=3);assert.ok(!prompt.includes('仅一张单视角'));
  const a={id:kind,name:kind,kind,design,prompt,referenceIds:[],version:1,approved:true,status:'ready' as const,url:'https://example.com/board.png',createdAt:0};
  p.production!.library=[a];reviewAssetSet(p,a.id,'核对同一资产各视角和细节，基准造型明确');requireAssetSets(p);
 }
});
void test('optional detail reviews do not block approved masters; costumes and prop states stay separate',()=>{
 const p:Project={id:'sets',revision:1,idea:'test',title:'test',createdAt:0,updatedAt:0,duration:12,ratio:'16:9',mode:'live',phase:'planned',questions:[],answers:{},jobs:[],production:initialProduction()};
 p.production!.script={title:'test',logline:'人物与手机',synopsis:'楚子航在教室使用手机'};
 const assets=validateAssetDesigns({assets:['character','background','prop'].map((kind,i)=>({kind,name:['楚子航','教室','手机'][i],evidence:['楚子航','教室','手机'][i],description:['黑发，白色衬衣','无人空间，固定门窗','黑色翻盖手机'][i],renderStyle:'photographic',colors:[],lighting:'固定顶部灯光'}))},p);
 p.production!.library=assets;assets.forEach(a=>{a.approved=true;a.status='ready';a.url='https://example.com/'+a.id+'.png';});
 assert.doesNotThrow(()=>requireAssetSets(p));
 assets.slice().forEach((source,i)=>{const views=createAssetViews(p,source.id);assert.equal(views.length,[9,6,5][i]);p.production!.library!.push(...views);assert.throws(()=>reviewAssetSet(p,source.id,'checked'),/逐张确认/);views.forEach(v=>{v.status='ready';v.approved=true;v.url='https://example.com/'+v.id+'.png';});reviewAssetSet(p,source.id,'核对各方向结构与材质一致。');});
 requireAssetSets(p);
 const costume=createCostumeSet(p,assets[0].id,'黑色夹克与白色内搭');p.production!.library!.push(costume);costume.status='ready';costume.approved=true;costume.url='https://example.com/costume.png';
 assert.ok(!approvedAssets(p).includes(costume));selectCostume(p,costume.id);assert.ok(approvedAssets(p).includes(costume));
 const costumeViews=createAssetViews(p,costume.id);p.production!.library!.push(...costumeViews);costumeViews.forEach(v=>{v.status='ready';v.approved=true;v.url='https://example.com/'+v.id+'.png';});reviewAssetSet(p,costume.id,'同一人物，新服装各方向一致');selectCostume(p,costume.id);
 assert.ok(approvedAssets(p).includes(costume));assert.ok(!approvedAssets(p).includes(assets[0]));
 const state=createPropState(p,assets[2].id,'翻盖完全打开，保持铰链与按键结构');assert.equal(state.sourceAssetId,assets[2].id);assert.match(state.viewId!,/^state-/);assert.deepEqual(state.referenceIds,[assets[2].id]);
});
