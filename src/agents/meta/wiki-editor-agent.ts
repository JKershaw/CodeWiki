import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage, WikiPageUpdate } from '../../domain/wiki-page.js';
import type { EditRequest, EditDecision } from '../../domain/edit-request.js';
import { isCommitEditSource } from '../../domain/edit-request.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';
import { extractTitleWithFallback } from '../../commands/update-wiki-page.js';
import {
  createParseContext,
  parseChoice,
  parseSection,
} from '../parsing/index.js';

/**
 * Wiki Editor Agent - Intelligently processes edit requests from analysis agents.
 *
 * This meta-agent:
 * - Reads pending edit requests from the queue
 * - Compares commit timestamps to determine if edits are current or historical
 * - For current edits: applies normally
 * - For historical edits: uses LLM to decide whether to skip, merge to history, or apply
 * - Maintains a "Historical Context" section on pages for evolutionary understanding
 */
export class WikiEditorAgent implements Agent {
  readonly type: AgentType = 'wiki-editor';

  private readonly MAX_EDITS_PER_RUN = 10;
  private readonly HISTORY_SECTION_HEADER = '## Historical Context';

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isWikiTarget(target)) {
      throw new Error(`WikiEditorAgent cannot handle target type: ${target.type}`);
    }

    // Get pending edit requests, ordered by commit timestamp (oldest first)
    const pendingEdits = await context.repos.editRequests.findPending(context.wikiId);

    if (pendingEdits.length === 0) {
      return {
        result: createAgentResult({
          summary: 'No pending edit requests to process',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Get current wiki pages for comparison
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const pages = pagesResult.data || [];
    const pagesByPath = new Map(pages.map((p) => [p.path, p]));

    // Process edit requests (limited per run)
    const editsToProcess = pendingEdits.slice(0, this.MAX_EDITS_PER_RUN);
    const updates: WikiPageUpdate[] = [];
    const findings: Array<{
      type: string;
      description: string;
      relatedPaths: string[];
      importance: 'low' | 'medium' | 'high';
    }> = [];
    let totalCost = 0;

    for (const editRequest of editsToProcess) {
      const currentPage = pagesByPath.get(editRequest.targetPagePath) ?? null;

      const { decision, cost } = await this.processEditRequest(
        editRequest,
        currentPage,
        context
      );

      totalCost += cost;

      // Generate wiki update based on decision
      const update = this.createUpdateFromDecision(editRequest, currentPage, decision);
      if (update) {
        updates.push(update);
      }

      // Record finding for tracking
      findings.push({
        type: 'EDIT_PROCESSED',
        description: `${decision.action}: ${decision.reasoning}`,
        relatedPaths: [editRequest.targetPagePath],
        importance: decision.action === 'conflict' ? 'high' : 'low',
      });

      // Mark edit request as processed
      await context.repos.editRequests.markProcessed(
        editRequest.id,
        this.decisionToStatus(decision.action),
        decision.reasoning,
        '' // Will be set by executor with actual agent run ID
      );
    }

    const applied = findings.filter((f) => f.description.startsWith('apply:')).length;
    const historical = findings.filter((f) =>
      f.description.startsWith('merge-to-history:')
    ).length;
    const skipped = findings.filter((f) => f.description.startsWith('skip:')).length;
    const conflicts = findings.filter((f) => f.description.startsWith('conflict:')).length;

    return {
      result: createAgentResult({
        summary: `Processed ${editsToProcess.length} edit requests: ${applied} applied, ${historical} merged to history, ${skipped} skipped, ${conflicts} conflicts`,
        findings: findings.map((f) =>
          createFinding({
            type: f.type,
            description: f.description,
            relatedPaths: f.relatedPaths,
            importance: f.importance,
          })
        ),
        confidence: 0.9,
      }),
      updates,
      costUsd: totalCost,
    };
  }

  /**
   * Process a single edit request and decide how to handle it.
   */
  private async processEditRequest(
    editRequest: EditRequest,
    currentPage: WikiPage | null,
    context: AgentContext
  ): Promise<{ decision: EditDecision; cost: number }> {
    // Case 1: Page doesn't exist - always create
    if (!currentPage) {
      return {
        decision: {
          action: 'apply',
          reasoning: 'Page does not exist, creating new page',
          content: editRequest.proposedContent,
        },
        cost: 0,
      };
    }

    // Case 2: Delete request - apply if page exists
    if (editRequest.proposedUpdateType === 'delete') {
      return {
        decision: {
          action: 'apply',
          reasoning: 'Delete request for existing page',
        },
        cost: 0,
      };
    }

    // Case 3: Get the latest commit timestamp from the page's source commits
    const latestPageCommitTimestamp = await this.getLatestCommitTimestamp(
      currentPage.sourceCommits,
      editRequest.repoId,
      context
    );

    // Case 4: No existing commits on page (shouldn't happen, but handle gracefully)
    if (!latestPageCommitTimestamp) {
      return {
        decision: {
          action: 'apply',
          reasoning: 'Page has no source commits, applying edit',
          content: editRequest.proposedContent,
        },
        cost: 0,
      };
    }

    // Case 5: Edit is from a NEWER or SAME commit - apply normally
    const sourceSha = isCommitEditSource(editRequest.source) ? editRequest.source.commitSha : 'unknown';
    const sourceTimestamp = isCommitEditSource(editRequest.source) ? editRequest.source.commitTimestamp : null;

    // For non-commit sources, always apply (they're considered current)
    if (!sourceTimestamp || sourceTimestamp >= latestPageCommitTimestamp) {
      return {
        decision: {
          action: 'apply',
          reasoning: sourceSha !== 'unknown'
            ? `Edit from commit ${sourceSha.slice(0, 7)} (${this.formatDate(sourceTimestamp!)}) is current`
            : `Edit from ${editRequest.source.type} source is current`,
          content: editRequest.proposedContent,
        },
        cost: 0,
      };
    }

    // Case 6: Edit is from an OLDER commit - use LLM to decide
    return await this.handleHistoricalEdit(editRequest, currentPage, latestPageCommitTimestamp, context);
  }

  /**
   * Handle an edit request from a commit older than the current page content.
   */
  private async handleHistoricalEdit(
    editRequest: EditRequest,
    currentPage: WikiPage,
    latestPageCommitTimestamp: Date,
    context: AgentContext
  ): Promise<{ decision: EditDecision; cost: number }> {
    const prompt = this.buildHistoricalEditPrompt(
      editRequest,
      currentPage,
      latestPageCommitTimestamp
    );

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
      temperature: 0.2,
    });

    const decision = this.parseDecision(completion.content, editRequest, currentPage);

    return {
      decision,
      cost: completion.costUsd,
    };
  }

  private readonly CONTENT_TRUNCATION_LIMIT = 4000;

  /**
   * Build prompt for the LLM to decide how to handle a historical edit.
   */
  private buildHistoricalEditPrompt(
    editRequest: EditRequest,
    currentPage: WikiPage,
    latestPageCommitTimestamp: Date
  ): string {
    const hasHistorySection = currentPage.content.includes(this.HISTORY_SECTION_HEADER);
    const sourceSha = isCommitEditSource(editRequest.source) ? editRequest.source.commitSha : 'unknown';
    const sourceTimestamp = isCommitEditSource(editRequest.source) ? editRequest.source.commitTimestamp : null;
    const truncationLimit = this.CONTENT_TRUNCATION_LIMIT;

    // Build truncation notice with remaining content hint
    const currentContentTruncated = currentPage.content.length > truncationLimit;
    const proposedContentTruncated = editRequest.proposedContent.length > truncationLimit;

    return `You are editing a wiki page. An analysis from an OLDER commit has arrived and needs to be processed.

## Current Page State
**Path:** ${currentPage.path}
**Title:** ${currentPage.title}
**Last updated from commit dated:** ${this.formatDate(latestPageCommitTimestamp)}
**Has history section:** ${hasHistorySection ? 'Yes' : 'No'}

**Current Content:**
\`\`\`markdown
${currentPage.content.slice(0, truncationLimit)}${currentContentTruncated ? `\n... (${currentPage.content.length - truncationLimit} more characters)` : ''}
\`\`\`

## Proposed Edit (from older commit)
**Source Agent:** ${editRequest.sourceAgentType} ${this.getAgentBiasHint(editRequest.sourceAgentType)}
**Commit SHA:** ${sourceSha.slice(0, 7)}
**Commit Date:** ${sourceTimestamp ? this.formatDate(sourceTimestamp) : 'unknown'}
**Update Type:** ${editRequest.proposedUpdateType}

**Proposed Content:**
\`\`\`markdown
${editRequest.proposedContent.slice(0, truncationLimit)}${proposedContentTruncated ? `\n... (${editRequest.proposedContent.length - truncationLimit} more characters)` : ''}
\`\`\`

## Decision Required

The proposed edit comes from code that existed BEFORE the current page content was written. Analyze both pieces of content and decide:

1. **SKIP** - The current content already supersedes this information (the historical info adds nothing)
2. **HISTORY** - The historical context is valuable and should be added to a "Historical Context" section
3. **MERGE** - Some specific information from the historical edit should be incorporated into the main content
4. **CONFLICT** - The information contradicts current content in a way that needs human review

Remember: When in doubt between SKIP and MERGE, prefer MERGE. High-priority information (security, API contracts, error handling, configuration) should be preserved unless explicitly contradicted.

## Response Format

Respond with EXACTLY this format:

DECISION: [SKIP|HISTORY|MERGE|CONFLICT]
REASONING: [Your reasoning in 1-2 sentences]
CONTENT: [If HISTORY or MERGE, provide the actual wiki markdown text to use - NOT a description of it. Write the content directly as it should appear on the page. Do not include meta-text like "The merged content could be:" - just write the wiki content itself.]
`;
  }

  /**
   * Get a hint about decision bias based on the source agent type.
   */
  private getAgentBiasHint(agentType: AgentType): string {
    switch (agentType) {
      case 'security':
        return '(bias toward MERGE - security details are critical)';
      case 'technical-debt':
        return '(bias toward MERGE - debt context helps prioritization)';
      case 'pattern':
        return '(bias toward HISTORY - pattern evolution aids understanding)';
      default:
        return '';
    }
  }

  /**
   * Parse the LLM's decision response.
   */
  private parseDecision(
    response: string,
    editRequest: EditRequest,
    currentPage: WikiPage
  ): EditDecision {
    const ctx = createParseContext('wiki-editor', response);
    const DECISION_VALUES = ['skip', 'history', 'merge', 'conflict'] as const;

    const llmDecision = parseChoice(
      ctx,
      'DECISION',
      /DECISION:\s*(SKIP|HISTORY|MERGE|CONFLICT)/i,
      DECISION_VALUES,
      { defaultValue: 'skip' }
    ) ?? 'skip';

    const reasoning =
      parseSection(ctx, 'REASONING', /REASONING:\s*([^\n]+)/i) ||
      'Unable to parse reasoning from response';

    const contentMatch = response.match(/CONTENT:\s*([\s\S]*?)(?=$)/i);

    // Handle HISTORY decision
    if (llmDecision === 'history') {
      // Build content with history section
      const historyEntry = contentMatch?.[1]?.trim() || editRequest.proposedContent.slice(0, 500);
      const formattedEntry = this.formatHistoryEntry(
        isCommitEditSource(editRequest.source) ? editRequest.source.commitSha : 'unknown',
        isCommitEditSource(editRequest.source) ? editRequest.source.commitTimestamp : new Date(),
        historyEntry
      );

      let content: string;
      if (currentPage.content.includes(this.HISTORY_SECTION_HEADER)) {
        // Append to existing history section
        content = currentPage.content.replace(
          this.HISTORY_SECTION_HEADER,
          `${this.HISTORY_SECTION_HEADER}\n\n${formattedEntry}`
        );
      } else {
        // Create new history section at the end
        content = `${currentPage.content}\n\n${this.HISTORY_SECTION_HEADER}\n\n${formattedEntry}`;
      }

      return {
        action: 'merge-to-history',
        reasoning,
        content,
      };
    }

    // Handle MERGE decision
    if (llmDecision === 'merge') {
      const content = contentMatch?.[1]?.trim() || editRequest.proposedContent;
      return {
        action: 'apply',
        reasoning: `Merged historical content: ${reasoning}`,
        content,
      };
    }

    // Handle CONFLICT decision
    if (llmDecision === 'conflict') {
      return {
        action: 'conflict',
        reasoning,
      };
    }

    // Default to skip
    return {
      action: 'skip',
      reasoning,
    };
  }

  /**
   * Format a history entry for the Historical Context section.
   */
  private formatHistoryEntry(
    commitSha: string,
    commitDate: Date,
    content: string
  ): string {
    return `### ${this.formatDate(commitDate)} (${commitSha.slice(0, 7)})

${content}`;
  }

  /**
   * Get the latest commit timestamp from a list of commit SHAs.
   */
  private async getLatestCommitTimestamp(
    commitShas: string[],
    repoId: string,
    context: AgentContext
  ): Promise<Date | null> {
    if (commitShas.length === 0) {
      return null;
    }

    let latestTimestamp: Date | null = null;

    for (const sha of commitShas) {
      const commit = await context.repos.commits.findBySha(repoId, sha);
      if (commit && (!latestTimestamp || commit.committedAt > latestTimestamp)) {
        latestTimestamp = commit.committedAt;
      }
    }

    return latestTimestamp;
  }

  /**
   * Create a WikiPageUpdate from an edit decision.
   */
  private createUpdateFromDecision(
    editRequest: EditRequest,
    currentPage: WikiPage | null,
    decision: EditDecision
  ): WikiPageUpdate | null {
    if (decision.action === 'skip') {
      return null;
    }

    if (decision.action === 'conflict') {
      // Could create a conflict record here in the future
      return null;
    }

    // For 'apply' and 'merge-to-history'
    const content = decision.content || editRequest.proposedContent;

    // Always extract title - use explicit title if provided, otherwise extract from content
    // This ensures we don't end up with 'Untitled' pages when content has an H1 header
    const title = editRequest.targetPageTitle ||
      extractTitleWithFallback(content, editRequest.targetPagePath);

    const update: WikiPageUpdate = {
      type: currentPage ? 'update' : 'create',
      path: editRequest.targetPagePath,
      content,
      title,
      agentRunId: '', // Will be set by executor
      confidenceDelta: editRequest.confidenceDelta,
    };

    // Only add optional properties if they have values
    const sourceCommitId = isCommitEditSource(editRequest.source) ? editRequest.source.commitSha : null;
    if (sourceCommitId) {
      update.sourceCommitId = sourceCommitId;
    }
    if (editRequest.redirectTo) {
      update.redirectTo = editRequest.redirectTo;
    }
    // Propagate file tracking data for coverage calculation
    if (editRequest.filesAccessed && editRequest.filesAccessed.length > 0) {
      update.filesAccessed = editRequest.filesAccessed;
    }
    if (editRequest.targetPaths && editRequest.targetPaths.length > 0) {
      update.targetPaths = editRequest.targetPaths;
    }

    return update;
  }

  /**
   * Convert decision action to edit request status.
   */
  private decisionToStatus(
    action: 'apply' | 'merge-to-history' | 'skip' | 'conflict'
  ): 'applied' | 'merged-to-history' | 'skipped' | 'conflict' {
    switch (action) {
      case 'apply':
        return 'applied';
      case 'merge-to-history':
        return 'merged-to-history';
      case 'skip':
        return 'skipped';
      case 'conflict':
        return 'conflict';
    }
  }

  /**
   * Format a date for display.
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0]!;
  }
}

const SYSTEM_PROMPT = `You are a Wiki Editor Agent for CodeWiki. Process edit requests that may arrive out of chronological order.

## Decisions

Choose one action for each historical edit:

**SKIP**: Information is obsolete or already covered in current content.
**MERGE**: Details are still relevant and add value. Bias toward MERGE for security, API, and error details.
**HISTORY**: Context about code evolution aids understanding. Summarize key points.
**CONFLICT**: Direct contradiction with current content. Use sparingly.

## Priority

Always merge these unless explicitly contradicted: security notes, API contracts, error handling, configuration options.

## Examples

SKIP: Edit describes "Redis cache" but current page says "Redis was replaced in v2.0".
MERGE: Edit documents error codes not in current page.
HISTORY: Edit explains original callback API, current page documents Promise API.
CONFLICT: Edit says "24-hour tokens", current page says "1-hour tokens".`;
