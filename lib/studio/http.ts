// Includes response-body consumption: providers can send headers before generation finishes.
export async function fetchJSON(url:string|URL,init:RequestInit,timeoutMs:number):Promise<{response:Response;data:unknown}>{
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(new DOMException('Request timed out','TimeoutError')),timeoutMs);
 try{
  const response=await fetch(url,{...init,signal:controller.signal});
  let data:unknown;
  try{data=await response.json();}catch(error){if(!response.ok&&error instanceof SyntaxError)data={};else throw error;}
  return {response,data};
 }catch(error){if(controller.signal.aborted)throw controller.signal.reason;throw error;}
 finally{clearTimeout(timer);}
}
