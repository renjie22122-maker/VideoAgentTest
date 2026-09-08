import type { Project, Shot } from './types.ts';
export function cameraPosition(s:Shot,t:number){const u=s.camera.easing==='ease-in-out'?t*t*(3-2*t):t;const a=s.camera.start,b=s.camera.end;if(t<=0)return {...a};if(t>=1)return {...b};if(s.camera.movement==='orbit'){const angleA=Math.atan2(a.x,a.z),angleB=Math.atan2(b.x,b.z),angle=angleA+(angleB-angleA)*u,radius=Math.hypot(a.x,a.z)+(Math.hypot(b.x,b.z)-Math.hypot(a.x,a.z))*u;return {x:Math.sin(angle)*radius,y:a.y+(b.y-a.y)*u,z:Math.cos(angle)*radius};}return {x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,z:a.z+(b.z-a.z)*u};}
export function locateShot(shots:Shot[],seconds:number){let offset=0;for(let i=0;i<shots.length;i++){if(seconds<offset+shots[i].duration||i===shots.length-1)return {shot:shots[i],index:i,local:Math.min(1,Math.max(0,(seconds-offset)/shots[i].duration))};offset+=shots[i].duration;}throw new Error('没有分镜。');}
function lines(ctx:CanvasRenderingContext2D,value:string,x:number,y:number,width:number,lineHeight:number,maxLines=3){let line='',row=0;for(const char of value){if(ctx.measureText(line+char).width>width){ctx.fillText(line,x,y+row*lineHeight);line='';row++;if(row>=maxLines)return;}line+=char;}ctx.fillText(line,x,y+row*lineHeight);}
export function drawAnimatic(canvas:HTMLCanvasElement,p:Project,seconds:number){
  if(!p.plan)return;const ctx=canvas.getContext('2d');if(!ctx)return;
  const w=canvas.width,h=canvas.height,{shot:s,index,local}=locateShot(p.plan.shots,seconds),pos=cameraPosition(s,local);
  ctx.fillStyle='#14191c';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#2d383e';ctx.lineWidth=1;
  for(let i=1;i<3;i++){ctx.beginPath();ctx.moveTo(w*i/3,0);ctx.lineTo(w*i/3,h);ctx.stroke();ctx.beginPath();ctx.moveTo(0,h*i/3);ctx.lineTo(w,h*i/3);ctx.stroke();}
  const scale=Math.min(w,h)*.72/Math.max(1,pos.z),cx=w*.5-pos.x*w*.045,cy=h*.48+(pos.y-1.6)*h*.04;
  ctx.fillStyle='#263329';ctx.strokeStyle='#d5f584';ctx.lineWidth=2;ctx.fillRect(cx-scale*.55,cy-scale*.65,scale*1.1,scale*1.3);ctx.strokeRect(cx-scale*.55,cy-scale*.65,scale*1.1,scale*1.3);
  ctx.fillStyle='#d5f584';ctx.font=Math.round(w*.02)+'px sans-serif';ctx.textAlign='center';ctx.fillText('主体构图区域',cx,cy);ctx.textAlign='left';
  ctx.fillStyle='#11171bdd';ctx.fillRect(0,0,w,h*.16);ctx.fillRect(0,h*.69,w,h*.31);
  ctx.fillStyle='#d5f584';ctx.font='bold '+Math.round(w*.024)+'px sans-serif';ctx.fillText('FRAME / 动态分镜预演 · 非 AI 实拍画面',w*.04,h*.065);
  ctx.fillStyle='#e8eeea';ctx.font=Math.round(w*.019)+'px sans-serif';ctx.fillText('SHOT '+String(index+1).padStart(2,'0')+'   '+s.camera.lens+' mm   '+s.duration+' s',w*.04,h*.12);
  ctx.font='bold '+Math.round(w*.026)+'px sans-serif';ctx.fillText(s.title,w*.04,h*.755);
  ctx.fillStyle='#b1c0c5';ctx.font=Math.round(w*.018)+'px sans-serif';lines(ctx,s.description,w*.04,h*.81,w*.91,h*.037,3);
  ctx.fillStyle='#d5f584';ctx.fillRect(w*.04,h*.96,w*.92*local,3);ctx.font=Math.round(w*.015)+'px monospace';ctx.fillText(seconds.toFixed(1)+'s / '+p.plan.shots.reduce((a,s)=>a+s.duration,0)+'s',w*.04,h*.94);
}
export async function recordAnimatic(canvas:HTMLCanvasElement,p:Project,onProgress:(n:number)=>void,signal:AbortSignal):Promise<Blob>{
  if(typeof MediaRecorder==='undefined'||!canvas.captureStream)throw new Error('此浏览器不支持视频导出，请使用新版 Chrome 或 Edge。');
  const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(m=>MediaRecorder.isTypeSupported(m));if(!mime)throw new Error('浏览器不支持 WebM 编码。');
  const total=p.plan!.shots.reduce((n,s)=>n+s.duration,0),stream=canvas.captureStream(24),recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2_500_000});
  return new Promise((resolve,reject)=>{const chunks:BlobPart[]=[];let frame=0,aborted=false;const started=performance.now();
    const stop=()=>{aborted=true;if(recorder.state!=='inactive')recorder.stop();};
    const clean=()=>{cancelAnimationFrame(frame);stream.getTracks().forEach(t=>t.stop());signal.removeEventListener('abort',stop);};
    signal.addEventListener('abort',stop,{once:true});if(signal.aborted){clean();reject(new Error('已取消导出。'));return;}
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onerror=()=>{clean();reject(new Error('浏览器编码失败。'));};recorder.onstop=()=>{clean();if(aborted)reject(new Error('已取消导出。'));else resolve(new Blob(chunks,{type:'video/webm'}));};
    const tick=()=>{const time=Math.min(total,(performance.now()-started)/1000);drawAnimatic(canvas,p,time);onProgress(time/total);if(time>=total){recorder.stop();return;}frame=requestAnimationFrame(tick);};
    recorder.start(500);tick();
  });
}
