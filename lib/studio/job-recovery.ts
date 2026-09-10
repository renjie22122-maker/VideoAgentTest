import type {Job} from './types.ts';
export function requeueFailedJob(job:Job,maxRetries:number){
 if(job.longTake){const part=job.longTake.parts.find(p=>!p.outputUrl);if(part?.failed){if((job.retries??0)>=maxRetries)throw new Error('长镜头失败段已达到重试预算。');job.retries=(job.retries??0)+1;part.remoteId=undefined;part.submitted=false;part.failed=false;}if(part?.submitted&&!part.remoteId)throw new Error('长镜头分段提交结果未知，请核查供应商记录，不能自动重新计费。');job.status='queued';job.error=undefined;return;}
 if((job.qaRetries??0)>=maxRetries)throw new Error('该镜头已达到质量返工重试上限，请调整分镜并重新批准。');
 const localFailure=/最多使用 10 张参考图|上一镜头尚未成功|旧版资产提示词|MiniMax.*镜头时长须|MiniMax 原生 需要.*整数秒/.test(job.error??'');
 if(job.remoteId==='fal-pending'&&!localFailure)throw new Error('第 '+job.shotId+' 镜上次提交结果未知，不能直接重发。请先核查供应商记录；已出图可上传到该镜头。无需修改分镜来绕过限制。');
 // A persisted provider task is queried again, never submitted as a new render.
 if(job.remoteId&&job.remoteId!=='fal-pending'){
  job.status='queued';job.error=undefined;return;
 }
 if(!localFailure&&(job.retries??0)>=maxRetries)throw new Error('该镜头已达到提交重试上限，请先核查供应商任务记录，避免重复计费；已有结果可上传使用。');
 if(localFailure){job.remoteId=undefined;job.retries=0;}else job.retries=(job.retries??0)+1;
 job.status='queued';job.error=undefined;
}
