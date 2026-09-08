import type { CameraPoint, Shot } from './types.ts';
// Original reduced motion representation inspired by LAMP, not its DSL/checkpoint.
export type MotionProgram={version:1;subject:{start:CameraPoint;end:CameraPoint};camera:{mode:'world'|'follow'|'orbit';degrees:number};};
export function validateMotion(value:unknown):MotionProgram{
 const m=value as MotionProgram;
 if(!m||m.version!==1||!m.subject||!m.camera||!['world','follow','orbit'].includes(m.camera.mode))throw new Error('运动程序结构或模式无效。');
 const point=(v:CameraPoint)=>{if(!v||Object.values(v).length!==3||!['x','y','z'].every(k=>typeof v[k as keyof CameraPoint]==='number'&&Number.isFinite(v[k as keyof CameraPoint])&&Math.abs(v[k as keyof CameraPoint])<=100))throw new Error('主体坐标须为 -100–100 米内的有限数字。');return {x:v.x,y:v.y,z:v.z};};
 if(!Number.isFinite(m.camera.degrees)||Math.abs(m.camera.degrees)>360)throw new Error('环绕角度须在 -360–360 度内。');
 return {version:1,subject:{start:point(m.subject.start),end:point(m.subject.end)},camera:{mode:m.camera.mode,degrees:m.camera.degrees}};
}
const lerp=(a:CameraPoint,b:CameraPoint,t:number)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
export function motionAt(s:Shot,t:number){
 const m=validateMotion(s.motion),v=Math.max(0,Math.min(1,t)),u=s.camera.easing==='ease-in-out'?v*v*(3-2*v):v;
 const subject=lerp(m.subject.start,m.subject.end,u),offset=lerp(s.camera.start,s.camera.end,u);
 let camera=offset;
 if(m.camera.mode==='follow')camera={x:subject.x+offset.x,y:subject.y+offset.y,z:subject.z+offset.z};
 if(m.camera.mode==='orbit'){
  const a=Math.atan2(s.camera.start.x,s.camera.start.z)+m.camera.degrees*Math.PI/180*u;
  const r=Math.hypot(s.camera.start.x,s.camera.start.z)+(Math.hypot(s.camera.end.x,s.camera.end.z)-Math.hypot(s.camera.start.x,s.camera.start.z))*u;
  camera={x:subject.x+Math.sin(a)*r,y:subject.y+offset.y,z:subject.z+Math.cos(a)*r};
 }
 return {time:v*s.duration,subject,camera,lookAt:{...subject}};
}
export function motionSamples(s:Shot){return Array.from({length:61},(_,i)=>motionAt(s,i/60));}
export function motionWarnings(s:Shot){
 if(!s.motion)return [];
 const frames=motionSamples(s),issues:string[]=[];
 if(frames.some(f=>Math.hypot(f.camera.x-f.subject.x,f.camera.y-f.subject.y,f.camera.z-f.subject.z)<.25))issues.push('相机距主体中心不足 0.25 米，请核对穿模风险。');
 const maxSpeed=Math.max(...frames.slice(1).map((f,i)=>Math.hypot(f.camera.x-frames[i].camera.x,f.camera.y-frames[i].camera.y,f.camera.z-frames[i].camera.z)/(s.duration/60)));
 if(maxSpeed>2)issues.push('采样相机速度峰值约 '+maxSpeed.toFixed(1)+' 米/秒，需核对运动意图。');
 return issues;
}
export function motionGuidance(s:Shot){if(!s.motion)return undefined;const m=validateMotion(s.motion);return {program:m,coordinates:'meters; shared shot-local world; follow/orbit camera endpoints are offsets from subject',start:motionAt(s,0),middle:motionAt(s,.5),end:motionAt(s,1),control:'text guidance only; no guaranteed trajectory conditioning',orbitConvention:'positive angle rotates from +z toward +x viewed from above; orbit end uses end radius/height and explicit angle'};}
export const MOTION_SCHEMA='可选 motion={version:1,subject:{start:{x,y,z},end:{x,y,z}},camera:{mode:"world"|"follow"|"orbit",degrees:number}}。主体点为镜头内同一局部世界的米制坐标；world 相机起终点为世界位置；follow/orbit 为相对主体偏移。orbit 使用 start 方位、显式角度（-360 至 360）、end 半径和高度，不用 end 方位；正角从 +z 朝 +x 转。world/follow 不用 degrees，填 0。主体静止可两点相同。没有明确移动要求不要臆造主体移动。不要输出代码或逐帧大数组。';
