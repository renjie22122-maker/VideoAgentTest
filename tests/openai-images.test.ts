import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { generateOpenAIImage, imageFile, readImage } from '../lib/studio/openai-images.ts';
import { submitMedia, pollMedia, capabilities } from '../lib/studio/providers.ts';
import { publicSettings } from '../lib/studio/settings.ts';
import { demoPlan } from '../lib/studio/domain.ts';
import { initialProduction } from '../lib/studio/graph.ts';
import type { Project, Job } from '../lib/studio/types.ts';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=';
void test('native OpenAI image queue persists PNG, exposes local reference, keeps independent key and resumes without regeneration',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'frame-gpt-image-'));
 const config={STUDIO_DATA_DIR:dir,IMAGE_PROVIDER:'openai',OPENAI_IMAGE_API_KEY:'dummy-openai',OPENAI_IMAGE_MODEL:'gpt-image-2',MEDIA_API_KEY:'dummy-video',MEDIA_GATEWAY_URL:'https://gateway.example',VIDEO_MODEL:'video'};
 const previous=Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]));Object.assign(process.env,config);
 t.after(()=>{for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 const p:Project={id:randomUUID(),idea:'女孩在车站找到信',title:'信',revision:1,createdAt:0,updatedAt:0,duration:12,ratio:'16:9',mode:'live',phase:'planned',questions:[],answers:{},jobs:[],production:initialProduction()};
 p.plan=demoPlan(p);p.production!.node='generation';p.production!.renderApprovedRevision=1;
 await writeFile(path.join(dir,'projects.json'),JSON.stringify([p]));
 let calls=0;
 t.mock.method(globalThis,'fetch',async(url:unknown,init:RequestInit)=>{
  calls++;assert.equal(String(url),'https://api.openai.com/v1/images/generations');
  assert.equal((init.headers as Record<string,string>).Authorization,'Bearer dummy-openai');
  const body=JSON.parse(init.body as string);assert.equal(body.model,'gpt-image-2');assert.equal(body.size,'1536x1024');assert.equal(body.n,1);assert.equal(body.output_format,'png');assert.ok(body.prompt.includes(p.plan!.bible.appearance));assert.equal(body.seed,undefined);
  return new Response(JSON.stringify({data:[{b64_json:png}]}));
 });
 const {dispatch}=await import('../lib/studio/server.ts');
 assert.equal(capabilities().image,true);assert.equal(capabilities().imageModel,'gpt-image-2');assert.equal(publicSettings().values.OPENAI_IMAGE_API_KEY,undefined);
 await dispatch({action:'enqueue',id:p.id,revision:1,kind:'image'});
 const submitted=await dispatch({action:'poll',id:p.id}) as Project;
 assert.ok(submitted.jobs[0].remoteId?.startsWith('openai-image:'));
 assert.equal((await readImage(submitted.jobs[0].id)).toString('base64'),png);
 await submitMedia(submitted,submitted.jobs[0]);assert.equal(calls,1);
 const ready=await dispatch({action:'poll',id:p.id}) as Project;
 assert.equal(ready.jobs[0].status,'succeeded');assert.equal(ready.plan!.shots[0].referenceUrl,'/api/studio-images/'+ready.jobs[0].id+'.png');
 assert.throws(()=>imageFile('../api-settings'),/无效/);
 // A local reference must be uploaded as bytes, never an inaccessible localhost URL.
 t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{const body=JSON.parse(init.body as string);assert.equal(body.referenceImages[0],'data:image/png;base64,'+png);assert.equal((init.headers as Record<string,string>).Authorization,'Bearer dummy-video');return new Response(JSON.stringify({id:'video-job'}));});
 await submitMedia(ready,{...ready.jobs[0],id:randomUUID(),input:undefined,kind:'video'});
 // Failed/unknown synchronous calls cannot be repeated on automatic polling.
 let failedCalls=0;t.mock.method(globalThis,'fetch',async()=>{failedCalls++;throw new DOMException('timeout','TimeoutError');});
 const failed:Job={id:randomUUID(),shotId:p.plan.shots[0].id,kind:'image',status:'running',mode:'live',revision:1,createdAt:0};
 await assert.rejects(generateOpenAIImage(p,failed,'test'),/超时/);
 await assert.rejects(generateOpenAIImage(p,failed,'test'),/阻止自动重复/);assert.equal(failedCalls,1);
 await assert.rejects(generateOpenAIImage(p,{...failed,retries:1},'test'),/超时/);assert.equal(failedCalls,2);
 await assert.rejects(pollMedia({...failed,remoteId:'openai-image:../../api-settings'}),/无效/);
});
