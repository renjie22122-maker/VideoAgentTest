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
 * observation renders them as availableActions, and the policy engine
 * evaluates them into allow / deny verdicts.
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
};

export interface AgentAction {
  readonly id: AutoDecision['action'];
  /** One-line description shown to the supervisor via availableActions. */
  readonly description: string;
  /**
   * Capabilities that authorize this action. ANY-of semantics: the executing
   * role must grant at least one. An empty list means the action is safe for
   * the supervisor itself (stop).
   */
  readonly requiredCapabilities: readonly CapabilityId[];
  /** Resource kinds this action mutates / invalidates; drives policy and lineage. */
  readonly effects: readonly string[];
  /** Whether a successful execution forces independent verification. */
  readonly requiresVerification: boolean;
  /** Must complete or throw; the run controller owns the audit log and budget. */
  execute(ctx: ActionExecutionContext): Promise<void>;
}
