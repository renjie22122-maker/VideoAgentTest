import type { Project, Question } from './types.ts';
import { text } from './domain.ts';
import { roleJSON } from './providers.ts';
import { skillGuide } from './skills.ts';
export type CreativeBrief={summary:string;known:{topic:string;value:string;evidence:string}[];assumptions:string[];ready:boolean;round:number;source:'model'|'demo';history:{question:string;answer:string}[]};
export type ClarificationResult={brief:CreativeBrief;questions:Question[]};
function obj(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('创意分析格式无效。');return v as Record<string,unknown>;}
export function clarificationSources(p:Project,history:CreativeBrief['history']){
 return [{id:'idea',text:p.idea},...Object.entries(p.storyContext?.guide??{}).filter(([key,value])=>key!=='editingMode'&&typeof value==='string'&&value).map(([key,value])=>({id:'story-'+key,text:value})),...history.map((h,i)=>({id:'answer-'+i,text:h.answer})),...Object.entries(p.answers).map(([id,answer])=>({id:'additional-'+id,text:answer})),{id:'duration',text:p.duration+' 秒'+(p.durationMode==='auto'?'（系统暂估，非用户指定）':'')},{id:'ratio',text:p.ratio}];
}
export function validateClarification(raw:unknown,p:Project,history:CreativeBrief['history']):ClarificationResult{
 const v=obj(raw);if(!Array.isArray(v.known)||v.known.length>30||!Array.isArray(v.assumptions)||v.assumptions.length>12||!Array.isArray(v.questions)||v.questions.length>4||typeof v.ready!=='boolean')throw new Error('创意分析没有返回有效的事实、建议与问题。');
 const sources=clarificationSources(p,history).map(s=>s.text);
 const known=v.known.map((item,index)=>{const f=obj(item),evidence=text(f.evidence,'信息依据',600);if(!sources.some(s=>s.includes(evidence)))throw new Error('第 '+(index+1)+' 项事实依据「'+evidence.slice(0,80)+'」不是可引用来源中的连续原文。请逐字摘录；推断应移入 assumptions。');return {topic:text(f.topic,'信息类别',80),value:text(f.value,'已知信息',1500),evidence};});
 const optionalSuggestions:string[]=[];
 const parsedQuestions=v.questions.map((item,index)=>{
  const q=obj(item),prefix='第 '+(index+1)+' 个澄清问题';
  const id=text(q.id,prefix+' ID',50);if(!/^[a-z][a-z0-9_-]*$/.test(id)||['constructor','prototype'].includes(id))throw new Error(prefix+' ID 无效。');
  const values=q.options??[];
  if(!Array.isArray(values)||values.length>6)throw new Error(prefix+'的 options 应为最多 6 个文本选项，开放式问题可省略或填 []。');
  const required=q.required===undefined||q.required===null?true:q.required==='true'?true:q.required==='false'?false:q.required;
  if(typeof required!=='boolean')throw new Error(prefix+'的 required 应为 true 或 false。');
  return {id,label:text(q.label,prefix+'内容',1000),why:text(q.why,prefix+'提问原因',1000),placeholder:typeof q.placeholder==='string'?q.placeholder.slice(0,300):'',options:[...new Set(values.map(o=>text(o,prefix+'选项',500)))],required};
 });
 if(new Set(parsedQuestions.map(q=>q.id)).size!==parsedQuestions.length)throw new Error('澄清问题 ID 重复。');
 const questions=parsedQuestions.filter(q=>{if(!q.required){optionalSuggestions.push('可选补充：'+q.label+'（'+q.why+'）'+(q.options.length?' 参考方向：'+q.options.join('；'):''));return false;}return true;});
 const ready=questions.length===0;
 if(v.ready!==ready&&!(ready&&optionalSuggestions.length))throw new Error('澄清问题与就绪状态不一致。');

 return {questions,brief:{summary:text(v.summary,'创意理解',4000),known,assumptions:[...v.assumptions.map(a=>text(a,'待确认建议',1200)),...optionalSuggestions],ready,round:(p.brief?.round??0)+1,source:p.mode==='live'?'model':'demo',history}};
}
export function demoClarification(p:Project,history:CreativeBrief['history']):ClarificationResult{
 const known:CreativeBrief['known']=[];const questions:Question[]=[];const content=p.idea;
 const add=(id:string,label:string,why:string,options:string[])=>{if(p.answers[id]?.trim()){known.push({topic:label,value:p.answers[id],evidence:p.answers[id]});return;}questions.push({id,label,why,options,placeholder:'可以选择方向，也可以直接写你的想法',required:true});};
 if(!history.length){
   const scene=content.match(/(?:雨后|黄昏|凌晨|夜晚|白天|车站|面包店|街道|海边|室内)/g);if(scene)known.push({topic:'已提及的时空',value:scene.join('、'),evidence:scene[0]});
 }
 if(/信|信件/.test(content))add('letter_meaning','这封信最关键的内容或来历是什么？','它会决定主角为何行动，以及结尾回应什么。',['来自过去的自己','来自重要的人','由编剧设计，但保留温暖结尾']);
 else if(/产品|广告|品牌/.test(content))add('product_message','这条片子最需要观众记住哪个产品特点？','决定事件、视觉重点和结尾信息。',['突出使用效果','突出情感价值','先展示外观与质感']);
 else if(/追|逃|寻找|找/.test(content))add('motivation','主角为什么必须完成这次追逐或寻找？','动机决定阻力和动作的紧迫程度。',['避免失去重要的人或物','完成一个承诺','由编剧补充动机']);
 else add('core_event','在「'+content.slice(0,45)+'」中，你最想看到哪个具体变化发生？','把画面想法收束成可以拍摄的核心事件。',['人物作出一个选择','一个物件或环境发生变化','由编剧设计具体事件']);
 if(!/结尾|最后|最终|离开|回到|结束/.test(content))add('ending','你希望结尾让观众明确知道结果，还是留下悬念？','确定收束方式，避免编剧擅自解释故事。',['明确完成事件','留下开放结尾','由编剧根据创意决定']);
 if(!/无对白|对白|旁白|配音|台词/.test(content))add('voice','这个故事通过画面和声音表达，还是需要人物说话？','影响剧本节奏、台词和后续声音制作。',['无对白，靠动作表达','少量人物对白','需要旁白']);
 return {questions,brief:{summary:'我理解的核心创意是：'+p.idea+'。目标 '+p.duration+' 秒，画幅 '+p.ratio+'。',known,assumptions:['演示模式只做关键词分析；真实模式会由语言模型阅读全文并针对性澄清。'],ready:questions.length===0,round:(p.brief?.round??0)+1,source:'demo',history}};
}
export async function analyzeClarification(p:Project,history:CreativeBrief['history']=p.brief?.history??[]):Promise<ClarificationResult>{
 if(p.mode==='demo')return demoClarification(p,history);
 const instruction=skillGuide('clarify',p)+'\nknown[].evidence 只能从 citationSources 中某一条 text 逐字摘录连续片段，不能改写、拼接、加省略号或引用 previousBrief 的模型总结。value 可以概括，但不得超出证据含义。没有直接依据的信息移到 assumptions 或提出问题。片长/画幅分别引用 duration/ratio 条目。';
 const input={idea:p.idea,duration:p.duration,ratio:p.ratio,previousBrief:p.brief??null,history,additionalAnswers:p.answers,citationSources:clarificationSources(p,history)};
 const result=await roleJSON('创意开发编辑',instruction,input);
 try{return validateClarification(result,p,history);}catch(error){
  const repaired=await roleJSON('创意开发编辑',instruction+'\n上次分析未通过检查。保持用户原意，仅修复引用和结构；不要新增一轮问答或要求用户重复输入。',{...input,previousOutput:result,validationError:error instanceof Error?error.message:'结构无效'});
  try{return validateClarification(repaired,p,history);}catch(e){throw new Error('创意分析已自动修正一次，仍未通过：'+(e instanceof Error?e.message:'结构无效')+' 原有内容未改变。');}
 }
}
