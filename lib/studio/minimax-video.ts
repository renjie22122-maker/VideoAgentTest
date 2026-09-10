import {miniMaxTiming,timingInstruction} from './render-timing.ts';
import {soundTimeline} from './sound-plan.ts';
import { PHYSICS_GUIDE } from './physical-rules.ts';
import { cameraSpeedSummary } from './shot-intent.ts';
import { groupShot } from './video-group.ts';
import { approvedAssets } from './assets.ts';
import { motionGuidance } from './motion.ts';
import type { Project, Job } from './types.ts';
import { readImage } from './openai-images.ts';
type Request=(url:string,body:unknown,key:string,method?:string)=>Promise<Record<string,unknown>>;
export function miniMaxBase(value:string){try{const u=new URL(value);return u.protocol==='https:'&&['api.minimax.io','api.minimaxi.com'].includes(u.hostname)?u.origin:null;}catch{return null;}}
export function prepareMiniMax(p:Project,j:Job,model:string){
 if(!['MiniMax-H3','MiniMax-H3-Max'].includes(model))throw new Error('当前原生视频适配支持 MiniMax-H3 / MiniMax-H3-Max。');
 const shot=j.group?groupShot(j.group):p.plan?.shots.find(s=>s.id===j.shotId);if(!shot)throw new Error('镜头不存在。');
 const mode=shot.videoInput?.mode??'first';
 const timing=miniMaxTiming(shot.duration,model);
 const images:{url:string;role:string;name:string}[]=[];
 if(mode==='first'||mode==='first_last'){
  if(!shot.referenceUrl)throw new Error(shot.id+' 缺少首帧，请上传或生成，或选择文字/美术参考图模式。');
  images.push({url:shot.referenceUrl,role:'first_frame',name:'首帧'});
  if(mode==='first_last'){if(!shot.videoInput?.lastFrameUrl)throw new Error(shot.id+' 缺少尾帧。');images.push({url:shot.videoInput.lastFrameUrl,role:'last_frame',name:'尾帧'});}
 }else if(mode==='references'){
  if(model==='MiniMax-H3-Max')throw new Error('美术参考图模式需要 MiniMax-H3，H3-Max 不支持。');
  const ids=shot.videoInput?.assetIds??[];const assets=approvedAssets(p);
  if(!ids.length||ids.length>9||new Set(ids).size!==ids.length)throw new Error('请为本镜选择 1–9 张已批准美术参考图。');
  for(const id of ids){const a=assets.find(a=>a.id===id);if(!a?.url)throw new Error('所选美术参考图已失效，请重新选择。');images.push({url:a.url,role:'reference_image',name:a.name});}
 }
 let cursor=0;const timeline=j.group?.shots.map(s=>{const start=cursor;cursor+=s.duration;return {叙事线:s.narrative,台词表演:s.performance,设计:s.intent,镜头:s.id,开始秒:start,结束秒:cursor,画面:s.description,景别:s.size,运镜:s.camera,对白:s.dialogue,声音:s.sound,起始状态:s.startState,结束状态:s.endState,转场:s.transition};});
 const prompt=JSON.stringify({时长适配:timingInstruction(timing),声音时间表:soundTimeline(j.group?.shots??[shot]),叙事线:shot.narrative,台词表演:shot.performance,默认物理约束:PHYSICS_GUIDE,相机速度参考:cameraSpeedSummary(shot),本镜视听设计:shot.intent,故事约束:p.storyContext?.guide,分镜时间表:timeline,模式:mode,参考顺序:images.map((a,i)=>({编号:i+1,名称:a.name})),运动程序:motionGuidance(shot),画面:shot.description,运镜:shot.camera,开始:shot.startState,结束:shot.endState,对白:shot.dialogue,声音:shot.sound,要求:j.group?'按分镜时间表依次生成多个镜头组成的一段视频，在指定时间切镜，保留各镜对白、机位和动作；依据参考图保持身份，不复制设定板排版。':mode==='references'?'依据美术参考图保持人物身份、服装和场景；设定板只取基准造型，不复制多面板排版。单一连续镜头。':mode==='text'?'根据文字生成单一连续镜头。':'遵守输入首尾关键帧，单一连续镜头，不复制设定板布局。'});
 if(prompt.length>7000)throw new Error('视频提示词超过 H3 的 7000 字限制，请精简镜头描述。');
 return {prompt,images,shot,mode,timing};
}
export async function submitMiniMax(p:Project,j:Job,base:string,model:string,key:string,request:Request){
 const {prompt,images,mode,timing}=prepareMiniMax(p,j,model);
 j.renderTiming=timing;
 const content:({type:string;text:string}|{type:string;image_url:{url:string};role:string})[]=[{type:'text',text:prompt}];
 for(const image of images){let url=image.url;const match=/^\/api\/studio-images\/([a-f0-9-]{36})\.(png|jpg|webp)$/.exec(url);if(match)url='data:image/'+(match[2]==='jpg'?'jpeg':match[2])+';base64,'+(await readImage(match[1],match[2])).toString('base64');if(!url.startsWith('data:image/')&&!url.startsWith('https://'))throw new Error('参考图必须为 HTTPS 图片或本地已存图片。');content.push({type:'image_url',image_url:{url},role:image.role});}
 const input={model,content,duration:timing.requestSeconds,resolution:'768P',ratio:mode==='first'||mode==='first_last'?'adaptive':p.ratio};
 if(JSON.stringify(input).length>64*1024*1024)throw new Error('视频请求超过 64 MB，请减少参考图。');
 const result=await request(base+'/v2/video_generation',input,key);
 if(typeof result.task_id!=='string'||!result.task_id||result.task_id.length>300)throw new Error('MiniMax 未返回有效任务 ID，请检查供应商记录后再重试。');
 return 'minimax-h3:'+encodeURIComponent(base)+':'+encodeURIComponent(result.task_id);
}
export async function pollMiniMax(remoteId:string,key:string,request:Request){
 const parts=remoteId.split(':');if(parts.length!==3)throw new Error('MiniMax 任务记录无效。');
 const base=decodeURIComponent(parts[1]),id=decodeURIComponent(parts[2]);if(miniMaxBase(base)!==base)throw new Error('MiniMax 任务来源无效。');
 const data=await request(base+'/v2/query/video_generation/'+encodeURIComponent(id),undefined,key,'GET');
 const task=data.task as {status?:string;content?:{url?:string}}|undefined;
 if(task?.status==='failed'||task?.status==='cancelled')return {status:'failed' as const,error:'MiniMax 视频任务'+(task.status==='failed'?'生成失败':'已取消')+'，请在供应商任务记录查看原因。'};
 if(['queued','running'].includes(task?.status??''))return {status:'running' as const};
 if(task?.status!=='succeeded')throw new Error('MiniMax 返回了未知任务状态。');
 if(!task.content?.url||new URL(task.content.url).protocol!=='https:')throw new Error('MiniMax 视频结果地址无效。');
 return {status:'succeeded' as const,outputUrl:task.content.url};
}
