import type { AgentDefinition } from '../../team-config.ts';
import type { AutoLogEntry, AutoRun } from '../../auto-run-state.ts';
import type { Project } from '../../types.ts';
import type { AgentObservation } from '../observation.ts';
import type { AutoDecision } from '../planner.ts';
import type { CapabilityId } from '../capabilities.ts';

/**
 * Action contract. Each registered action receives a validated decision and a
 * projected observation, performs ONE bounded mutation (or review), and
 * records its own outcome. Mutation / invalidation / approval / verification
 * rules live here instead of in a single dispatch switch.
 *
 * The metadata fields are the data-driven half of the policy: the planner's
 * observation renders them as allowedActions, and the policy engine
 * evaluates them into allow / deny verdicts — it contains no per-action
 * hardcoding.
 */
export type ActionExecutionContext = {
  project: Project;
  run: AutoRun;
  observation: AgentObservation;
  decision: AutoDecision;
  requiredReview: AutoDecision | undefined;
  role: AgentDefinition | undefined;
  entry: AutoLogEntry;
  contentBefore: string;
  /** The step's task record — reused when the scheduler drove this step. */
  taskId: string;
};

/** Explicit capability semantics: allOf must ALL be granted; anyOf needs one. */
export type CapabilityRequirement = {
  allOf?: readonly CapabilityId[];
  anyOf?: readonly CapabilityId[];
};

/** Declared precondition: the policy engine checks it before any model call. */
export type ActionPrecondition = {
  id: string;
  label: string;
  message: string;
  satisfied(p: Project): boolean;
};

export interface AgentAction {
  readonly id: AutoDecision['action'];
  /** One-line description shown to the supervisor via allowedActions. */
  readonly description: string;
  /** Approval / verification semantics — the replacement for prompt prose. */
  readonly approval: string;
  /** Capabilities that authorize this action. */
  readonly capabilityRequirement: CapabilityRequirement;
  /** State preconditions; checked generically by the policy engine. */
  readonly preconditions: readonly ActionPrecondition[];
  /** Resource kinds this action mutates / invalidates; drives policy and lineage. */
  readonly effects: readonly string[];
  /** Whether a successful execution forces independent verification. */
  readonly requiresVerification: boolean;
  /** Must complete or throw; the run controller owns the audit log and budget. */
  execute(ctx: ActionExecutionContext): Promise<void>;
}
