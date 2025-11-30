/**
 * Wiki exploration tools for agentic research.
 *
 * These tools allow the Research Agent to iteratively explore
 * the wiki, read pages, follow links, and refine searches.
 */

import type { WikiPage } from '../../domain/wiki-page.js';

/**
 * Context provided to wiki tools when they execute.
 */
export interface WikiToolContext {
  /** All wiki pages available for searching */
  pages: WikiPage[];
  /** Maximum content length to return per page */
  maxContentLength?: number;
}

/**
 * Definition of a wiki tool.
 */
export interface WikiToolDefinition {
  /** Unique name for the tool */
  name: string;
  /** Description of what the tool does (shown to LLM) */
  description: string;
  /** JSON Schema for the input parameters */
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
  /** Execute the tool with given input */
  execute: (input: Record<string, unknown>, context: WikiToolContext) => Promise<string>;
}

const DEFAULT_MAX_CONTENT_LENGTH = 4000;
const MAX_SEARCH_RESULTS = 10;
const SNIPPET_LENGTH = 200;

/**
 * Extract a snippet around a keyword match in content.
 */
function extractSnippet(content: string, keyword: string, length: number = SNIPPET_LENGTH): string {
  const lowerContent = content.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const index = lowerContent.indexOf(lowerKeyword);

  if (index === -1) {
    // No match found, return beginning of content
    return content.slice(0, length) + (content.length > length ? '...' : '');
  }

  // Center the snippet around the match
  const start = Math.max(0, index - length / 2);
  const end = Math.min(content.length, index + keyword.length + length / 2);

  let snippet = content.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';

  return snippet;
}

/**
 * Tool to search wiki pages by keywords.
 */
export const searchWikiTool: WikiToolDefinition = {
  name: 'search_wiki',
  description:
    'Search wiki pages by keywords. Returns matching pages with titles, paths, and relevant snippets. ' +
    'Use this to find pages related to your question. Try different search terms if initial results are not helpful.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query - can be keywords, concepts, or phrases to find in wiki pages',
      },
    },
    required: ['query'],
  },
  execute: async (input, context) => {
    const query = (input['query'] as string).toLowerCase();
    const keywords = query.split(/\s+/).filter(k => k.length > 2);

    if (keywords.length === 0) {
      return 'Error: Please provide a more specific search query (at least one word with 3+ characters)';
    }

    // Score each page
    const scored = context.pages.map(page => {
      const lowerTitle = page.title.toLowerCase();
      const lowerPath = page.path.toLowerCase();
      const lowerContent = page.content.toLowerCase();

      let score = 0;
      let matchedKeyword = keywords[0] || query;

      for (const keyword of keywords) {
        // Title matches (highest weight)
        if (lowerTitle.includes(keyword)) {
          score += 5;
          matchedKeyword = keyword;
        }
        // Path matches
        if (lowerPath.includes(keyword)) {
          score += 3;
          matchedKeyword = keyword;
        }
        // Content matches
        const contentMatches = (lowerContent.match(new RegExp(keyword, 'g')) || []).length;
        if (contentMatches > 0) {
          score += Math.min(contentMatches, 5);
          matchedKeyword = keyword;
        }
      }

      // Boost by confidence
      score *= 0.5 + page.confidence * 0.5;

      return { page, score, matchedKeyword };
    });

    // Filter and sort
    const results = scored
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SEARCH_RESULTS);

    if (results.length === 0) {
      return `No pages found matching "${query}". Try different keywords or more general terms.`;
    }

    // Format results
    const formatted = results.map(({ page, score, matchedKeyword }) => {
      const snippet = extractSnippet(page.content, matchedKeyword);
      return [
        `**${page.title}** (${page.path})`,
        `Confidence: ${(page.confidence * 100).toFixed(0)}%`,
        `Snippet: ${snippet}`,
      ].join('\n');
    });

    return `Found ${results.length} matching pages:\n\n${formatted.join('\n\n---\n\n')}`;
  },
};

/**
 * Tool to read the full content of a wiki page.
 */
export const readPageTool: WikiToolDefinition = {
  name: 'read_page',
  description:
    'Read the full content of a wiki page by its path. Use this after searching to get complete information from a relevant page.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path of the wiki page to read (e.g., "architecture/cqrs", "getting-started")',
      },
    },
    required: ['path'],
  },
  execute: async (input, context) => {
    const path = (input['path'] as string).toLowerCase();

    // Find the page (try exact match first, then partial)
    let page = context.pages.find(p => p.path.toLowerCase() === path);

    if (!page) {
      // Try partial match
      page = context.pages.find(p => p.path.toLowerCase().includes(path));
    }

    if (!page) {
      // List similar pages as suggestions
      const similar = context.pages
        .filter(p => {
          const pathParts = path.split('/');
          return pathParts.some(part => p.path.toLowerCase().includes(part));
        })
        .slice(0, 5);

      if (similar.length > 0) {
        return `Page "${path}" not found. Did you mean one of these?\n${similar.map(p => `- ${p.path}`).join('\n')}`;
      }
      return `Page "${path}" not found. Use search_wiki to find relevant pages.`;
    }

    const maxLength = context.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
    let content = page.content;
    if (content.length > maxLength) {
      content = content.slice(0, maxLength) + '\n\n... (content truncated, page continues)';
    }

    const metadata = [
      `# ${page.title}`,
      `Path: ${page.path}`,
      `Confidence: ${(page.confidence * 100).toFixed(0)}%`,
      page.links.length > 0 ? `Links to: ${page.links.join(', ')}` : null,
      page.backlinks.length > 0 ? `Linked from: ${page.backlinks.join(', ')}` : null,
      '',
      '---',
      '',
    ]
      .filter(Boolean)
      .join('\n');

    return metadata + content;
  },
};

/**
 * Tool to list all wiki pages, optionally filtered by category.
 */
export const listPagesTool: WikiToolDefinition = {
  name: 'list_pages',
  description:
    'List all wiki pages, optionally filtered by category/path prefix. Use this to understand wiki structure or find pages in a specific area.',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Optional category or path prefix to filter by (e.g., "architecture", "api")',
      },
    },
    required: [],
  },
  execute: async (input, context) => {
    const category = input['category'] as string | undefined;

    let pages = context.pages;

    if (category) {
      const lowerCategory = category.toLowerCase();
      pages = pages.filter(
        p =>
          p.path.toLowerCase().startsWith(lowerCategory) ||
          p.path.toLowerCase().includes('/' + lowerCategory)
      );
    }

    if (pages.length === 0) {
      if (category) {
        return `No pages found in category "${category}". Try listing all pages or a different category.`;
      }
      return 'The wiki is empty.';
    }

    // Group by top-level category
    const grouped: Record<string, WikiPage[]> = {};
    for (const page of pages) {
      const parts = page.path.split('/');
      const topLevel = parts.length > 1 ? parts[0]! : '(root)';
      if (!grouped[topLevel]) grouped[topLevel] = [];
      grouped[topLevel]!.push(page);
    }

    // Format output
    const sections = Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, catPages]) => {
        const pageList = catPages
          .sort((a, b) => a.title.localeCompare(b.title))
          .map(p => `  - ${p.title} (${p.path}) [${(p.confidence * 100).toFixed(0)}%]`)
          .join('\n');
        return `**${cat}/**\n${pageList}`;
      });

    return `Wiki contains ${pages.length} pages:\n\n${sections.join('\n\n')}`;
  },
};

/**
 * Tool to get pages related to a given page (via links).
 */
export const getRelatedPagesTool: WikiToolDefinition = {
  name: 'get_related_pages',
  description:
    'Get pages that are linked to or from a given page. Use this to explore related topics and follow connections between concepts.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path of the page to find related pages for',
      },
    },
    required: ['path'],
  },
  execute: async (input, context) => {
    const path = (input['path'] as string).toLowerCase();

    const page = context.pages.find(p => p.path.toLowerCase() === path);

    if (!page) {
      return `Page "${path}" not found. Use search_wiki to find the correct path.`;
    }

    const sections: string[] = [`Related pages for "${page.title}" (${page.path}):\n`];

    // Pages this page links to
    if (page.links.length > 0) {
      const linkedPages = page.links
        .map(link => {
          const linked = context.pages.find(p => p.path === link);
          return linked ? `  - ${linked.title} (${linked.path})` : `  - ${link} (not found)`;
        })
        .join('\n');
      sections.push(`**Links to:**\n${linkedPages}`);
    } else {
      sections.push('**Links to:** (none)');
    }

    // Pages that link to this page
    if (page.backlinks.length > 0) {
      const backlinkPages = page.backlinks
        .map(link => {
          const linked = context.pages.find(p => p.path === link);
          return linked ? `  - ${linked.title} (${linked.path})` : `  - ${link} (not found)`;
        })
        .join('\n');
      sections.push(`**Linked from:**\n${backlinkPages}`);
    } else {
      sections.push('**Linked from:** (none)');
    }

    return sections.join('\n\n');
  },
};

/**
 * All available wiki research tools.
 */
export const wikiTools: WikiToolDefinition[] = [
  searchWikiTool,
  readPageTool,
  listPagesTool,
  getRelatedPagesTool,
];
