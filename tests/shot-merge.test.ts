import test from 'node:test';
import assert from 'node:assert/strict';
import {demoPlan} from '../lib/studio/domain.ts';
import {mergeShotPair,shortShotMergeOptions} from '../lib/studio/shot-merge.ts';
import type {Project} from '../lib/studio/types.ts';
void test('short merge retains all dialogue and duration; rejects unsafe neighbors',()=>{
 const p={idea:'test',duration:30,answers:{}} as Project;const shots=demoPlan(p).shots;
 shots[0].duration=2;shots[1].duration=3;shots[1].scene=shots[0].scene;shots[0].dialogue='第一句';shots[1].dialogue='第二句';shots[0].referenceUrl='https://old';
 const before=JSON.stringify(shots);const {merged}=mergeShotPair(shots,shots[0].id,shots[1].id);
 assert.equal(merged.duration,5);assert.equal(merged.dialogue,'第一句\n第二句');assert.deepEqual(merged.endState,shots[1].endState);assert.equal(merged.referenceUrl,undefined);assert.equal(JSON.stringify(shots),before);
 shots[1].scene='different';assert.equal(shortShotMergeOptions(shots,shots[0].id).length,0);assert.throws(()=>mergeShotPair(shots,shots[0].id,shots[1].id));
 shots[1].scene=shots[0].scene;shots[1].duration=15;assert.equal(shortShotMergeOptions(shots,shots[0].id).length,0);
});
