// A workflow can make several sequential model calls, including validated repairs.
export const LLM_TIMEOUT_MS = 15 * 60 * 1000;
export function studioTimeoutMs(action: string): number {
  if (['status','settings','skills','list','get','shot_image_prompt'].includes(action)) return 15000;
  const calls = ['approve_script','approve_assets'].includes(action) ? 4 : 2;
  return calls * LLM_TIMEOUT_MS + 30000;
}
