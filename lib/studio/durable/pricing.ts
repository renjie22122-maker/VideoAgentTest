/**
 * Cost estimates for the usage ledger.
 *
 * These are DOCUMENTED ESTIMATES, not provider invoices: local preflight and
 * accounting sanity checks, never a billing statement. Every figure has an
 * environment override so real rates can be configured per deployment.
 */
export type CostCategory = 'llm' | 'image' | 'video';

const per1MTokens = Number(process.env.COST_LLM_PER_1M_TOKENS ?? 3);
const videoPerSecond = Number(process.env.COST_VIDEO_PER_SECOND ?? 0);
const imagePerImage = Number(process.env.COST_IMAGE_PER_IMAGE ?? 0);

export function estimateLLMCost(model: string, inputTokens: number): number {
  const premium = /(?:claude|gpt-5|o[1-9]|gemini-2)/i.test(model) ? 2 : 1;
  const base = per1MTokens * premium;
  // Blended input/output estimate: output tokens ≈ input tokens for these tasks.
  return (inputTokens * 2 * base) / 1_000_000;
}

export function estimateVideoCost(provider: string, model: string, seconds: number): number {
  const base = videoPerSecond || (provider === 'minimax' ? 0.3 : provider === 'fal-kling' ? 0.25 : 0.2);
  const premium = /max|pro/i.test(model) ? 1.5 : 1;
  return seconds * base * premium;
}

export function estimateImageCost(provider: string): number {
  return imagePerImage || (provider === 'openai' ? 0.08 : provider === 'fal' ? 0.05 : 0.03);
}
