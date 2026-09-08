'use client';
import { filmTeam, teamForStage } from '@/lib/studio/team';
import type { Project } from '@/lib/studio/types';
import { Button } from './ui/button';
export function AgentTeam({project,busy,act}:{project:Project;busy:boolean;act:(action:string,data?:Record<string,unknown>)=>Promise<unknown>}){
 const stage=project.production?.node??'clarify',recommended=teamForStage(stage);
 return <section className="panel"><h2>制作团队 · 总 Agent 协调</h2><p>当前阶段建议：{recommended.map(r=>r.name).join('、')}。各部门读取同一版剧本、资产与分镜；报告提供证据与返工岗位，由导演和用户决定修改。修改作品后旧报告需重新审查。</p><p className="help">真实模式下，每次会审调用一次语言模型并计费。这里审查文字方案，不把未看过的图像或视频判为合格；不会自动启动付费生图或视频。</p>
 {filmTeam.map(role=>{const report=[...(project.production?.teamReports??[])].reverse().find(r=>r.roleId===role.id);return <details key={role.id}><summary>{role.name} · {report?(report.revision===project.revision?'本版已有报告':'旧版报告待更新'):'尚未独立会审'}</summary><p>交付：{role.deliverable}</p><p>{role.checks}</p><Button disabled={busy} onClick={()=>void act('team_review',{roleId:role.id})}>运行{role.name}会审{project.mode==='live'?'（模型调用）':'（演示）'}</Button>{report&&<><p>{report.mode==='demo'?'演示 · ':''}{report.summary}</p>{report.findings.map((f,i)=><div className="issue" key={i}><div><strong>{f.shotId||'全局'} · {f.severity==='error'?'冲突':f.severity==='warning'?'待复核':'建议'}</strong><p>依据：{f.evidence}</p><p>建议：{f.suggestion}</p><small>返工岗位：{filmTeam.find(r=>r.id===f.returnTo)?.name}</small></div></div>)}</>}</details>;})}</section>;
}
