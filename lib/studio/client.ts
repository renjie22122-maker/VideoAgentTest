import { studioTimeoutMs } from './timeouts.ts';
import { fetchJSON } from './http.ts';
import {recordStudioResult,recordStudioFailure} from './notification-client.ts';

export async function studioRequest<T>(action:string,data:Record<string,unknown>={}):Promise<T>{
 try{
  const {response,data:body}=await fetchJSON('/api/studio',{method:'POST',headers:{'Content-Type':'application/json','X-Frame-Local':'1'},body:JSON.stringify({action,...data})},studioTimeoutMs(action));
  const result=body as {error?:string;data:T};
  if(!response.ok)throw new Error(result.error||'请求失败，请重新打开作品查看当前状态。');
  recordStudioResult(action,result.data);
  return result.data;
 }catch(error){
  let failure=error;
  if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))failure=new Error('等待工作台响应超时。服务端可能仍在处理，请先重新打开作品查看结果，不要连续重复提交。');
  if(error instanceof TypeError)failure=new Error('无法连接本地工作台，请确认服务仍在运行，再重新打开作品查看结果。');
  if(error instanceof SyntaxError)failure=new Error('工作台返回内容不完整，请确认本地服务状态后重新打开作品。');
  recordStudioFailure(action,data,failure instanceof Error?failure.message:'请求失败');
  throw failure;
 }
}
