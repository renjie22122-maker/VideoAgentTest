import test from 'node:test';
import assert from 'node:assert/strict';
import { compileAssetDesign, validateAssetDesigns } from '../lib/studio/asset-design.ts';
import { startAsset } from '../lib/studio/assets.ts';
import type { Project, Asset } from '../lib/studio/types.ts';
void test('structured design disallows narrative style and cross-asset lighting contamination',()=>{
 const p={production:{script:{characters:[{name:'楚子航'}]},assets:{bible:{character:'楚子航',location:'教室'}}}} as unknown as Project;
 const character={kind:'character',name:'楚子航',evidence:'楚子航',description:'黑发，蓝色校服',renderStyle:'photographic',colors:['#123456'],lighting:'楚子航站在暴雨中的教室'};
 const asset=validateAssetDesigns({assets:[character]},p)[0];assert.ok(!asset.prompt.includes('站在暴雨'));assert.ok(!asset.prompt.includes('环境照明：'));
 assert.throws(()=>validateAssetDesigns({assets:[{...character,renderStyle:'教室里人物逆光'}]},p),/结构化/);
 assert.throws(()=>validateAssetDesigns({assets:[{...character,description:'站在暴雨中的教室'}]},p),/混入/);
 assert.throws(()=>validateAssetDesigns({assets:[{...character,kind:'background',name:'教室',evidence:'教室',description:'空荡空间',lighting:'楚子航面部阴影'}]},p),/人物布光/);
 assert.ok(!compileAssetDesign('prop','手机',{description:'黑色翻盖手机',renderStyle:'photographic',colors:[],lighting:'楚子航的身体轮廓光'}).includes('楚子航'));
});
void test('saved legacy prompts cannot silently bypass the new compiler',async()=>{
 await assert.rejects(startAsset({mode:'live'} as Project,{prompt:'old'} as Asset),/旧版资产提示词/);
});
