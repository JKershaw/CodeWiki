import type { AgentContext } from '../../base-agent.js';
import { createAgentResult, createFinding } from '../../base-agent.js';
import type { FindingGroup, FindingType } from '../../../domain/finding.js';
import type { FindingHandler, FindingHandlerResult } from '../finding-handler.js';

/**
 * Handler for category mismatch findings.
 * Currently reports the issues for manual review - category moves require careful consideration.
 */
export class CategoryMismatchHandler implements FindingHandler {
  readonly supportedTypes: readonly FindingType[] = ['category_mismatch'];

  async handle(group: FindingGroup, _context: AgentContext): Promise<FindingHandlerResult> {
    // Category mismatch requires more careful handling - just report for now
    // Moving pages between categories can affect navigation and linking
    return {
      result: createAgentResult({
        summary: `Found ${group.findings.length} page(s) that may be in the wrong category`,
        findings: group.findings.map(f => createFinding({
          type: 'CONSOLIDATION',
          description: f.description,
          relatedPaths: f.affectedPaths,
          importance: 'low',
        })),
        confidence: 0.6,
      }),
      updates: [],
      costUsd: 0,
    };
  }
}
