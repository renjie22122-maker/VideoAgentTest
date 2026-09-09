import test from 'node:test';
import assert from 'node:assert/strict';
import {continuityFixDecision} from '../lib/studio/autopilot.ts';
import {initialProduction} from '../lib/studio/graph.ts';
import {defaultAgents} from '../lib/studio/team-config.ts';
import type {Project} from '../lib/studio/types.ts';
void test('targeted continuity repair requires current evidence and an enabled director',()=>{
 const p={mode:'live',revision:3,plan:{shots:[]},production:initialProduction()} as unknown as Project;
 assert.throws(()=>continuityFixDecision(p));
 p.production!.scriptApproved=true;
 p.production!.continuityReview={revision:2,summary:'问题',findings:[{shotId:'shot-1',message:'动作缺失',evidence:'原文',suggestion:'补充动作'}]};
 assert.throws(()=>continuityFixDecision(p));
 p.production!.continuityReview.revision=3;
 assert.equal(continuityFixDecision(p).roleId,'storyboard');
 assert.equal(continuityFixDecision(p).action,'revise_shots');
 p.production!.agentConfig={version:1,agents:defaultAgents().map(a=>({...a,enabled:a.id==='director'}))};
 assert.equal(continuityFixDecision(p).roleId,'director');
 p.mode='demo';assert.throws(()=>continuityFixDecision(p),/真实语言模型/);
});
