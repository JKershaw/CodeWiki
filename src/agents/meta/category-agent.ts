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
 * Deduplicates findings by page path (keeps first occurrence).
 */
export function parseCategoryFindings(response: string): CategoryFinding[] {
  const results: CategoryFinding[] = [];
  const seenPaths = new Set<string>();

  // Use the same parsing as categorizations, but filter to mismatches
  const categorizations = parseCategorizations(response);

  for (const cat of categorizations) {
    if (cat.currentCategory.toLowerCase() !== cat.suggestedCategory.toLowerCase()) {
      // Deduplicate by page path - keep first occurrence only
      if (seenPaths.has(cat.pagePath)) {
        continue;
      }
      seenPaths.add(cat.pagePath);

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
      temperature: 0.2, // Lower temperature for more consistent, accurate outputs
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

Analyze EACH page above. For each page:

1. **What is the PRIMARY PURPOSE?** - Is this page teaching a concept, documenting an API, providing a tutorial, etc.?
2. **Does the purpose match the category?**
   - "guides" = tutorials, how-tos, getting started, walkthroughs
   - "security" = security vulnerabilities, attack prevention, encryption
   - "architecture" = system design, patterns at system level
   - "api" = endpoint documentation, REST/GraphQL specs

3. **Only flag CLEAR mismatches** - When uncertain, mark as "correct"

IMPORTANT REMINDERS:
- Getting started guides belong in "guides" even if they mention auth/security/APIs
- Installation tutorials belong in "guides"
- A page that TEACHES ABOUT a security vulnerability belongs in "security"
- A page that shows HOW TO SET UP something is a "guide"

## Output Format

Output exactly ONE line per page in this format:
- path: [path] | current: [category] | suggested: [category] | reason: [reason or "correct"]

Then add your confidence score.

## Example Output

- path: guides/getting-started | current: guides | suggested: guides | reason: correct
- path: guides/xss-prevention | current: guides | suggested: security | reason: XSS is a security vulnerability topic
- path: architecture/event-sourcing | current: architecture | suggested: architecture | reason: correct

CONFIDENCE: 0.9

Now analyze each page (one line per page, no duplicates):
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

const SYSTEM_PROMPT = `You are a Category Agent for CodeWiki. Your job is to analyze page categorization with HIGH ACCURACY. Prioritize precision over recall - only flag pages when you are CONFIDENT they are miscategorized.

## How Categories Work

A wiki page's category is the first segment of its path:
- "security/auth" → category is "security"
- "guides/getting-started" → category is "guides"
- "api/endpoints" → category is "api"

## Category Definitions

- **security**: Content PRIMARILY about security concepts - vulnerabilities (SQL injection, XSS, CSRF), attack prevention, encryption algorithms, access control policies, security audits, CVEs
- **architecture**: System design, high-level patterns, service boundaries, data flow diagrams, infrastructure decisions
- **api**: REST endpoints, GraphQL schemas, request/response formats, HTTP methods, route definitions
- **guides**: Step-by-step tutorials, how-to instructions, getting started guides, installation walkthroughs, user onboarding - even if they MENTION other topics
- **decisions**: ADRs, technical decisions, rationale documents
- **patterns**: Design patterns, coding conventions, reusable solutions
- **testing**: Test strategies, test utilities, QA processes
- **misc/docs/other**: Catch-all categories

## CRITICAL RULES - Read Carefully

1. **When in doubt, mark as "correct"** - Only flag clear mismatches
2. **Guides stay in guides** - A getting started guide or installation tutorial belongs in "guides" even if it mentions security, API, or architecture concepts
3. **Look at the PRIMARY purpose** - What is the page TEACHING? A guide that shows how to set up auth is a GUIDE, not security content
4. **One suggestion per page** - Never output multiple lines for the same page path
5. **Avoid false positives** - It's better to miss a mismatch than to wrongly flag a correct categorization

## Examples

Page: "guides/getting-started"
Content: Installation steps, npm commands, project setup...
- Primary purpose: USER ONBOARDING (how to set up the project)
- Current category: "guides"
- CORRECT! This is a getting started tutorial → belongs in guides

Page: "guides/sql-injection-prevention"
Content: SQL injection attacks, parameterized queries, security best practices...
- Primary purpose: SECURITY EDUCATION (teaching about a vulnerability)
- Current category: "guides"
- MISMATCH → should be in "security"

Page: "architecture/cqrs"
Content: CQRS pattern, read/write separation, architectural benefits...
- Primary purpose: ARCHITECTURE DOCUMENTATION
- Current category: "architecture"
- CORRECT! Architecture content in architecture category`;
