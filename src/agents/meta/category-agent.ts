import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import type { WikiPage } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';
import {
  createParseContext,
  parseConfidence as parseConfidenceCentral,
} from '../parsing/index.js';

/**
 * Represents a categorization suggestion from the LLM.
 */
export interface Categorization {
  pagePath: string;
  currentCategory: string;
  suggestedCategory: string;
  confidence: number;
  reason: string;
}

/**
 * Represents a category mismatch finding from the LLM.
 */
export interface CategoryFinding {
  pagePath: string;
  suggestedCategory: string;
  severity: 'low' | 'medium' | 'high';
  reason: string;
}

/**
 * Parse categorization lines from LLM response.
 *
 * Simplified format:
 * - path: [path] | current: [category] | suggested: [category] | reason: [reason]
 */
export function parseCategorizations(response: string): Categorization[] {
  const results: Categorization[] = [];

  // Find all lines that start with "- path:"
  const lines = response.split('\n').filter(l => l.trim().match(/^-\s*path:/i));

  for (const line of lines) {
    // Pattern: - path: [path] | current: [cat] | suggested: [cat] | reason: [reason]
    const match = line.match(
      /^-\s*path:\s*([^|]+)\s*\|\s*current:\s*([^|]+)\s*\|\s*suggested:\s*([^|]+)\s*\|\s*reason:\s*(.+)$/i
    );

    if (match) {
      const currentCat = match[2]!.trim();
      const suggestedCat = match[3]!.trim();
      const reason = match[4]!.trim();
      const isMismatch = currentCat.toLowerCase() !== suggestedCat.toLowerCase();

      results.push({
        pagePath: match[1]!.trim(),
        currentCategory: currentCat,
        suggestedCategory: suggestedCat,
        confidence: isMismatch ? 0.85 : 0.95,
        reason: reason === 'correct' ? 'Correctly categorized' : reason,
      });
    }
  }

  return results;
}

/**
 * Parse category finding lines from LLM response.
 * Extracts mismatches from the unified categorization format.
 */
export function parseCategoryFindings(response: string): CategoryFinding[] {
  const results: CategoryFinding[] = [];

  // Use the same parsing as categorizations, but filter to mismatches
  const categorizations = parseCategorizations(response);

  for (const cat of categorizations) {
    if (cat.currentCategory.toLowerCase() !== cat.suggestedCategory.toLowerCase()) {
      results.push({
        pagePath: cat.pagePath,
        suggestedCategory: cat.suggestedCategory,
        severity: 'medium',
        reason: cat.reason,
      });
    }
  }

  return results;
}

/**
 * Parse overall confidence from LLM response.
 */
export function parseConfidence(response: string): number {
  const ctx = createParseContext('category', response);
  return parseConfidenceCentral(ctx, { defaultValue: 0.7 });
}

/**
 * Category Agent - Analyzes wiki pages and infers appropriate categories.
 *
 * This meta-agent examines all wiki pages to:
 * 1. Infer the best category for each page based on content
 * 2. Detect pages that may be miscategorized
 * 3. Create findings for category mismatches
 */
export class CategoryAgent implements Agent {
  readonly type: AgentType = 'category';

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isWikiTarget(target)) {
      throw new Error(`CategoryAgent cannot handle target type: ${target.type}`);
    }
    return this.runOnWikiImpl(context);
  }

  private async runOnWikiImpl(context: AgentContext): Promise<AgentRunResult> {
    // Get wiki pages via CQRS query
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const pages = pagesResult.data || [];

    if (pages.length < 2) {
      return {
        result: createAgentResult({
          summary: 'Not enough pages to analyze categories',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Build category statistics
    const categoryStats = this.buildCategoryStats(pages);
    const prompt = this.buildPrompt(pages, categoryStats);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
      temperature: 0.4, // Higher temperature to encourage finding mismatches
    });

    const categorizations = parseCategorizations(completion.content);
    const categoryFindings = parseCategoryFindings(completion.content);
    const confidence = parseConfidence(completion.content);

    // Create updates for pages with category changes
    const updates = this.generateUpdates(pages, categorizations);

    // Create findings from the parsed findings
    const findings = categoryFindings.map(f => createFinding({
      type: 'CATEGORY_MISMATCH',
      description: `${f.pagePath} should be in "${f.suggestedCategory}": ${f.reason}`,
      relatedPaths: [f.pagePath],
      importance: f.severity,
    }));

    // Count mismatches
    const mismatchCount = categorizations.filter(
      c => c.currentCategory !== c.suggestedCategory
    ).length;

    return {
      result: createAgentResult({
        summary: `Analyzed ${pages.length} pages across ${Object.keys(categoryStats).length} categories. Found ${mismatchCount} potential miscategorizations.`,
        findings,
        confidence,
      }),
      updates,
      costUsd: completion.costUsd,
    };
  }

  private buildCategoryStats(pages: WikiPage[]): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const page of pages) {
      const category = page.path.split('/')[0] ?? 'uncategorized';
      stats[category] = (stats[category] ?? 0) + 1;
    }
    return stats;
  }

  private buildPrompt(
    pages: WikiPage[],
    categoryStats: Record<string, number>
  ): string {
    // Limit pages to avoid overly long prompts
    const limitedPages = pages.slice(0, 15);

    const categoryList = Object.entries(categoryStats)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, count]) => `- ${cat}: ${count} pages`)
      .join('\n');

    return `## Existing Categories in This Wiki

${categoryList}

## Pages to Analyze

${limitedPages.map(p => {
  const category = p.path.split('/')[0] ?? 'uncategorized';
  return `### ${p.path}
**Title:** ${p.title}
**Current Category:** ${category}
**Content:**
${p.content.slice(0, 1000)}
---`;
}).join('\n\n')}

## Instructions

Analyze EACH page above using this process:

1. **Identify the primary topic** - What is this page actually about?
2. **Check for security keywords** - Does it mention: SQL injection, XSS, authentication, authorization, encryption, vulnerabilities, attacks, tokens, passwords?
3. **Check for API keywords** - Does it mention: endpoints, REST, HTTP methods, request/response, routes?
4. **Compare topic to category** - Does the primary topic match the current category?
5. **If mismatch → Report it!**

## Output Format

For each page, output ONE line in this format:
- path: [path] | current: [category] | suggested: [category] | reason: [reason or "correct"]

CONFIDENCE: [0-1]

## Example

- path: guides/xss-prevention | current: guides | suggested: security | reason: XSS is a security vulnerability
- path: api/users | current: api | suggested: api | reason: correct

CONFIDENCE: 0.85

Now analyze the pages:
`;
  }

  private generateUpdates(
    pages: WikiPage[],
    categorizations: Categorization[]
  ): WikiPageUpdate[] {
    const updates: WikiPageUpdate[] = [];
    const pageMap = new Map(pages.map(p => [p.path, p]));

    for (const cat of categorizations) {
      // Only create updates for mismatched categories with high confidence
      if (cat.currentCategory !== cat.suggestedCategory && cat.confidence >= 0.8) {
        const page = pageMap.get(cat.pagePath);
        if (!page) continue;

        // We don't move pages (too risky), but we can update category metadata
        // This will be stored in the WikiPage.category field
        updates.push({
          type: 'update',
          path: page.path,
          content: page.content, // Keep content unchanged
          agentRunId: '',
          confidenceDelta: 0.0, // No confidence change for category updates
        });
      }
    }

    return updates;
  }
}

const SYSTEM_PROMPT = `You are a Category Agent for CodeWiki. Your PRIMARY JOB is to FIND MISCATEGORIZED PAGES. You must actively look for pages that are in the wrong category.

## How Categories Work

A wiki page's category is the first segment of its path:
- "security/auth" → category is "security"
- "guides/getting-started" → category is "guides"
- "api/endpoints" → category is "api"

## Category Definitions (with keywords)

- **security**: Authentication, authorization, vulnerabilities, SQL injection, XSS, CSRF, encryption, tokens, passwords, access control, attack prevention, CVE, security audits
- **architecture**: System design, high-level patterns, service boundaries, data flow, infrastructure decisions
- **api**: REST endpoints, GraphQL, request/response formats, HTTP methods, API documentation, routes
- **guides**: Step-by-step tutorials, how-to instructions, getting started, walkthroughs for users
- **decisions**: ADRs, technical decisions, rationale documents, why we chose X
- **patterns**: Design patterns, coding conventions, reusable solutions, best practices
- **testing**: Test strategies, test utilities, testing guides, QA processes
- **misc/docs/other**: Catch-all categories - pages here often belong elsewhere!

## Your Task

You MUST actively identify pages where the content does NOT match the category. Pay special attention to:
- Pages in "guides", "misc", "docs" that are actually about security, architecture, or API
- Security-related content (vulnerabilities, authentication, encryption) that is NOT in "security"
- API documentation that is NOT in "api"

## Chain of Thought Process

For EACH page:
1. Read the content carefully
2. Identify the PRIMARY topic (security? architecture? API? tutorial?)
3. Compare to the current category
4. If they don't match → FLAG IT as miscategorized

## Example Analysis

Page: "guides/sql-injection-prevention"
Content discusses SQL injection attacks, parameterized queries, input validation...
- Primary topic: SECURITY (SQL injection is a security vulnerability)
- Current category: "guides"
- MISMATCH! This should be in "security", not "guides"
- Output: Flag as category_mismatch with high severity

Page: "security/authentication"
Content discusses login flows, JWT tokens, session management...
- Primary topic: SECURITY
- Current category: "security"
- MATCH! No action needed

IMPORTANT: If content is about security topics (attacks, vulnerabilities, authentication, encryption), it belongs in "security" even if it reads like a guide.`;
