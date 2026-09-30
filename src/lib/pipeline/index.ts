/**
 * Pipeline entry points (used by the worker and the CLI; the web app only queues runs, see
 * ./queue.ts):
 *   fetch → raw snapshot → parse → quality gates → normalise → company → dedup → facts →
 *   visa/remote → score → job changes → AI enqueue → lifecycle → run report / alerts.
 */
export type { RunStatus } from './report';
export { processQueuedRuns, runPipeline, type PipelineRunResult, type ProcessQueuedResult, type RunPipelineOptions } from './run';
export { reprocessFromRaw, type ReprocessOptions, type ReprocessResult } from './reprocess';
