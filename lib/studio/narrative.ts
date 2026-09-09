import type {Shot} from './types.ts';
export type NarrativeLink={threadId:string;timeRelation:'continuous'|'simultaneous'|'later'|'earlier';resumeFromShotId:string|null;elapsed:string;handoff:string;soundSource:string};
export const NARRATIVE_SCHEMA=`交叉剪辑模式每镜必须有 narrative={threadId:"稳定叙事线 ID，同线所有镜头共用",timeRelation:"continuous/simultaneous/later/earlier（相对本线前镜；首次出现相对全局前镜）",resumeFromShotId:"本线最近前镜 ID，首次为 null",elapsed:"离开这条线期间故事时间推进多少，未知须说明",handoff:"本线状态如何衔接；跨线切换的动机与重新辨认人物空间的视觉线索",soundSource:"对白/环境声属于哪条线哪个场次；J/L-cut 仅声音先入或延续，不转移人物道具"}。播放顺序不等于故事时间，同一场次可以有多条线；人物、服装、道具持有、动作进度与轴线按本线追踪，切回来不能重置或继承另一线状态。`;
export function validateNarrative(raw:unknown):NarrativeLink{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('叙事线资料格式无效。');const v=raw as Record<string,unknown>;
 const field=(key:string)=>{const value=v[key];if(typeof value!=='string'||!value.trim()||value.length>1500)throw new Error('叙事线 '+key+' 不能为空且不能超过 1500 字。');return value.trim();};
 if(!['continuous','simultaneous','later','earlier'].includes(String(v.timeRelation)))throw new Error('叙事时间关系无效。');
 if(v.resumeFromShotId!==null&&(typeof v.resumeFromShotId!=='string'||!v.resumeFromShotId.trim()))throw new Error('本线前镜引用无效。');
 return {threadId:field('threadId'),timeRelation:v.timeRelation as NarrativeLink['timeRelation'],resumeFromShotId:v.resumeFromShotId as string|null,elapsed:field('elapsed'),handoff:field('handoff'),soundSource:field('soundSource')};
}
export function validateNarrativeLinks(shots:Shot[],required:boolean){
 if(!required&&!shots.some(s=>s.narrative))return;
 const last=new Map<string,string>();
 for(const s of shots){if(!s.narrative)throw new Error(s.id+' 缺少叙事线、时间关系和声音归属。');const n=s.narrative;if(n.resumeFromShotId!==(last.get(n.threadId)??null))throw new Error(s.id+' 必须衔接本叙事线的最近前镜，不能引用另一线或未来镜头。');last.set(n.threadId,s.id);}
}
export function previousNarrativeShot(shots:Shot[],index:number):Shot|undefined{
 const s=shots[index];if(!s)return;
 return shots.slice(0,index).findLast(prev=>s.narrative?prev.narrative?.threadId===s.narrative.threadId:!prev.narrative&&prev.scene===s.scene);
}
export function referencePredecessor(shots:Shot[],index:number):Shot|undefined{
 const s=shots[index],prev=previousNarrativeShot(shots,index);
 return prev&&prev.scene===s.scene&&(!s.narrative||s.narrative.timeRelation==='continuous')?prev:undefined;
}
