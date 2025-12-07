import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage, WikiPageUpdate } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';
import { createCodebaseToolExecutor } from '../agent-helpers.js';
import {
  createParseContext,
  parseSection,
  parseConfidence,
  hasRequiredFailures,
  getFailureSummary,
  validateMinLength,
} from '../parsing/index.js';

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

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isWikiTarget(target)) {
      throw new Error(`WriterAgent cannot handle target type: ${target.type}`);
    }
    return this.runOnWiki(context);
  }

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('WriterAgent does not run on commits. Use runOnWiki instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    // Get wiki pages via CQRS query
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const pages = pagesResult.data || [];

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

    // Set up codebase exploration tools for fact verification
    const toolExecutor = createCodebaseToolExecutor(context);

    const completion = await context.llm.completeWithTools({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      tools: toolExecutor?.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })) ?? [],
      executeTools: toolExecutor?.executeTools ?? (async () => []),
      maxToolRounds: 3,
      maxTokens: 3500,
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

## Available Tools

You have access to tools to verify information in the source code:
- **read_file**: Read source files to verify code examples and claims
- **search_files**: Find files by pattern to locate implementations
- **list_directory**: Explore project structure

**Use these tools to**:
- Verify any code examples mentioned in the content actually exist
- Check that file paths and function names are accurate
- Find real examples from tests when adding usage examples
- Confirm technical claims before including them

## Your Task

Transform this into a polished wiki article that:
1. Reads like an encyclopedia entry, NOT a commit summary
2. Explains WHAT something is and WHY it matters
3. Uses third-person, present tense ("The system uses..." not "This commit adds...")
4. Preserves all factual information from the original
5. Adds context and explanation where helpful - USE TOOLS TO VERIFY
6. Links to related pages where relevant (use markdown: [Title](path.md))

If you cannot verify a claim, either omit it or note the uncertainty.

Format your response as:

TITLE:
[A clear, descriptive title - not ALL_CAPS, not referencing commits]

CONTENT:
[The full rewritten article in markdown]

CONFIDENCE: [0-1 based on how complete the rewrite is]
`;
  }

  private parseResponse(response: string, originalPage: WikiPage): ParsedRewrite | null {
    const ctx = createParseContext('writer', response);

    // Parse title (optional - falls back to original)
    const title = parseSection(ctx, 'TITLE', /TITLE:\s*(.+?)(?=\n|CONTENT:|$)/i, {
      required: false,
      defaultValue: originalPage.title,
    }) ?? originalPage.title;

    // Parse content (required)
    const content = parseSection(ctx, 'CONTENT', /CONTENT:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i, {
      required: true,
    });

    // Check for required failures
    if (hasRequiredFailures(ctx)) {
      console.error(`[writer] Parse failed: ${getFailureSummary(ctx)}`);
      return null;
    }

    // Validate content length
    if (!validateMinLength(ctx, 'CONTENT', content, 100)) {
      return null;
    }

    // Parse confidence (optional with default)
    const confidence = parseConfidence(ctx, { defaultValue: 0.7 });

    return { title, content: content!, confidence };
  }
}

interface ParsedRewrite {
  title: string;
  content: string;
  confidence: number;
}

const SYSTEM_PROMPT = `You are a technical writer transforming raw documentation into polished wiki articles.

Your job is to take content that was generated from commit analysis and rewrite it as a proper encyclopedia article.

## CRITICAL: Verify Before Writing

You have access to tools (read_file, search_files, list_directory) to explore the source code. USE THEM to verify facts:

1. **Before adding code examples**: Use read_file to get real code from the codebase
2. **Before claiming how something works**: Read the actual implementation to verify
3. **Before citing file paths**: Use search_files to confirm they exist
4. **When adding context**: Base it on actual code, not assumptions

If you cannot verify a claim with tools, either:
- Omit the claim entirely, OR
- Explicitly note it as unverified (e.g., "The implementation appears to...")

Never invent code examples or technical details. Use the tools to find real examples.

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

A good wiki article MUST have:

1. **Opening paragraph** - What this is and why it matters (not "this commit adds...")
2. **How it works** - Explain the mechanism:
   - What are the key components?
   - How do they interact?
   - What's the control flow?
3. **Usage/Configuration** - Practical details:
   - Required configuration or environment variables
   - API signatures or function calls
   - Code examples (prefer examples from tests when available)
4. **Edge cases/Limitations** - What developers should watch out for
5. **Related concepts** - Links to other wiki pages

If the source content doesn't provide enough detail for sections 2-4, note what's unclear rather than making things up.

Transform commit-focused content into timeless documentation that explains the codebase as it exists today.`;
