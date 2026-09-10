import {assetRoot,assetRequirement} from './asset-policy.ts';
import {referencePredecessor} from './narrative.ts';
import type { Project } from './types.ts';
import { approvedAssets } from './assets.ts';
export function shotReferences(p:Project,shotId:string,limit=10){
 const i=p.plan!.shots.findIndex(s=>s.id===shotId),shot=p.plan!.shots[i];
 const text=JSON.stringify({description:shot.description,start:shot.startState,end:shot.endState});
 const candidates=approvedAssets(p,shotId).filter(a=>{const root=assetRoot(a,p.production?.library??[]);return root.kind!=='prop'||root.sceneIds!==undefined||text.includes(root.name);}).sort((a,b)=>{
  const score=(v:typeof a)=>{const root=assetRoot(v,p.production?.library??[]);return (assetRequirement(root)==='required'?0:10)+(root.kind==='character'?(text.includes(root.name)?0:2):root.kind==='background'?1:3);};
  return score(a)-score(b);
 });
 const entries=candidates.map(a=>({url:a.url!,name:a.name,kind:assetRoot(a,p.production?.library??[]).kind,version:a.version}));
 if(shot.referenceUrl)entries.push({url:shot.referenceUrl,name:'当前镜头画面',kind:'variant',version:0});
 const previous=referencePredecessor(p.plan!.shots,i);
 if(previous?.scene===shot.scene&&previous.referenceUrl)entries.push({url:previous.referenceUrl,name:'同场前镜画面',kind:'variant',version:0});
 const seen=new Set<string>();const unique=entries.filter(e=>{if(seen.has(e.url))return false;seen.add(e.url);return true;});
 return {selected:unique.slice(0,limit),omitted:unique.slice(limit).map(e=>e.name)};
}
