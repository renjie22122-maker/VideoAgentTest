import { usableAssets, requireReadyAssets } from './asset-policy.ts';
import { ASSET_PROMPT_VERSION, compileAssetDesign } from './asset-design.ts';
import { assetViews, isDesignBoard } from './asset-views.ts';
import { randomUUID } from 'node:crypto';
import type { Asset, Project } from './types.ts';
import { submitFal, pollFal } from './fal.ts';
import { text } from './domain.ts';
export function assetInventory(p:Project):Asset[]{
 const g=p.production!,b=g.assets!.bible;
 const characters=g.script?.characters?.length?g.script.characters.map(c=>({name:c.name,kind:'character' as const,detail:c.description})):[{name:'主要人物',kind:'character' as const,detail:b.character+'；'+b.appearance}];
 const locations=g.script?.scenes?.length?Array.from(new Set(g.script.scenes.map(s=>s.location))):[b.location];
 const props=b.props.split(/[，,；;、\n]+/).map(v=>v.trim()).filter(v=>v&&!/^(裤兜|口袋|教室窗户|窗户|暴雨|雨水|雨声|操场积水|积水|灯光|雷声)$/.test(v));
 const items:{name:string;kind:Asset['kind'];detail:string}[]=[...characters,...locations.map(location=>({name:location,kind:'background' as const,detail:location})),...props.map(prop=>({name:prop,kind:'prop' as const,detail:prop}))];
 return items.map(item=>({id:randomUUID(),name:item.name,kind:item.kind,prompt:isolatedAssetPrompt(item.kind,item.name,item.detail,b),referenceIds:[],version:1,approved:false,status:'draft',createdAt:Date.now()}));
}
export function isolatedAssetPrompt(kind:Asset['kind'],name:string,detail:string,b:NonNullable<NonNullable<Project['production']>['assets']>['bible']){
 return compileAssetDesign(kind,name,{description:detail,renderStyle:/动画|三维/.test(b.style)?'animation':/插画|绘画/.test(b.style)?'illustration':'photographic',colors:[],lighting:kind==='background'?'自然光与空间固定灯具，不进行角色布光':'中性摄影棚柔光'});
}
export function rebuildAsset(p:Project,id:unknown):Asset{
 const library=p.production?.library??[],source=library.find(a=>a.id===id);if(!source||source.retired||source.kind==='variant')throw new Error('请选择当前人物、场景或道具主图。');
 if(source.design)return {...source,origin:undefined,uploadedFilename:undefined,setReview:undefined,id:randomUUID(),prompt:compileAssetDesign(source.kind,source.name,source.design),promptVersion:ASSET_PROMPT_VERSION,parentId:source.parentId??source.id,version:source.version+1,approved:false,status:'draft',url:undefined,remoteId:undefined,error:undefined,createdAt:Date.now()};
 const candidate=assetInventory(p).find(a=>a.kind===source.kind&&a.name===source.name);if(!candidate)throw new Error('该资产需从最新设定重新建立清单。');
 return {...candidate,parentId:source.parentId??source.id,version:Math.max(...library.filter(a=>a.id===(source.parentId??source.id)||a.parentId===(source.parentId??source.id)).map(a=>a.version))+1};
}
export function approvedAssets(p:Project,shotId?:string){return usableAssets(p,shotId);}
export function assetReferences(p:Project,shotId?:string){return approvedAssets(p,shotId).map(a=>a.url!);}
export function requireAssetMasters(p:Project,shotId?:string){requireReadyAssets(p,shotId?[shotId]:undefined);}
export function variant(p:Project,id:unknown,notes:unknown,ids:unknown){
 const parent=p.production!.library!.find(a=>a.id===id);if(!parent?.approved||!parent.url)throw new Error('请先确认原始资产图。');
 if(!Array.isArray(ids)||ids.length>9||ids.some(v=>typeof v!=='string'))throw new Error('参考资产选择无效。');
 const refs=Array.from(new Set([parent.id,...ids]));if(refs.some(id=>!p.production!.library!.some(a=>a.id===id&&a.approved&&!a.retired&&a.status==='ready'&&a.url)))throw new Error('只能引用已确认的资产。');
 const note=text(notes,'修改要求',3000);
 return {...parent,origin:undefined,uploadedFilename:undefined,setReview:undefined,id:randomUUID(),name:parent.name+' · 修改版',kind:'variant' as const,parentId:parent.parentId??parent.id,version:Math.max(...p.production!.library!.filter(a=>a.id===parent.id||a.parentId===(parent.parentId??parent.id)).map(a=>a.version))+1,prompt:JSON.stringify({任务:isDesignBoard(parent)?'单张多面板资产设定板':'单张资产修改',基础设计:parent.design??null,参考图:refs.map((id,index)=>({顺序:index+1,资产ID:id})),修改要求:note,保持要求:'图 1 为主要资产，保持未要求变化的身份、材质和配色',输出要求:isDesignBoard(parent)?'保持参考设定板的多面板布局，在一张图内更新对应设计；原基准与探索方案分区。':'单张单视角画面，不要拼贴；只修改所选视角'},null,2),referenceIds:refs,approved:false,status:'draft' as const,url:undefined,remoteId:undefined,error:undefined,createdAt:Date.now()};
}
export async function startAsset(p:Project,a:Asset){
 if(p.mode==='live'&&a.promptVersion!==ASSET_PROMPT_VERSION)throw new Error('这是旧版资产提示词，请先点击重新分析资产设计，避免继续生成混合画面。');
 if(p.mode==='demo'){a.status='ready';a.url=undefined;a.error='演示仅展示资产流程，不生成真实图片。';return;}
 const refs=a.referenceIds.map(id=>{const ref=p.production?.library?.find(v=>v.id===id&&v.approved&&!v.retired&&v.status==='ready');if(!ref?.url)throw new Error('引用的资产已失效，请重新选择。');return ref.url;});
 const result=await submitFal(a.prompt,refs,refs.length>1);a.remoteId=result.remoteId;a.model=result.model;a.origin='generated';a.uploadedFilename=undefined;
}
export async function updateAsset(a:Asset){if(!a.remoteId)throw new Error('上次提交结果不明，已阻止自动重复提交。请核查 fal 记录；新建修改版会产生新请求。');const result=await pollFal(a.remoteId);if(result.status==='succeeded'){a.status='ready';a.url=result.outputUrl;}else if(result.status==='failed'){a.status='failed';a.error=result.error;}}

export function createAssetViews(p:Project,id:unknown):Asset[]{
 const library=p.production?.library??[],source=library.find(a=>a.id===id);
 if(!source?.approved||!source.url||!source.design||source.viewId||source.retired)throw new Error('请先确认新版独立主图，再建立多视角。');
 source.setReview=undefined;
 const root=source.parentId??source.id;const kind=library.find(a=>a.id===root)?.kind??source.kind;if(kind==='variant')throw new Error('缺少来源主图类型。');
 return assetViews[kind].filter(view=>!library.some(a=>!a.retired&&a.sourceAssetId===source.id&&a.viewId===view.id)).map(view=>({...source,origin:undefined,uploadedFilename:undefined,id:randomUUID(),kind:'variant' as const,name:source.name+' · '+view.label,parentId:root,sourceAssetId:source.id,viewId:view.id,referenceIds:[source.id],prompt:JSON.stringify({...JSON.parse(compileAssetDesign(kind,source.name,source.design!)),任务:'主图派生单一视角',版面设计:undefined,一致性要求:undefined,视角:view.instruction,参考图:[{顺序:1,资产ID:source.id,版本:source.version}],保持要求:'保持输入主图的实体身份、比例、材质和颜色；视角要求优先于主图构图',输出要求:'只输出当前视角的一张图，禁止拼图'},null,2),version:1,approved:false,status:'draft' as const,url:undefined,remoteId:undefined,error:undefined,model:undefined,createdAt:Date.now()}));
}

export function createCostumeSet(p:Project,id:unknown,notes:unknown):Asset{
 const source=p.production?.library?.find(a=>a.id===id),root=p.production?.library?.find(a=>a.id===(source?.parentId??source?.id));
 if(!source?.approved||!source.url||!source.design||source.viewId||root?.kind!=='character')throw new Error('请先确认人物主图，再建立服装分套。');
 const description=text(notes,'服装方案',1200),next=variant(p,id,'只改变服装：'+description+'。保持脸型、发型、身材，白底或灰底；以新服装更新主体区三视图与服装细节区。',[]);
 return {...next,kind:'character',parentId:undefined,costumeOf:source.costumeOf??root.id,setName:description.slice(0,40),name:root.name+' · '+description.slice(0,24),setReview:undefined,design:{...source.design,description:source.design.description+'\n新服装方案（替代原服装描述）：'+description}};
}
export function createPropState(p:Project,id:unknown,notes:unknown):Asset{
 const source=p.production?.library?.find(a=>a.id===id),root=p.production?.library?.find(a=>a.id===(source?.parentId??source?.id));
 if(!source?.approved||!source.url||root?.kind!=='prop'||source.viewId)throw new Error('请先确认道具主图。');
 const state=text(notes,'道具状态与结构依据',800),next=variant(p,id,'只展示此道具的状态：'+state+'。单物体白底或灰底，不出现手或其它主体；不可添加不具备的机械结构。',[]);
 return {...next,viewId:'state-'+randomUUID(),sourceAssetId:source.id,name:root.name+' · '+state.slice(0,24)};
}
export function reviewAssetSet(p:Project,id:unknown,notes:unknown){
 const source=p.production?.library?.find(a=>a.id===id);if(!source?.approved||source.retired)throw new Error('请先确认主图。');
 const kind=p.production!.library!.find(a=>a.id===(source.parentId??source.id))?.kind??source.kind;if(kind==='variant')throw new Error('缺少资产类型。');
 const views=p.production!.library!.filter(a=>!a.retired&&a.sourceAssetId===source.id&&a.viewId);
 if(!isDesignBoard(source)&&assetViews[kind].some(v=>!views.some(a=>a.viewId===v.id)))throw new Error('请先补齐完整的标准设定图清单。');
 if(source.status!=='ready'||!source.url||(!isDesignBoard(source)&&!views.length)||views.some(a=>!a.approved||a.status!=='ready'||!a.url))throw new Error('请先生成并逐张确认这套设定图。');
 source.setReview={at:Date.now(),notes:text(notes,'一致性审核意见',1500),viewIds:views.map(a=>a.id)};
}

export function requireAssetSets(p:Project,shotId?:string){requireAssetMasters(p,shotId); }
export function selectCostume(p:Project,id:unknown){
 const source=p.production?.library?.find(a=>a.id===id),root=p.production?.library?.find(a=>a.id===(source?.parentId??source?.id));
 if(!source?.approved||source.status!=='ready'||!source.url||root?.kind!=='character')throw new Error('请先确认此套服装的主图。');
 (p.production!.costumeSelections??={})[root.costumeOf??root.id]=root.id;
}
