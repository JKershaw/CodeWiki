/**
 * Wiki exploration tools for the agentic Research Agent.
 *
 * These tools allow the LLM to search, read, and explore the wiki
 * to find information needed to answer questions.
 */

import type { WikiPage } from '../../domain/wiki-page.js';
import type { Repositories } from '../../repositories/index.js';

/**
 * Context provided to wiki tools when they execute.
 */
export interface WikiToolContext {
  wikiId: string;
  repos: Repositories;
}

/**
 * Definition of a wiki tool.
 */
export interface WikiToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  execute: (input: Record<string, unknown>, context: WikiToolContext) => Promise<unknown>;
}

// ============================================================================
// Tool: search_wiki
// ============================================================================

export interface SearchWikiInput {
  query: string;
  limit?: number;
  min_confidence?: number;
  category?: string;
}

export interface SearchWikiResult {
  path: string;
  title: string;
  confidence: number;
  snippet: string;
  lastUpdated: string;
}

/**
 * Extract the best snippet from content that matches the query.
 */
function extractSnippet(content: string, query: string, maxLength = 300): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 2);

  // Try to find a section containing query terms
  let bestStart = 0;
  let bestScore = 0;

  for (let i = 0; i < content.length - maxLength; i += 50) {
    const window = lowerContent.slice(i, i + maxLength);
    let score = 0;
    for (const word of queryWords) {
      if (window.includes(word)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
    }
  }

  // Extract snippet, trying to start at a sentence boundary
  let start = bestStart;
  const beforeStart = content.slice(Math.max(0, start - 50), start);
  const sentenceStart = beforeStart.lastIndexOf('. ');
  if (sentenceStart !== -1) {
    start = Math.max(0, start - 50) + sentenceStart + 2;
  }

  let snippet = content.slice(start, start + maxLength);

  // Try to end at a sentence boundary
  const lastPeriod = snippet.lastIndexOf('. ');
  if (lastPeriod > maxLength * 0.5) {
    snippet = snippet.slice(0, lastPeriod + 1);
  } else {
    snippet = snippet.trim() + '...';
  }

  return snippet;
}

/**
 * Score a page's relevance to a query using improved matching.
 */
function scorePageRelevance(page: WikiPage, query: string): number {
  const lowerQuery = query.toLowerCase();
  const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 2);
  const lowerTitle = page.title.toLowerCase();
  const lowerPath = page.path.toLowerCase();
  const lowerContent = page.content.toLowerCase();

  let score = 0;

  // Exact phrase match in title (highest value)
  if (lowerTitle.includes(lowerQuery)) {
    score += 10;
  }

  // Exact phrase match in content
  if (lowerContent.includes(lowerQuery)) {
    score += 5;
  }

  // Individual word matches
  for (const word of queryWords) {
    if (lowerTitle.includes(word)) score += 3;
    if (lowerPath.includes(word)) score += 2;

    // Count occurrences in content (capped)
    const matches = (lowerContent.match(new RegExp(word, 'g')) || []).length;
    score += Math.min(matches * 0.3, 3);
  }

  // Boost for page confidence
  score *= (0.7 + page.confidence * 0.3);

  return score;
}

export const searchWikiTool: WikiToolDefinition = {
  name: 'search_wiki',
  description: `Search the wiki for pages relevant to a query.
Returns page titles, paths, confidence scores, and content snippets.
Use specific terms for precise results, or broader terms to explore.
Results are ranked by relevance.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query - can be keywords, phrases, or concepts',
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default: 10)',
      },
      min_confidence: {
        type: 'number',
        description: 'Minimum confidence threshold 0-1 (default: 0)',
      },
      category: {
        type: 'string',
        description: 'Filter by path prefix (e.g., "architecture/", "patterns/")',
      },
    },
    required: ['query'],
  },
  execute: async (input, context): Promise<SearchWikiResult[] | { error: string }> => {
    const { query, limit = 10, min_confidence = 0, category } = input as SearchWikiInput;

    try {
      // Get all pages for this wiki
      const allPages = await context.repos.wikiPages.findByWiki(context.wikiId);

      if (allPages.length === 0) {
        return { error: 'Wiki has no pages yet' };
      }

      // Filter and score pages
      let candidates = allPages.filter(page => {
        if (min_confidence && page.confidence < min_confidence) return false;
        if (category && !page.path.startsWith(category)) return false;
        return true;
      });

      // Score and sort by relevance
      const scored = candidates.map(page => ({
        page,
        score: scorePageRelevance(page, query),
      }));

      scored.sort((a, b) => b.score - a.score);

      // Filter out zero-score results and take top N
      const results = scored
        .filter(s => s.score > 0)
        .slice(0, limit)
        .map(({ page }) => ({
          path: page.path,
          title: page.title,
          confidence: page.confidence,
          snippet: extractSnippet(page.content, query),
          lastUpdated: page.updatedAt.toISOString(),
        }));

      if (results.length === 0) {
        return { error: `No pages found matching "${query}"` };
      }

      return results;
    } catch (error) {
      return { error: `Search failed: ${error}` };
    }
  },
};

// ============================================================================
// Tool: read_wiki_page
// ============================================================================

export interface ReadWikiPageInput {
  path: string;
}

export interface ReadWikiPageResult {
  title: string;
  content: string;
  confidence: number;
  sourceCommits: string[];
  links: string[];
  backlinks: string[];
  lastUpdated: string;
}

export const readWikiPageTool: WikiToolDefinition = {
  name: 'read_wiki_page',
  description: `Read the full content of a wiki page by its path.
Use after search_wiki to get complete information from promising results.
Returns markdown content, confidence score, and related page links.`,
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Wiki page path (e.g., "architecture/cqrs", "patterns/repository")',
      },
    },
    required: ['path'],
  },
  execute: async (input, context): Promise<ReadWikiPageResult | { error: string }> => {
    const { path } = input as ReadWikiPageInput;

    try {
      const page = await context.repos.wikiPages.findByPath(context.wikiId, path);

      if (!page) {
        return { error: `Page not found: "${path}"` };
      }

      return {
        title: page.title,
        content: page.content,
        confidence: page.confidence,
        sourceCommits: page.sourceCommits,
        links: page.links,
        backlinks: page.backlinks,
        lastUpdated: page.updatedAt.toISOString(),
      };
    } catch (error) {
      return { error: `Failed to read page: ${error}` };
    }
  },
};

// ============================================================================
// Tool: list_wiki_sections
// ============================================================================

export interface ListWikiSectionsInput {
  section?: string;
}

export interface WikiSection {
  name: string;
  pages: Array<{
    path: string;
    title: string;
    confidence: number;
  }>;
}

export interface ListWikiSectionsResult {
  sections: WikiSection[];
  totalPages: number;
}

export const listWikiSectionsTool: WikiToolDefinition = {
  name: 'list_wiki_sections',
  description: `List all wiki pages organized by section/category.
Use to understand wiki structure and discover what topics are documented.
Helpful when searches don't find what you need - lets you browse available content.`,
  inputSchema: {
    type: 'object',
    properties: {
      section: {
        type: 'string',
        description: 'Optional: filter to specific section (e.g., "architecture")',
      },
    },
    required: [],
  },
  execute: async (input, context): Promise<ListWikiSectionsResult | { error: string }> => {
    const { section } = input as ListWikiSectionsInput;

    try {
      const allPages = await context.repos.wikiPages.findByWiki(context.wikiId);

      if (allPages.length === 0) {
        return { error: 'Wiki has no pages yet' };
      }

      // Group pages by top-level section
      const sectionMap = new Map<string, WikiPage[]>();

      for (const page of allPages) {
        const parts = page.path.split('/');
        const sectionName = parts.length > 1 ? parts[0]! : 'root';

        // Filter by section if specified
        if (section && sectionName !== section) continue;

        if (!sectionMap.has(sectionName)) {
          sectionMap.set(sectionName, []);
        }
        sectionMap.get(sectionName)!.push(page);
      }

      // Convert to result format
      const sections: WikiSection[] = [];
      for (const [name, pages] of sectionMap) {
        sections.push({
          name,
          pages: pages
            .sort((a, b) => a.title.localeCompare(b.title))
            .map(p => ({
              path: p.path,
              title: p.title,
              confidence: p.confidence,
            })),
        });
      }

      // Sort sections alphabetically
      sections.sort((a, b) => a.name.localeCompare(b.name));

      return {
        sections,
        totalPages: allPages.length,
      };
    } catch (error) {
      return { error: `Failed to list sections: ${error}` };
    }
  },
};

// ============================================================================
// Tool: get_related_pages
// ============================================================================

export interface GetRelatedPagesInput {
  path: string;
}

export interface RelatedPageInfo {
  path: string;
  title: string;
  snippet: string;
}

export interface GetRelatedPagesResult {
  linksTo: RelatedPageInfo[];
  linkedFrom: RelatedPageInfo[];
}

export const getRelatedPagesTool: WikiToolDefinition = {
  name: 'get_related_pages',
  description: `Get pages related to a specific page via links and backlinks.
Use to explore connected concepts and find additional context.
"linksTo" shows pages this page references.
"linkedFrom" shows pages that reference this page.`,
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
  execute: async (input, context): Promise<GetRelatedPagesResult | { error: string }> => {
    const { path } = input as GetRelatedPagesInput;

    try {
      const page = await context.repos.wikiPages.findByPath(context.wikiId, path);

      if (!page) {
        return { error: `Page not found: "${path}"` };
      }

      const linksTo: RelatedPageInfo[] = [];
      const linkedFrom: RelatedPageInfo[] = [];

      // Get pages this page links to
      for (const linkedPath of page.links) {
        const linkedPage = await context.repos.wikiPages.findByPath(context.wikiId, linkedPath);
        if (linkedPage) {
          linksTo.push({
            path: linkedPage.path,
            title: linkedPage.title,
            snippet: linkedPage.content.slice(0, 200) + '...',
          });
        }
      }

      // Get pages that link to this page
      for (const backlinkPath of page.backlinks) {
        const backlinkPage = await context.repos.wikiPages.findByPath(context.wikiId, backlinkPath);
        if (backlinkPage) {
          linkedFrom.push({
            path: backlinkPage.path,
            title: backlinkPage.title,
            snippet: backlinkPage.content.slice(0, 200) + '...',
          });
        }
      }

      return { linksTo, linkedFrom };
    } catch (error) {
      return { error: `Failed to get related pages: ${error}` };
    }
  },
};

// ============================================================================
// All Wiki Tools
// ============================================================================

export const wikiTools: WikiToolDefinition[] = [
  searchWikiTool,
  readWikiPageTool,
  listWikiSectionsTool,
  getRelatedPagesTool,
];

/**
 * Create tool executor function for use with LLM.completeWithTools().
 */
export function createWikiToolExecutor(context: WikiToolContext) {
  return async (
    calls: Array<{ id: string; name: string; input: Record<string, unknown> }>
  ): Promise<Array<{ id: string; result: string }>> => {
    const results: Array<{ id: string; result: string }> = [];

    for (const call of calls) {
      const tool = wikiTools.find(t => t.name === call.name);
      if (!tool) {
        results.push({
          id: call.id,
          result: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
        });
        continue;
      }

      const result = await tool.execute(call.input, context);
      results.push({
        id: call.id,
        result: JSON.stringify(result),
      });
    }

    return results;
  };
}
