'use client';
import { useState } from 'react';
import { motionAt, motionSamples, motionWarnings } from '@/lib/studio/motion';
import type { Shot } from '@/lib/studio/types';
import { Button } from './ui/button';
export function MotionEditor({shot,onChange,onPlan,busy}:{shot:Shot;onChange:(s:Shot)=>void;onPlan?:(notes:string)=>void;busy:boolean}){
 const [instruction,setInstruction]=useState('');const m=shot.motion;
 const update=(next:NonNullable<Shot['motion']>)=>onChange({...shot,motion:next});
 const frames=m?motionSamples(shot):[],points=frames.flatMap(f=>[f.subject,f.camera]);
 const extent=Math.max(3,...points.flatMap(p=>[Math.abs(p.x),Math.abs(p.z)]));
 const project=(p:{x:number;z:number})=>`${160+p.x*140/extent},${160-p.z*140/extent}`;
 return <section className="asset-prompt-card"><h3>运动规划 · 主体与相机分开控制</h3><p className="help">借鉴 LAMP 的运动程序方法；俯视图为可计算的设计轨迹，H3 接收文字运动指导，不保证精确复现路径。</p>
 <label>用自然语言描述运动<textarea value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder="例如：人物向右走两米，相机保持距离跟随；不要改变对白和时长。"/></label><Button disabled={busy||!onPlan||!instruction.trim()} onClick={()=>onPlan?.(instruction)}>规划运动（调用语言模型，先保存镜头修改）</Button>
 {!m?<Button disabled={busy} onClick={()=>update({version:1,subject:{start:{x:0,y:0,z:0},end:{x:0,y:0,z:0}},camera:{mode:'world',degrees:0}})}>手动建立运动程序</Button>:<>
 <label>相机与主体关系<select value={m.camera.mode} onChange={e=>update({...m,camera:{...m.camera,mode:e.target.value as typeof m.camera.mode}})}><option value="world">世界坐标起终点</option><option value="follow">相对主体跟随</option><option value="orbit">绕主体环绕</option></select></label>
 {m.camera.mode==='orbit'&&<label>环绕角度（正角从 +Z 朝 +X）<input type="number" min={-360} max={360} value={m.camera.degrees} onChange={e=>update({...m,camera:{...m.camera,degrees:Math.max(-360,Math.min(360,Number(e.target.value)))}})}/></label>}
 <p className="help">下方原相机起终点在跟随/环绕模式表示相对主体的偏移。环绕终点取结束半径和高度，方向由环绕角决定。</p>
 {(['start','end'] as const).map(key=><div className="form-grid" key={key}>{(['x','y','z'] as const).map(axis=><label key={axis}>主体{key==='start'?'起点':'终点'} {axis.toUpperCase()}（米）<input type="number" min={-100} max={100} step={.1} value={m.subject[key][axis]} onChange={e=>update({...m,subject:{...m.subject,[key]:{...m.subject[key],[axis]:Math.max(-100,Math.min(100,Number(e.target.value)))}}})}/></label>)}</div>)}
 <svg viewBox="0 0 320 320" aria-label="主体与相机俯视轨迹"><polyline points={frames.map(f=>project(f.subject)).join(' ')} fill="none" stroke="#66bfff" strokeWidth="3"/><polyline points={frames.map(f=>project(f.camera)).join(' ')} fill="none" stroke="#d5f584" strokeWidth="2"/>{[0,.5,1].map(t=>{const f=motionAt(shot,t),[cx,cy]=project(f.camera).split(',');return <circle key={t} cx={cx} cy={cy} r="4" fill="#d5f584"/>;})}</svg><small>蓝色：主体；绿色：相机；圆点：起点、中点、终点。每镜采样 61 个位置。</small>
 {motionWarnings(shot).map(v=><p key={v}>{v}</p>)}<details><summary>查看运动程序和轨迹数据</summary><pre>{JSON.stringify({program:m,frames},null,2)}</pre></details>
 <Button disabled={busy} variant="outline" onClick={()=>onChange({...shot,motion:undefined})}>恢复原运镜模式</Button></>}
 </section>;
}
