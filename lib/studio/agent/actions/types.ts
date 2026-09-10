import type { AgentDefinition } from '../../team-config.ts';
import type { AutoLogEntry, AutoRun } from '../../auto-run-state.ts';
import type { Project } from '../../types.ts';
import type { AgentObservation } from '../observation.ts';
import type { AutoDecision } from '../planner.ts';

/**
 * Action contract. Each registered action receives a validated decision and a
 * projected observation, performs ONE bounded mutation (or review), and
 * records its own outcome. Mutation / invalidation / approval / verification
 * rules live here instead of in a single dispatch switch.
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
  /** Must complete or throw; the run controller owns the audit log and budget. */
  execute(ctx: ActionExecutionContext): Promise<void>;
}
