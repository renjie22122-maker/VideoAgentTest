'use client';
import {AssetReadinessNotice} from './asset-catalog-controls';
import {suggestVideoAssets,videoAssetChoices} from '@/lib/studio/video-asset-selection';
import {shortShotMergeOptions} from '@/lib/studio/shot-merge';
import {useState} from 'react';
import type {Project,Shot} from '@/lib/studio/types';
import {VideoPreflight} from './video-preflight';
import {GroupVideo} from './group-video';
import {RawClip} from './raw-clip';
import {Button} from './ui/button';
import {AssetUpload} from './asset-upload';
export function ShotVideoControls({project,shot,busy,act}:{project:Project;shot:Shot;busy:boolean;act:(action:string,data?:Record<string,unknown>)=>Promise<unknown>}){
 const [mode,setMode]=useState<NonNullable<Shot['videoInput']>['mode']>(shot.videoInput?.mode??'first');
 const suggestion=suggestVideoAssets(project,shot.id);
 const [ids,setIds]=useState<string[]>(shot.videoInput?.assetIds?.length?shot.videoInput.assetIds:shot.videoInput?.mode==='references'?suggestion.ids:[]);
 const rendered=project.jobs.findLast(j=>j.shotId===shot.id&&j.kind==='video'&&j.outputUrl===shot.videoUrl&&j.renderTiming)?.renderTiming;
 const take=project.jobs.findLast(j=>j.shotId===shot.id&&j.longTake)?.longTake;
 const mergeOptions=shortShotMergeOptions(project.plan?.shots??[],shot.id);
 const pending=project.jobs.some(j=>['queued','running'].includes(j.status));
 const changed=mode!==(shot.videoInput?.mode??'first')||JSON.stringify(ids)!==JSON.stringify(shot.videoInput?.assetIds??[]);
 const ready=['generation','qa'].includes(project.production?.node??'')&&project.production?.renderApprovedRevision===project.revision;
 return <section className="asset-prompt-card"><AssetReadinessNotice project={project} shotId={shot.id}/><h3>{shot.id} · 视频模式与单镜生成</h3>{shot.duration>15&&<div><h4>长镜头串行接续 · {shot.duration} 秒</h4><p>按当前 15 秒上限，至少 {Math.ceil(shot.duration/15)} 次视频调用；有对白时可能进一步分段。前段真实尾帧作为后段首帧；保持整镜运镜进度，完成后本地拼接为一个视频。分段不等于切镜，但画面、动作速度及音色接缝仍需审片。失败后使用下方生成 / 恢复按钮继续，已完成段不会重新生成。</p>{take&&<p>已处理 {take.parts.filter(p=>p.fileId).length} / {take.parts.length} 段 · {take.phase==='assembling'?'本地组装':take.phase==='complete'?'已完成，待审片':'串行生成中'}</p>}</div>}<GroupVideo project={project} shot={shot} busy={busy||changed} act={act}/>{shot.duration<5&&<div><h4>短镜头时长：{shot.duration} 秒</h4><p>H3 最少 4 秒，H3-Max 最少 5 秒。可将同场相邻动作合并为一个连续镜头；保留对白和总时长，但需重新检查构图、运镜及批准。合并处及后续素材会失效，原作品会备份。</p>{mergeOptions.map(option=><Button key={option.neighborId} variant="outline" disabled={busy||pending||changed} onClick={()=>void act('merge_shots',{shotId:shot.id,neighborId:option.neighborId})}>{option.label}（修改分镜，不生成）</Button>)}{!mergeOptions.length&&<p>没有合适的同场邻镜，请调整场次时长或重新拆分镜头。</p>}</div>}{shot.videoUrl&&<div>{rendered&&rendered.tailSeconds>0&&<p>原片请求 {rendered.requestSeconds} 秒，剪辑保留前 {rendered.editSeconds} 秒；尾部 {rendered.tailSeconds} 秒余量尚需后期裁切，原文件未自动改写。</p>}<h4>{shot.videoMode==='live'?'已完成片段':'上次生成的片段'}</h4><RawClip url={shot.videoUrl} title={shot.title} dialogue={shot.dialogue}/><a href={shot.videoUrl} target="_blank" rel="noreferrer">打开视频原文件 / 另存为</a></div>}<label>视频输入方式<select disabled={busy||pending} value={mode} onChange={e=>{const next=e.target.value as typeof mode;setMode(next);if(next==='references'&&!ids.length)setIds(suggestion.ids);}}><option value="references">文字＋美术设定参考图（H3）</option><option value="text">纯文字，不需要分镜图</option><option value="first">首帧＋文字</option><option value="first_last">首尾帧＋文字</option></select></label>
 {mode==='references'&&<fieldset><legend>已按镜头自动匹配，可调整（最多 9 张）</legend><Button variant="outline" disabled={busy||pending} onClick={()=>setIds(suggestion.ids)}>按当前镜头重新匹配素材</Button><p>匹配依据：画面、起止状态中的人物 / 道具及本场环境。不会仅因画外音就选入人物图。</p>{suggestion.matches.map(a=><p key={a.id}>{a.name}：{a.reason}</p>)}{!suggestion.ids.length&&<p>没有匹配到已批准素材，请手动选择，或检查镜头描述中的名称与资产名称。</p>}{suggestion.omitted.length>0&&<p>超过 9 张未选入：{suggestion.omitted.join('、')}</p>}{videoAssetChoices(project).map(a=><label key={a.id}><input type="checkbox" disabled={busy||pending||(!ids.includes(a.id)&&ids.length>=9)} checked={ids.includes(a.id)} onChange={e=>setIds(e.target.checked?[...ids,a.id]:ids.filter(id=>id!==a.id))}/>{a.name} · V{a.version}</label>)}</fieldset>}
 <Button disabled={busy||pending||!changed||(mode==='references'&&!ids.length)} onClick={()=>void act('video_config',{shotId:shot.id,videoInput:{mode,assetIds:ids}})}>保存视频模式与参考选择</Button>
 {mode==='first_last'&&<><p>首帧使用本镜分镜画面；尾帧：{shot.videoInput?.lastFrameUrl?'已上传':'尚未上传'}</p><AssetUpload assetId="" shotId={shot.id} actionOverride="video_tail_upload" disabled={busy||pending||changed} onUpload={act}/></>}
 <p>仅更换视频输入配置会保留已完成的文字分镜检查与批准，本镜旧视频需要重新生成和审查。美术参考图模式本版由 H3 支持；Kling 可选文字、首帧或首尾帧。先运行下方免费预检确认时长和模式。以下按钮仅提交本镜，真实模式按调用计费。</p>
 <VideoPreflight key={shot.id+project.revision} project={project} shot={shot} disabled={busy||changed}/><div className="queue-actions">{(['image','video'] as const).map(kind=><div key={kind}><Button disabled={busy||pending||changed||!ready} onClick={()=>void act('enqueue',{shotId:shot.id,kind})}>仅生成 / 恢复本镜{kind==='image'?'画面':'视频'}</Button><Button variant="outline" disabled={busy||pending||changed||!ready||!(kind==='image'?shot.referenceUrl:shot.videoUrl)} onClick={()=>void act('enqueue',{shotId:shot.id,kind,regenerate:true})}>重新生成本镜{kind==='image'?'画面':'视频'}（新调用）</Button></div>)}</div>
 {busy?<p>当前操作处理中，请等待完成。</p>:pending?<p>队列中还有任务，请先完成或停止队列。</p>:changed?<p>视频模式或参考图有未保存修改，请先保存。</p>:!ready?<p>当前版本尚未批准生成。请到“连续性检查”运行场记审查并编译提示词，再到“提示词”批准生成。旧版本保存配置曾清除的批准不会自动恢复。</p>:null}<p>重新生成保留旧任务结果记录；替换镜头后需重新核对邻镜衔接，不会自动重生成其他片段。</p></section>;
}
