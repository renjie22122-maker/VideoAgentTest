import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { imageFile } from './openai-images.ts';
export async function saveAssetUpload(base64:unknown){
 if(typeof base64!=='string'||!base64.length||base64.length>11_184_812||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw new Error('请选择不超过 8 MB 的 PNG、JPEG 或 WebP 图片。');
 const data=Buffer.from(base64,'base64');if(data.length>8*1024*1024)throw new Error('图片不能超过 8 MB。');
 let ext:string;
 if(data.length>=24&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))ext='png';
 else if(data.length>=12&&data[0]===255&&data[1]===216&&data[2]===255)ext='jpg';
 else if(data.length>=16&&data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP')ext='webp';
 else throw new Error('文件内容不是支持的图片格式，请上传 PNG、JPEG 或 WebP。');
 const id=randomUUID(),file=imageFile(id,ext);await mkdir(path.dirname(file),{recursive:true});await writeFile(file+'.tmp',data);await rename(file+'.tmp',file);
 return {url:'/api/studio-images/'+id+'.'+ext,bytes:data.length};
}
