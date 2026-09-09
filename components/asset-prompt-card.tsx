'use client';
import type { Asset } from '@/lib/studio/types';
export function AssetPromptCard({asset,library}:{asset:Asset;library:Asset[]}){
 let spec:Record<string,unknown>|null=null;try{const value:unknown=JSON.parse(asset.prompt);if(value&&typeof value==='object'&&!Array.isArray(value))spec=value as Record<string,unknown>;}catch{/* Existing prompts remain readable. */}
 return <section className="asset-prompt-card" aria-label={asset.name+'生成提示词'}><h4>{asset.origin==='upload'?'上传资产的后续设计约束':'生成前可检查的结构化提示词'}</h4>{asset.origin==='upload'&&<p>此图片来自本地文件，未使用以下提示词生成；设计约束供后续衍生图使用。</p>}<p className="help">设计规范版本：{asset.promptVersion??'旧版'} · {asset.status==='draft'?'尚未提交生图':'此候选记录的生成要求'}</p>
 {asset.evidence&&<p><strong>设定依据：</strong>{asset.evidence}</p>}
 {spec?<dl>{Object.entries(spec).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{typeof value==='string'?value:JSON.stringify(value,null,2)}</dd></div>)}</dl>:<p style={{whiteSpace:'pre-wrap'}}>{asset.prompt}</p>}
 <p><strong>{asset.origin==='upload'?'后续衍生设计的参考图：':'生成输入参考图：'}</strong>{asset.referenceIds.length?asset.referenceIds.map((id,index)=>{const a=library.find(a=>a.id===id);return (index+1)+'. '+(a?.name??id)+' V'+(a?.version??'?');}).join('；'):asset.origin==='upload'?'当前图片直接来自上传，未调用生图模型':'无；此提示词用于独立文生图'}</p>
 <details><summary>{asset.origin==='upload'?'查看后续设计约束（未用于生成上传图片）':asset.status==='draft'?'查看待提交的完整提示词':'查看此候选的完整提示词'}</summary><pre>{asset.prompt}</pre></details>
 </section>;
}
