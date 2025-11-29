import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { FindingGroup } from '../../domain/finding.js';
import type { FindingHandlerRegistry } from './finding-handler-registry.js';
import { createDefaultHandlerRegistry } from './finding-handler-registry.js';

/**
 * Consolidation Agent - Self-healing wiki maintenance.
 *
 * This agent addresses findings detected by meta agents:
 * - Merges duplicate pages (LLM decides what to keep)
 * - Deletes redundant pages
 * - Updates/fixes links pointing to deleted pages
 * - Standardizes terminology across pages
 *
 * The agent uses the Strategy Pattern via FindingHandlerRegistry to
 * delegate finding processing to specialized handlers. This design:
 * - Adheres to Single Responsibility Principle (each handler has one job)
 * - Adheres to Open/Closed Principle (new types via new handlers, no modifications)
 * - Keeps the agent class focused on coordination and lifecycle management
 */
export class ConsolidationAgent implements Agent {
  readonly type: AgentType = 'consolidation';
  private readonly handlerRegistry: FindingHandlerRegistry;

  constructor(handlerRegistry?: FindingHandlerRegistry) {
    this.handlerRegistry = handlerRegistry ?? createDefaultHandlerRegistry();
  }

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('ConsolidationAgent does not run on commits. Use runOnWiki instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    // Get open findings grouped for consolidation
    const findingGroups = await context.repos.findings.groupOpenFindings(context.wikiId);

    if (findingGroups.length === 0) {
      return {
        result: createAgentResult({
          summary: 'No findings to consolidate',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Process the highest priority finding group
    const group = findingGroups[0]!;

    // Mark findings as in progress
    await this.markFindingsInProgress(group, context);

    try {
      const result = await this.processGroup(group, context);

      // Mark findings as addressed
      await this.markFindingsAddressed(group, result.agentRunId ?? '', context);

      return result;
    } catch (error) {
      // Reset findings to open on error
      await this.resetFindingsToOpen(group, context);
      throw error;
    }
  }

  /**
   * Process a group of related findings by delegating to the appropriate handler.
   */
  private async processGroup(
    group: FindingGroup,
    context: AgentContext
  ): Promise<AgentRunResult & { agentRunId?: string }> {
    const handler = this.handlerRegistry.getHandler(group.type);

    if (!handler) {
      return {
        result: createAgentResult({
          summary: `Unsupported finding type: ${group.type}`,
          findings: [
            createFinding({
              type: 'CONSOLIDATION',
              description: `No handler registered for finding type: ${group.type}`,
              relatedPaths: group.affectedPaths,
              importance: 'low',
            }),
          ],
          confidence: 0.5,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    return handler.handle(group, context);
  }

  /**
   * Mark all findings in a group as in progress.
   */
  private async markFindingsInProgress(group: FindingGroup, context: AgentContext): Promise<void> {
    for (const finding of group.findings) {
      await context.repos.findings.markInProgress(finding.id, '');
    }
  }

  /**
   * Mark all findings in a group as addressed.
   */
  private async markFindingsAddressed(
    group: FindingGroup,
    agentRunId: string,
    context: AgentContext
  ): Promise<void> {
    for (const finding of group.findings) {
      await context.repos.findings.markAddressed(finding.id, agentRunId);
    }
  }

  /**
   * Reset all findings in a group back to open status.
   */
  private async resetFindingsToOpen(group: FindingGroup, context: AgentContext): Promise<void> {
    for (const finding of group.findings) {
      await context.repos.findings.save({
        ...finding,
        status: 'open',
        addressedByAgentRunId: null,
      });
    }
  }
}
