import { fetchJSON } from './http.ts';

export async function studioRequest<T>(action:string,data:Record<string,unknown>={}):Promise<T>{
 try{
  const {response,data:body}=await fetchJSON('/api/studio',{method:'POST',headers:{'Content-Type':'application/json','X-Frame-Local':'1'},body:JSON.stringify({action,...data})},['status','settings','skills','list','get'].includes(action)?15000:['approve_assets','approve_script','asset_inventory','asset_refresh_inventory','asset_save_bible'].includes(action)?630000:330000);
  const result=body as {error?:string;data:T};
  if(!response.ok)throw new Error(result.error||'请求失败，请重新打开作品查看当前状态。');
  return result.data;
 }catch(error){
  if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))throw new Error('等待工作台响应超时。服务端可能仍在处理，请先重新打开作品查看结果，不要连续重复提交。');
  if(error instanceof TypeError)throw new Error('无法连接本地工作台，请确认服务仍在运行，再重新打开作品查看结果。');
  if(error instanceof SyntaxError)throw new Error('工作台返回内容不完整，请确认本地服务状态后重新打开作品。');
  throw error;
 }
}
