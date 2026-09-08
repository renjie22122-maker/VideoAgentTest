export function networkError(error:unknown,host:string):Error {
 const e=error as {name?:string;cause?:{code?:string;errors?:{code?:string}[]}};
 const codes=[e?.cause?.code,...(e?.cause?.errors??[]).map(v=>v.code)];
 if(codes.some(c=>c==='EACCES'||c==='EPERM'))return new Error('无法连接 '+host+'：运行工作台的进程没有外网权限。请以允许联网的方式重新启动本地服务。');
 if(e?.name==='TimeoutError'||e?.name==='AbortError'||codes.includes('UND_ERR_CONNECT_TIMEOUT'))return new Error('连接 '+host+' 超时，请检查网络或代理后重试。请求结果尚未确认，请勿连续重复提交。');
 if(codes.some(c=>c==='ENOTFOUND'||c==='EAI_AGAIN'))return new Error('无法解析 '+host+'，请检查 API 地址及 DNS。');
 if(codes.some(c=>c==='ECONNREFUSED'||c==='ECONNRESET'))return new Error('与 '+host+' 的连接被拒绝或中断，请检查服务状态及代理。');
 return new Error('无法连接 '+host+'，请检查本机网络、代理和证书配置。');
}
