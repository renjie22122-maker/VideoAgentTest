import { fetchJSON } from './http.ts';
import { setting } from './settings.ts';
import { networkError } from './network.ts';
import { readImage } from './openai-images.ts';
export const falModels={generate:'fal-ai/flux-2/turbo',edit:'fal-ai/flux-2/turbo/edit',compose:'fal-ai/bytedance/seedream/v4.5/edit'};
export function falRoute(refs:string[],compose=false){if(refs.length>10)throw new Error('最多使用 10 张参考图，请缩小资产集合。');return refs.length?(compose||refs.length>4?falModels.compose:falModels.edit):falModels.generate;}
export function queueURL(value:unknown){if(typeof value!=='string')throw new Error('fal 未返回任务跟踪地址。');const url=new URL(value);if(url.origin!=='https://queue.fal.run'||url.username||url.password)throw new Error('fal 返回了不可信的任务地址。');return url.href;}
export async function falCall(url:string,body?:unknown,beforeSubmit?:()=>Promise<void>){
 const key=setting('FAL_API_KEY');if(!key)throw new Error('请先配置 fal.ai API Key。');
 if(!/^[!-~]+$/.test(key))throw new Error('fal.ai API Key 格式无效，请重新填写。');
 const target=queueURL(url),serialized=body===undefined?undefined:JSON.stringify(body);
 if(serialized!==undefined&&Buffer.byteLength(serialized,'utf8')>64*1024*1024)throw new Error('fal 请求超过 64 MB，请缩小参考图或提示词。');
 // Persist the uncertain-submission marker only after all local preparation succeeds.
 // This callback can fail (for example, storage unavailable); in that case no POST is sent.
 if(body!==undefined)await beforeSubmit?.();
 let result;try{result=await fetchJSON(target,{method:body===undefined?'GET':'POST',redirect:'error',headers:{Authorization:'Key '+key,'Content-Type':'application/json'},...(serialized===undefined?{}:{body:serialized})},body===undefined?60000:300000);}catch(e){throw networkError(e,'queue.fal.run');}
 if(!result.response.ok)throw new Error('fal 请求失败（HTTP '+result.response.status+'），请检查密钥、余额和模型权限。');return result.data as Record<string,unknown>;
}
export async function submitFal(prompt:string,refs:string[],compose=false,beforeSubmit?:()=>Promise<void>){
 const model=falRoute(refs,compose);
 const images=await Promise.all(refs.map(async url=>{const match=/^\/api\/studio-images\/([a-f0-9-]{36})\.(png|jpg|webp)$/.exec(url);if(match)return 'data:image/'+(match[2]==='jpg'?'jpeg':match[2])+';base64,'+(await readImage(match[1],match[2])).toString('base64');if(!url.startsWith('https://'))throw new Error('参考图必须是 HTTPS 图片或本机生成图片。');return url;}));
 const data=await falCall('https://queue.fal.run/'+model,{prompt,...(images.length?{image_urls:images}:{}),num_images:1},beforeSubmit);
 if(typeof data.request_id!=='string')throw new Error('fal 未返回任务 ID，请核查供应商记录后手动重试。');
 return {model,remoteId:'fal:'+JSON.stringify({id:data.request_id,status:queueURL(data.status_url),result:queueURL(data.response_url)})};
}
export async function pollFal(remoteId:string):Promise<{status:'running'|'succeeded'|'failed';outputUrl?:string;error?:string}>{
 const task=JSON.parse(remoteId.slice(4)) as {status:string;result:string};const status=await falCall(task.status);
 if(status.error)return {status:'failed',error:'fal 生成失败，请核查供应商任务记录。'};
 if(status.status==='IN_QUEUE'||status.status==='IN_PROGRESS')return {status:'running'};
 if(status.status!=='COMPLETED')throw new Error('fal 返回未知任务状态。');
 const result=await falCall(task.result);if(result.error)return {status:'failed',error:'fal 未能生成图片。'};
 const url=(result.images as {url?:unknown}[]|undefined)?.[0]?.url;
 if(typeof url!=='string'||!url.startsWith('https://'))throw new Error('fal 未返回有效图片 URL。');
 return {status:'succeeded',outputUrl:url};
}
