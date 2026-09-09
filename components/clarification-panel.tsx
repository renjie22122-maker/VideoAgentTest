'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Project } from '@/lib/studio/types';
export function ClarificationPanel({project,answers,onAnswers,busy,onAction}:{project:Project;answers:Record<string,string>;onAnswers:(v:Record<string,string>)=>void;busy:boolean;onAction:(action:string,data:Record<string,unknown>,navigate?:boolean)=>Promise<unknown>}){
 const [notes,setNotes]=useState('');const brief=project.brief;const editing=project.production?.node==='clarify';
 async function submit(action:string){const result=await onAction(action,{answers,notes},true);if(result)setNotes('');}
 if(!brief)return <div><p className="help">本幕尚未进行针对性创意分析。</p>{editing&&<Button disabled={busy} onClick={()=>void submit('analyze_brief')}>阅读创意，分析需要澄清的内容</Button>}</div>;
 return <div className="clarification"><div className="section-head"><h2>创意开发编辑的理解</h2><small>第 {brief.round} 轮 · {brief.source==='model'?'模型分析':'演示关键词分析'}</small></div><p className="brief-summary">{brief.summary}</p>{brief.known.length>0&&<details><summary>已确认的信息与依据 · {brief.known.length} 项</summary>{brief.known.map((f,i)=><div className="known-fact" key={i}><strong>{f.topic}</strong><p>{f.value}</p><small>依据：“{f.evidence}”</small></div>)}</details>}{brief.assumptions.length>0&&<div className="brief-assumptions"><h3>待你确认的建议</h3>{brief.assumptions.map((a,i)=><p key={i}>{a}</p>)}</div>}{brief.history.length>0&&<details><summary>已回答的澄清问题</summary>{brief.history.map((h,i)=><div className="known-fact" key={i}><strong>{h.question}</strong><p>{h.answer}</p></div>)}</details>}
 {editing&&<>{brief.ready?<p className="pass">关键歧义已处理，请确认上述理解和建议后开始编剧。</p>:<div className="fields"><h3>这些选择会影响成片</h3>{project.questions.map((q,i)=><div key={q.id} className="clarify-question"><label><span className="question-number">0{i+1}</span>{q.label}<textarea disabled={busy} placeholder={q.placeholder} value={answers[q.id]??''} onChange={e=>onAnswers({...answers,[q.id]:e.target.value})}/></label>{q.why&&<p className="help">为什么问：{q.why}</p>}<div className="answer-options">{q.options?.map(option=><Button key={option} variant="outline" disabled={busy} onClick={()=>onAnswers({...answers,[q.id]:option})}>{option}</Button>)}</div></div>)}</div>}<label>补充要求 / 纠正理解（可选）<textarea disabled={busy} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="例如：信不是来自未来，而是写给未来的自己；不要旁白。"/></label>
 {!brief.ready&&<Button disabled={busy||project.questions.some(q=>!answers[q.id]?.trim())} onClick={()=>void submit(brief.round>=3?'confirm_brief':'clarify_answers')}>{brief.round>=3?'确认当前回答，允许编剧补充细节':'提交回答，检查是否仍有歧义'}</Button>}
 {brief.ready&&notes.trim()&&<Button disabled={busy} onClick={()=>void submit(brief.round>=3?'confirm_brief':'clarify_answers')}>更新补充要求并检查理解</Button>}
 {brief.ready&&!notes.trim()&&<Button disabled={busy} onClick={()=>void submit('plan')}>确认创意理解与建议，生成结构化剧本</Button>}
 </>}</div>;
}
