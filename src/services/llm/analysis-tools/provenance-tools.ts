/**
 * Provenance and traceability tools for the Self-Improvement Agent.
 *
 * These tools allow tracing wiki content back to its sources: edit requests,
 * agent runs, work items, and orchestrator decisions.
 */

import type { AnalysisToolDefinition } from './types.js';
import type { EditRequest } from '../../../domain/edit-request.js';
import {
  createListOrchestratorRunsQuery,
  handleListOrchestratorRuns,
} from '../../../queries/orchestrator-run.js';

/**
 * Tool to get the edit history and agent provenance for a wiki page.
 */
export const getPageProvenanceTool: AnalysisToolDefinition = {
  name: 'get_page_provenance',
  description:
    'Get the edit history for a wiki page, showing which agents created or modified it and what they contributed. ' +
    'Use this to trace which agents are responsible for content gaps or issues on a specific page.',
  inputSchema: {
    type: 'object',
    properties: {
      page_path: {
        type: 'string',
        description: 'The path of the wiki page to get provenance for',
      },
    },
    required: ['page_path'],
  },
  execute: async (input, context) => {
    const pagePath = (input['page_path'] as string).toLowerCase();
    const { repos, wikiId, wikiPages } = context;

    // Find the page
    const page = wikiPages.find(p => p.path.toLowerCase() === pagePath);
    if (!page) {
      return `Page "${pagePath}" not found in wiki.`;
    }

    // Get all edit requests for this page
    const editRequests = await repos.editRequests.findByPagePath(wikiId, pagePath);

    if (editRequests.length === 0) {
      return `## Page Provenance: ${pagePath}\n\nNo edit history found. This page may have been created through bootstrap or direct update.`;
    }

    // Sort by creation time
    editRequests.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Group by agent type
    const byAgent: Record<string, EditRequest[]> = {};
    for (const req of editRequests) {
      const agent = req.sourceAgentType;
      if (!byAgent[agent]) byAgent[agent] = [];
      byAgent[agent]!.push(req);
    }

    // Build report
    const sections: string[] = [];
    sections.push(`## Page Provenance: ${page.title}`);
    sections.push(`Path: ${page.path}`);
    sections.push(`Current confidence: ${(page.confidence * 100).toFixed(0)}%`);
    sections.push(`Total edits: ${editRequests.length}`);
    sections.push('');

    // Summary by agent
    sections.push('### Contributions by Agent');
    sections.push('| Agent | Edits | Applied | Merged | Skipped |');
    sections.push('|-------|-------|---------|--------|---------|');

    for (const [agent, edits] of Object.entries(byAgent).sort((a, b) => b[1].length - a[1].length)) {
      const applied = edits.filter(e => e.status === 'applied').length;
      const merged = edits.filter(e => e.status === 'merged-to-history').length;
      const skipped = edits.filter(e => e.status === 'skipped').length;
      sections.push(`| ${agent} | ${edits.length} | ${applied} | ${merged} | ${skipped} |`);
    }
    sections.push('');

    // Recent edit details
    sections.push('### Recent Edits (last 10)');
    const recentEdits = editRequests.slice(-10);

    for (const edit of recentEdits) {
      const date = edit.createdAt.toISOString().split('T')[0];
      sections.push(`#### ${edit.sourceAgentType} - ${date}`);
      sections.push(`- **Status**: ${edit.status}`);
      sections.push(`- **Type**: ${edit.proposedUpdateType}`);
      sections.push(`- **Confidence delta**: ${edit.confidenceDelta > 0 ? '+' : ''}${edit.confidenceDelta}`);
      if (edit.processingNotes) {
        sections.push(`- **Notes**: ${edit.processingNotes}`);
      }

      // Show a snippet of what was proposed
      const contentPreview = edit.proposedContent.slice(0, 200);
      if (contentPreview.length < edit.proposedContent.length) {
        sections.push(`- **Preview**: ${contentPreview}...`);
      }
      sections.push('');
    }

    return sections.join('\n');
  },
};

/**
 * Tool to get a summary of what pages an agent type has created/modified.
 */
export const getAgentContributionsTool: AnalysisToolDefinition = {
  name: 'get_agent_contributions',
  description:
    'Get a summary of all wiki pages that a specific agent type has created or modified. ' +
    'Use this to understand the scope of an agent\'s impact on the wiki.',
  inputSchema: {
    type: 'object',
    properties: {
      agent_type: {
        type: 'string',
        description: 'The agent type (e.g., "code-change", "security", "pattern")',
      },
    },
    required: ['agent_type'],
  },
  execute: async (input, context) => {
    const agentType = input['agent_type'] as string;
    const { repos, wikiId } = context;

    // Get all applied edit requests (we need to query by status)
    const appliedEdits = await repos.editRequests.findByStatus(wikiId, 'applied');
    const mergedEdits = await repos.editRequests.findByStatus(wikiId, 'merged-to-history');

    const allEdits = [...appliedEdits, ...mergedEdits];
    const agentEdits = allEdits.filter(e => e.sourceAgentType === agentType);

    if (agentEdits.length === 0) {
      return `No contributions found for agent type "${agentType}". This agent may not have run yet, or all its edits were skipped.`;
    }

    // Group by page path
    const byPage: Record<string, { edits: EditRequest[]; created: boolean }> = {};
    for (const edit of agentEdits) {
      const path = edit.targetPagePath;
      if (!byPage[path]) {
        byPage[path] = { edits: [], created: false };
      }
      byPage[path]!.edits.push(edit);
      if (edit.proposedUpdateType === 'create') {
        byPage[path]!.created = true;
      }
    }

    const sections: string[] = [];
    sections.push(`## Agent Contributions: ${agentType}`);
    sections.push(`Total successful edits: ${agentEdits.length}`);
    sections.push(`Pages affected: ${Object.keys(byPage).length}`);
    sections.push('');

    // Sort by edit count
    const sortedPages = Object.entries(byPage).sort((a, b) => b[1].edits.length - a[1].edits.length);

    sections.push('### Pages Modified');
    sections.push('| Page | Edits | Created By This Agent |');
    sections.push('|------|-------|----------------------|');

    for (const [path, data] of sortedPages.slice(0, 30)) {
      sections.push(`| ${path} | ${data.edits.length} | ${data.created ? '✓' : ''} |`);
    }

    if (sortedPages.length > 30) {
      sections.push(`\n... and ${sortedPages.length - 30} more pages`);
    }

    return sections.join('\n');
  },
};

/**
 * Tool to get orchestrator decision history.
 */
export const getOrchestratorDecisionsTool: AnalysisToolDefinition = {
  name: 'get_orchestrator_decisions',
  description:
    'Get orchestrator decision history showing the LLM reasoning used to prioritize work and the work items created. ' +
    'Use this to understand how the orchestrator decided what agents to run and in what order. ' +
    'Helps identify if orchestration strategy is effective or needs adjustment.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of decisions to return (default: 20)',
      },
    },
    required: [],
  },
  execute: async (input, context) => {
    const limit = (input.limit as number) || 20;

    const query = createListOrchestratorRunsQuery(context.repoId, {
      limit,
      usedLLM: true,
    });
    const result = await handleListOrchestratorRuns(query, context.repos);

    if (!result.success || !result.data) {
      return result.error || 'Failed to get orchestrator decisions';
    }

    if (result.data.length === 0) {
      return 'No orchestrator decisions found. The orchestrator may not have run yet, or all runs used deterministic fallback.';
    }

    const sections: string[] = [];
    sections.push(`## Orchestrator Decisions (${result.data.length} LLM-powered runs)`);
    sections.push('');

    // Summary stats
    const totalCost = result.data.reduce((sum, r) => sum + r.costUsd, 0);
    const totalWorkItems = result.data.reduce((sum, r) => sum + r.workItemsCreated, 0);
    const avgDuration = result.data.reduce((sum, r) => sum + r.durationMs, 0) / result.data.length;

    sections.push('### Summary');
    sections.push(`- Total cost: $${totalCost.toFixed(4)}`);
    sections.push(`- Total work items created: ${totalWorkItems}`);
    sections.push(`- Average decision time: ${avgDuration.toFixed(0)}ms`);
    sections.push('');

    // Aggregate work item types across all decisions
    const workItemCounts: Record<string, number> = {};
    for (const run of result.data) {
      for (const item of run.workItems) {
        workItemCounts[item.agentType] = (workItemCounts[item.agentType] || 0) + 1;
      }
    }

    if (Object.keys(workItemCounts).length > 0) {
      sections.push('### Work Items by Agent Type (across all decisions)');
      const sortedAgents = Object.entries(workItemCounts).sort((a, b) => b[1] - a[1]);
      for (const [agent, count] of sortedAgents) {
        sections.push(`- ${agent}: ${count}`);
      }
      sections.push('');
    }

    // Show individual decisions (most recent first)
    sections.push('### Decision History');
    sections.push('');

    for (const run of result.data) {
      const date = run.timestamp.toISOString().replace('T', ' ').split('.')[0];
      sections.push(`#### ${date}`);
      sections.push(`**Reasoning:** ${run.reasoning}`);
      sections.push('');
      sections.push(`**Context:** ${run.contextSnapshot.wikiPages} pages, ${run.contextSnapshot.pendingEditRequests} pending edits, ${run.contextSnapshot.pagesNeedingRewrite} pages need rewrite`);
      sections.push(`**Result:** ${run.workItemsCreated} of ${run.workItemsRequested} items created (after dedup)`);
      sections.push(`**Cost:** $${run.costUsd.toFixed(4)} | **Duration:** ${run.durationMs}ms`);
      sections.push('');

      if (run.workItems.length > 0) {
        sections.push('**Work items requested:**');
        for (const item of run.workItems.slice(0, 10)) {
          const target = item.targetCommitId
            ? `commit:${item.targetCommitId.slice(0, 8)}`
            : item.targetPath
            ? `path:${item.targetPath}`
            : 'wiki-wide';
          sections.push(`- ${item.agentType} (${target}): ${item.reason.slice(0, 80)}${item.reason.length > 80 ? '...' : ''}`);
        }
        if (run.workItems.length > 10) {
          sections.push(`  ... and ${run.workItems.length - 10} more items`);
        }
        sections.push('');
      }

      sections.push('---');
      sections.push('');
    }

    return sections.join('\n');
  },
};

/**
 * Tool to trace full provenance from wiki page back to orchestrator decisions.
 */
export const getProvenanceTraceTool: AnalysisToolDefinition = {
  name: 'get_provenance_trace',
  description:
    'Trace the complete provenance chain from a wiki page back through edit requests, agent runs, work items, ' +
    'and orchestrator decisions. Use this to understand exactly how and why specific wiki content was created. ' +
    'This enables answering questions like "which orchestrator decisions led to this page existing?"',
  inputSchema: {
    type: 'object',
    properties: {
      page_path: {
        type: 'string',
        description: 'The path of the wiki page to trace provenance for',
      },
    },
    required: ['page_path'],
  },
  execute: async (input, context) => {
    const pagePath = (input['page_path'] as string).toLowerCase();
    const { repos, wikiId, wikiPages, repoId } = context;

    // Find the page
    const page = wikiPages.find(p => p.path.toLowerCase() === pagePath);
    if (!page) {
      return `Page "${pagePath}" not found in wiki.`;
    }

    const sections: string[] = [];
    sections.push(`## Full Provenance Trace: ${page.title}`);
    sections.push(`Path: ${page.path}`);
    sections.push('');

    // Get edit requests for this page
    const editRequests = await repos.editRequests.findByPagePath(wikiId, pagePath);
    const appliedEdits = editRequests.filter(e => e.status === 'applied' || e.status === 'merged-to-history');

    if (appliedEdits.length === 0 && (!page.sourceAgentRunIds || page.sourceAgentRunIds.length === 0)) {
      sections.push('No provenance data available. This page may have been created through bootstrap or direct update.');
      return sections.join('\n');
    }

    // Build trace chains
    sections.push('### Provenance Chains');
    sections.push('');

    // Track unique orchestrator runs we find
    const orchestratorRunIds = new Set<string>();
    const workItemIds = new Set<string>();

    // Method 1: Trace from edit requests (includes workItemId)
    if (appliedEdits.length > 0) {
      sections.push('#### From Edit Requests');
      sections.push('');

      for (const edit of appliedEdits.slice(-10)) {
        const date = edit.createdAt.toISOString().split('T')[0];
        sections.push(`**${edit.sourceAgentType}** (${date}) - ${edit.status}`);
        sections.push(`- Edit Request ID: \`${edit.id.slice(0, 8)}...\``);
        sections.push(`- Agent Run ID: \`${edit.sourceAgentRunId.slice(0, 8)}...\``);

        if (edit.workItemId) {
          workItemIds.add(edit.workItemId);
          sections.push(`- Work Item ID: \`${edit.workItemId.slice(0, 8)}...\``);

          // Look up work item to get orchestrator run
          const workItem = await repos.workQueue.findById(edit.workItemId);
          if (workItem && workItem.orchestratorRunId) {
            orchestratorRunIds.add(workItem.orchestratorRunId);
            sections.push(`- Orchestrator Run ID: \`${workItem.orchestratorRunId.slice(0, 8)}...\``);
          }
        } else {
          sections.push(`- Work Item ID: (not tracked - pre-provenance data)`);
        }
        sections.push('');
      }
    }

    // Method 2: Trace from page's sourceAgentRunIds
    if (page.sourceAgentRunIds && page.sourceAgentRunIds.length > 0) {
      sections.push('#### From Page Agent Run History');
      sections.push(`Source agent runs: ${page.sourceAgentRunIds.length}`);
      sections.push('');

      for (const agentRunId of page.sourceAgentRunIds.slice(-5)) {
        sections.push(`- Agent Run: \`${agentRunId.slice(0, 8)}...\``);
      }
      sections.push('');
    }

    // Show orchestrator decisions that contributed
    if (orchestratorRunIds.size > 0) {
      sections.push('### Related Orchestrator Decisions');
      sections.push('');

      const query = createListOrchestratorRunsQuery(repoId, { limit: 50, usedLLM: true });
      const result = await handleListOrchestratorRuns(query, repos);

      if (result.success && result.data) {
        const relevantRuns = result.data.filter(r => orchestratorRunIds.has(r.id));

        for (const run of relevantRuns) {
          const date = run.timestamp.toISOString().replace('T', ' ').split('.')[0];
          sections.push(`#### Decision: ${date}`);
          sections.push(`**Reasoning:** ${run.reasoning}`);
          sections.push('');

          // Find work items for this page
          const relevantWorkItems = run.workItems.filter(w => workItemIds.has(w.agentType));
          if (relevantWorkItems.length > 0) {
            sections.push('**Work items that affected this page:**');
            for (const item of relevantWorkItems) {
              const target = item.targetCommitId
                ? `commit:${item.targetCommitId.slice(0, 8)}`
                : item.targetPath
                ? `path:${item.targetPath}`
                : 'wiki-wide';
              sections.push(`- ${item.agentType} (${target}): ${item.reason}`);
            }
          }
          sections.push('');
        }
      }
    }

    // Summary
    sections.push('### Summary');
    sections.push(`- Edit requests affecting this page: ${editRequests.length}`);
    sections.push(`- Applied/merged edits: ${appliedEdits.length}`);
    sections.push(`- Unique work items: ${workItemIds.size}`);
    sections.push(`- Related orchestrator decisions: ${orchestratorRunIds.size}`);

    return sections.join('\n');
  },
};

/**
 * Tool to trace what happened after a work item was created.
 */
export const getWorkItemOutcomesTool: AnalysisToolDefinition = {
  name: 'get_work_item_outcomes',
  description:
    'Trace what happened after work items were created - which agent runs resulted, which edit requests were produced, ' +
    'and which wiki pages were affected. Use this to understand if orchestrator decisions produced useful outcomes.',
  inputSchema: {
    type: 'object',
    properties: {
      agent_type: {
        type: 'string',
        description: 'Filter to work items for a specific agent type (optional)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of work items to analyze (default: 20)',
      },
    },
    required: [],
  },
  execute: async (input, context) => {
    const agentType = input['agent_type'] as string | undefined;
    const limit = (input.limit as number) || 20;
    const { repos, wikiId, repoId } = context;

    // Get completed work items
    const options = agentType
      ? { status: 'completed' as const, agentType: agentType as Parameters<typeof repos.workQueue.findByRepo>[1]['agentType'] }
      : { status: 'completed' as const };
    const workItems = await repos.workQueue.findByRepo(repoId, options);

    if (workItems.length === 0) {
      return 'No completed work items found.';
    }

    // Sort by completion time (most recent first)
    workItems.sort((a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0));

    const sections: string[] = [];
    sections.push(`## Work Item Outcomes`);
    sections.push(`Analyzing ${Math.min(limit, workItems.length)} of ${workItems.length} completed work items`);
    sections.push('');

    // Analyze each work item
    let pagesCreated = 0;
    let pagesUpdated = 0;
    let editsSkipped = 0;

    for (const workItem of workItems.slice(0, limit)) {
      if (!workItem.agentRunId) continue;

      // Find edit requests from this work item
      const editRequests = workItem.id
        ? (await repos.editRequests.findByAgentRun(workItem.agentRunId)).filter(e => e.workItemId === workItem.id)
        : await repos.editRequests.findByAgentRun(workItem.agentRunId);

      const applied = editRequests.filter(e => e.status === 'applied');
      const merged = editRequests.filter(e => e.status === 'merged-to-history');
      const skipped = editRequests.filter(e => e.status === 'skipped');

      pagesCreated += applied.filter(e => e.proposedUpdateType === 'create').length;
      pagesUpdated += applied.filter(e => e.proposedUpdateType === 'update').length + merged.length;
      editsSkipped += skipped.length;

      // Only show details for first few
      if (workItems.indexOf(workItem) < 5) {
        const date = workItem.completedAt?.toISOString().split('T')[0] || 'unknown';
        sections.push(`### ${workItem.agentType} (${date})`);

        if (workItem.orchestratorRunId) {
          sections.push(`- Orchestrator Run: \`${workItem.orchestratorRunId.slice(0, 8)}...\``);
        }
        sections.push(`- Edit requests: ${editRequests.length} (${applied.length} applied, ${merged.length} merged, ${skipped.length} skipped)`);

        if (applied.length > 0) {
          sections.push(`- Pages affected: ${[...new Set(applied.map(e => e.targetPagePath))].join(', ')}`);
        }
        sections.push('');
      }
    }

    // Summary
    sections.push('### Aggregate Outcomes');
    sections.push(`- Total pages created: ${pagesCreated}`);
    sections.push(`- Total pages updated: ${pagesUpdated}`);
    sections.push(`- Total edits skipped: ${editsSkipped}`);

    return sections.join('\n');
  },
};

/**
 * All provenance and traceability tools.
 */
export const provenanceTools: AnalysisToolDefinition[] = [
  getPageProvenanceTool,
  getAgentContributionsTool,
  getOrchestratorDecisionsTool,
  getProvenanceTraceTool,
  getWorkItemOutcomesTool,
];
