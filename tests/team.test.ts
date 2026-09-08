import test from 'node:test';
import assert from 'node:assert/strict';
import { filmTeam, teamForStage, validateTeamReport } from '../lib/studio/team.ts';
import type { Project } from '../lib/studio/types.ts';
void test('department handoffs validate targets and revisions without claiming media review',()=>{
 assert.equal(new Set(filmTeam.map(r=>r.id)).size,17);assert.ok(teamForStage('assets').some(r=>r.id==='prop_art'));
 const p={revision:9,mode:'live',plan:{shots:[{id:'shot-1'}]}} as Project;
 const raw={summary:'手机类型待确定',findings:[{shotId:'shot-1',severity:'warning',evidence:'直板或翻盖',suggestion:'确认唯一结构',returnTo:'prop_art'}]};
 assert.equal(validateTeamReport(raw,p,'continuity').revision,9);
 assert.throws(()=>validateTeamReport({...raw,findings:[{...raw.findings[0],returnTo:'unknown'}]},p,'continuity'),/返工岗位/);
 assert.throws(()=>validateTeamReport({...raw,findings:[{...raw.findings[0],shotId:'missing'}]},p,'continuity'),/镜头引用/);
});
