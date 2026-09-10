'use client';
import {useState} from 'react';
import type {Project,Shot} from '@/lib/studio/types';
import {videoGroup} from '@/lib/studio/video-group';
import {Button} from './ui/button';
import {RawClip} from './raw-clip';
export function GroupVideo({project,shot,busy,act}:{project:Project;shot:Shot;busy:boolean;act:(action:string,data?:Record<string,unknown>)=>Promise<unknown>}){
 const shots=project.plan?.shots??[],index=shots.findIndex(s=>s.id===shot.id);const pending=project.jobs.some(j=>['queued','running'].includes(j.status));
 const [startId,setStartId]=useState(shot.id),[endId,setEndId]=useState(shots[index+1]?.id??shots[index-1]?.id??shot.id);
 let group:ReturnType<typeof videoGroup>|undefined,error='';try{group=videoGroup(project,startId,endId);}catch(e){error=e instanceof Error?e.message:'不能组合';}
 const startIndex=shots.findIndex(s=>s.id===startId),endIndex=shots.findIndex(s=>s.id===endId);
 const selected=startIndex<0||endIndex<0?[]:shots.slice(Math.min(startIndex,endIndex),Math.max(startIndex,endIndex)+1);
 const total=selected.reduce((sum,s)=>sum+s.duration,0);
 return <section className="asset-prompt-card"><h4>自定义多分镜联合生成 · 保留原分镜</h4><p>选择起止镜头，包含其间全部连续分镜；不限制为两镜。将文字、时间段和相关美术图直接交给 H3，输出一段含切镜的视频。不修改分镜、不回退审批；点击即批准本次付费生成。剪辑总时长须在 4–15 秒内，小数秒向上取整提交，尾部余量需裁切；参考图去重后最多 9 张。</p><div className="form-grid"><label>起始镜头<select disabled={busy||pending} value={startId} onChange={e=>setStartId(e.target.value)}>{shots.map(s=><option key={s.id} value={s.id}>{s.id} · {s.title} · {s.duration} 秒</option>)}</select></label><label>结束镜头<select disabled={busy||pending} value={endId} onChange={e=>setEndId(e.target.value)}>{shots.map(s=><option key={s.id} value={s.id}>{s.id} · {s.title} · {s.duration} 秒</option>)}</select></label></div><p>已选 {selected.length} 镜 · 共 {total} 秒：{selected.map(s=>s.id).join(' → ')}。始终按原分镜顺序生成。</p>{group?<p>参考图 {group.assetIds.length} 张：{group.assetIds.map(id=>project.production?.library?.find(a=>a.id===id)?.name??id).join('、')}</p>:<p role="alert">{error}</p>}<Button disabled={busy||pending||!group||!project.production?.scriptApproved} onClick={()=>void act('enqueue_group',{shotId:startId,neighborId:endId})}>联合生成所选 {selected.length} 镜（不合并分镜，计费）</Button><p>模型不保证切镜精确到指定帧，需人工审查。联合片段单独保存，暂不自动拆分或加入整片时间轴。</p>{project.jobs.filter(j=>j.group?.shots.some(s=>s.id===shot.id)).map(j=><div key={j.id}><p>联合片段 {j.group!.shots.map(s=>s.id).join(' + ')} · {{queued:'排队中',running:'生成中',succeeded:'已完成',failed:'失败',cancelled:'已失效'}[j.status]}</p>{j.error&&<p>{j.error}</p>}{j.outputUrl&&<><RawClip url={j.outputUrl} title="联合片段" dialogue={j.group!.shots.map(s=>s.dialogue).join('\n')}/><a href={j.outputUrl} target="_blank" rel="noreferrer">打开联合视频原文件</a></>}</div>)}</section>;
}
