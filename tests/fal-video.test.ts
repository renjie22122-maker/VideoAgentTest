import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {prepareFalVideo,submitFalVideo,pollFalVideo} from '../lib/studio/fal-video.ts';
import {submitFal} from '../lib/studio/fal.ts';
import {demoPlan} from '../lib/studio/domain.ts';
import {initialProduction} from '../lib/studio/graph.ts';
import type {Project,Job} from '../lib/studio/types.ts';

function setup(t:TestContext,key='test-fal-key'){
 const previous={STUDIO_DATA_DIR:process.env.STUDIO_DATA_DIR,FAL_API_KEY:process.env.FAL_API_KEY};
 const directory=mkdtempSync(path.join(tmpdir(),'frame-fal-submit-'));
 process.env.STUDIO_DATA_DIR=directory;process.env.FAL_API_KEY=key;
 t.after(()=>{for(const [name,value]of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value;}});
 const p:Project={id:'fal-video-project',revision:1,idea:'女孩在站台听见远处列车。',title:'站台',createdAt:0,updatedAt:0,duration:12,ratio:'16:9',mode:'live',phase:'planned',questions:[],answers:{},jobs:[],production:initialProduction()};
 p.plan=demoPlan(p);const shot=p.plan.shots[0];shot.duration=5;shot.videoInput={mode:'text'};
 const job:Job={id:'fal-video-job',shotId:shot.id,kind:'video',status:'running',mode:'live',revision:1,createdAt:0};
 return {p,shot,job,directory};
}
const queued={request_id:'request-123',status_url:'https://queue.fal.run/fal-ai/kling-video/requests/request-123/status',response_url:'https://queue.fal.run/fal-ai/kling-video/requests/request-123'};

void test('Kling maps text and first/last frames with explicit timing, aspect ratio and audio',t=>{
 const {p,shot,job}=setup(t);
 const text=prepareFalVideo(p,job,true);
 assert.equal(text.model,'fal-ai/kling-video/v3/pro/text-to-video');assert.equal(text.input.duration,'5');assert.equal(text.input.generate_audio,true);assert.ok('aspect_ratio' in text.input);assert.equal(text.input.aspect_ratio,'16:9');
 assert.ok(!('start_image_url' in text.input));assert.match(text.input.prompt,/站台|画面/);
 shot.videoInput={mode:'first_last',lastFrameUrl:'https://assets.example/end.png'};shot.referenceUrl='https://assets.example/start.png';
 const frames=prepareFalVideo(p,job,false);
 assert.equal(frames.model,'fal-ai/kling-video/v3/pro/image-to-video');assert.ok('start_image_url' in frames.input);assert.equal(frames.input.start_image_url,shot.referenceUrl);assert.equal(frames.input.end_image_url,shot.videoInput.lastFrameUrl);assert.equal(frames.input.generate_audio,false);assert.ok(!('aspect_ratio' in frames.input));
});

void test('valid image and video submissions persist their marker immediately before the single POST',async t=>{
 const {p,shot,job,directory}=setup(t);const order:string[]=[];
 const imageId='00000000-0000-4000-8000-000000000000';
 mkdirSync(path.join(directory,'images'));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 writeFileSync(path.join(directory,'images',imageId+'.png'),png);
 shot.referenceUrl='/api/studio-images/'+imageId+'.png';shot.videoInput={mode:'first_last',lastFrameUrl:'https://assets.example/end.png'};
 t.mock.method(globalThis,'fetch',async(url:unknown,init:RequestInit)=>{
  order.push('fetch');assert.equal(order.at(-2),'persist');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');
  const body=JSON.parse(init.body as string);
  if(String(url).includes('kling-video')){assert.equal(body.start_image_url,'data:image/png;base64,'+png.toString('base64'));assert.equal(body.end_image_url,shot.videoInput?.lastFrameUrl);}
  else assert.deepEqual(body.image_urls,['data:image/png;base64,'+png.toString('base64')]);
  return Response.json(queued);
 });
 const before=async()=>{await Promise.resolve();order.push('persist');};
 const id=await submitFalVideo(p,job,true,before);assert.match(id,/^fal-video:/);assert.deepEqual(JSON.parse(id.slice('fal-video:'.length)),{id:queued.request_id,status:queued.status_url,result:queued.response_url});
 await submitFal('人物参考图',[shot.referenceUrl],false,before);
 assert.deepEqual(order,['persist','fetch','persist','fetch']);
});

void test('unsupported references, missing frames and invalid durations fail without a marker or network request',async t=>{
 const {p,shot,job}=setup(t);let pending=0,fetches=0;
 t.mock.method(globalThis,'fetch',async()=>{fetches++;return Response.json(queued);});const before=async()=>{pending++;};
 shot.videoInput={mode:'references',assetIds:['character-1']};
 await assert.rejects(()=>submitFalVideo(p,job,true,before),/不支持/);
 shot.videoInput={mode:'first_last'};await assert.rejects(()=>submitFalVideo(p,job,true,before),/缺少/);
 shot.videoInput={mode:'text'};for(const duration of [2,3.5,16]){shot.duration=duration;await assert.rejects(()=>submitFalVideo(p,job,true,before),/整数秒/);}
 assert.equal(pending,0);assert.equal(fetches,0);
});

void test('missing API keys and unavailable local images never create an uncertain-submission marker',async t=>{
 const {p,shot,job}=setup(t,'');let pending=0,fetches=0;
 t.mock.method(globalThis,'fetch',async()=>{fetches++;return Response.json(queued);});const before=async()=>{pending++;};
 await assert.rejects(()=>submitFalVideo(p,job,true,before),/API Key/);
 await assert.rejects(()=>submitFal('参考图',[],false,before),/API Key/);
 process.env.FAL_API_KEY='test-fal-key';
 const missing='/api/studio-images/00000000-0000-4000-8000-000000000001.png';
 shot.videoInput={mode:'first'};shot.referenceUrl=missing;
 await assert.rejects(()=>submitFalVideo(p,job,true,before),/ENOENT/);
 await assert.rejects(()=>submitFal('参考图',[missing],false,before),/ENOENT/);
 assert.equal(pending,0);assert.equal(fetches,0);
});

void test('the UTF-8 request size is checked before persisting the marker for both fal adapters',async t=>{
 const {p,shot,job}=setup(t);let pending=0,fetches=0;
 t.mock.method(globalThis,'fetch',async()=>{fetches++;return Response.json(queued);});const before=async()=>{pending++;};
 const oversized='雨'.repeat(23*1024*1024); // Below 64M characters, above 64MiB on the wire.
 shot.description=oversized;
 await assert.rejects(()=>submitFalVideo(p,job,true,before),/64 MB/);
 await assert.rejects(()=>submitFal(oversized,[],false,before),/64 MB/);
 assert.equal(pending,0);assert.equal(fetches,0);
});

void test('failed marker persistence blocks POST; a transport interruption occurs after the marker',async t=>{
 const {p,job}=setup(t);let fetches=0,marked=false;
 t.mock.method(globalThis,'fetch',async()=>{fetches++;assert.equal(marked,true);throw new DOMException('timed out','TimeoutError');});
 await assert.rejects(()=>submitFalVideo(p,job,false,async()=>{throw new Error('本地存储失败');}),/本地存储失败/);assert.equal(fetches,0);
 await assert.rejects(()=>submitFalVideo(p,job,false,async()=>{marked=true;}),/超时或中断/);
 assert.equal(marked,true);assert.equal(fetches,1);
});

void test('Kling polling reads the original task and extracts video.url without resubmission',async t=>{
 setup(t);const calls:string[]=[];
 t.mock.method(globalThis,'fetch',async(url:unknown,init:RequestInit)=>{
  assert.equal(init.method,'GET');calls.push(String(url));
  return Response.json(String(url).endsWith('/status')?{status:'COMPLETED'}:{video:{url:'https://v3.fal.media/result.mp4'}});
 });
 const result=await pollFalVideo('fal-video:'+JSON.stringify({id:queued.request_id,status:queued.status_url,result:queued.response_url}));
 assert.deepEqual(result,{status:'succeeded',outputUrl:'https://v3.fal.media/result.mp4'});assert.deepEqual(calls,[queued.status_url,queued.response_url]);
});
