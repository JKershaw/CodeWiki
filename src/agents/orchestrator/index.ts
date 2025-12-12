/**
 * Orchestrator - the outer loop that decides what work to do.
 */
export type { Orchestrator } from './orchestrator.js';
export { DefaultOrchestrator, createOrchestrator } from './orchestrator.js';
export type { OrchestratorConfig, WorkSummary } from './orchestrator.js';
export { PhasedOrchestrator, Phase, detectPhase } from './phased-orchestrator.js';
export type { PhaseContext } from './phased-orchestrator.js';
