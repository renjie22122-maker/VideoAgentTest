'use client';
import { useEffect, useState } from 'react';
import { Save, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Capabilities } from '@/lib/studio/types';
import type { SettingsView } from '@/lib/studio/settings';
import { studioRequest } from '@/lib/studio/client';
import { languagePresets, languagePreset, languageProtocols, detectLanguagePreset, isLocalLanguageUrl } from '@/lib/studio/provider-catalog';

type Field=[string,string,string];
const imageFields:Field[]=[['IMAGE_PROVIDER','图像服务',''],['OPENAI_IMAGE_MODEL','GPT 图像模型',''],['OPENAI_IMAGE_API_KEY','OpenAI 图像 API Key','']];
const mediaFields:Field[]=[['MEDIA_GATEWAY_URL','MiniMax / 自建网关基础地址','https://api.minimax.io/v1'],['IMAGE_MODEL','网关图像模型 ID','仅自建图像网关使用'],['VIDEO_MODEL','MiniMax / 网关视频模型 ID','MiniMax-H3 或网关中的模型 ID'],['MEDIA_API_KEY','MiniMax / 网关 API Key','']];
const qaFields:Field[]=[['QA_GATEWAY_URL','审片网关地址','https://your-review-gateway.example'],['QA_API_KEY','审片 API Key','']];
const selections:Record<string,readonly(readonly[string,string])[]>={
 IMAGE_PROVIDER:[['gateway','自建媒体网关'],['openai','OpenAI 文生图'],['fal','fal.ai（FLUX / Seedream）']],
 OPENAI_IMAGE_MODEL:[['gpt-image-2','GPT Image 2'],['gpt-image-1.5','GPT Image 1.5'],['gpt-image-1','GPT Image 1'],['gpt-image-1-mini','GPT Image 1 Mini']],
 VIDEO_PROVIDER:[['','自动识别（原配置）'],['minimax','MiniMax · 原生 H3'],['fal-kling','fal.ai · Kling 3.0 Pro'],['gateway','自建媒体网关']],
 VIDEO_GENERATE_AUDIO:[['','使用服务默认设置'],['true','生成原生声音'],['false','仅生成画面']],
 LLM_PROTOCOL:languageProtocols.map(p=>[p.id,p.label]),
 LLM_JSON_MODE:[['auto','自动选择结构化输出参数'],['prompt','仅通过提示词约束 JSON（兼容模式）']],
};
function request<T>(action:string,settings?:unknown):Promise<T>{return studioRequest<T>(action,{settings});}
export function ApiSettings({onSaved}:{onSaved:(caps:Capabilities)=>void}){
 const [snapshot,setSnapshot]=useState<SettingsView|null>(null);
 const [values,setValues]=useState<Record<string,string>>({});
 const [clear,setClear]=useState<string[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{let active=true;void request<SettingsView>('settings').then(data=>{if(active){setSnapshot(data);setValues(data.values);}}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[]);
 const provider=values.LLM_PROVIDER||detectLanguagePreset(values.LLM_BASE_URL||'');
 const preset=languagePreset(provider);
 const protocol=values.LLM_PROTOCOL||preset.protocol;
 const local=isLocalLanguageUrl(values.LLM_BASE_URL||preset.baseUrl)&&protocol==='openai';
 const video=values.VIDEO_PROVIDER||'';
 function update(key:string,value:string){setValues(v=>({...v,[key]:value}));setMessage('');}
 function chooseProvider(id:string){
   const next=languagePreset(id);
   setValues(v=>({...v,LLM_PROVIDER:id,...(id==='custom'?{}:{LLM_BASE_URL:next.baseUrl,LLM_PROTOCOL:next.protocol,LLM_MODEL:'',LLM_API_KEY:'',LLM_JSON_MODE:'auto',LLM_MAX_TOKENS:'',LLM_WORKSPACE_ID:''})}));
   setMessage(id==='custom'?'保留当前字段，可手动调整。':'已填入服务地址和协议，请填写该服务可用的模型 ID。更换服务时需重新填写或清除原密钥；保存后生效。');
 }
 async function save(){
  if(!snapshot)return;setBusy(true);setError('');setMessage('');
  try{const data=await request<{settings:SettingsView;capabilities:Capabilities}>('save_settings',{revision:snapshot.revision,values,clearSecrets:clear});setSnapshot(data.settings);setValues(data.settings.values);setClear([]);onSaved(data.capabilities);setMessage('已保存并立即生效。新建作品时可选择“真实 API”；已有演示作品保持演示模式。本次仅保存配置，没有调用计费接口。');}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 function field([key,label,placeholder]:Field){
  const isSecret=key.endsWith('_KEY');
  const options=selections[key];
  const defaults:Record<string,string>={IMAGE_PROVIDER:'gateway',OPENAI_IMAGE_MODEL:'gpt-image-2',LLM_PROTOCOL:protocol,LLM_JSON_MODE:'auto'};
  return <div key={key}><label>{label}{isSecret&&<small> · {snapshot?.secrets[key]?'已设置':'未设置'}</small>}{options?<select value={values[key]||defaults[key]||''} onChange={e=>update(key,e.target.value)}>{options.map(([value,name])=><option key={value} value={value}>{name}</option>)}</select>:<input type={isSecret?'password':key==='LLM_MAX_TOKENS'?'number':'text'} autoComplete="off" spellCheck={false} value={values[key]??''} placeholder={isSecret?(snapshot?.secrets[key]?'留空保留现有密钥':local&&key==='LLM_API_KEY'?'本机模型可留空':'输入密钥'):placeholder} disabled={clear.includes(key)} {...(key==='LLM_MAX_TOKENS'?{min:512,max:131072,step:1}:{})} onChange={e=>update(key,e.target.value)}/>}</label>{isSecret&&snapshot?.secrets[key]&&<label className="clear-key"><input type="checkbox" checked={clear.includes(key)} onChange={e=>{setClear(e.target.checked?[...clear,key]:clear.filter(k=>k!==key));update(key,'');}}/>清除此服务的密钥</label>}</div>;
 }
 return <section className="panel api-settings">
  <div className="section-head"><h2><KeyRound size={18}/>API 配置</h2><span>本机保存 · 无需重启</span></div>
  <p className="help">按用途选择服务。密钥只保存在本机服务端，不回显，也不写入浏览器存储。留空保留原密钥，勾选“清除”才会删除。</p>
  {!snapshot&&!error&&<output>正在读取配置…</output>}
  {error&&<p className="banner error" role="alert">{error}</p>}
  {snapshot&&<form onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy} style={{border:0,padding:0}}>
   <section className="api-group"><h3>语言模型 · 总 Agent 与专业岗位</h3>
    <label>选择服务商<select value={provider} onChange={e=>chooseProvider(e.target.value)}>{languagePresets.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
    <p className="help">{preset.description} {preset.docs&&<a href={preset.docs} target="_blank" rel="noreferrer">查看官方接口文档</a>}</p>
    <div className="form-grid">{field(['LLM_MODEL','模型 ID',preset.modelHint])}{field(['LLM_API_KEY','语言模型 API Key',''])}</div>
    <details><summary>地址、协议与长文本设置</summary><div className="form-grid">
     {field(['LLM_BASE_URL','API 基础地址（不含具体方法路径）',preset.baseUrl||'https://your-provider.example/v1'])}
     {field(['LLM_PROTOCOL','接口协议',''])}
     {field(['LLM_MAX_TOKENS','单次输出上限（Token，可选）','留空沿用供应商默认；Claude 默认 16384'])}
     {field(['LLM_JSON_MODE','结构化输出',''])}
     {protocol==='anthropic'&&field(['LLM_WORKSPACE_ID','Anthropic 工作区 ID（可选）','仅多工作区密钥需要'])}
    </div><p className="help">长剧本或完整分镜可能需要提高输出上限，具体范围和费用取决于所选模型。基础地址不要附加 /chat/completions、/messages 或 :generateContent。兼容模式仍会检查结果结构。专业岗位可在岗位设置中使用同一服务下的其他模型。</p></details>
    <p className="help">当前接口：{languageProtocols.find(p=>p.id===protocol)?.label} · {local?'本机模型，无密钥也可连接':'独立 API 密钥'}。保存配置不会验证余额或发起生成。</p>
   </section>
   <section className="api-group"><h3>fal.ai · 图像与 Kling 视频</h3><p className="help">图像使用 FLUX / Seedream，视频可选 Kling 3.0 Pro。共用 fal.ai 密钥，分别选择启用的服务。</p><div className="form-grid">{field(['FAL_API_KEY','fal.ai API Key',''])}</div></section>
   <section className="api-group"><h3>图像服务</h3><p className="help">OpenAI 使用独立图像密钥，生成结果保存在本机；fal.ai 用于美术资产、多参考图与分镜合成。</p><div className="form-grid">{imageFields.map(field)}</div></section>
   <section className="api-group"><h3>视频服务</h3><div className="form-grid">{field(['VIDEO_PROVIDER','视频生成服务',''])}{video==='fal-kling'&&field(['VIDEO_GENERATE_AUDIO','Kling 原生声音',''])}</div>
    <p className="help">{video==='fal-kling'?'Kling 3.0 Pro 通过 fal.ai 接入，复用上方 fal.ai 密钥，无需填写 VIDEO_MODEL。支持文字、首帧、首尾帧，3–15 整数秒，可选择生成中英文原生声音。此接入暂不支持直接上传美术参考图集合模式。':video==='gateway'?'自建网关需实现项目定义的 /jobs 协议，不能直接填写任意视频供应商地址。':'MiniMax 国际站自动使用 H3 原生 V2 接口；填写 MiniMax-H3 或 MiniMax-H3-Max。原配置的其他地址使用自建 /jobs 网关协议。'}</p>
    {video!=='fal-kling'?<div className="form-grid">{mediaFields.map(field)}</div>:values.IMAGE_PROVIDER==='gateway'&&<details><summary>备用图像网关配置</summary><div className="form-grid">{mediaFields.filter(([key])=>key!=='VIDEO_MODEL').map(field)}</div></details>}
   </section>
   <details className="api-group"><summary>视觉审片网关（可选）</summary><p className="help">网关需实现 /review 并分析实际画面；未配置时保留人工审片。</p><div className="form-grid">{qaFields.map(field)}</div></details>
   <Button type="submit" disabled={busy}><Save/>{busy?'正在保存…':'保存 API 设置'}</Button>
  </fieldset></form>}
  {message&&<output className="banner">{message}</output>}
 </section>;
}
