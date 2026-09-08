import { autoStep } from './autopilot.ts';
import { resolveDuration } from './duration.ts';
import { MOTION_SCHEMA, validateMotion } from './motion.ts';
import { runTeamReview } from './team-runtime.ts';
import { validateAgentConfig } from './team-config.ts';
import { saveAssetUpload } from './asset-upload.ts';
import { validateAssetDesigns } from './asset-design.ts';
import { createAssetViews, createCostumeSet, createPropState, reviewAssetSet, requireAssetSets, selectCostume, rebuildAsset, variant, startAsset, updateAsset } from './assets.ts';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Project, Job, Shot } from './types.ts';
import { text, finite, validateShot, validatePlan, validateBible, checkContinuity, invalidateFrom } from './domain.ts';
import { roleJSON, capabilities, generatePlan, submitMedia, pollMedia, mediaInput, writeScript, designAssets, reviewMedia, continuitySkill, compilerSkill, editorSkill, planAssetLibrary } from './providers.ts';
import { initialProduction, transition, requireNode, reopenStoryboard } from './graph.ts';
import { publicSettings, saveSettings, setting } from './settings.ts';
import { validateScreenplay } from './screenplay.ts';
import { analyzeClarification } from './clarification.ts';
import { productionSkills, skillCatalog } from './skills.ts';
import { readImage } from './openai-images.ts';

const root=path.resolve(process.env.STUDIO_DATA_DIR||'.studio');
const file=path.join(root,'projects.json');
let mutating=false;
type Command={agentConfig?:unknown;roleId?:string;action?:string;id?:string;revision?:number;idea?:unknown;duration?:unknown;ratio?:Project['ratio'];mode?:Project['mode'];answers?:Record<string,unknown>;script?:Record<string,unknown>;seed?:unknown;bible?:unknown;shot?:Shot;kind?:'image'|'video';verdict?:'passed'|'rejected';shotId?:string;notes?:unknown;settings?:unknown;assetId?:unknown;referenceIds?:unknown;imageBase64?:unknown;filename?:unknown};
async function load():Promise<Project[]> {try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw new Error('项目存储无法读取，请检查 .studio/projects.json。');}}
async function save(data:Project[]){await mkdir(root,{recursive:true});const tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(data,null,2),'utf8');await rename(tmp,file);}
function bump(p:Project){p.updatedAt=Date.now();}
export async function dispatch(input:Command):Promise<unknown>{
  // Atomic file replacement lets readers see the last committed state during generation.
  if(['status','settings','skills','list','get','shot_image_prompt'].includes(input.action??''))return handle(input);
  if(mutating)throw new Error('工作台正在处理上一项操作，请等待完成后再提交。可重新打开作品查看已保存结果。');
  mutating=true;
  try{return await handle(input);}finally{mutating=false;}
}
async function handle(input:Command):Promise<unknown>{
  if(input.action==='status')return capabilities();
  if(input.action==='settings')return publicSettings();
  if(input.action==='skills')return skillCatalog();
  const all=await load();
  if(input.action==='save_settings'){
    if(all.some(p=>p.production?.library?.some(a=>a.status==='running')))throw new Error('请先完成资产生成，再更换 API 设置。');
    if(all.some(p=>p.mode==='live'&&p.jobs.some(j=>j.status==='queued'||j.status==='running')))throw new Error('请先完成或停止真实生成队列，再更换 API 设置。');
    return {settings:saveSettings(input.settings),capabilities:capabilities()};
  }
  if(input.action==='list')return all.map(({id,title,updatedAt,phase,mode})=>({id,title,updatedAt,phase,mode})).sort((a,b)=>b.updatedAt-a.updatedAt);
  if(input.action==='create'){
    const idea=text(input.idea,'创意',4000),timing=resolveDuration(input.duration,{idea,answers:{}}),duration=timing.seconds;
    if((input.ratio!=='16:9'&&input.ratio!=='9:16'&&input.ratio!=='1:1')||(input.mode!=='demo'&&input.mode!=='live'))throw new Error('画幅或模式无效。');
    const p:Project={durationMode:timing.mode,durationReason:timing.reason,id:randomUUID(),revision:1,idea,title:idea.slice(0,18),createdAt:Date.now(),updatedAt:Date.now(),duration,ratio:input.ratio,mode:input.mode,phase:'clarify',questions:[],answers:{},jobs:[]};
    p.production=initialProduction();p.production.skillVersions=Object.fromEntries(Object.entries(productionSkills).map(([id,s])=>[id,s.version]));const analysis=await analyzeClarification(p);p.brief=analysis.brief;p.questions=analysis.questions;all.push(p);await save(all);return p;
  }
  const p=all.find(p=>p.id===input.id);if(!p)throw new Error('项目不存在。');
  if(input.action==='shot_image_prompt'){
    if(!p.plan?.shots.some(s=>s.id===input.shotId))throw new Error('镜头不存在。');
    const j=newJob(p,input.shotId!,'image');
    const prepared=mediaInput(p,j) as {prompt:string;referenceImages:string[];model:string};
    return {prompt:prepared.prompt,referenceImages:prepared.referenceImages,model:prepared.model,compiled:!!p.production?.prompts?.some(v=>v.shotId===input.shotId)};
  }
  if(input.action==='get')return p;
  if(input.action!=='poll'&&input.action!=='cancel'&&input.revision!==p.revision)throw new Error('项目已在其他窗口更改，请重新打开项目后再编辑。');
  if(p.production?.autoRun?.status==='running'&&!['auto_start','auto_step','auto_stop'].includes(input.action??''))throw new Error('请先停止自动任务，再手动修改作品。');
  if(input.action==='shot_image_upload'){
    if(!p.plan||p.jobs.some(j=>['running','queued'].includes(j.status)))throw new Error('请先停止或等待生成队列，再上传分镜画面。');
    const i=p.plan.shots.findIndex(s=>s.id===input.shotId);if(i<0)throw new Error('镜头不存在。');
    const image=await saveAssetUpload(input.imageBase64);
    invalidateFrom(p,i);reopenStoryboard(p);
    const s=p.plan.shots[i];s.referenceUrl=image.url;s.referenceMode='live';s.referenceOrigin='upload';s.referenceFilename=typeof input.filename==='string'?input.filename.replace(/[\\/]/g,'_').slice(0,150):'本地图片';
    p.production!.events.push({at:Date.now(),node:'storyboard',role:'用户',message:'上传 '+s.id+' 分镜画面；本镜视频及后续素材失效，请重新检查并批准。'});
    bump(p);await save(all);return p;
  }
  if(input.action==='motion_plan'){
    if(!p.plan||p.jobs.some(j=>['running','queued'].includes(j.status)))throw new Error('请先生成分镜并等待当前队列结束。');
    const i=p.plan.shots.findIndex(s=>s.id===input.shotId);if(i<0)throw new Error('镜头不存在。');
    const notes=text(input.notes,'运动意图',2000),shot=p.plan.shots[i];
    if(p.mode==='demo')throw new Error('演示模式请使用手动运动程序；自然语言规划需要已配置语言模型。');
    const raw=await roleJSON('摄影 / 动作规划师',MOTION_SCHEMA+'只返回 {motion:上述结构}。遵守用户运动意图，不改写对白、剧情或时长；相机坐标沿用输入。',{shot,instruction:notes});
    const motion=validateMotion(raw.motion);p.plan.shots[i]={...shot,motion};invalidateFrom(p,i);reopenStoryboard(p);bump(p);await save(all);return p;
  }
  if(input.action==='duration_update'){
    if(p.jobs.some(j=>['running','queued'].includes(j.status))||p.production?.library?.some(a=>a.status==='running'))throw new Error('请先完成或停止生成任务，再修改时长。');
    const timing=resolveDuration(input.duration,p);const previous=p.production!;
    if(previous.script)(previous.scriptHistory??=[]).push({at:Date.now(),script:previous.script});
    p.duration=timing.seconds;p.durationMode=timing.mode;p.durationReason=timing.reason;
    p.production={...initialProduction(),scriptHistory:previous.scriptHistory?.slice(-10),agentConfig:previous.agentConfig,agentConfigRevision:previous.agentConfigRevision,events:previous.events,library:previous.library?.map(a=>({...a,retired:true,approved:false}))};
    p.brief=undefined;p.questions=[];delete p.plan;p.jobs=p.jobs.map(j=>({...j,status:'cancelled',error:'目标时长修改，需重新编剧和确认下游。'}));p.phase='clarify';p.revision++;
    p.production.events.push({at:Date.now(),node:'clarify',role:'制片',message:'目标时长改为 '+p.duration+' 秒，保留创意与回答，旧剧本及资产已归档，等待重新编剧。'});bump(p);await save(all);return p;
  }
  if(['auto_start','auto_step','auto_stop'].includes(input.action??'')){
    const g=p.production!;if(!g)throw new Error('作品未初始化。');
    if(input.action==='auto_stop'){if(g.autoRun)g.autoRun.status='stopped';}
    else{
      if(p.jobs.some(j=>['running','queued'].includes(j.status))||g.library?.some(a=>a.status==='running'))throw new Error('请先完成或停止媒体生成。');
      if(input.action==='auto_start'){
        if(g.autoRun?.status==='running')throw new Error('自动任务已经运行。');
        g.autoRun={status:'running',steps:0,maxSteps:4,instruction:text(input.notes,'自动任务要求',2000),log:[]};
      }else{
        if(g.autoRun?.status!=='running')throw new Error('自动任务未启动。');
        const backupDir=path.join(root,'auto-backups');await mkdir(backupDir,{recursive:true});await writeFile(path.join(backupDir,p.id+'-'+Date.now()+'.json'),JSON.stringify(p,null,2));
        const candidate=structuredClone(p);
        try{await autoStep(candidate);Object.assign(p,candidate);}catch(e){g.autoRun!.status='failed';g.autoRun!.error=e instanceof Error?e.message:'自动任务失败';}
      }
    }
    bump(p);await save(all);return p;
  }
  if(input.action==='agent_config_save'){
    if(!p.production)throw new Error('作品尚未初始化。');
    p.production.agentConfig=validateAgentConfig(input.agentConfig);p.production.agentConfigRevision=(p.production.agentConfigRevision??0)+1;
    bump(p);await save(all);return p;
  }
  if(input.action==='team_review'){
    const {role}=await runTeamReview(p,input.roleId);const g=p.production!;
    g.events.push({at:Date.now(),node:g.node,role:role.name,message:'完成部门文本会审；建议不会自动修改作品或启动生成。'});bump(p);await save(all);return p;
  }
  if(input.action?.startsWith('asset_')){
    if(!p.production?.assets)throw new Error('请先确认剧本与美术设定。');
    if(p.jobs.some(j=>j.status==='running'||j.status==='queued'))throw new Error('请先完成或停止分镜生成队列。');
    const library=p.production.library??=[];
    if(library.some(a=>a.status==='running')&&!['asset_poll','asset_abandon'].includes(input.action))throw new Error('请先完成或停止正在生成的资产。');
    if(input.action==='asset_save_bible'){
      const bible=validateBible(input.bible);
      const additions=await planAssetLibrary({...p,production:{...p.production,assets:{...p.production.assets,bible}}});
      if(library.length+additions.length>160)throw new Error('资产版本已达到 160 个上限，请新建作品。');
      p.production.assets.bible=bible;for(const a of library){a.approved=false;a.retired=true;}
      if(p.plan){p.plan.bible=bible;invalidateFrom(p,0);reopenStoryboard(p);}else p.revision++;
      p.production.library=[...library,...additions];
    }else if(input.action==='asset_inventory'||input.action==='asset_refresh_inventory'){
      if(!library.length||input.action==='asset_refresh_inventory'){
        const additions=await planAssetLibrary(p);if(library.length+additions.length>160)throw new Error('资产版本已达到 160 个上限。');
        for(const a of library){a.retired=true;a.approved=false;}
        p.production.library=[...library,...additions];if(p.plan){invalidateFrom(p,0);reopenStoryboard(p);}else p.revision++;
      }
    }else{
      const asset=library.find(a=>a.id===input.assetId);if(!asset)throw new Error('资产不存在。');if(asset.retired)throw new Error('这是旧设定下的归档资产，请使用新候选。');
      if(input.action==='asset_upload'){
        if(asset.status!=='draft')throw new Error('请先创建新候选，再上传替换图，原图会保留。');
        const upload=await saveAssetUpload(input.imageBase64);asset.url=upload.url;asset.status='ready';asset.approved=false;asset.origin='upload';asset.uploadedFilename=typeof input.filename==='string'?input.filename.replace(/[\\/]/g,'_').slice(0,150):'本地图片';asset.model='本地上传';asset.error=undefined;
      }else if(input.action==='asset_regenerate'){
        if(!['ready','failed'].includes(asset.status))throw new Error('请等待本次生成完成后再重新生成。');
        if(library.length>=160)throw new Error('资产版本已达到上限。');
        const root=asset.parentId??asset.id;
        const family=library.filter(a=>(a.id===root||a.parentId===root)&&(a.viewId??'master')===(asset.viewId??'master'));
        if(family.length>=4)throw new Error('同一设计已保留 4 个候选，请修改设计要求后再建立新候选。');
        const next={...asset,id:randomUUID(),parentId:root,version:Math.max(...family.map(a=>a.version))+1,status:'running' as const,approved:false,url:undefined,remoteId:undefined,error:undefined,model:undefined,origin:undefined,uploadedFilename:undefined,setReview:undefined,createdAt:Date.now()};
        library.push(next);await save(all);
        try{await startAsset(p,next);}catch(e){const candidate=library.find(a=>a.id===next.id)!;candidate.status='failed';candidate.error=e instanceof Error?e.message:'重新生成失败';}
      }else if(input.action==='asset_generate'){
        if(asset.status!=='draft')throw new Error('此候选已提交，请跟踪结果或创建新候选。');
        asset.status='running';await save(all);
        try{await startAsset(p,asset);}catch(e){asset.status='failed';asset.error=e instanceof Error?e.message:'资产生成失败';}
      }else if(input.action==='asset_poll'){
        if(asset.status==='running')try{await updateAsset(asset);}catch(e){asset.error=e instanceof Error?e.message:'资产跟踪失败';if(!asset.remoteId)asset.status='failed';}
      }else if(input.action==='asset_approve'){
        if(asset.status!=='ready'||(p.mode==='live'&&(!asset.url||asset.promptVersion!=='3.0.0')))throw new Error('请等待图片生成完成再确认。');
        if(asset.sourceAssetId){const source=library.find(a=>a.id===asset.sourceAssetId);if(source)source.setReview=undefined;}
        const root=asset.parentId??asset.id;for(const a of library)if((a.id===root||a.parentId===root)&&(a.viewId??'master')===(asset.viewId??'master'))a.approved=false;
        if(!asset.viewId)for(const a of library)if(a.viewId&&a.parentId===root&&a.sourceAssetId!==asset.id){a.approved=false;a.retired=true;}
        asset.approved=true;asset.setReview=undefined;if(p.plan){invalidateFrom(p,0);reopenStoryboard(p);}else p.revision++;
      }else if(input.action==='asset_abandon'){
        if(asset.status!=='running')throw new Error('该资产未在生成中。');asset.status='failed';asset.error='已停止本地跟踪，供应商任务可能仍在执行并计费。';
      }else if(input.action==='asset_retry'){
        if(asset.status!=='failed'||library.length>=160)throw new Error('只允许重试失败任务，每个作品最多 160 个资产版本。');
        if(asset.remoteId){asset.status='running';asset.error=undefined;}else library.push({...asset,id:randomUUID(),version:asset.version+1,status:'draft',error:undefined,createdAt:Date.now()});
      }else if(input.action==='asset_edit_design'){
        if(asset.status!=='draft'||!asset.design||asset.viewId||asset.kind==='variant')throw new Error('只能修改尚未生成的独立资产设计。');
        const revised=validateAssetDesigns({assets:[{...asset.design,description:input.notes,kind:asset.kind,name:asset.name,evidence:asset.evidence}]},p)[0];
        asset.design=revised.design;asset.prompt=revised.prompt;asset.promptVersion=revised.promptVersion;
      }else if(input.action==='asset_costume'||input.action==='asset_prop_state'){
        if(library.length>=160)throw new Error('资产版本达到上限。');library.push(input.action==='asset_costume'?createCostumeSet(p,input.assetId,input.notes):createPropState(p,input.assetId,input.notes));
        asset.setReview=undefined;if(p.plan){invalidateFrom(p,0);reopenStoryboard(p);}
      }else if(input.action==='asset_use_costume'){
        selectCostume(p,input.assetId);if(p.plan){invalidateFrom(p,0);reopenStoryboard(p);}
      }else if(input.action==='asset_set_review'){
        reviewAssetSet(p,input.assetId,input.notes);
      }else if(input.action==='asset_views'){
        const views=createAssetViews(p,input.assetId);if(library.length+views.length>160)throw new Error('资产版本已达到 160 个上限。');library.push(...views);if(p.plan){invalidateFrom(p,0);reopenStoryboard(p);}
      }else if(input.action==='asset_rebuild'){
        if(library.length>=160)throw new Error('每个作品最多 160 个资产版本。');library.push(rebuildAsset(p,input.assetId));
      }else if(input.action==='asset_variant'){
        if(library.length>=160)throw new Error('每个作品最多保留 160 个资产版本。');
        library.push(variant(p,input.assetId,input.notes,input.referenceIds??[]));
      }else throw new Error('未知资产操作。');
    }
    bump(p);await save(all);return p;
  }
  if(p.production?.library?.some(a=>a.status==='running'))throw new Error('请先完成或停止资产生成，再修改作品。');
  if(['analyze_brief','clarify_answers','confirm_brief'].includes(input.action??'')){
    requireNode(p,'clarify');
    if(input.action!=='confirm_brief'&&(p.brief?.round??0)>=3)throw new Error('已完成三轮分析，请填写关键问题后确认当前理解继续，或创建新的创意。');
    const answers={...p.answers};const history=[...(p.brief?.history??[])];
    if(input.action!=='analyze_brief')for(const q of p.questions){const answer=text(input.answers?.[q.id],q.label,1500);answers[q.id]=answer;history.push({question:q.label,answer});}
    if(typeof input.notes==='string'&&input.notes.trim()){const answer=text(input.notes,'补充要求',4000);answers.additional_requirements=answer;history.push({question:'用户补充要求或对理解的纠正',answer});}
    if(input.action==='confirm_brief'){
      if(!p.brief||(p.brief.round<3&&!p.brief.ready))throw new Error('请先提交回答检查歧义。');
      p.brief={...p.brief,history,ready:true};p.questions=[];
    }else {const result=await analyzeClarification({...p,answers},history);p.brief=result.brief;p.questions=result.questions;}
    p.answers=answers;p.revision++;p.production!.skillVersions=Object.fromEntries(Object.entries(productionSkills).map(([id,s])=>[id,s.version]));
    p.production!.events.push({at:Date.now(),node:'clarify',role:'创意开发编辑',message:p.brief.ready?'关键歧义已处理，等待用户确认简报。':'已阅读创意与回答，提出 '+p.questions.length+' 个针对性问题。'});
  }else if(input.action==='plan'||input.action==='rewrite_script'){
    if(input.action==='plan')requireNode(p,'clarify','script');
    if(p.brief&&!p.brief.ready)throw new Error('请先完成针对性澄清并确认创意理解。');
    if(p.jobs.some(j=>j.status==='running'||j.status==='queued')||p.production?.library?.some(a=>a.status==='running'))throw new Error('请先完成或停止生成任务。');
    const answers:Record<string,string>={...p.answers};for(const q of p.questions)answers[q.id]=text(input.answers?.[q.id],q.label,1500);
    const timing=p.durationMode==='auto'?resolveDuration('auto',{idea:p.idea,answers}):resolveDuration(p.duration,p);const candidate={...p,answers,duration:timing.seconds};const script=await writeScript(candidate);p.duration=timing.seconds;p.durationReason=timing.reason;
    const previous=p.production!.script;const history=p.production!.scriptHistory??[];if(previous)history.push({at:Date.now(),script:previous});
    if(input.action==='rewrite_script'){const events=p.production!.events;p.production={...initialProduction(),events};delete p.plan;p.phase='clarify';p.jobs=p.jobs.map(j=>({...j,status:'cancelled',error:'剧本重写后原素材已失效。'}));}
    p.answers=answers;p.production!.script=script;p.production!.scriptHistory=history.slice(-10);p.production!.skillVersions=Object.fromEntries(Object.entries(productionSkills).map(([id,s])=>[id,s.version]));p.title=script.title;p.revision++;transition(p,'script','编剧完成结构化剧本，等待人工确认。');
  }else if(input.action==='approve_script'){
    requireNode(p,'script');const g=p.production!;
    const script=validateScreenplay(input.script,p.duration);
    const candidate={...p,production:{...g,script}};const bible=await designAssets(candidate);
    g.script=script;g.scriptApproved=true;g.assets={bible,seed:42,locked:false};p.title=script.title;p.revision++;transition(p,'assets','剧本已由用户确认，美术完成资产设定。');
  }else if(input.action==='approve_assets'){
    requireNode(p,'assets');const g=p.production!;
    if(p.mode==='live'&&setting('IMAGE_PROVIDER')==='fal'){requireAssetSets(p);if(JSON.stringify(input.bible)!==JSON.stringify(g.assets!.bible))throw new Error('设定已修改，请先保存设定并重新确认对应资产，再生成分镜。');}
    const seed=finite(input.seed,0,2147483647,'Seed');if(!Number.isInteger(seed))throw new Error('Seed 必须为整数。');
    const assets={bible:validateBible(input.bible),seed,locked:true};
    const plan=await generatePlan({...p,production:{...g,assets}});g.assets=assets;p.plan={...plan,...g.script,bible:assets.bible};p.phase='planned';p.revision++;transition(p,'storyboard','资产已锁定，导演生成分镜与运镜。');
  }else if(input.action==='shot'){
    if(!p.plan)throw new Error('请先生成分镜。');const i=p.plan.shots.findIndex(s=>s.id===input.shot?.id);if(i<0)throw new Error('镜头不存在。');
    const shot=validateShot(input.shot,i);p.plan.shots[i]=shot;invalidateFrom(p,i);reopenStoryboard(p);
  }else if(input.action==='bible'){
    if(!p.plan)throw new Error('请先生成分镜。');const plan=validatePlan({...p.plan,bible:input.bible});p.plan.bible=plan.bible;for(const a of p.production?.library??[])a.approved=false;if(p.production?.assets)p.production.assets.bible=plan.bible;invalidateFrom(p,0);reopenStoryboard(p);
  }else if(input.action==='continuity_review'){
    requireNode(p,'storyboard','continuity');p.production!.continuityReview=await continuitySkill(p);
    if(p.production!.node==='storyboard')transition(p,'continuity','场记完成规则与语义审查，等待用户复核。');
  }else if(input.action==='compile'){
    requireNode(p,'storyboard','continuity');if(!p.plan)throw new Error('缺少分镜。');
    if(checkContinuity(p.plan).some(i=>i.level==='error'))throw new Error('请先修正运镜错误。');
    if(p.production!.continuityReview?.revision!==p.revision)throw new Error('请先运行当前版本的专业场记审查。');
    if(p.production!.node==='storyboard')transition(p,'continuity','场记完成规则检查，警告需要人工复核。');
    p.production!.prompts=await compilerSkill(p);if(p.production!.assets)p.production!.assets.locked=true;
    transition(p,'prompts','提示词编译完成，等待人工批准生成。');
  }else if(input.action==='approve_render'){
    requireNode(p,'prompts');p.production!.renderApprovedRevision=p.revision;transition(p,'generation','用户批准当前版本分镜与提示词。');
  }else if(input.action==='review'){
    requireNode(p,'qa');if(input.verdict!=='passed'&&input.verdict!=='rejected')throw new Error('审查结论无效。');
    const g=p.production!,report=g.qa.find(q=>q.shotId===input.shotId);if(!report)throw new Error('审查镜头不存在。');
    const notes=text(input.notes,'审查意见',1000);report.source='human';report.notes=notes;report.verdict=input.verdict;
    if(input.verdict==='rejected'){
      if(report.attempt>=g.maxRetries)throw new Error('该镜头已达到重试上限，请修改分镜后开启新版本。');
      const i=p.plan!.shots.findIndex(s=>s.id===input.shotId);const affected=new Set(p.plan!.shots.slice(i).map(s=>s.id));
      for(const s of p.plan!.shots.slice(i)){delete s.videoUrl;delete s.videoMode;}
      p.jobs=p.jobs.map(j=>j.kind==='video'&&affected.has(j.shotId)?{...j,status:'cancelled'}:j);
      g.qa=g.qa.filter(q=>!affected.has(q.shotId)||q.shotId===input.shotId);report.attempt++;
      transition(p,'generation','审片退回：'+notes+'；重新生成该镜头与后续镜头。');
      for(const s of p.plan!.shots.slice(i))p.jobs.push(newJob(p,s.id,'video'));
    }else if(g.qa.length===p.plan!.shots.length&&g.qa.every(q=>q.verdict==='passed'))transition(p,'assembly','全部镜头通过人工审查，进入组装。');
  }else if(input.action==='prepare_assembly'){
    requireNode(p,'assembly','complete');p.production!.editPlan=await editorSkill(p);
    p.production!.events.push({at:Date.now(),node:'assembly',role:'剪辑指导',message:'后期剪辑与声音方案已生成，尚未执行音频合成。'});
  }else if(input.action==='complete'){
    requireNode(p,'assembly','complete');if(!p.production!.editPlan)throw new Error('请先生成并查看后期方案。');if(p.production!.node!=='complete')transition(p,'complete','用户已完成预演视频导出。');
  }else if(input.action==='enqueue'){
    requireNode(p,'generation');if(p.production!.renderApprovedRevision!==p.revision)throw new Error('请先批准当前版本提示词。');
    if(!p.plan)throw new Error('请先生成分镜。');if(input.kind!=='image'&&input.kind!=='video')throw new Error('任务类型无效。');
    if(checkContinuity(p.plan).some(i=>i.level==='error'))throw new Error('请先解决连续性检查中的错误。');
    if(p.mode==='live'&&!capabilities()[input.kind as 'image'|'video'])throw new Error(input.kind==='image'?'图像服务尚未配置，请在 API 设置中选择服务并填写对应密钥。':'视频网关尚未配置。');
    if(input.kind==='image'&&p.mode==='live'&&setting('IMAGE_PROVIDER')==='fal')requireAssetSets(p);
    if(input.kind==='video'&&p.plan.shots.some(s=>p.mode==='live'?!s.referenceUrl:s.referenceMode!=='demo'))throw new Error('请先完成全部参考图。');
    for(const shot of p.plan.shots){
      if(input.kind==='image'&&shot.referenceUrl)continue;
      if(p.jobs.some(j=>j.shotId===shot.id&&j.kind===input.kind&&['queued','running','succeeded'].includes(j.status)))continue;
      const failed=p.jobs.findLast(j=>j.shotId===shot.id&&j.kind===input.kind&&j.status==='failed'&&j.revision===p.revision);
      if(failed){
        if((failed.retries??0)>=p.production!.maxRetries||(failed.qaRetries??0)>=p.production!.maxRetries)throw new Error('该版本已达到重试上限，请修改分镜后重新批准。');
        if(failed.remoteId==='fal-pending')failed.remoteId=undefined;
        failed.retries=(failed.retries??0)+1;failed.status='queued';failed.error=undefined;continue;
      }
      if(p.jobs.filter(j=>j.shotId===shot.id&&j.kind===input.kind&&j.revision===p.revision).length>=p.production!.maxRetries+1)throw new Error('该镜头已达到本版本任务预算，请修改分镜开启新版本。');
      p.jobs.push(newJob(p,shot.id,input.kind));
    }
  }else if(input.action==='cancel'){
    p.jobs=p.jobs.map(j=>['queued','running'].includes(j.status)?{...j,status:'cancelled',error:'已停止本地跟踪；远端已提交的任务可能继续执行并计费。'}:j);
  }else if(input.action==='poll'){
    await tick(p,async()=>{bump(p);await save(all);});
    if(p.production?.node==='generation'&&p.plan&&p.plan.shots.every(s=>s.videoMode)){
      const g=p.production;g.qa=p.plan.shots.map(s=>{const previous=g.qa.find(q=>q.shotId===s.id);return {shotId:s.id,verdict:'needs_review',source:previous?.source??(p.mode==='demo'?'demo':'human'),notes:previous?.notes??(p.mode==='demo'?'演示规则运行完成，尚未进行像素级视觉审查。请人工确认分镜节奏。':'真实素材待人工审查；未配置视觉审查网关时，不自动判断画面质量。'),attempt:previous?.attempt??0};});
      transition(p,'qa','素材已就绪，等待审片；不将规则检查作为视觉质量结论。');
    }
  }else throw new Error('未知操作。');
  bump(p);await save(all);return p;
}
function newJob(p:Project,shotId:string,kind:'image'|'video'):Job{return {id:randomUUID(),shotId,kind,status:'queued',mode:p.mode,revision:p.revision,createdAt:Date.now()};}
async function tick(p:Project,persist:()=>Promise<void>){
  const job=p.jobs.find(j=>j.status==='running')||p.jobs.find(j=>j.status==='queued');if(!job||!p.plan)return;
  // A sequential queue ensures that downstream requests receive the previous output.
  const index=p.plan.shots.findIndex(s=>s.id===job.shotId),shot=p.plan.shots[index];
  const previous=index>0?p.plan.shots[index-1]:undefined;
  if(previous){const ready=job.kind==='image'?(job.mode==='demo'?previous.referenceMode==='demo':!!previous.referenceUrl):(job.mode==='demo'?previous.videoMode==='demo':!!previous.videoUrl);if(!ready){job.status='failed';job.error='上一镜头尚未成功，请先重试上游任务。';return;}}
  try{
    if(job.status==='queued'){
      job.status='running';job.startedAt=Date.now();job.input=mediaInput(p,job);
      await persist();
      if(job.mode==='live'&&!job.remoteId){if(job.kind==='image'&&setting('IMAGE_PROVIDER')==='fal'){job.remoteId='fal-pending';await persist();}job.remoteId=await submitMedia(p,job);await persist();}
      return;
    }
    if(Date.now()-(job.startedAt||0)>30*60*1000){job.status='failed';job.error='生成超过 30 分钟，请在供应商端核查任务。';return;}
    if(job.mode==='demo'){
      if(Date.now()-(job.startedAt||0)<900)return;
      job.status='succeeded';job.finishedAt=Date.now();if(job.kind==='image')shot.referenceMode='demo';else if(await reflect(p,job))shot.videoMode='demo';return;
    }
    // Persist the idempotency key before submission; resubmission after a crash uses the same key.
    if(!job.remoteId){job.remoteId=await submitMedia(p,job);return;}
    if(job.remoteId==='fal-pending')throw new Error('上次 fal 提交结果不明，已阻止自动重复提交。请核查供应商记录后再手动重试。');
    const result=await pollMedia(job);job.status=result.status;job.error=result.error;
    if(result.status==='succeeded'){job.outputUrl=result.outputUrl;job.finishedAt=Date.now();if(job.kind==='image'){shot.referenceUrl=result.outputUrl;shot.referenceMode='live';shot.referenceOrigin='generated';}else if(await reflect(p,job)){shot.videoUrl=result.outputUrl;shot.videoMode='live';}}
  }catch(e){job.status='failed';job.error=e instanceof Error?e.message:'生成失败';}
}
async function reflect(p:Project,j:Job):Promise<boolean>{
  const review=await reviewMedia(p,j);const g=p.production!;if(!review){const previous=g.qa.find(q=>q.shotId===j.shotId);if(previous&&j.qaRetries){previous.attempt=Math.max(previous.attempt,j.qaRetries);previous.notes+=' 返工素材已就绪，等待人工复核。';}return true;}
  const attempt=j.qaRetries??0;g.qa=g.qa.filter(q=>q.shotId!==j.shotId);g.qa.push({shotId:j.shotId,verdict:review.verdict,source:review.source,notes:review.notes,attempt});
  transition(p,'qa','自动审查：'+review.notes);
  transition(p,'generation',review.verdict==='passed'?'审查通过，继续生成。':'审查退回，检查重试预算。');
  if(review.verdict==='passed')return true;
  if(attempt>=g.maxRetries)throw new Error('自动审查未通过，已达到重试上限，请修改分镜。');
  j.status='cancelled';j.error='自动审查退回；正在使用反思意见重试。';
  p.jobs.unshift({...newJob(p,j.shotId,'video'),qaRetries:attempt+1});return false;
}
export function studioMiddleware(req:IncomingMessage,res:ServerResponse,next:()=>void){
  if(req.url?.startsWith('/api/studio-images/')){
    const match=/^\/api\/studio-images\/([a-f0-9-]{36})\.(png|jpg|webp)$/.exec(req.url);
    if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'')||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}
    if(req.method!=='GET'||!match){res.writeHead(404);res.end();return;}
    void readImage(match[1],match[2]).then(bytes=>{res.writeHead(200,{'Content-Type':match[2]==='jpg'?'image/jpeg':'image/'+match[2],'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});res.end(bytes);}).catch(()=>{res.writeHead(404);res.end();});return;
  }
  if(req.url?.split('?')[0]!=='/api/studio')return next();
  const send=(status:number,body:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  const host=req.headers.host||'';if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))return send(403,{error:'仅允许本机访问。'});
  if(req.headers.origin&&req.headers.origin!=='http://'+host)return send(403,{error:'请求来源不被允许。'});
  if(req.method!=='POST'||req.headers['x-frame-local']!=='1')return send(405,{error:'请使用工作台发起请求。'});
  let body='';let oversize=false;
  req.on('data',chunk=>{if(oversize)return;body+=chunk;if(Buffer.byteLength(body)>12_000_000){oversize=true;body='';}});
  req.on('end',()=>{if(oversize)return send(413,{error:'请求过大。'});let input;try{input=JSON.parse(body);if(!input||typeof input!=='object'||Array.isArray(input))throw new Error();}catch{return send(400,{error:'请求 JSON 无效。'});}
    void dispatch(input).then(result=>send(200,{data:result})).catch(e=>send(400,{error:e instanceof Error?e.message:'请求失败'}));
  });
}

