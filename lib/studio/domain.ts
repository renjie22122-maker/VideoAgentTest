import { validateMotion, motionWarnings, motionGuidance } from './motion.ts';
import type { Project, Plan, Shot, Issue, ContinuityState, Bible } from './types.ts';

export function text(value: unknown, name: string, max=4000): string {
  if(typeof value!=='string'||!value.trim()||value.length>max) throw new Error(name+'不能为空，且不能超过 '+max+' 字。');
  return value.trim();
}
export function finite(value: unknown,min:number,max:number,name:string):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max) throw new Error(name+'必须在 '+min+'–'+max+' 之间。');return value;
}
function oneOf<T extends string>(v:unknown, options:readonly T[], name:string):T { if(!options.includes(v as T))throw new Error(name+'无效。');return v as T; }
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('数据格式无效。');return v as Record<string,unknown>;}
export function validateState(v:unknown):ContinuityState { const s=object(v);return {pose:text(s.pose,'动作状态',500),screenDirection:oneOf(s.screenDirection,['left-to-right','right-to-left','static'],'运动方向'),wardrobe:text(s.wardrobe,'服装',1000),props:text(s.props,'道具',1000),light:text(s.light,'光线',1000),axis:oneOf(s.axis,['A','B'],'轴线')}; }
export function validateShot(v:unknown,index:number):Shot {
  const s=object(v),c=object(s.camera),start=object(c.start),end=object(c.end);
  const point=(p:Record<string,unknown>)=>({x:finite(p.x,-10,10,'相机 X'),y:finite(p.y,0.1,10,'相机高度'),z:finite(p.z,0.1,15,'相机距离')});
  return {...(s.motion===undefined?{}:{motion:validateMotion(s.motion)}),id:'shot-'+(index+1),scene:text(s.scene,'场景',100),title:text(s.title,'镜头标题',100),beat:text(s.beat,'叙事目的',1000),description:text(s.description,'画面',4000),dialogue:typeof s.dialogue==='string'?s.dialogue.slice(0,1000):'',sound:typeof s.sound==='string'?s.sound.slice(0,1000):'',duration:finite(s.duration,2,15,'镜头时长'),size:oneOf(s.size,['wide','medium','close'],'景别'),transition:oneOf(s.transition,['cut','dissolve'],'转场'),camera:{movement:oneOf(c.movement,['fixed','push','pull','track','orbit'],'运镜'),lens:finite(c.lens,18,135,'焦距'),start:point(start),end:point(end),easing:oneOf(c.easing,['linear','ease-in-out'],'缓动')},startState:validateState(s.startState),endState:validateState(s.endState)};
}
export function validateBible(value:unknown):Bible {
 const raw=object(value),b=raw.bible&&typeof raw.bible==='object'?object(raw.bible):raw;
 const labels={character:'人物身份',appearance:'固定外观与服装',location:'场景与时空',lighting:'光线与主光方向',palette:'色彩与白平衡',props:'道具与位置',style:'画面风格',negative:'避免出现'};
 const bible={} as Bible;
 for(const key of Object.keys(labels) as (keyof Bible)[]){const v=b[key];
  if(v===undefined||v===null||v==='')throw new Error('美术设定缺少「'+labels[key]+'」。');
  if(typeof v!=='string')throw new Error('美术设定「'+labels[key]+'」必须是文字，不能是数组或对象。');
  if(!v.trim())throw new Error('美术设定「'+labels[key]+'」不能只包含空格。');
  if(v.trim().length>2000)throw new Error('美术设定「'+labels[key]+'」共 '+v.trim().length+' 字，超过 2000 字上限，请精简。');
  bible[key]=v.trim();
 }
 return bible;
}
export function validatePlan(v:unknown):Plan {
  const p=object(v),b=object(p.bible);if(!Array.isArray(p.shots)||p.shots.length<2||p.shots.length>24)throw new Error('分镜数量应为 2–24。');
  const bible=validateBible(b);
  return {title:text(p.title,'标题',100),logline:text(p.logline,'故事梗概',2000),synopsis:text(p.synopsis,'剧本',8000),bible,shots:p.shots.map(validateShot)};
}
export function demoPlan(p:Project):Plan {
  const a=p.answers,subject=a.subject||'创意中的主角',location=a.location||'创意中的场景',ending=a.ending||'按确认的创意完成核心事件',tone=a.tone||'遵循创意与回答';
  const count=Math.max(3,Math.ceil(p.duration/6));
  const state:ContinuityState={pose:'主角在场景中，尚未开始主要动作',screenDirection:'left-to-right',wardrobe:subject,props:'沿用创意中的道具，位置保持不变',light:location+'；固定主光方向',axis:'A'};
  const beats=['建立环境与人物关系','接近主角，建立关注点','发现变化，建立动机','动作展开，情绪发生转折','展示反应，为结尾留白','完成关键动作并收束'];
  let prev=state;
  const shots:Shot[]=Array.from({length:count},(_,i)=>{
    const last=i===count-1,beat=last?beats[5]:beats[Math.min(i,4)];
    const end={...prev,pose:last?ending:'第 '+(i+1)+' 个叙事节拍完成：'+beat};
    const s:Shot={id:'shot-'+(i+1),scene:'scene-1',title:last?'余韵':beat,beat,description:(i===0?location+'。'+subject+'。':subject+'，延续上一镜头动作。')+'围绕「'+p.idea+'」呈现：'+(last?ending:beat)+'。',dialogue:'',sound:i===0?'环境声渐入，贯穿同一场景':'延续上一镜环境底声',duration:Math.floor(p.duration/count)+(i<p.duration%count?1:0),size:i===0?'wide':last?'medium':i%2?'medium':'close',transition:'cut',camera:{movement:i===0?'fixed':last?'pull':'push',lens:i===0?28:i%2?50:85,start:{x:1,y:1.6,z:5},end:{x:1,y:1.6,z:i===0?5:last?7:3},easing:'ease-in-out'},startState:{...prev},endState:end};prev=end;return s;
  });
  return {title:p.idea.slice(0,18)+(p.idea.length>18?'…':''),logline:p.idea,synopsis:'开场：在'+location+'建立人物与环境。\n发展：'+subject+'，围绕「'+p.idea+'」展开关键动作。\n结尾：'+ending+'。\n风格：'+tone+'。\n\n这是演示模板生成的剧本，确认或修改分镜后进入预演。',bible:{character:subject,appearance:subject,location,lighting:state.light,palette:'低饱和色彩，固定白平衡',props:state.props,style:tone,negative:'避免角色换脸、服装改变、道具闪现、无动机越轴、突然变焦'},shots};
}
export function checkContinuity(plan:Plan, targetDuration?:number):Issue[] {
  const issues:Issue[]=[];const add=(s:Shot,code:string,message:string,level:Issue['level']='warning')=>issues.push({shotId:s.id,level,code,message});
  plan.shots.forEach((s,i)=>{
    const prev=plan.shots[i-1];
    for(const message of motionWarnings(s))add(s,'motion-program',message);
    const spoken=s.dialogue.replace(/[\s\p{P}]/gu,'').length;
    if(spoken>s.duration*4)add(s,'dialogue-density','本镜对白约 '+spoken+' 字，仅 '+s.duration+' 秒；按每秒 3–4 字粗估需 '+Math.ceil(spoken/4)+'–'+Math.ceil(spoken/3)+' 秒，另需动作与停顿时间。请延长或跨镜分配对白。');
    if(!s.motion&&s.camera.movement==='fixed'&&JSON.stringify(s.camera.start)!==JSON.stringify(s.camera.end))add(s,'fixed-motion','固定镜头的起终点不同。','error');
    if(!s.motion&&s.camera.movement==='push'&&s.camera.end.z>=s.camera.start.z)add(s,'push-direction','推进镜头的终点应更接近主体。','error');
    if(!s.motion&&s.camera.movement==='pull'&&s.camera.end.z<=s.camera.start.z)add(s,'pull-direction','拉远镜头的终点应远离主体。','error');
    const distance=Math.hypot(s.camera.end.x-s.camera.start.x,s.camera.end.y-s.camera.start.y,s.camera.end.z-s.camera.start.z);
    if(distance/s.duration>2)add(s,'camera-speed','运镜速度较快，可能影响动作辨识。');
    if(s.camera.start.x*s.camera.end.x<0)add(s,'camera-axis','运镜路径穿过主体轴线，请确认空间关系。');
    if(s.startState.wardrobe!==s.endState.wardrobe)add(s,'wardrobe-in-shot','镜头内服装描述不同（不等于换装），请核对。起始：'+s.startState.wardrobe+'；结束：'+s.endState.wardrobe);
    if(prev&&prev.scene===s.scene){
      for(const [key,label] of [['wardrobe','服装'],['props','道具'],['light','光线'],['pose','动作状态']] as const)if(prev.endState[key]!==s.startState[key])add(s,'continuity-'+key,label+'描述不同，需语义复核，并非已确认穿帮。前镜结束：'+prev.endState[key]+'；本镜开始：'+s.startState[key]);
      if(prev.endState.axis!==s.startState.axis&&s.transition==='cut')add(s,'axis','直接切换到了轴线另一侧，建议增加中性镜头。');
      if(prev.endState.screenDirection!==s.startState.screenDirection&&prev.endState.screenDirection!=='static'&&s.startState.screenDirection!=='static')add(s,'direction','相邻镜头运动方向反转。');
      if(prev.size===s.size&&Math.abs(prev.camera.lens-s.camera.lens)<10&&s.transition==='cut')add(s,'jump-cut','连续同景别、近似焦距可能形成跳切，请检查角度和动作。');
    }
  });
  const total=plan.shots.reduce((n,s)=>n+s.duration,0);if(targetDuration&&Math.abs(total-targetDuration)>.5)issues.push({shotId:plan.shots[0].id,level:'warning',code:'duration',message:'分镜合计 '+total+' 秒，与目标 '+targetDuration+' 秒不同。'});
  return issues;
}
export function shotPrompt(p:Project,index:number):string {
  if(!p.plan)throw new Error('请先生成分镜。');const s=p.plan.shots[index];if(!s)throw new Error('镜头不存在。');
  return JSON.stringify({motionPlan:motionGuidance(s),task:'cinematic shot',aspectRatio:p.ratio,durationSeconds:s.duration,bible:p.plan.bible,shot:s.description,dialogue:s.dialogue,sound:s.sound,shotSize:s.size,camera:{...s.camera,units:'meters relative to subject; x lateral, y height, z distance; look at subject origin',note:'camera path is creative guidance, provider may not support exact trajectory'},startState:s.startState,endState:s.endState,previousEndState:index?p.plan.shots[index-1].endState:null,referenceImage:s.referenceUrl??null,previousReferenceImage:index?p.plan.shots[index-1].referenceUrl??null:null,transition:s.transition});
}
export function invalidateFrom(p:Project,index:number):void {
  if(!p.plan)return;const ids=new Set(p.plan.shots.slice(index).map(s=>s.id));
  for(const s of p.plan.shots.slice(index)){delete s.referenceOrigin;delete s.referenceFilename;delete s.referenceUrl;delete s.videoUrl;delete s.referenceMode;delete s.videoMode;}
  p.jobs=p.jobs.map(j=>ids.has(j.shotId)&&j.status!=='cancelled'?{...j,status:'cancelled',error:'分镜已修改，输出失效，请重新生成。'}:j);
  p.revision++;
}
