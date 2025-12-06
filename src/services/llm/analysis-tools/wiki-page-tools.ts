/**
 * Wiki page analysis tools for the Self-Improvement Agent.
 *
 * These tools allow reading wiki pages and exploring wiki structure
 * to understand what content exists and how it's organized.
 */

import type { AnalysisToolDefinition } from './types.js';
import { getAgentPrompt, getAvailableAgentTypes } from '../../../agents/registry.js';
import {
  findPageByPath,
  formatPageNotFoundError,
  filterPagesByCategory,
  groupPagesByCategory,
  truncateContent,
  DEFAULT_MAX_CONTENT_LENGTH,
} from '../wiki-page-helpers.js';

/**
 * Tool to read a wiki page.
 */
export const getPageContentTool: AnalysisToolDefinition = {
  name: 'get_page_content',
  description:
    'Read the content of a wiki page. Use this to understand what the wiki actually says about a topic.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path of the wiki page to read',
      },
    },
    required: ['path'],
  },
  execute: async (input, context) => {
    const path = input['path'] as string;
    const { wikiPages } = context;
    const { page } = findPageByPath(wikiPages, path);

    if (!page) {
      return formatPageNotFoundError(path, wikiPages);
    }

    const { content } = truncateContent(page.content, DEFAULT_MAX_CONTENT_LENGTH);

    return [
      `# ${page.title}`,
      `Path: ${page.path}`,
      `Confidence: ${(page.confidence * 100).toFixed(0)}%`,
      '',
      '---',
      '',
      content,
    ].join('\n');
  },
};

/**
 * Tool to list wiki pages.
 */
export const listWikiPagesTool: AnalysisToolDefinition = {
  name: 'list_wiki_pages',
  description:
    'List all wiki pages grouped by category. Use this to understand wiki structure and find relevant pages.',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Optional category to filter by',
      },
    },
    required: [],
  },
  execute: async (input, context) => {
    const category = input['category'] as string | undefined;
    let { wikiPages } = context;

    if (category) {
      wikiPages = filterPagesByCategory(wikiPages, category);
    }

    if (wikiPages.length === 0) {
      return category
        ? `No pages found in category "${category}".`
        : 'The wiki has no pages.';
    }

    // Group by top-level category
    const grouped = groupPagesByCategory(wikiPages);

    const sections: string[] = [];
    sections.push(`## Wiki Pages (${wikiPages.length} total)`);
    sections.push('');

    for (const [cat, pages] of Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))) {
      sections.push(`### ${cat}/`);
      for (const page of pages.sort((a, b) => a.title.localeCompare(b.title))) {
        const confidenceIcon = page.confidence >= 0.7 ? '✓' : page.confidence >= 0.4 ? '○' : '?';
        sections.push(`- ${confidenceIcon} ${page.title} (${page.path})`);
      }
      sections.push('');
    }

    return sections.join('\n');
  },
};

/**
 * Tool to read an agent's system prompt.
 * Uses the agent registry to access prompts via the Agent.getSystemPrompt() interface.
 */
export const getAgentPromptTool: AnalysisToolDefinition = {
  name: 'get_agent_prompt',
  description:
    'Read the system prompt for a specific agent type. Use this to understand how an agent is instructed ' +
    'and identify potential improvements to its prompts.',
  inputSchema: {
    type: 'object',
    properties: {
      agent_type: {
        type: 'string',
        description: 'The agent type (e.g., "code-change", "pattern", "security", "project-overview")',
      },
    },
    required: ['agent_type'],
  },
  execute: async (input, _context) => {
    const agentType = input['agent_type'] as string;
    const availableTypes = getAvailableAgentTypes();

    // Check if agent type exists
    if (!availableTypes.includes(agentType)) {
      return `Unknown agent type "${agentType}". Available types: ${availableTypes.join(', ')}`;
    }

    // Get the prompt from the registry
    const prompt = getAgentPrompt(agentType);

    if (prompt === null) {
      return `The "${agentType}" agent does not use an LLM (pure computation). No system prompt available.`;
    }

    return [
      `## System Prompt for: ${agentType}`,
      '',
      '---',
      '',
      prompt.trim(),
    ].join('\n');
  },
};

/**
 * All wiki page analysis tools.
 */
export const wikiPageTools: AnalysisToolDefinition[] = [
  getPageContentTool,
  listWikiPagesTool,
  getAgentPromptTool,
];
