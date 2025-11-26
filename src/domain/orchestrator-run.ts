import type { OrchestratorContext } from '../agents/orchestrator/context-gatherer.js';
import type { OrchestratorDecision } from '../agents/orchestrator/prompts.js';

/**
 * Record of a single orchestrator decision run.
 * Used for debugging, analysis, and prompt tuning.
 */
export interface OrchestratorRun {
  id: string;
  repoId: string;
  timestamp: Date;

  // Input
  context: OrchestratorContext;
  promptSent: string;

  // Output
  rawResponse: string;
  decision: OrchestratorDecision;
  workItemsCreated: string[];

  // Metrics
  model: string;
  costUsd: number;
  durationMs: number;

  // Whether this used LLM or fell back to deterministic
  usedLLM: boolean;
}

/**
 * Create a new orchestrator run record.
 */
export function createOrchestratorRun(params: {
  id: string;
  repoId: string;
  context: OrchestratorContext;
  promptSent: string;
}): OrchestratorRun {
  return {
    id: params.id,
    repoId: params.repoId,
    timestamp: new Date(),
    context: params.context,
    promptSent: params.promptSent,
    rawResponse: '',
    decision: { reasoning: '', workItems: [] },
    workItemsCreated: [],
    model: '',
    costUsd: 0,
    durationMs: 0,
    usedLLM: false,
  };
}
