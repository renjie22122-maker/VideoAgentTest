import { randomUUID } from 'node:crypto';
import type { Asset, Project } from './types.ts';
import { text } from './domain.ts';
export const ASSET_PROMPT_VERSION='3.0.0';
export type AssetDesign={description:string;renderStyle:'photographic'|'animation'|'illustration';colors:string[];lighting:string};
const looks={photographic:'写实摄影，真实材质',animation:'三维动画渲染，清晰形体',illustration:'绘画插图，清晰形体'};
export function compileAssetDesign(kind:Asset['kind'],name:string,d:AssetDesign){
 const scope=kind==='character'?'同一人物的设定板，纯白或中性灰背景，均匀柔光。允许同一身份重复展示多角度和局部，不出现第二种人物身份、环境布景或独立道具。':kind==='background'?'同一无人环境的设定板，不出现人物、人形剪影、角色展示栏或独立道具陈列。各视角保持同一空间关系。':'同一件物品的设定板，纯白或中性灰背景，均匀柔光。允许多角度与局部重复展示，不出现人物、手持展示、故事环境或无关物品。';
 const panels=kind==='character'?['主体区：同一人物正面、侧面、背面全身三视图，统一比例，头脚完整，双手空置；以原设定发型和服装为基准。','头部区：仅头部的原发型与两个发型探索小图，保持同一脸型、发色与身份；不改变已指定的基准发型。','表情区：仅头部的中性、微笑、紧张、愤怒表情，保持五官比例。','服装区：原服装的领口、袖口、鞋子、面料与缝线特写；两个不同服装的局部设计探索，不重复全身人物。']:kind==='background'?['同一空间全景、反向观察与入口方向三个透视图，禁止用镜像代替换位。','俯视空间布局设计示意，门窗、固定家具与通道对应各透视图，不编造实测尺寸。','固定设施与材质细节特写，保持原位置与配色，不加入人物或独立产品展示。']:['同一物品正面、侧面、背面、俯视四个方向，比例一致，结构对应。','关键部件、连接结构、表面材质与磨损细节特写。','仅在设定有依据时展示开合或使用状态，不凭空添加机械功能。'];
 return JSON.stringify({任务:'单张多面板资产设定板',资产类型:kind,资产名称:name,主体范围:scope,可见设计:d.description,表现方式:looks[d.renderStyle],限定配色:d.colors,光照:kind==='background'?d.lighting:'中性摄影棚柔光',版面设计:panels,一致性要求:'基准设计占主体区，探索方案放在独立小区域，不得混入基准三视图。探索方案需另行确认后才能用于分镜。',输出要求:'输出一张完整设定板图片，同图包含上述多个面板、角度与细节。分区清晰、留白合理、主体大于细节；不要水印或长篇文字。'},null,2);
}
export function validateAssetDesigns(raw:Record<string,unknown>,p:Project):Asset[]{
 if(!Array.isArray(raw.assets)||!raw.assets.length||raw.assets.length>24)throw new Error('资产清单需要 1–24 项。');
 const sources:string[]=[];
 const collect=(value:unknown):void=>{
  if(typeof value==='string')sources.push(value);
  else if(Array.isArray(value))value.forEach(collect);
  else if(value&&typeof value==='object')Object.values(value).forEach(collect);
 };
 collect(p.production?.script);collect(p.production?.assets?.bible);
 const seen=new Set<string>();
 return raw.assets.map(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('资产设计格式错误。');const v=value as Record<string,unknown>;
  if(!['character','background','prop'].includes(String(v.kind)))throw new Error('资产类型错误。');
  const kind=v.kind as Asset['kind'],name=text(v.name,'资产名称',100),evidence=text(v.evidence,'资产依据',300);
  if(!sources.some(source=>source.includes(evidence)))throw new Error('资产「'+name+'」的依据未匹配剧本或美术设定原文：'+JSON.stringify(evidence)+'。请从 script 或 bible 的单个文本字段逐字引用连续片段，不要改写、拼接或引用任务要求。');
  if(seen.has(kind+name))throw new Error('资产名称重复。');seen.add(kind+name);
  const description=text(v.description,'可见设计',1600);
  if(kind!=='background'&&/教室|操场|暴雨|下雨|雨幕|窗外|站在|走进/.test(description))throw new Error('人物或道具设计混入了场景、天气或动作，请只保留外观。');
  if(kind==='background'&&(p.production?.script?.characters??[]).some(c=>description.includes(c.name)))throw new Error('环境设计混入了人物姓名。');
  if(!['photographic','animation','illustration'].includes(String(v.renderStyle)))throw new Error('请选择结构化表现风格。');
  if(!Array.isArray(v.colors)||v.colors.length>6||v.colors.some(c=>typeof c!=='string'||!/^#[\da-f]{6}$/i.test(c)))throw new Error('配色必须是最多六个 HEX 色值。');
  const lighting=kind==='background'?text(v.lighting,'环境光照',500):'studio soft light';
  if(kind==='background'&&/人物|面部|身体|轮廓光/.test(lighting))throw new Error('环境光照不可包含人物布光。');
  const design:AssetDesign={description,renderStyle:v.renderStyle as AssetDesign['renderStyle'],colors:v.colors as string[],lighting};
  return {id:randomUUID(),name,kind,design,evidence,promptVersion:ASSET_PROMPT_VERSION,prompt:compileAssetDesign(kind,name,design),referenceIds:[],version:1,approved:false,status:'draft',createdAt:Date.now()};
 });
}
