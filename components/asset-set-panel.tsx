'use client';
import Image from 'next/image';
import { useState } from 'react';
import type { Asset } from '@/lib/studio/types';
import { assetViews, isDesignBoard } from '@/lib/studio/asset-views';
import { Button } from './ui/button';
export function AssetSetPanel({source,library,busy,act}:{source:Asset;library:Asset[];busy:boolean;act:(action:string,data?:Record<string,unknown>)=>Promise<unknown>}){
 const [proposal,setProposal]=useState(''),[review,setReview]=useState('');
 const kind=library.find(a=>a.id===(source.parentId??source.id))?.kind??source.kind;
 if(kind==='variant')return null;
 const board=isDesignBoard(source);
 const views=library.filter(a=>!a.retired&&a.sourceAssetId===source.id&&a.viewId),ready=views.filter(a=>a.approved&&a.status==='ready').length;
 return <section className="asset-prompt-card"><h4>{source.setName?'服装套装：'+source.setName:'整套设定图设计'}</h4><p>{assetViews[kind].map(v=>v.label).join(' · ')}</p><p className="help">{board?'当前为一张多面板设定板：请核对各分区，确认基准造型；发型与服装探索不自动用于分镜。下方独立视角仅按需补充。':'旧版单视角资产。可创建多面板设定板候选，或继续补充独立视角。'}</p><Button disabled={busy||!source.approved} onClick={()=>void act('asset_views',{assetId:source.id})}>可选：补充独立视角清单（不生图）</Button>
 {(board||views.length>0)&&<><p>{board?'设定板已确认；独立补充图':'已确认'} {ready} / {views.length} 张 · {source.setReview?'整套审核通过':'等待整套审核'}</p><div className="asset-contact-sheet">{views.filter(v=>v.url).map(v=><figure key={v.id}><Image src={v.url!} alt={v.name} width={240} height={240} unoptimized/><figcaption>{v.name} · {v.approved?'已确认':'待确认'}</figcaption></figure>)}</div><ul>{views.map(v=><li key={v.id}>{v.name} — {v.approved?'已确认':v.status==='draft'?'待生成':v.status==='ready'?'待确认':v.status==='running'?'生成中':'失败'}</li>)}</ul><label>一致性审核意见<textarea value={review} onChange={e=>setReview(e.target.value)} placeholder={kind==='character'?'核对各角度脸型、身材、发型、服装结构与配色是否一致':kind==='background'?'核对门窗位置、空间尺度、固定设施与反向视角是否一致':'核对各方向尺寸比例、按钮部件和开合状态是否一致'}/></label><Button disabled={busy||ready!==views.length||!review.trim()} onClick={()=>void act('asset_set_review',{assetId:source.id,notes:review})}>确认整套一致性</Button>{source.setReview&&<p>审核记录：{source.setReview.notes}</p>}</>}
 {(kind==='character'||kind==='prop')&&<><label>{kind==='character'?'新增服装分套':'增加道具状态图'}<textarea value={proposal} onChange={e=>setProposal(e.target.value)} placeholder={kind==='character'?'例如：黑色休闲夹克、白色内搭；保持原人物身份。新服装独立建套，不替换原校服。':'例如：翻盖手机打开状态，铰链位于上边缘。只填写实际具备的结构和状态。'}/></label><Button disabled={busy||!proposal.trim()} onClick={()=>void act(kind==='character'?'asset_costume':'asset_prop_state',{assetId:source.id,notes:proposal})}>{kind==='character'?'创建独立服装主图候选':'创建独立状态候选'}（不生图）</Button></>}
 {kind==='character'&&source.setReview&&<Button disabled={busy} onClick={()=>void act('asset_use_costume',{assetId:source.id})}>全片分镜使用此套服装（旧素材失效）</Button>}{source.costumeOf&&<p className="help">这是独立服装方案，需要明确选择后才用于分镜，不会与原服装同时输入。</p>}
 </section>;
}
