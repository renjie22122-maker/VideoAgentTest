import type {Shot} from './types.ts';
export type SoundCue={id:string;layer:'ambience'|'foley'|'sfx'|'music';world:'diegetic'|'non_diegetic';source:string;sourceSceneId:string;start:number;end:number;bridge:'none'|'J'|'L'|'continuous';mix:string};
export const SOUND_SCHEMA=`每镜 soundCues=[{id:"跨镜同一声音共用稳定ID",layer:"ambience/foley/sfx/music",world:"diegetic（故事内有声源，可在画外）/non_diegetic（配乐等非故事内声音）",source:"具体声源、空间距离和方向",sourceSceneId:"来源场次ID，非叙事配乐写 score",start:镜内开始秒,end:结束秒,bridge:"none/J/L/continuous",mix:"音量变化、淡入淡出、对白时压低背景及空间混响"}]，无声音写 []。不要把画外有源声音误归为无源。对白用 performance，sourceSceneId+dialogueIndex 是跨镜同一句话的稳定标识；拆分时按原文连续片段分配到各镜，不重说、不从头配音、不在切镜处无故停顿。J/L-cut 明确声源，不把来自另一线的声音当作当前空间。`;
export function validateSoundCues(raw:unknown):SoundCue[]{
 if(!Array.isArray(raw)||raw.length>24)throw new Error('声音层须为最多 24 项的数组。');return raw.map(v=>{
 if(!v||typeof v!=='object')throw new Error('声音层格式无效。');const s=v as Record<string,unknown>;
 for(const key of ['id','source','sourceSceneId','mix'])if(typeof s[key]!=='string'||!String(s[key]).trim()||String(s[key]).length>1000)throw new Error('声音层 '+key+' 无效。');
 if(!['ambience','foley','sfx','music'].includes(String(s.layer))||!['diegetic','non_diegetic'].includes(String(s.world))||!['none','J','L','continuous'].includes(String(s.bridge))||!Number.isFinite(s.start)||!Number.isFinite(s.end)||Number(s.start)<0||Number(s.end)<=Number(s.start))throw new Error('声音层类型或时间窗无效。');
 return {id:String(s.id),layer:s.layer as SoundCue['layer'],world:s.world as SoundCue['world'],source:String(s.source),sourceSceneId:String(s.sourceSceneId),start:Number(s.start),end:Number(s.end),bridge:s.bridge as SoundCue['bridge'],mix:String(s.mix)};
 });
}
export function soundTimeline(shots:Shot[]){let offset=0;return shots.flatMap(s=>{const base=offset;offset+=s.duration;return [...(s.performance??[]).map(l=>({kind:'dialogue',utteranceId:(l.sourceSceneId??s.scene)+':'+l.dialogueIndex,shotId:s.id,...l,start:base+l.start,end:base+l.end})),...(s.soundCues??[]).map(c=>({kind:'sound',shotId:s.id,...c,start:base+c.start,end:base+c.end}))];});}
