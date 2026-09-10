import {isReadOnlyCommand,languageCallBudget} from './command-policy.ts';
// A workflow can make several sequential model calls, including validated repairs.
export const LLM_TIMEOUT_MS = 15 * 60 * 1000;
export function studioTimeoutMs(action: string): number {
  if (isReadOnlyCommand(action)) return 15000;
  const calls = languageCallBudget(action);
  return calls * LLM_TIMEOUT_MS + 30000;
}
