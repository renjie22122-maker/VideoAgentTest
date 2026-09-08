 'use client';
import { useState } from 'react';
import type { Project } from '@/lib/studio/types';
import { Button } from './ui/button';
export function DurationSettings({project,busy,act}:{project:Project;busy:boolean;act:(action:string,data?:Record<string,unknown>,navigate?:boolean)=>Promise<unknown>}){
 const [value,setValue]=useState(project.durationMode==='auto'?'auto':String(project.duration));
 return <details><summary>修改预期时长 · {project.durationMode==='auto'?'自动估算':'手动指定'} {project.duration} 秒</summary><p>{project.durationReason}</p><label>时长模式<select value={value==='auto'?'auto':'manual'} onChange={e=>setValue(e.target.value==='auto'?'auto':String(project.duration))}><option value="auto">自动估算（无需填写秒数）</option><option value="manual">手动指定</option></select></label>{value!=='auto'&&<label>目标秒数<input type="number" min={12} max={120} value={value} onChange={e=>setValue(e.target.value)}/></label>}<p>保存后回到创意阶段。保留原始创意和回答，旧剧本与美术资产归档；需重新编剧和确认，不会自动调用生成 API。当前支持 12–120 秒，自动结果是规则粗估。</p><Button disabled={busy||value!== 'auto'&&(!Number.isInteger(Number(value))||Number(value)<12||Number(value)>120)} onClick={()=>void act('duration_update',{duration:value==='auto'?'auto':Number(value)},true)}>保存时长，返回创意阶段</Button></details>;
}
