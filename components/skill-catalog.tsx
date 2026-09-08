'use client';
import { useEffect, useState } from 'react';
type Skill={id:string;name:string;role:string;version:string;instructions:string};
export function SkillCatalog(){const [skills,setSkills]=useState<Skill[]>([]),[error,setError]=useState('');
 useEffect(()=>{let active=true;void fetch('/api/studio',{method:'POST',headers:{'Content-Type':'application/json','X-Frame-Local':'1'},body:JSON.stringify({action:'skills'})}).then(async r=>{if(!r.ok)throw new Error('无法读取专业规范。');return r.json() as Promise<{data:Skill[]}>;}).then(v=>{if(active)setSkills(v.data);}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[]);
 return <section className="panel skill-catalog"><h2>工作流专业规范</h2><p className="help">这些是工作台实际使用的任务规范。模型节点读取规范执行；调度与导出仍由确定性代码控制。规范不会替代真实素材检查。</p>{error&&<p role="alert" className="error">{error}</p>}{skills.map(s=><details key={s.id}><summary>{s.name} · v{s.version} <small> / {s.role}</small></summary><pre>{s.instructions}</pre></details>)}</section>;
}
