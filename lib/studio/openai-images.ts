import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { setting } from './settings.ts';
import { fetchJSON } from './http.ts';
import { networkError } from './network.ts';
import type { Project, Job } from './types.ts';

export function openAIImageModel(){return setting('OPENAI_IMAGE_MODEL')||'gpt-image-2';}
export function imageFile(id:string,ext='png'){
 if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('素材 ID 无效。');
 if(!['png','jpg','webp'].includes(ext))throw new Error('图片格式无效。');
 return path.resolve(process.env.STUDIO_DATA_DIR||'.studio','images',id+'.'+ext);
}
export async function readImage(id:string,ext='png'){return readFile(imageFile(id,ext));}
export async function generateOpenAIImage(p:Project,j:Job,prompt:string):Promise<string>{
 const file=imageFile(j.id),remoteId='openai-image:'+j.id;
 try{await readFile(file);return remoteId;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const key=setting('OPENAI_IMAGE_API_KEY');if(!key)throw new Error('请在 API 设置中填写 OpenAI 图像 API Key。');
 await mkdir(path.dirname(file),{recursive:true});
 // A crash or timeout must not silently resubmit a synchronous paid request.
 // Only an explicit queue retry increments retries and permits another attempt.
 try{await writeFile(file+'.attempt-'+(j.retries??0),'submitted',{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new Error('上次 OpenAI 图像请求结果未确认，已阻止自动重复扣费。请核查供应商记录；手动重试可能再次产生费用。');throw e;}
 let result;
 try{result=await fetchJSON('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:openAIImageModel(),prompt:'生成一张电影分镜参考图。只呈现单一画面，不要拼贴、字幕、标签或运镜箭头。以下是画面和连续性要求：\n'+prompt,n:1,size:p.ratio==='1:1'?'1024x1024':p.ratio==='16:9'?'1536x1024':'1024x1536',quality:'medium',output_format:'png'})},300000);}catch(e){throw networkError(e,'api.openai.com');}
 if(!result.response.ok){const status=result.response.status;throw new Error(status===401?'OpenAI 图像密钥无效，请检查 API 设置。':status===403?'OpenAI 账户没有此图像模型的访问权限，请检查账户验证和模型权限。':status===429?'OpenAI 图像请求受限，请检查额度、余额或速率限制。':'OpenAI 图像生成失败（HTTP '+status+'），请核对模型权限和请求要求。');}
 const b64=(result.data as {data?:{b64_json?:unknown}[]})?.data?.[0]?.b64_json;
 if(typeof b64!=='string'||b64.length>40_000_000||!b64.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(b64))throw new Error('OpenAI 未返回有效的图片数据。');
 const bytes=Buffer.from(b64,'base64');if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('OpenAI 返回的图片不是 PNG。');
 await writeFile(file+'.tmp',bytes);await rename(file+'.tmp',file);return remoteId;
}
