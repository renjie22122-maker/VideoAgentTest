import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmedBrief,validateBriefDecisions,inheritBriefDecisions} from '../lib/studio/brief-decisions.ts';
import type {CreativeBrief} from '../lib/studio/clarification.ts';
const brief:CreativeBrief={summary:'故事',known:[],assumptions:['省略鸭子','压缩开场','保持结尾'],ready:true,round:1,source:'model',history:[]};
void test('writer requires explicit decisions and receives only accepted or revised suggestions',()=>{
 assert.throws(()=>confirmedBrief(brief),/逐条/);
 const decisions=validateBriefDecisions(brief,[{suggestion:'省略鸭子',choice:'reject'},{suggestion:'压缩开场',choice:'revise',replacement:'完整展示开场'},{suggestion:'保持结尾',choice:'accept'}]);
 const confirmed=confirmedBrief({...brief,decisions})!;
 assert.deepEqual(confirmed.assumptions,['完整展示开场','保持结尾']);
 assert.equal(confirmed.decisions[0].choice,'reject');
 assert.deepEqual(brief.assumptions,['省略鸭子','压缩开场','保持结尾']);
});
void test('stale, duplicate and empty revisions are rejected; partial decisions can be saved',()=>{
 assert.equal(validateBriefDecisions(brief,[{suggestion:'省略鸭子',choice:'reject'}]).length,1);
 for(const raw of [[{suggestion:'过期建议',choice:'accept'}],[{suggestion:'省略鸭子',choice:'accept'},{suggestion:'省略鸭子',choice:'reject'}],[{suggestion:'压缩开场',choice:'revise',replacement:' '}]] )assert.throws(()=>validateBriefDecisions(brief,raw));
});

void test('writer context excludes stale model summaries and timing facts',()=>{
 const confirmed=confirmedBrief({...brief,summary:'本片已确认60秒',known:[{topic:'片长',value:'60秒',evidence:'60 秒'},{topic:'主角',value:'女孩',evidence:'女孩'}],decisions:brief.assumptions.map(suggestion=>({suggestion,choice:'accept'}))})!;
 assert.equal('summary' in confirmed,false);assert.equal(confirmed.known.length,1);assert.equal(confirmed.known[0].topic,'主角');
});
void test('unchanged suggestions retain decisions while new or edited suggestions require consent',()=>{
 const previous={...brief,decisions:validateBriefDecisions(brief,[{suggestion:'省略鸭子',choice:'reject'}])};
 const next=inheritBriefDecisions(previous,{...brief,assumptions:['省略鸭子','新的建议']});
 assert.deepEqual(next.decisions,previous.decisions);assert.throws(()=>confirmedBrief(next),/逐条/);
 assert.deepEqual(inheritBriefDecisions(previous,{...brief,assumptions:['换一种建议']}).decisions,[]);
});
