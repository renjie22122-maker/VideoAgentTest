'use client';
import { useState } from 'react';
export function AssetUpload({assetId,disabled,onUpload,shotId}:{assetId:string;shotId?:string;disabled:boolean;onUpload:(action:string,data:Record<string,unknown>)=>Promise<unknown>}){
 const [error,setError]=useState(''),[loading,setLoading]=useState(false);
 async function upload(file:File){setError('');setLoading(true);try{
  if(file.size>8*1024*1024)throw new Error('图片不能超过 8 MB。');
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('支持 PNG、JPEG、WebP 图片。');
  const bitmap=await createImageBitmap(file);bitmap.close();
  const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{if(typeof reader.result==='string')resolve(reader.result.split(',')[1]);else reject(new Error('文件读取格式错误。'));};reader.onerror=()=>reject(new Error('文件读取失败。'));reader.readAsDataURL(file);});
  await onUpload(shotId?'shot_image_upload':'asset_upload',{assetId,shotId,imageBase64:data,filename:file.name});
 }catch(e){setError(e instanceof Error?e.message:'图片无法读取。');}finally{setLoading(false);}}
 return <div className="asset-prompt-card"><label>{shotId?'上传图片作为当前分镜画面':'或上传本地图片作为此候选'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled||loading} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(file);}}/></label><p className="help">PNG / JPEG / WebP，最大 8 MB。{shotId?'上传后作为本镜首帧；本镜视频及后续素材失效，需重新检查并批准生成。':'保存到本机，上传后仍需确认使用。'} 不会调用生图 API。</p>{loading&&<output>正在读取并保存图片…</output>}{error&&<p role="alert">{error}</p>}</div>;
}
