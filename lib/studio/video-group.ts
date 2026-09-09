import type {Project,Shot} from './types.ts';
import {suggestVideoAssets,videoAssetChoices} from './video-asset-selection.ts';
export function videoGroup(p:Project,id:string,neighborId:string){
 const shots=p.plan?.shots??[];const i=shots.findIndex(s=>s.id===id),n=shots.findIndex(s=>s.id===neighborId);
 if(i<0||n<0||i===n)throw new Error('请选择至少两个连续分镜的起止位置。');
 const group=shots.slice(Math.min(i,n),Math.max(i,n)+1);const duration=group.reduce((t,s)=>t+s.duration,0);
 if(duration<4||duration>15||!Number.isInteger(duration))throw new Error('联合生成时长须为 4–15 整数秒。');
 const ids=Array.from(new Set(group.flatMap(s=>s.videoInput?.mode==='references'&&s.videoInput.assetIds?.length?s.videoInput.assetIds:suggestVideoAssets(p,s.id).ids)));
 if(!ids.length||ids.length>9)throw new Error('所选分镜需有 1–9 张相关已批准美术图；请调整各镜参考选择。');
 if(ids.some(id=>!videoAssetChoices(p).some(a=>a.id===id)))throw new Error('参考图已失效，请重新选择。');
 return {shots:structuredClone(group),assetIds:ids,duration};
}
export function groupShot(group:ReturnType<typeof videoGroup>):Shot{
 const first=group.shots[0],last=group.shots.at(-1)!;
 return {...first,duration:group.duration,videoInput:{mode:'references',assetIds:group.assetIds},endState:last.endState};
}
