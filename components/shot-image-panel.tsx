'use client';
import { useEffect, useState } from 'react';
import { studioRequest } from '@/lib/studio/client';
import type { Project, Shot } from '@/lib/studio/types';
import { AssetUpload } from './asset-upload';
type Preview={prompt:string;referenceImages:string[];model:string;compiled:boolean};
export function ShotImagePanel({project,shot,busy,dirty,act}:{project:Project;shot:Shot;busy:boolean;dirty:boolean;act:(action:string,data?:Record<string,unknown>)=>Promise<unknown>}){
 const [stored,setPreview]=useState<(Preview&{key:string})|null>(null),[error,setError]=useState('');
 const key=project.id+':'+project.revision+':'+project.updatedAt+':'+shot.id;const preview=stored?.key===key?stored:null;
 useEffect(()=>{let active=true;void studioRequest<Preview>('shot_image_prompt',{id:project.id,shotId:shot.id}).then(v=>{if(active){setPreview({...v,key});setError('');}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'读取失败');});return()=>{active=false;};},[project.id,shot.id,key]);
 return <section className="asset-prompt-card"><h3>分镜画面 · 提示词与本地上传</h3>{shot.referenceOrigin==='upload'&&<p>当前画面来自本地上传：{shot.referenceFilename}。以下提示词未用于生成这张上传图片。</p>}{dirty&&<p>当前镜头有未保存修改；下方显示已保存版本，请先保存再上传。</p>}{error&&<p role="alert">{error}</p>}{preview?<><p>{preview.model} · {preview.compiled?'已编译的当前请求预览':'尚未正式编译，当前为镜头草案提示词'}</p><pre style={{whiteSpace:'pre-wrap',maxHeight:350,overflow:'auto'}}>{preview.prompt}</pre><p>当前输入参考图 {preview.referenceImages.length} 张。前镜生成、资产变化或重新编译后会更新；此处显示下一次请求内容，不代表历史图片的原始提示词。</p><details><summary>查看参考图地址与顺序</summary><ol>{preview.referenceImages.map((url,i)=><li key={i} style={{overflowWrap:'anywhere'}}>{url}</li>)}</ol></details></>:!error&&<p>正在读取提示词…</p>}<AssetUpload assetId="" shotId={shot.id} disabled={busy||dirty||project.jobs.some(j=>j.status==='running'||j.status==='queued')} onUpload={act}/></section>;
}
