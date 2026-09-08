import type { NodeId, Project } from './types.ts';
export const filmTeam = [
 {id:'producer',name:'总制片 / 总 Agent',stages:['clarify','script','assets','storyboard','generation'],deliverable:'制作约束、任务分派、依赖和返工决定',checks:'先检查输入是否齐备；区分艺术偏好与硬性限制；禁止越过用户批准或自行付费重试。'},
 {id:'development',name:'创意开发',stages:['clarify'],deliverable:'针对当前创意的歧义清单与制作简报',checks:'只问影响故事、时长、受众和制作可行性的未知项；已明确的信息不重复询问。'},
 {id:'writer',name:'编剧',stages:['script','storyboard'],deliverable:'场次、动作、逐字对白、戏剧转折',checks:'检查动机、因果、对白密度；分镜不得扩写已确认台词；时长不足交给制片协调。'},
 {id:'director',name:'导演',stages:['script','storyboard','continuity'],deliverable:'叙事重心、表演节奏与创作裁决',checks:'每个镜头承担明确的信息或情绪任务；解决专业部门冲突，不擅改已确认剧情。'},
 {id:'storyboard',name:'分镜导演',stages:['storyboard','continuity'],deliverable:'镜头序列、构图、切点与场次时长',checks:'逐场拆分，单镜动作可完成，分配而不重复对白；切点衔接，不用固定模板机械切镜。'},
 {id:'camera',name:'摄影指导',stages:['storyboard','continuity','prompts'],deliverable:'景别、焦距、机位、布光和运镜路径',checks:'区分主体轴线与相机坐标零点；路径、速度和焦距合理；构图变化不能直接判定跳切。'},
 {id:'art',name:'美术指导',stages:['assets','continuity'],deliverable:'统一材质、配色、时代背景与资产边界',checks:'把全局风格提炼为各资产可用的外观规范；隔离人物、场景与道具，不复制全量故事提示词。'},
 {id:'character_art',name:'人物美术',stages:['assets'],deliverable:'人物设定板、头部表情、发型和服装细节',checks:'同一身份多视角，白底或灰底；基准造型与探索方案分区；不混入场景或另一个人。'},
 {id:'environment_art',name:'场景美术',stages:['assets'],deliverable:'无人场景设定板、空间布局及材质',checks:'门窗、设施和通行空间对应各视角；反向不是镜像；未知尺度不声称实测。'},
 {id:'prop_art',name:'道具美术',stages:['assets','continuity'],deliverable:'道具结构、部件、开合状态与持有关系',checks:'先确定唯一结构，禁止“直板或翻盖”之类未决选项；屏幕亮灭和机械动作有顺序。'},
 {id:'action',name:'动作 / 表演指导',stages:['storyboard','continuity'],deliverable:'动作分拍、手部交接、姿态与表情变化',checks:'左右手、受力和道具接触可执行；动作推进不是状态冲突；留出必要时间。'},
 {id:'vfx',name:'视觉特效指导',stages:['assets','storyboard','qa'],deliverable:'雨水、反射、遮挡、合成层次与特效验收项',checks:'视觉效果和视觉特效合并为同一部门；说明可由生成实现及需后期实现的效果；文本审查不能冒充像素检测。'},
 {id:'continuity',name:'场记',stages:['continuity','qa'],deliverable:'有前后证据的连续性问题与返工岗位',checks:'区分文本差异、合理剪辑和明确冲突；服装局部描写不等于换装，画外变入镜不等于凭空出现。'},
 {id:'sound',name:'声音 / 对白指导',stages:['script','storyboard','assembly'],deliverable:'对白时长、画外音、音效、环境声及混音计划',checks:'按实际字数估时，标注粗估而非实测；对白跨镜不断句；环境音连续，不重复等待音与挂断音。'},
 {id:'editor',name:'剪辑指导',stages:['continuity','assembly'],deliverable:'时间轴、节奏、声音桥接与组装清单',checks:'核算素材时长与目标总长；字幕和音轨对齐；不得把尚未执行的 FFmpeg 操作说成已完成。'},
 {id:'executor',name:'执行制片 / 模型适配',stages:['prompts','generation'],deliverable:'模型能力检查、请求参数、任务 ID 与重试预算',checks:'检查真实端点、时长、参考图模式、输出规格；持久化任务，不因超时自动重复付费。'},
 {id:'reviewer',name:'质量审查',stages:['qa'],deliverable:'通过、需人工复核或退回的证据报告',checks:'没有实际视频视觉输入就不能断言换脸、肢体或画面穿帮；失败指向负责岗位并限制重试次数。'},
] as const;
export type TeamRoleId=typeof filmTeam[number]['id'];
export type TeamReport={roleId:TeamRoleId;revision:number;at:number;mode:'demo'|'live';summary:string;findings:{shotId:string;severity:'note'|'warning'|'error';evidence:string;suggestion:string;returnTo:TeamRoleId}[]};
export function teamForStage(stage:NodeId){return filmTeam.filter(r=>(r.stages as readonly string[]).includes(stage));}
export function teamInstructions(stage:NodeId){return '\n部门协作责任（总 Agent 综合执行；独立会审结果另行记录）：\n'+teamForStage(stage).map(r=>r.name+'：交付 '+r.deliverable+'。'+r.checks).join('\n');}
export function validateTeamReport(raw:Record<string,unknown>,p:Project,roleId:TeamRoleId):TeamReport{
 if(typeof raw.summary!=='string'||!raw.summary.trim()||raw.summary.length>3000||!Array.isArray(raw.findings)||raw.findings.length>20)throw new Error('部门报告结构无效。');
 const findings=raw.findings.map((value:unknown)=>{const f=value as TeamReport['findings'][number];if(!f||!['note','warning','error'].includes(f.severity)||typeof f.shotId!=='string'||(f.shotId&&!p.plan?.shots.some(s=>s.id===f.shotId))||typeof f.evidence!=='string'||!f.evidence.trim()||f.evidence.length>2000||typeof f.suggestion!=='string'||!f.suggestion.trim()||f.suggestion.length>2000||!filmTeam.some(r=>r.id===f.returnTo))throw new Error('部门报告证据、镜头引用或返工岗位无效。');return {shotId:f.shotId,severity:f.severity,evidence:f.evidence,suggestion:f.suggestion,returnTo:f.returnTo};});
 return {roleId,revision:p.revision,at:Date.now(),mode:p.mode,summary:raw.summary,findings};
}
