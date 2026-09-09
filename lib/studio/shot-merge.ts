import type {Shot} from './types.ts';
export function shortShotMergeOptions(shots:Shot[],id:string){
 const i=shots.findIndex(s=>s.id===id),shot=shots[i];if(!shot)return [];
 return [i-1,i+1].filter(n=>n>=0&&n<shots.length).flatMap(n=>{
  const other=shots[n],seconds=shot.duration+other.duration;
  if(other.scene!==shot.scene||seconds<4||seconds>15||!Number.isInteger(seconds))return [];
  return [{neighborId:other.id,seconds,label:(n<i?'与前镜 ':'与后镜 ')+other.id+' 合并为 '+seconds+' 秒'}];
 });
}
export function mergeShotPair(shots:Shot[],id:string,neighborId:string){
 if(!shortShotMergeOptions(shots,id).some(o=>o.neighborId===neighborId))throw new Error('只能合并同场相邻镜头，合计须为 4–15 整数秒。');
 const index=Math.min(shots.findIndex(s=>s.id===id),shots.findIndex(s=>s.id===neighborId));const a=shots[index],b=shots[index+1];
 const dialogue=[a.dialogue,b.dialogue].filter(Boolean).join('\n');const sound=[a.sound,b.sound].filter(Boolean).join('\n');
 const description='前 '+a.duration+' 秒：'+a.description+'\n后 '+b.duration+' 秒：'+b.description;
 const beat=[a.beat,b.beat].join('；');
 if(dialogue.length>1000||sound.length>1000||description.length>4000||beat.length>1000)throw new Error('合并后文本超过镜头字段上限，请先精简动作说明；不会截断对白。');
 const mode=a.videoInput?.mode??'first';
 if(mode!==(b.videoInput?.mode??'first'))throw new Error('请先把两个镜头的视频输入模式设为相同，再合并。');
 const ids=Array.from(new Set([...(a.videoInput?.assetIds??[]),...(b.videoInput?.assetIds??[])]));if(ids.length>9)throw new Error('合并后参考素材超过 9 张，请先缩小参考选择。');
 const merged:Shot={...a,intent:undefined,title:(a.title+' / '+b.title).slice(0,100),duration:a.duration+b.duration,description,dialogue,sound,beat,endState:b.endState,camera:{...a.camera,end:b.camera.end},motion:undefined,videoInput:a.videoInput?{...a.videoInput,assetIds:ids,lastFrameUrl:mode==='first_last'?b.videoInput?.lastFrameUrl:undefined}:undefined};
 // The result is a new continuous-shot design, requiring review of its camera path.
 delete merged.referenceUrl;delete merged.referenceMode;delete merged.referenceOrigin;delete merged.referenceFilename;delete merged.videoUrl;delete merged.videoMode;
 return {index,merged};
}
