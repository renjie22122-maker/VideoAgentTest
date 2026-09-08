import test from 'node:test';
import assert from 'node:assert/strict';
import { motionAt, motionSamples, validateMotion, motionWarnings } from '../lib/studio/motion.ts';
import { demoPlan, validateShot } from '../lib/studio/domain.ts';
import { cameraPosition } from '../lib/studio/animatic.ts';
import type { Project } from '../lib/studio/types.ts';
const fixture=()=>demoPlan({idea:'test',duration:30,answers:{}} as Project).shots[0];
void test('subject-relative follow maintains separation and survives shot validation',()=>{
 const s=fixture();s.camera.start=s.camera.end={x:0,y:2,z:5};s.motion={version:1,subject:{start:{x:0,y:0,z:0},end:{x:4,y:0,z:0}},camera:{mode:'follow',degrees:0}};
 assert.deepEqual(validateShot(s,0).motion,s.motion);
 for(const f of motionSamples(s)){assert.equal(f.camera.x-f.subject.x,0);assert.equal(f.camera.z-f.subject.z,5);}
 assert.deepEqual(cameraPosition(s,1),{x:4,y:2,z:5});
});
void test('explicit orbit preserves a full circle even when endpoints coincide',()=>{
 const s=fixture();s.camera.start=s.camera.end={x:0,y:2,z:3};s.motion={version:1,subject:{start:{x:0,y:0,z:0},end:{x:0,y:0,z:0}},camera:{mode:'orbit',degrees:360}};
 assert.ok(Math.abs(motionAt(s,.5).camera.z+3)<1e-9);assert.ok(Math.abs(motionAt(s,1).camera.z-3)<1e-9);assert.equal(motionSamples(s).length,61);
 s.motion.camera.degrees=-360;assert.ok(motionAt(s,.25).camera.x<0);
});
void test('malformed motion is rejected and camera proximity is reported',()=>{
 assert.throws(()=>validateMotion({version:1}),/结构/);
 const s=fixture();s.camera.start=s.camera.end={x:0,y:.1,z:.1};s.motion={version:1,subject:{start:{x:0,y:0,z:0},end:{x:0,y:0,z:0}},camera:{mode:'world',degrees:0}};
 assert.ok(motionWarnings(s).some(v=>v.includes('0.25')));
 assert.throws(()=>validateMotion({...s.motion,camera:{mode:'orbit',degrees:Infinity}}),/环绕/);
 assert.throws(()=>validateMotion({...s.motion,subject:{start:{x:NaN,y:0,z:0},end:{x:0,y:0,z:0}}}),/坐标/);
});
