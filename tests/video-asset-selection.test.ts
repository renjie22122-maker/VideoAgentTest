import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestVideoAssets} from '../lib/studio/video-asset-selection.ts';
import type {Project} from '../lib/studio/types.ts';
void test('auto reference selection uses approved visual assets and scene, excluding voice-only and drafts',()=>{
 const make=(id:string,name:string,kind:string,extra={})=>({id,name,kind,status:'ready',approved:true,url:'https://example.com/'+id,...extra});
 const p={plan:{shots:[{id:'s',scene:'scene',description:'零号握住龙眼',dialogue:'飞行员：开火',startState:{pose:'零号直立',props:'龙眼'},endState:{pose:'零号仰头',props:'龙眼'}}]},production:{script:{scenes:[{id:'scene',location:'冰原'}]},library:[make('draft','零号','character',{approved:false}),make('zero','零号','character'),make('pilot','飞行员','character'),make('ice','冰原','background'),make('eye','龙眼','prop'),make('box','弹箱','prop'),make('old','零号','character',{retired:true}),make('detail','零号','character',{viewId:'face'})]}} as unknown as Project;
 assert.deepEqual(suggestVideoAssets(p,'s').ids,['zero','ice','eye']);
 const before=JSON.stringify(p);suggestVideoAssets(p,'s');assert.equal(JSON.stringify(p),before);
 p.production!.library!.push(...Array.from({length:12},(_,i)=>make('eye'+i,'龙眼','prop')) as never[]);
 const selected=suggestVideoAssets(p,'s');assert.equal(selected.ids.length,9);assert.equal(selected.omitted.length,6);
});
void test('selected costume replaces base appearance in automatic matches',()=>{
 const p={plan:{shots:[{id:'s',scene:'scene',description:'零号抬手',startState:{},endState:{}}]},production:{costumeSelections:{base:'coat'},library:[{id:'base',name:'零号',kind:'character',status:'ready',approved:true,url:'https://base'},{id:'coat',costumeOf:'base',name:'零号外套',kind:'character',status:'ready',approved:true,url:'https://coat'}]}} as unknown as Project;
 assert.deepEqual(suggestVideoAssets(p,'s').ids,['coat']);
});
