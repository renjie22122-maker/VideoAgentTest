'use client';
import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { drawAnimatic, recordAnimatic } from '@/lib/studio/animatic';
import type { Project } from '@/lib/studio/types';
export function StudioPreview({project,canExport,onExport}:{project:Project;canExport:boolean;onExport:()=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),abort=useRef<AbortController|null>(null),playbackOrigin=useRef(0);const [time,setTime]=useState(0),[playing,setPlaying]=useState(false),[exporting,setExporting]=useState(false),[progress,setProgress]=useState(0),[error,setError]=useState('');
 const total=project.plan!.shots.reduce((n,s)=>n+s.duration,0);const dimensions=project.ratio==='9:16'?[720,1280]:project.ratio==='1:1'?[960,960]:[1280,720];
 useEffect(()=>{if(!exporting&&canvas.current)drawAnimatic(canvas.current,project,Math.min(time,total));},[project,time,total,exporting]);
 useEffect(()=>{if(!playing)return;const timer=setInterval(()=>{const next=Math.min((performance.now()-playbackOrigin.current)/1000,total);setTime(next);if(next>=total)setPlaying(false);},40);return()=>clearInterval(timer);},[playing,total]);
 useEffect(()=>()=>abort.current?.abort(),[]);
 async function exportVideo(){setPlaying(false);setExporting(true);setError('');abort.current=new AbortController();try{const blob=await recordAnimatic(canvas.current!,project,setProgress,abort.current.signal);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='FRAME-'+project.id.slice(0,8)+'-animatic.webm';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);onExport();}catch(e){setError((e as Error).message);}finally{setExporting(false);}}
 return <div className="preview"><canvas ref={canvas} width={dimensions[0]} height={dimensions[1]} aria-label="动态分镜构图预演"/><div className="preview-controls"><Button variant="outline" disabled={exporting} onClick={()=>{playbackOrigin.current=performance.now()-(time>=total?0:time)*1000;if(time>=total)setTime(0);setPlaying(!playing);}}>{playing?<Pause/>:<Play/>}{playing?'暂停':'播放预演'}</Button><span>{time.toFixed(1)} / {total}s</span><Button disabled={!canExport||exporting} onClick={exportVideo}><Download/>导出 WebM</Button>{exporting&&<Button variant="outline" onClick={()=>abort.current?.abort()}>取消导出 {Math.round(progress*100)}%</Button>}</div><Slider aria-label="预演时间" min={0} max={total} step={.1} value={[time]} disabled={exporting} onValueChange={v=>{setPlaying(false);setTime(Array.isArray(v)?v[0]:v);}}/><p className="help">这是构图与节奏预演，主体用区域框表示，无配音或配乐。导出按实际片长录制，请保持页面可见。</p>{error&&<p role="alert" className="error">{error}</p>}</div>;
}

