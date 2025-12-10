import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { FindingGroup } from '../../domain/finding.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import type { FindingHandlerRegistry } from './finding-handler-registry.js';
import { createDefaultHandlerRegistry } from './finding-handler-registry.js';
import { createGroupOpenFindingsQuery, handleGroupOpenFindings } from '../../queries/index.js';
import {
  createMarkFindingInProgressCommand,
  handleMarkFindingInProgress,
  createMarkFindingAddressedCommand,
  handleMarkFindingAddressed,
  createResetFindingToOpenCommand,
  handleResetFindingToOpen,
} from '../../commands/index.js';

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

  getSystemPrompt(): null {
    return null; // This agent delegates to handlers, no central LLM prompt
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isWikiTarget(target)) {
      throw new Error(`ConsolidationAgent cannot handle target type: ${target.type}`);
    }

    // Get open findings grouped for consolidation via CQRS query
    const findingsQuery = createGroupOpenFindingsQuery(context.wikiId);
    const findingsResult = await handleGroupOpenFindings(findingsQuery, context.repos);
    const findingGroups = findingsResult.data || [];

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

    // Process multiple finding groups per run (up to 5) to speed up consolidation
    const MAX_GROUPS_PER_RUN = 5;
    const groupsToProcess = findingGroups.slice(0, MAX_GROUPS_PER_RUN);

    const allUpdates: WikiPageUpdate[] = [];
    const allFindings: AgentRunResult['result']['findings'] = [];
    const summaries: string[] = [];
    let totalCost = 0;

    for (const group of groupsToProcess) {
      // Mark findings as in progress
      await this.markFindingsInProgress(group, context);

      try {
        const result = await this.processGroup(group, context);

        // Mark findings as addressed
        await this.markFindingsAddressed(group, result.agentRunId ?? '', context);

        // Accumulate results
        if (result.updates) {
          allUpdates.push(...result.updates);
        }
        if (result.result.findings) {
          allFindings.push(...result.result.findings);
        }
        summaries.push(result.result.summary);
        totalCost += result.costUsd ?? 0;
      } catch (error) {
        // Reset findings to open on error
        await this.resetFindingsToOpen(group, context);
        // Continue processing other groups, but log the error
        console.error(`[consolidation] Error processing group ${group.type}:`, error);
      }
    }

    const remainingGroups = findingGroups.length - groupsToProcess.length;
    const summaryText = remainingGroups > 0
      ? `Processed ${groupsToProcess.length} finding groups (${remainingGroups} remaining). ${summaries.join('; ')}`
      : `Processed ${groupsToProcess.length} finding groups. ${summaries.join('; ')}`;

    return {
      result: createAgentResult({
        summary: summaryText,
        findings: allFindings,
        confidence: 0.8,
      }),
      updates: allUpdates,
      costUsd: totalCost,
    };
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
   * Mark all findings in a group as in progress via CQRS commands.
   */
  private async markFindingsInProgress(group: FindingGroup, context: AgentContext): Promise<void> {
    for (const finding of group.findings) {
      const command = createMarkFindingInProgressCommand(finding.id, '');
      await handleMarkFindingInProgress(command, context.repos);
    }
  }

  /**
   * Mark all findings in a group as addressed via CQRS commands.
   */
  private async markFindingsAddressed(
    group: FindingGroup,
    agentRunId: string,
    context: AgentContext
  ): Promise<void> {
    for (const finding of group.findings) {
      const command = createMarkFindingAddressedCommand(finding.id, agentRunId);
      await handleMarkFindingAddressed(command, context.repos);
    }
  }

  /**
   * Reset all findings in a group back to open status via CQRS commands.
   */
  private async resetFindingsToOpen(group: FindingGroup, context: AgentContext): Promise<void> {
    for (const finding of group.findings) {
      const command = createResetFindingToOpenCommand(finding.id);
      await handleResetFindingToOpen(command, context.repos);
    }
  }
}
