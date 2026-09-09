import test from 'node:test';
import assert from 'node:assert/strict';
import {shotReferences} from '../lib/studio/shot-references.ts';
import type {Project} from '../lib/studio/types.ts';
void test('shot references exclude unrelated props and other-scene frames, deduplicate, and report cap',()=>{
 const p={plan:{shots:[{id:'a',scene:'old',referenceUrl:'https://old'},{id:'b',scene:'new',description:'手机',startState:{},endState:{}}]},production:{library:[{id:'phone',name:'手机',kind:'prop',approved:true,status:'ready',url:'https://phone'}, {id:'other',name:'弹箱',kind:'prop',approved:true,status:'ready',url:'https://other'},...Array.from({length:12},(_,i)=>({id:'c'+i,name:'人物'+i,kind:'character',approved:true,status:'ready',url:'https://c'+i}))]}} as unknown as Project;
 const limited=shotReferences(p,'b');assert.equal(limited.selected.length,10);assert.equal(limited.omitted.length,3);assert.ok(!limited.selected.some(e=>e.url==='https://old'||e.url==='https://other'));
 const all=shotReferences(p,'b',30);assert.ok(all.selected.some(e=>e.url==='https://phone'));p.plan!.shots[1].referenceUrl='https://phone';assert.equal(shotReferences(p,'b',30).selected.length,13);
});
