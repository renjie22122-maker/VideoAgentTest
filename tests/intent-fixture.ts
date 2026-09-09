import type {Shot} from '../lib/studio/types.ts';
import type {Screenplay} from '../lib/studio/screenplay.ts';
export function withIntent(shots:Shot[],script:Screenplay):Shot[]{
 const seen=new Set<string>();return shots.map(s=>{const scene=script.scenes!.find(v=>v.id===s.scene)!;const first=!seen.has(s.scene);seen.add(s.scene);return {...s,dialogue:first?scene.dialogue.map(d=>d.line).join(''):'',intent:{actionIndices:first?scene.action.map((_,i)=>i+1):[],dialogueIndices:first?scene.dialogue.map((_,i)=>i+1):[],purpose:'建立动作与反应',movementReason:'保持观察距离',speedPlan:'前段匀速，末段减速',actionTiming:'先观察再反应',visualPlan:'主体清晰，环境声属于本场',cutReason:'接续本场动作',physicsChecks:['脚接触地面，持有物不凭空消失'],scaleAnchors:['人物与门框保持相对尺度，绝对尺寸待确认']}};});
}
