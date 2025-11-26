import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage, WikiPageUpdate } from '../../domain/wiki-page.js';

/**
 * Writer Agent - Transforms raw analysis pages into polished wiki articles.
 *
 * This synthesis agent identifies pages with raw "commit-style" content and
 * rewrites them as encyclopedia-style articles suitable for a wiki.
 *
 * From PLAN.md:
 * "The only component that modifies wiki files. It receives update requests,
 * understands wiki structure and conventions, manages links and cross-references,
 * handles formatting, and resolves conflicts."
 */
export class WriterAgent implements Agent {
  readonly type: AgentType = 'writer';

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('WriterAgent does not run on commits. Use runOnWiki instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    const pages = await context.repos.wikiPages.findByRepo(context.repoId);

    // Find pages that need rewriting
    const pagesNeedingRewrite = this.findPagesNeedingRewrite(pages);

    if (pagesNeedingRewrite.length === 0) {
      return {
        result: createAgentResult({
          summary: 'All pages are in good article format',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Rewrite the first page that needs work
    const page = pagesNeedingRewrite[0]!;
    const prompt = this.buildPrompt(page, pages);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 3000,
      temperature: 0.3,
    });

    const rewritten = this.parseResponse(completion.content, page);

    if (!rewritten) {
      return {
        result: createAgentResult({
          summary: `Failed to rewrite ${page.path}`,
          findings: [createFinding({
            type: 'ISSUE',
            description: `Could not parse rewrite for ${page.path}`,
            relatedPaths: [page.path],
            importance: 'low',
          })],
          confidence: 0.5,
        }),
        updates: [],
        costUsd: completion.costUsd,
      };
    }

    const update: WikiPageUpdate = {
      type: 'update',
      path: page.path,
      title: rewritten.title,
      content: rewritten.content,
      sourceCommitId: page.sourceCommits[0] ?? '',
      agentRunId: '',
      confidenceDelta: 0.2, // Boost confidence after rewrite
    };

    return {
      result: createAgentResult({
        summary: `Rewrote ${page.path} as encyclopedia article`,
        findings: [createFinding({
          type: 'SYNTHESIS',
          description: `Transformed raw analysis into article: ${page.title}`,
          relatedPaths: [page.path],
          importance: 'medium',
        })],
        confidence: rewritten.confidence,
      }),
      updates: [update],
      costUsd: completion.costUsd,
    };
  }

  /**
   * Find pages that have raw "commit-style" content that needs rewriting.
   */
  private findPagesNeedingRewrite(pages: WikiPage[]): WikiPage[] {
    const needsRewrite: WikiPage[] = [];

    // Skip categories that are inherently commit-focused
    const skipCategories = ['commits', 'security'];

    for (const page of pages) {
      const category = page.path.split('/')[0] ?? '';

      // Skip certain categories
      if (skipCategories.includes(category)) continue;

      // Skip overview pages (already synthesized)
      if (page.path.endsWith('/overview') || page.path.endsWith('/index')) continue;

      // Check for indicators of raw analysis content
      if (this.needsRewrite(page)) {
        needsRewrite.push(page);
      }
    }

    // Prioritize by:
    // 1. Lower confidence (needs more work)
    // 2. Non-commit categories first
    needsRewrite.sort((a, b) => {
      // Lower confidence first
      return a.confidence - b.confidence;
    });

    return needsRewrite;
  }

  /**
   * Check if a page has content that needs rewriting.
   */
  private needsRewrite(page: WikiPage): boolean {
    const content = page.content.toLowerCase();
    const firstParagraph = page.content.split('\n\n')[1] ?? ''; // After title

    // Indicators of raw commit-style content
    const commitIndicators = [
      'this commit ',
      'this change ',
      'this patch ',
      'this pr ',
      'this pull request ',
      'this update ',
      'this adds ',
      'this modifies ',
      'this introduces ',
      'this implements ',
      'this refactors ',
      'in this commit',
      'commit adds',
      'commit modifies',
      'commit introduces',
    ];

    // Check if content starts with commit-style language
    for (const indicator of commitIndicators) {
      if (firstParagraph.toLowerCase().includes(indicator)) {
        return true;
      }
    }

    // Check for overly short content (needs expansion)
    const contentLines = page.content.split('\n').filter(l => l.trim().length > 0);
    if (contentLines.length < 5 && !page.path.includes('overview')) {
      return true;
    }

    // Check for metadata-only pattern pages
    if (page.path.startsWith('patterns/')) {
      // Pattern pages that are too terse
      if (page.content.length < 500) {
        return true;
      }
    }

    return false;
  }

  private buildPrompt(page: WikiPage, allPages: WikiPage[]): string {
    // Find related pages for context
    const category = page.path.split('/')[0] ?? '';
    const relatedPages = allPages
      .filter(p => p.path !== page.path && p.path.startsWith(category + '/'))
      .slice(0, 5);

    const relatedContext = relatedPages.length > 0
      ? `\n## Related Pages in ${category}/\n${relatedPages.map(p => `- ${p.title}: ${p.path}`).join('\n')}`
      : '';

    return `Rewrite the following wiki page as a proper encyclopedia article.

## Current Page

**Title:** ${page.title}
**Path:** ${page.path}
**Current Content:**

${page.content}
${relatedContext}

## Your Task

Transform this into a polished wiki article that:
1. Reads like an encyclopedia entry, NOT a commit summary
2. Explains WHAT something is and WHY it matters
3. Uses third-person, present tense ("The system uses..." not "This commit adds...")
4. Preserves all factual information from the original
5. Adds context and explanation where helpful
6. Links to related pages where relevant (use markdown: [Title](path.md))

Format your response as:

TITLE:
[A clear, descriptive title - not ALL_CAPS, not referencing commits]

CONTENT:
[The full rewritten article in markdown]

CONFIDENCE: [0-1 based on how complete the rewrite is]
`;
  }

  private parseResponse(response: string, originalPage: WikiPage): ParsedRewrite | null {
    // Parse title
    const titleMatch = response.match(/TITLE:\s*(.+?)(?=\n|CONTENT:|$)/i);
    const title = titleMatch ? titleMatch[1]!.trim() : originalPage.title;

    // Parse content
    const contentMatch = response.match(/CONTENT:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (!contentMatch) {
      return null;
    }
    const content = contentMatch[1]!.trim();

    // Validate we got actual content
    if (content.length < 100) {
      return null;
    }

    // Parse confidence
    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]!) : 0.7;

    return { title, content, confidence };
  }
}

interface ParsedRewrite {
  title: string;
  content: string;
  confidence: number;
}

const SYSTEM_PROMPT = `You are a technical writer transforming raw documentation into polished wiki articles.

Your job is to take content that was generated from commit analysis and rewrite it as a proper encyclopedia article.

## Writing Style

GOOD article openings:
- "The Repository Pattern provides an abstraction layer between business logic and data persistence."
- "CodeWiki uses a multi-agent architecture where specialized agents analyze different aspects of code changes."
- "Dependency injection in this codebase follows the constructor injection pattern."

BAD article openings (NEVER write these):
- "This commit adds..."
- "This change introduces..."
- "This PR implements..."
- "In this update..."

## Guidelines

1. **Present tense, third person**: "The system uses" not "We added"
2. **Focus on WHAT and WHY**: Explain the concept, not the change history
3. **Preserve facts**: Don't lose information, just reframe it
4. **Add context**: Help readers understand why this matters
5. **Link related pages**: Use [Title](path.md) format for internal links
6. **Structure clearly**: Use headers, lists, and code blocks appropriately

## Content Structure

A good wiki article typically has:
1. Opening paragraph explaining what this is
2. Why it matters / when to use it
3. How it works (details)
4. Examples or usage
5. Related concepts (with links)

Transform commit-focused content into timeless documentation that explains the codebase as it exists today.`;
