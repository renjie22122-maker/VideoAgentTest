import type {Project} from './types.ts';
// Browser-safe selection; generated and uploaded approved assets are treated equally.
export function videoAssetChoices(p:Project){
 const library=p.production?.library??[];
 return library.filter(a=>{
  if(!a.approved||a.retired||a.viewId||a.status!=='ready'||!a.url)return false;
  const root=library.find(r=>r.id===(a.parentId??a.id))??a;
  const identity=library.find(r=>r.id===(root.costumeOf??root.id))??root;
  const selected=p.production?.costumeSelections?.[identity.id];
  return root.costumeOf?selected===root.id:!selected||selected===root.id;
 });
}
export function suggestVideoAssets(p:Project,shotId:string){
 const shot=p.plan?.shots.find(s=>s.id===shotId);if(!shot)return {ids:[],matches:[],omitted:[]};
 const scene=p.production?.script?.scenes?.find(s=>s.id===shot.scene);
 const text=[shot.description,shot.startState.pose,shot.startState.wardrobe,shot.startState.props,shot.endState.pose,shot.endState.wardrobe,shot.endState.props].join('\n');
 const library=p.production?.library??[];
 const matches=videoAssetChoices(p).flatMap(a=>{
  const root=library.find(r=>r.id===(a.parentId??a.id))??a;
  const identity=library.find(r=>r.id===(root.costumeOf??root.id))??root;
  const name=identity.name;
  const explicit=text.includes(name)||text.includes(a.name);
  const sceneMatch=root.kind==='background'&&(scene?.location===root.name||scene?.location===root.evidence);
  // Dialogue-only speakers are not assumed visible. Match visual state, not dialogue.
  if(!explicit&&!sceneMatch)return [];
  const priority=root.kind==='character'?0:root.kind==='background'?1:2;
  return [{id:a.id,name:a.name,url:a.url!,reason:explicit?'镜头画面 / 场记中提及':'匹配本场环境',priority}];
 }).sort((a,b)=>a.priority-b.priority);
 const seen=new Set<string>();const unique=matches.filter(a=>{if(seen.has(a.url))return false;seen.add(a.url);return true;});
 return {ids:unique.slice(0,9).map(a=>a.id),matches:unique.slice(0,9),omitted:unique.slice(9).map(a=>a.name)};
}
