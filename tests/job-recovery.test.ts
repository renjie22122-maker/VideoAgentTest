import test from 'node:test';
import assert from 'node:assert/strict';
import {requeueFailedJob} from '../lib/studio/job-recovery.ts';
import type {Job} from '../lib/studio/types.ts';
void test('recovery distinguishes local failures, unknown submissions and existing remote jobs',()=>{
 const job={shotId:'shot-2',status:'failed',retries:2,remoteId:'fal-pending',error:'等待完整结果超时'} as Job;
 assert.throws(()=>requeueFailedJob(job,2),/结果未知/);assert.equal(job.remoteId,'fal-pending');assert.equal(job.status,'failed');
 job.error='最多使用 10 张参考图，请缩小资产集合。';requeueFailedJob(job,2);assert.equal(job.status,'queued');assert.equal(job.remoteId,undefined);assert.equal(job.retries,0);
 job.status='failed';job.retries=9;job.remoteId='fal:existing';requeueFailedJob(job,2);assert.equal(job.remoteId,'fal:existing');assert.equal(job.retries,9);
 job.status='failed';job.qaRetries=2;assert.throws(()=>requeueFailedJob(job,2),/质量返工重试上限/);
});
