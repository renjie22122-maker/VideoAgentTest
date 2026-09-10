import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { languagePresets, languagePreset, languageProtocols } from './provider-catalog.ts';

export const settingKeys=['LLM_BASE_URL','LLM_API_KEY','LLM_MODEL','LLM_PROVIDER','LLM_PROTOCOL','LLM_JSON_MODE','LLM_MAX_TOKENS','LLM_WORKSPACE_ID','MEDIA_GATEWAY_URL','MEDIA_API_KEY','IMAGE_MODEL','VIDEO_MODEL','VIDEO_PROVIDER','VIDEO_GENERATE_AUDIO','QA_GATEWAY_URL','QA_API_KEY','IMAGE_PROVIDER','OPENAI_IMAGE_MODEL','OPENAI_IMAGE_API_KEY','FAL_API_KEY'] as const;
export type SettingKey=typeof settingKeys[number];
export type SettingsView={revision:number;values:Record<string,string>;secrets:Record<string,boolean>};
type Stored={revision:number;values:Partial<Record<SettingKey,string>>};
const secret=(key:string)=>key.endsWith('_KEY');
function filename(){return path.resolve(process.env.STUDIO_DATA_DIR||'.studio','api-settings.json');}
function read():Stored {try{return JSON.parse(readFileSync(filename(),'utf8')) as Stored;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {revision:0,values:{}};throw new Error('无法读取本地 API 设置。');}}
export function setting(key:SettingKey):string{return read().values[key]??process.env[key]??'';}
export function publicSettings():SettingsView {const data=read();const values:Record<string,string>={},secrets:Record<string,boolean>={};for(const key of settingKeys){const v=data.values[key]??process.env[key]??'';if(secret(key))secrets[key]=!!v;else values[key]=v;}return {revision:data.revision,values,secrets};}
export function saveSettings(input:unknown):SettingsView {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('设置格式无效。');
 const patch=input as {revision?:unknown;values?:unknown;clearSecrets?:unknown};const data=read();if(patch.revision!==data.revision)throw new Error('设置已在其他窗口更新，请重新打开设置。');
 if(!patch.values||typeof patch.values!=='object'||Array.isArray(patch.values))throw new Error('设置字段无效。');
 const values={...data.values};const fields=patch.values as Record<string,unknown>;
 const clear=patch.clearSecrets??[];if(!Array.isArray(clear)||clear.some(k=>typeof k!=='string'||!settingKeys.includes(k as SettingKey)||!secret(k)))throw new Error('清除密钥字段无效。');
 for(const [k,v] of Object.entries(fields)){
   if(!settingKeys.includes(k as SettingKey)||typeof v!=='string'||v.length>(secret(k)?8192:2000)||v.includes('\r')||v.includes('\n')||v.includes('\0'))throw new Error('API 设置字段或长度无效。');
   const key=k as SettingKey;const value=v.trim();if(secret(key)&&!value)continue;
   if(key==='LLM_PROVIDER'&&value&&!languagePresets.some(p=>p.id===value))throw new Error('请选择有效的语言模型服务商。');
   if(key==='LLM_PROTOCOL'&&value&&!languageProtocols.some(p=>p.id===value))throw new Error('请选择有效的语言模型接口协议。');
   if(key==='LLM_JSON_MODE'&&!['','auto','prompt'].includes(value))throw new Error('请选择有效的结构化输出设置。');
   if(key==='LLM_MAX_TOKENS'&&value&&(!/^\d+$/.test(value)||Number(value)<512||Number(value)>131072))throw new Error('语言模型输出上限须为 512–131072 的整数。');
   if(key==='VIDEO_PROVIDER'&&!['','gateway','minimax','fal-kling'].includes(value))throw new Error('请选择有效的视频服务。');
   if(key==='VIDEO_GENERATE_AUDIO'&&!['','true','false'].includes(value))throw new Error('视频声音设置无效。');
   if(key==='IMAGE_PROVIDER'&&!['','gateway','openai','fal'].includes(value))throw new Error('请选择有效的图像服务。');
   if(key==='OPENAI_IMAGE_MODEL'&&value&&!['gpt-image-2','gpt-image-1.5','gpt-image-1','gpt-image-1-mini'].includes(value))throw new Error('请选择支持的 GPT Image 模型。');
   if(key.endsWith('_URL')&&value){let url:URL;try{url=new URL(value);}catch{throw new Error('请填写有效的 API 地址。');}
     if(url.username||url.password||url.search||url.hash)throw new Error('API 地址不能包含密钥、查询参数或账号密码。');
     if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('API 地址必须使用 HTTPS，本机服务可使用 HTTP。');
     values[key]=url.href.replace(/\/$/,'');
   }else values[key]=value;
 }
 for(const k of clear)values[k as SettingKey]='';
 // Never silently send an existing provider's key to a different host.
 for(const [urlKey,key] of [['LLM_BASE_URL','LLM_API_KEY'],['MEDIA_GATEWAY_URL','MEDIA_API_KEY'],['QA_GATEWAY_URL','QA_API_KEY']] as const){
   const configuredOld=data.values[urlKey]??process.env[urlKey]??'',configuredNext=values[urlKey]??configuredOld;
   const old=urlKey==='LLM_BASE_URL'?(configuredOld||languagePreset(data.values.LLM_PROVIDER??process.env.LLM_PROVIDER??'').baseUrl):configuredOld;
   const next=urlKey==='LLM_BASE_URL'?(configuredNext||languagePreset(values.LLM_PROVIDER??data.values.LLM_PROVIDER??process.env.LLM_PROVIDER??'').baseUrl):configuredNext;
   if(next&&(!old||new URL(old).origin!==new URL(next).origin)&&(data.values[key]??process.env[key])&&!clear.includes(key)&&!(typeof fields[key]==='string'&&fields[key].trim()))throw new Error('更换服务商地址时，请重新填写或清除对应密钥。');
 }
 const file=filename();mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file+'.tmp',JSON.stringify({revision:data.revision+1,values},null,2),{encoding:'utf8',mode:0o600});renameSync(file+'.tmp',file);return publicSettings();
}
