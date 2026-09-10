export type RenderTiming = {editSeconds:number;requestSeconds:number;trimStart:number;trimEnd:number;tailSeconds:number};
// Keep editorial time independent of the vendor's integer request duration.
export function miniMaxTiming(seconds:number,model='MiniMax-H3'):RenderTiming {
 const minimum=model==='MiniMax-H3-Max'?5:4;
 if(!Number.isFinite(seconds)||seconds<minimum||seconds>15)throw new Error(model+' 的镜头时长须在 '+minimum+'–15 秒内；小数秒会向上取整生成。');
 const requestSeconds=Math.ceil(seconds);
 return {editSeconds:seconds,requestSeconds,trimStart:0,trimEnd:seconds,tailSeconds:Number((requestSeconds-seconds).toFixed(6))};
}
export function timingInstruction(timing:RenderTiming){return timing.tailSeconds>0?'剪辑保留前 '+timing.editSeconds+' 秒；供应商生成 '+timing.requestSeconds+' 秒。全部对白、动作和运镜在 '+timing.editSeconds+' 秒内完成并到达指定末状态（有尾帧时提前到达尾帧状态）；之后 '+timing.tailSeconds+' 秒仅保持末状态，不增加对白或新动作，不拉慢原定节奏。后期裁去尾部余量。':'按分镜原定时长执行。';}
