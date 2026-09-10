// Shared by the browser deadline and server dispatch. Unknown commands are never read-only.
const readOnly = new Set([
  'status',
  'settings',
  'skills',
  'list',
  'get',
  'shot_image_prompt',
  'video_preview',
  'quality_report',
]);
export function isReadOnlyCommand(action: string) {
  return readOnly.has(action);
}
export function languageCallBudget(action: string) {
  return ['approve_script', 'approve_assets'].includes(action) ? 4 : 2;
}
