import test from 'node:test';
import assert from 'node:assert/strict';
import {demoScreenplay,validateScreenplay,applySceneTiming,ScreenplayTimingError} from '../lib/studio/screenplay.ts';
import type {Project} from '../lib/studio/types.ts';
const p={idea:'海面上的相遇',answers:{},duration:175} as Project;
void test('timing mismatch reports actual total and repair preserves scene content',()=>{
 const original=demoScreenplay(p);original.scenes=[{...original.scenes[0],duration:80},{...original.scenes[0],id:'scene-2',duration:80}];
 assert.throws(()=>validateScreenplay(original,175),(e:unknown)=>e instanceof ScreenplayTimingError&&e.actual===160&&e.target===175);
 const result=applySceneTiming(original,{scenes:[{id:'scene-2',duration:90},{id:'scene-1',duration:85}]},175);
 assert.equal(result.scenes.reduce((n,s)=>n+s.duration,0),175);
 assert.deepEqual(result.scenes.map(({duration:_,...rest})=>rest),original.scenes.map(({duration:_,...rest})=>rest));
 assert.equal(original.scenes[0].duration,80);
 for(const scenes of [[{id:'scene-1',duration:175}],[{id:'scene-1',duration:85},{id:'scene-1',duration:90}],[{id:'scene-1',duration:80},{id:'scene-2',duration:80}]])assert.throws(()=>applySceneTiming(original,{scenes},175));
});
