import { setting } from './settings.ts';
import { languagePreset, languageProtocols, detectLanguagePreset, isLocalLanguageUrl, type LanguageProtocol } from './provider-catalog.ts';
import { fetchJSON } from './http.ts';
import { networkError } from './network.ts';
import { LLM_TIMEOUT_MS } from './timeouts.ts';
import { estimateLLMCost } from './durable/pricing.ts';
import { safely } from './durable/ledger.ts';

export type LanguageMessage={role:'system'|'user'|'assistant';content:string};
export type LanguageConfig={provider:string;protocol:LanguageProtocol;baseUrl:string;model:string;apiKey:string;jsonMode:'auto'|'prompt';maxTokens?:number;workspaceId?:string};
export type LanguageErrorCode='configuration'|'network'|'authentication'|'rate_limit'|'http'|'truncated'|'refusal'|'empty'|'format';
export class LanguageProviderError extends Error {
  readonly code:LanguageErrorCode;
  readonly status?:number;
  constructor(code:LanguageErrorCode,message:string,status?:number){super(message);this.name='LanguageProviderError';this.code=code;this.status=status;}
}
export function languageConfig():LanguageConfig {
  const provider=setting('LLM_PROVIDER')||detectLanguagePreset(setting('LLM_BASE_URL'));
  const preset=languagePreset(provider);
  const protocol=setting('LLM_PROTOCOL')||preset.protocol;
  if(!languageProtocols.some(p=>p.id===protocol))throw new LanguageProviderError('configuration','请选择有效的语言模型接口协议。');
  const limit=setting('LLM_MAX_TOKENS');
  if(limit&&(!/^\d+$/.test(limit)||Number(limit)<512||Number(limit)>131072))throw new LanguageProviderError('configuration','语言模型输出上限须为 512–131072 的整数。');
  return {provider,protocol:protocol as LanguageProtocol,baseUrl:setting('LLM_BASE_URL')||preset.baseUrl,model:setting('LLM_MODEL'),apiKey:setting('LLM_API_KEY'),jsonMode:setting('LLM_JSON_MODE')==='prompt'?'prompt':'auto',...(limit?{maxTokens:Number(limit)}:{}),workspaceId:setting('LLM_WORKSPACE_ID')};
}
function validateConfig(c:LanguageConfig):URL {
  let target:URL;
  try { target=new URL(c.baseUrl); } catch { throw new LanguageProviderError('configuration','请配置语言模型的 API 基础地址。'); }
  if(target.username||target.password||target.search||target.hash||(target.protocol!=='https:'&&!(target.protocol==='http:'&&isLocalLanguageUrl(c.baseUrl))))throw new LanguageProviderError('configuration','API 地址须使用 HTTPS，本机地址可使用 HTTP；不能包含密钥或查询参数。');
  if(!c.model.trim()||c.model.length>2000||['\r','\n','\0'].some(ch=>c.model.includes(ch)))throw new LanguageProviderError('configuration','请填写当前服务商可用的语言模型 ID。');
  if(!c.apiKey&&!(c.protocol==='openai'&&isLocalLanguageUrl(c.baseUrl)))throw new LanguageProviderError('configuration','请填写当前语言服务的 API 密钥。');
  if(c.maxTokens!==undefined&&(!Number.isInteger(c.maxTokens)||c.maxTokens<512||c.maxTokens>131072))throw new LanguageProviderError('configuration','语言模型输出上限须为 512–131072 的整数。');
  if(!languageProtocols.some(p=>p.id===c.protocol))throw new LanguageProviderError('configuration','语言模型协议无效。');
  return target;
}
export function languageReady():boolean {try{validateConfig(languageConfig());return true;}catch{return false;}}

// Keep vendor extensions out of the role prompts and workflow graph.
export function languageOptions(model:string):Record<string,unknown> {
  return /^MiniMax-/i.test(model)?{reasoning_split:true}:{response_format:{type:'json_object'}};
}
type WireRequest={url:URL;body:Record<string,unknown>;headers:Record<string,string>};
export function buildLanguageRequest(messages:readonly LanguageMessage[],c:LanguageConfig):WireRequest {
  const target=validateConfig(c);
  const base=target.href.replace(/\/$/,'');
  const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
  const turns=messages.filter(m=>m.role!=='system');
  const headers:Record<string,string>={'Content-Type':'application/json'};
  if(!turns.length)throw new LanguageProviderError('configuration','语言模型请求缺少用户内容。');
  if(c.protocol==='anthropic'){
    headers['x-api-key']=c.apiKey;headers['anthropic-version']='2023-06-01';
    if(c.workspaceId)headers['anthropic-workspace-id']=c.workspaceId;
    return {url:new URL(base+'/messages'),headers,body:{model:c.model,max_tokens:c.maxTokens??16384,system,messages:turns,stream:false}};
  }
  if(c.protocol==='gemini'){
    headers['x-goog-api-key']=c.apiKey;
    const model=c.model.replace(/^models\//,'');
    return {url:new URL(base+'/models/'+encodeURIComponent(model)+':generateContent'),headers,body:{systemInstruction:{parts:[{text:system}]},contents:turns.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),generationConfig:{...(c.jsonMode==='auto'?{responseMimeType:'application/json'}:{}),...(c.maxTokens?{maxOutputTokens:c.maxTokens}:{})}}};
  }
  if(c.apiKey)headers.Authorization='Bearer '+c.apiKey;
  const options=languageOptions(c.model);
  if(c.jsonMode==='prompt')delete options.response_format;
  const limitKey=c.provider==='openai'||target.hostname==='api.openai.com'?'max_completion_tokens':'max_tokens';
  return {url:new URL(base+'/chat/completions'),headers,body:{model:c.model,messages,stream:false,...options,...(c.maxTokens?{[limitKey]:c.maxTokens}:{})}};
}
function record(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function records(value:unknown):Record<string,unknown>[]{return Array.isArray(value)?value.map(record):[];}
const truncated=()=>new LanguageProviderError('truncated','语言模型输出已达到长度上限，结果不完整。请增加 API 设置中的输出上限或缩小本次任务；原有内容未改变。');
const refused=()=>new LanguageProviderError('refusal','语言模型未提供可用的创作结果（拒绝或内容拦截）。请检查输入和供应商调用记录。');
export function languageResponseText(raw:unknown,protocol:LanguageProtocol):string {
  const data=record(raw);let content:unknown;
  if(protocol==='anthropic'){
    if(data.stop_reason==='max_tokens')throw truncated();
    if(data.stop_reason==='refusal')throw refused();
    content=records(data.content).filter(p=>p.type==='text').map(p=>typeof p.text==='string'?p.text:'').join('');
  }else if(protocol==='gemini'){
    const candidate=records(data.candidates)[0]??{};
    if(candidate.finishReason==='MAX_TOKENS')throw truncated();
    if(record(data.promptFeedback).blockReason||['SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT','SPII','IMAGE_SAFETY'].includes(String(candidate.finishReason)))throw refused();
    content=records(record(candidate.content).parts).filter(p=>p.thought!==true).map(p=>typeof p.text==='string'?p.text:'').join('');
  }else{
    const choice=records(data.choices)[0]??{};const message=record(choice.message);
    if(choice.finish_reason==='length')throw truncated();
    if(choice.finish_reason==='content_filter'||message.refusal)throw refused();
    content=typeof message.content==='string'?message.content:records(message.content).filter(p=>p.type==='text').map(p=>typeof p.text==='string'?p.text:'').join('');
  }
  if(typeof content!=='string'||!content.trim())throw new LanguageProviderError('empty','语言模型未返回可用文本，请核对所选模型是否支持当前接口。');
  const cleaned=content.replace(/^\s*<think>[\s\S]*?<\/think>\s*/,'').trim();
  if(!cleaned)throw new LanguageProviderError('empty','语言模型仅返回了思考内容，没有最终结果。');
  return cleaned;
}
export async function languageText(messages:readonly LanguageMessage[],options:{model?:string;projectId?:string}={}):Promise<string>{
  const config=languageConfig();if(options.model)config.model=options.model;
  const wire=buildLanguageRequest(messages,config);
  // Cost ledger: blended estimate from prompt length (documented estimate).
  // projectId attributes the spend to a project when the caller provides it.
  safely((ledger)=>ledger.recordUsage({
    id: globalThis.crypto.randomUUID(),
    projectId: options.projectId ?? '',
    category: 'llm',
    provider: config.provider,
    model: config.model,
    estimatedCost: estimateLLMCost(config.model, Math.ceil(JSON.stringify(messages).length / 3.5)),
    jobId: '',
    createdAt: Date.now(),
  }));
  let result:{response:Response;data:unknown};
  try{result=await fetchJSON(wire.url,{method:'POST',headers:wire.headers,body:JSON.stringify(wire.body),redirect:'error'},LLM_TIMEOUT_MS);}
  catch(error){if(error instanceof SyntaxError)throw new LanguageProviderError('format','语言服务返回的响应不是完整 JSON，请核对接口地址及供应商记录。');throw new LanguageProviderError('network',networkError(error,wire.url.hostname).message);}
  const status=result.response.status;
  if(!result.response.ok){const code=status===401||status===403?'authentication':status===429?'rate_limit':'http';throw new LanguageProviderError(code,'语言服务请求失败（HTTP '+status+'）：'+(status===404?'接口路径或模型不存在，请检查协议、基础地址和模型 ID。':status===401||status===403?'密钥或模型访问权限无效。':status===402?'余额不足。':status===429?'请求频率或额度受限，请稍后再试。':status===400?'请求参数不受当前模型支持，请检查模型、输出上限和结构化输出设置。':'供应商服务异常，请核对调用记录。'),status);}
  return languageResponseText(result.data,config.protocol);
}
export function parseLanguageJSON(raw:string):Record<string,unknown>{
  try{const value:unknown=JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value as Record<string,unknown>;}
  catch{throw new LanguageProviderError('format','语言模型返回的内容不是合法 JSON 对象。');}
}
export async function languageJSON(messages:readonly LanguageMessage[],options:{model?:string}={}):Promise<Record<string,unknown>>{return parseLanguageJSON(await languageText(messages,options));}
