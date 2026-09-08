import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateDuration, resolveDuration } from '../lib/studio/duration.ts';
void test('optional timing estimates from dialogue and actions; manual timing is validated',()=>{
 const brief={idea:'一个人看雨',answers:{}};
 assert.equal(resolveDuration(undefined,brief).mode,'auto');assert.equal(resolveDuration(60,brief).seconds,60);
 assert.ok(estimateDuration('他说：“'+ '你好'.repeat(80)+'”').seconds>estimateDuration(brief.idea).seconds);
 assert.equal(estimateDuration('他说：“'+ '你好'.repeat(1000)+'”').limited,true);
 assert.throws(()=>resolveDuration(5,brief));assert.throws(()=>resolveDuration(NaN,brief));
});

void test('changing target duration preserves answers and archives approved work',async t=>{
 const {mkdtemp,writeFile}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const dir=await mkdtemp(path.join(tmpdir(),'duration-'));const previous=process.env.STUDIO_DATA_DIR;process.env.STUDIO_DATA_DIR=dir;t.after(()=>{if(previous===undefined)delete process.env.STUDIO_DATA_DIR;else process.env.STUDIO_DATA_DIR=previous;});
 const {dispatch}=await import('../lib/studio/server.ts');const {demoScreenplay}=await import('../lib/studio/screenplay.ts');const {demoPlan}=await import('../lib/studio/domain.ts');
 const p=await dispatch({action:'create',idea:'一个人看雨，最后离开，无对白',ratio:'16:9',mode:'demo'}) as import('../lib/studio/types.ts').Project;
 assert.equal(p.durationMode,'auto');p.answers={ending:'离开'};p.plan=demoPlan(p);p.production!.script=demoScreenplay(p);p.production!.scriptApproved=true;p.production!.node='storyboard';
 await writeFile(path.join(dir,'projects.json'),JSON.stringify([p]));
 const next=await dispatch({action:'duration_update',id:p.id,revision:p.revision,duration:60}) as typeof p;
 assert.equal(next.duration,60);assert.equal(next.durationMode,'manual');assert.deepEqual(next.answers,p.answers);assert.equal(next.production!.scriptHistory!.length,1);assert.equal(next.plan,undefined);assert.equal(next.production!.node,'clarify');assert.equal(next.production!.scriptApproved,false);
 await assert.rejects(dispatch({action:'duration_update',id:p.id,revision:p.revision,duration:90}),/其他窗口/);
});
