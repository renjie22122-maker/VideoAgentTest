import {
  storyCommandHandler,
  durationUpdateHandler,
  briefDecisionsHandler,
  clarifyHandler,
  planHandler,
  approveScriptHandler,
  approveAssetsHandler,
} from './story.ts';
import {
  mergeShotsHandler,
  shotImageUploadHandler,
  motionPlanHandler,
  shotHandler,
  bibleHandler,
  continuityReviewHandler,
  compileHandler,
  approveRenderHandler,
} from './storyboard.ts';
import {
  enqueueGroupHandler,
  videoConfigHandler,
  reviewHandler,
  prepareAssemblyHandler,
  completeHandler,
  enqueueHandler,
  cancelHandler,
  pollHandler,
} from './media.ts';
import { autoCommandHandler, agentConfigSaveHandler } from './autopilot.ts';
import { teamReviewHandler } from './team.ts';
import { assetHandler } from './assets.ts';
import type { CommandHandler } from './shared.ts';

/**
 * Ordered command registry.
 *
 * Order matters: it mirrors the original dispatch chain exactly, so handlers
 * match in the same sequence and the same guards still sit between phases.
 * First match wins; a handler may return NEXT_HANDLER to fall through.
 */
export const coreCommandHandlers: readonly CommandHandler[] = [
  storyCommandHandler,
  enqueueGroupHandler,
  mergeShotsHandler,
  videoConfigHandler,
  shotImageUploadHandler,
  motionPlanHandler,
  durationUpdateHandler,
  autoCommandHandler,
  agentConfigSaveHandler,
  teamReviewHandler,
  assetHandler,
];

/** Runs after the asset-generation guard. */
export const lateCommandHandlers: readonly CommandHandler[] = [
  briefDecisionsHandler,
  clarifyHandler,
  planHandler,
  approveScriptHandler,
  approveAssetsHandler,
  shotHandler,
  bibleHandler,
  continuityReviewHandler,
  compileHandler,
  approveRenderHandler,
  reviewHandler,
  prepareAssemblyHandler,
  completeHandler,
  enqueueHandler,
  cancelHandler,
  pollHandler,
];
