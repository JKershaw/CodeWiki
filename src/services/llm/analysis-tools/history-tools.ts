/**
 * Wiki page history tools for the Self-Improvement Agent.
 *
 * These tools allow exploring the complete edit history of wiki pages,
 * including full before/after content for each change.
 */

import type { AnalysisToolDefinition } from './types.js';
import { findPageByPath } from '../wiki-page-helpers.js';

/**
 * Tool to get the edit history for a wiki page with full content.
 */
export const getPageEditHistoryTool: AnalysisToolDefinition = {
  name: 'get_page_edit_history',
  description:
    'Get the complete edit history for a wiki page, including before/after content for each change. ' +
    'Use this to understand how a page evolved and what content changed between iterations.',
  inputSchema: {
    type: 'object',
    properties: {
      page_path: {
        type: 'string',
        description: 'The path of the wiki page to get history for',
      },
    },
    required: ['page_path'],
  },
  execute: async (input, context) => {
    const pagePath = input['page_path'] as string;
    const { repos, wikiPages } = context;

    // Find the page
    const { page } = findPageByPath(wikiPages, pagePath);
    if (!page) {
      return `Page "${pagePath}" not found in wiki.`;
    }

    // Get history for this page
    const history = await repos.wikiPageHistory.findByPage(page.id);

    if (history.length === 0) {
      return `## Edit History: ${pagePath}\n\nNo edit history found. This page may have been created before history tracking was enabled.`;
    }

    // Build report
    const sections: string[] = [];
    sections.push(`## Edit History: ${page.title}`);
    sections.push(`Path: ${page.path}`);
    sections.push(`Total changes: ${history.length}`);
    sections.push('');

    // Summary
    const creates = history.filter(h => h.operation === 'create').length;
    const updates = history.filter(h => h.operation === 'update').length;
    const deletes = history.filter(h => h.operation === 'delete').length;
    sections.push(`- Creates: ${creates}`);
    sections.push(`- Updates: ${updates}`);
    sections.push(`- Deletes: ${deletes}`);
    sections.push('');

    // Show each change (newest first)
    sections.push('### Changes (newest first)');

    for (const record of history.slice(0, 10)) {
      const date = record.timestamp.toISOString().split('T')[0];
      sections.push(`#### ${record.operation.toUpperCase()} - ${date}`);
      sections.push(`- **Agent type**: ${record.agentType}`);
      if (record.agentRunId) {
        sections.push(`- **Agent run**: ${record.agentRunId}`);
      }

      // Show content changes
      if (record.contentBefore) {
        const beforePreview = record.contentBefore.slice(0, 300);
        sections.push(`- **Before** (${record.contentBefore.length} chars): ${beforePreview}${record.contentBefore.length > 300 ? '...' : ''}`);
      }
      if (record.contentAfter) {
        const afterPreview = record.contentAfter.slice(0, 300);
        sections.push(`- **After** (${record.contentAfter.length} chars): ${afterPreview}${record.contentAfter.length > 300 ? '...' : ''}`);
      }
      sections.push('');
    }

    if (history.length > 10) {
      sections.push(`... and ${history.length - 10} more changes`);
    }

    return sections.join('\n');
  },
};

/**
 * Tool to get all wiki changes made by a specific agent run.
 */
export const getAgentRunChangesTool: AnalysisToolDefinition = {
  name: 'get_agent_run_changes',
  description:
    'Get all wiki page changes made by a specific agent run. ' +
    'Use this to understand what a particular agent run accomplished and correlate with benchmark changes.',
  inputSchema: {
    type: 'object',
    properties: {
      agent_run_id: {
        type: 'string',
        description: 'The ID of the agent run to get changes for',
      },
    },
    required: ['agent_run_id'],
  },
  execute: async (input, context) => {
    const agentRunId = input['agent_run_id'] as string;
    const { repos } = context;

    const history = await repos.wikiPageHistory.findByAgentRun(agentRunId);

    if (history.length === 0) {
      return `No wiki changes found for agent run: ${agentRunId}`;
    }

    // Build report
    const sections: string[] = [];
    sections.push(`## Changes by Agent Run: ${agentRunId}`);
    sections.push(`Total changes: ${history.length}`);
    sections.push('');

    // Group by operation
    const byOperation: Record<string, number> = {};
    for (const record of history) {
      byOperation[record.operation] = (byOperation[record.operation] || 0) + 1;
    }
    sections.push('### Summary by Operation');
    for (const [op, count] of Object.entries(byOperation)) {
      sections.push(`- ${op}: ${count}`);
    }
    sections.push('');

    // List pages changed
    sections.push('### Pages Changed');
    for (const record of history) {
      const date = record.timestamp.toISOString().split('T')[0];
      sections.push(`- **${record.pagePath}**: ${record.operation} (${date})`);

      // Show content size change
      const beforeSize = record.contentBefore?.length || 0;
      const afterSize = record.contentAfter?.length || 0;
      const delta = afterSize - beforeSize;
      sections.push(`  - Content: ${beforeSize} → ${afterSize} chars (${delta >= 0 ? '+' : ''}${delta})`);
    }

    return sections.join('\n');
  },
};

/**
 * Tool to compare wiki content between two points in time.
 */
export const compareWikiVersionsTool: AnalysisToolDefinition = {
  name: 'compare_wiki_versions',
  description:
    'Get a summary of all wiki changes between two iterations or within a time range. ' +
    'Use this to understand what changed in the wiki between benchmark runs.',
  inputSchema: {
    type: 'object',
    properties: {
      iteration_start: {
        type: 'string',
        description: 'Start iteration number',
      },
      iteration_end: {
        type: 'string',
        description: 'End iteration number',
      },
    },
    required: ['iteration_start', 'iteration_end'],
  },
  execute: async (input, context) => {
    const startIteration = parseInt(input['iteration_start'] as string, 10);
    const endIteration = parseInt(input['iteration_end'] as string, 10);
    const { repos, wikiId, benchmarkRuns } = context;

    // Find benchmark runs for these iterations to get timestamps
    const startRun = benchmarkRuns.find(r => r.iterationCount === startIteration);
    const endRun = benchmarkRuns.find(r => r.iterationCount === endIteration);

    if (!startRun || !endRun) {
      return `Could not find benchmark runs for iterations ${startIteration} and ${endIteration}.`;
    }

    // Get history in the time range
    const history = await repos.wikiPageHistory.findByTimeRange(
      wikiId,
      startRun.startedAt,
      endRun.completedAt || new Date()
    );

    if (history.length === 0) {
      return `No wiki changes found between iterations ${startIteration} and ${endIteration}.`;
    }

    // Build report
    const sections: string[] = [];
    sections.push(`## Wiki Changes: Iteration ${startIteration} → ${endIteration}`);
    sections.push(`Period: ${startRun.startedAt.toISOString().split('T')[0]} to ${(endRun.completedAt || new Date()).toISOString().split('T')[0]}`);
    sections.push(`Total changes: ${history.length}`);
    sections.push('');

    // Unique pages affected
    const pagesAffected = new Set(history.map(h => h.pagePath));
    sections.push(`Pages affected: ${pagesAffected.size}`);
    sections.push('');

    // Group by page
    const byPage: Record<string, typeof history> = {};
    for (const record of history) {
      if (!byPage[record.pagePath]) byPage[record.pagePath] = [];
      byPage[record.pagePath]!.push(record);
    }

    sections.push('### Changes by Page');
    for (const [pagePath, records] of Object.entries(byPage)) {
      const operations = records.map(r => r.operation).join(', ');
      sections.push(`- **${pagePath}**: ${records.length} changes (${operations})`);
    }
    sections.push('');

    // Content size delta
    let totalBefore = 0;
    let totalAfter = 0;
    for (const record of history) {
      if (record.operation === 'create') {
        totalAfter += record.contentAfter?.length || 0;
      } else if (record.operation === 'delete') {
        totalBefore += record.contentBefore?.length || 0;
      } else if (record.operation === 'update') {
        // For updates, we need to be careful not to double-count
        // Just track the most recent state
        totalAfter += record.contentAfter?.length || 0;
      }
    }

    sections.push(`### Net Content Change`);
    sections.push(`Approximate content delta: ${totalAfter - totalBefore >= 0 ? '+' : ''}${totalAfter - totalBefore} chars`);

    return sections.join('\n');
  },
};

/**
 * Tool to get full content comparison for a specific page edit.
 */
export const getEditDetailsTool: AnalysisToolDefinition = {
  name: 'get_edit_details',
  description:
    'Get the full before and after content for a specific edit. ' +
    'Use this when you need to see exactly what changed in a particular edit.',
  inputSchema: {
    type: 'object',
    properties: {
      page_path: {
        type: 'string',
        description: 'The path of the wiki page',
      },
      edit_index: {
        type: 'string',
        description: 'The index of the edit (0 = most recent, 1 = second most recent, etc.)',
      },
    },
    required: ['page_path', 'edit_index'],
  },
  execute: async (input, context) => {
    const pagePath = input['page_path'] as string;
    const editIndex = parseInt(input['edit_index'] as string, 10);
    const { repos, wikiPages } = context;

    // Find the page
    const { page } = findPageByPath(wikiPages, pagePath);
    if (!page) {
      return `Page "${pagePath}" not found in wiki.`;
    }

    // Get history for this page
    const history = await repos.wikiPageHistory.findByPage(page.id);

    if (editIndex < 0 || editIndex >= history.length) {
      return `Edit index ${editIndex} out of range. Page has ${history.length} edits (0 to ${history.length - 1}).`;
    }

    const record = history[editIndex]!;

    // Build report
    const sections: string[] = [];
    sections.push(`## Edit Details: ${page.title}`);
    sections.push(`Edit ${editIndex} of ${history.length - 1} (0 = most recent)`);
    sections.push('');
    sections.push(`- **Operation**: ${record.operation}`);
    sections.push(`- **Date**: ${record.timestamp.toISOString()}`);
    sections.push(`- **Agent type**: ${record.agentType}`);
    if (record.agentRunId) {
      sections.push(`- **Agent run**: ${record.agentRunId}`);
    }
    if (record.workItemId) {
      sections.push(`- **Work item**: ${record.workItemId}`);
    }
    if (record.editRequestId) {
      sections.push(`- **Edit request**: ${record.editRequestId}`);
    }
    sections.push('');

    // Full content
    if (record.contentBefore !== null) {
      sections.push('### Content Before');
      sections.push('```');
      sections.push(record.contentBefore);
      sections.push('```');
      sections.push('');
    }

    if (record.contentAfter !== null) {
      sections.push('### Content After');
      sections.push('```');
      sections.push(record.contentAfter);
      sections.push('```');
    }

    return sections.join('\n');
  },
};

/**
 * All wiki page history tools.
 */
export const historyTools: AnalysisToolDefinition[] = [
  getPageEditHistoryTool,
  getAgentRunChangesTool,
  compareWikiVersionsTool,
  getEditDetailsTool,
];
