import { motionGuidance } from './motion.ts';
import type { Project, Job } from './types.ts';
import { readImage } from './openai-images.ts';
type Request=(url:string,body:unknown,key:string,method?:string)=>Promise<Record<string,unknown>>;
export function miniMaxBase(value:string){try{const u=new URL(value);return u.protocol==='https:'&&['api.minimax.io','api.minimaxi.com'].includes(u.hostname)?u.origin:null;}catch{return null;}}
export async function submitMiniMax(p:Project,j:Job,base:string,model:string,key:string,request:Request){
 if(!['MiniMax-H3','MiniMax-H3-Max'].includes(model))throw new Error('当前原生视频适配支持 MiniMax-H3 / MiniMax-H3-Max。');
 const shot=p.plan?.shots.find(s=>s.id===j.shotId);if(!shot?.referenceUrl)throw new Error('请先生成当前镜头的分镜画面。');
 const min=model==='MiniMax-H3'?4:5;if(!Number.isInteger(shot.duration)||shot.duration<min||shot.duration>15)throw new Error(model+' 的镜头时长须为 '+min+'–15 整数秒，请调整当前镜头。');
 let url=shot.referenceUrl;const match=/^\/api\/studio-images\/([a-f0-9-]{36})\.(png|jpg|webp)$/.exec(url);
 if(match)url='data:image/'+(match[2]==='jpg'?'jpeg':match[2])+';base64,'+(await readImage(match[1],match[2])).toString('base64');
 if(!url.startsWith('data:image/')&&!url.startsWith('https://'))throw new Error('分镜画面必须为公开 HTTPS 图片或本地已存图片。');
 const prompt=JSON.stringify({运动程序:motionGuidance(shot),画面:shot.description,运镜:shot.camera,开始:shot.startState,结束:shot.endState,对白:shot.dialogue,声音:shot.sound,要求:'以输入图为首帧，单一连续镜头，不复制设定板布局；保持身份与道具结构，按时长完成动作。'});
 if(prompt.length>7000)throw new Error('视频提示词超过 H3 的 7000 字限制，请精简镜头描述。');
 const input={model,content:[{type:'text',text:prompt},{type:'image_url',image_url:{url},role:'first_frame'}],duration:shot.duration,resolution:'768P',ratio:'adaptive'};
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
