import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage, WikiPageUpdate } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';
import {
  createCodebaseToolExecutor,
  fetchAffectedFileContents,
  formatFetchedFilesForContext,
} from '../agent-helpers.js';
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
 * OPTIMIZATION: Pre-fetches source files referenced in wiki content and includes
 * them directly in the prompt, reducing tool calls. Falls back to tool-based
 * approach only if needed.
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

  // Max file size for pre-fetch
  private readonly MAX_FILE_SIZE = 15000;
  // Max total context for pre-fetched files
  private readonly MAX_TOTAL_SIZE = 40000;

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

    // Try pre-fetch approach first
    if (context.repoAccess) {
      const prefetchResult = await this.runWithPrefetch(page, pages, context);
      if (prefetchResult) {
        return prefetchResult;
      }
    }

    // Fall back to tool-based approach
    return this.runWithTools(page, pages, context);
  }

  /**
   * Optimized run using pre-fetched file contents.
   */
  private async runWithPrefetch(
    page: WikiPage,
    allPages: WikiPage[],
    context: AgentContext
  ): Promise<AgentRunResult | null> {
    // Extract file paths mentioned in the wiki content
    const referencedFiles = this.extractFileReferences(page.content);

    if (referencedFiles.length === 0) {
      return null; // Fall back to tools
    }

    // Pre-fetch referenced files
    const fetchedFiles = await fetchAffectedFileContents(
      context,
      referencedFiles,
      this.MAX_FILE_SIZE,
      this.MAX_TOTAL_SIZE
    );

    // Check if we got any content
    const filesWithContent = fetchedFiles.filter(f => f.content !== null);
    if (filesWithContent.length === 0) {
      return null; // Fall back to tools
    }

    // Build prompt with pre-fetched content
    const fileContext = formatFetchedFilesForContext(fetchedFiles, '## Source Files (for verification)');
    const prompt = this.buildPrefetchPrompt(page, allPages, fileContext);

    // Use single LLM call
    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT_PREFETCH,
      messages: [{ role: 'user', content: prompt }],
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
      confidenceDelta: 0.2,
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
      toolMetrics: { toolCallCount: 0, toolsUsed: {}, filesRead: referencedFiles },
    };
  }

  /**
   * Tool-based run for complex cases or fallback.
   */
  private async runWithTools(
    page: WikiPage,
    allPages: WikiPage[],
    context: AgentContext
  ): Promise<AgentRunResult> {
    const prompt = this.buildPrompt(page, allPages);

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
      confidenceDelta: 0.2,
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
   * Extract file paths mentioned in wiki content.
   */
  private extractFileReferences(content: string): string[] {
    const paths = new Set<string>();

    // Match common file path patterns
    // e.g., src/auth/login.ts, ./components/Button.tsx, lib/utils.js
    const pathPatterns = [
      /(?:^|[\s`'"])((?:src|lib|app|components|pages|utils|services|api|tests?)\/[\w\-./]+\.\w+)/gim,
      /`([\w\-./]+\.(?:ts|tsx|js|jsx|json|yaml|yml|md))`/gi,
    ];

    for (const pattern of pathPatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        const path = match[1]?.trim();
        if (path && !path.includes('*') && path.length < 100) {
          paths.add(path);
        }
      }
    }

    return Array.from(paths).slice(0, 10); // Limit to 10 files
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

## Example

TITLE:
Repository Pattern Implementation

CONTENT:
# Repository Pattern Implementation

The repository pattern provides an abstraction layer between business logic and data persistence in the codebase.

## How It Works

Each domain entity has a corresponding repository interface that defines standard CRUD operations:
- \`create()\` - Insert new records
- \`findById()\` - Retrieve by primary key
- \`update()\` - Modify existing records
- \`delete()\` - Remove records

The concrete implementations handle database-specific operations while the business logic depends only on the interfaces.

## Usage

\`\`\`typescript
const userRepo = new UserRepository(db);
const user = await userRepo.findById(userId);
\`\`\`

## Related Pages

- [Domain Model](architecture/domain-model.md)
- [Database Configuration](guides/database-setup.md)

CONFIDENCE: 0.85
`;
  }

  /**
   * Build prompt with pre-fetched file contents (optimized approach).
   */
  private buildPrefetchPrompt(page: WikiPage, allPages: WikiPage[], fileContext: string): string {
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

${fileContext}

## Your Task

The source files mentioned in the content are provided above for verification. Use them to:
- Verify any code examples mentioned in the content actually exist
- Check that file paths and function names are accurate
- Ensure technical claims match the actual code

Transform this into a polished wiki article that:
1. Reads like an encyclopedia entry, NOT a commit summary
2. Explains WHAT something is and WHY it matters
3. Uses third-person, present tense ("The system uses..." not "This commit adds...")
4. Preserves all factual information from the original
5. Adds context and explanation based on the provided source files
6. Links to related pages where relevant (use markdown: [Title](path.md))

If information is not verifiable from the provided files, either omit it or note the uncertainty.

Format your response as:

TITLE:
[A clear, descriptive title - not ALL_CAPS, not referencing commits]

CONTENT:
[The full rewritten article in markdown]

CONFIDENCE: [0-1 based on how complete the rewrite is]

## Example

TITLE:
Repository Pattern Implementation

CONTENT:
# Repository Pattern Implementation

The repository pattern provides an abstraction layer between business logic and data persistence...

## How It Works

Each domain entity has a corresponding repository interface...

CONFIDENCE: 0.85
`;
  }

  private parseResponse(response: string, originalPage: WikiPage): ParsedRewrite | null {
    const ctx = createParseContext('writer', response);

    // Parse title (optional - falls back to original)
    let title = parseSection(ctx, 'TITLE', /TITLE:\s*(.+?)(?=\n|CONTENT:|$)/i, {
      required: false,
      defaultValue: originalPage.title,
    }) ?? originalPage.title;

    // Parse content with multiple fallback strategies
    let content = parseSection(ctx, 'CONTENT', /CONTENT:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i, {
      required: false, // We'll handle requirement ourselves with fallbacks
    });

    // Fallback 1: Try to find content between TITLE: and CONFIDENCE:
    if (!content || content.length < 100) {
      const titleToConfidenceMatch = response.match(/TITLE:[^\n]*\n([\s\S]*?)(?=CONFIDENCE:|$)/i);
      if (titleToConfidenceMatch && titleToConfidenceMatch[1]) {
        const candidate = titleToConfidenceMatch[1].trim();
        // Skip if it's just "CONTENT:" header
        if (candidate.length > 100 && !candidate.match(/^CONTENT:\s*$/im)) {
          content = candidate.replace(/^CONTENT:\s*/i, '').trim();
          ctx.successfulSections.push('CONTENT (fallback 1)');
        }
      }
    }

    // Fallback 2: Extract any markdown article starting with a heading
    if (!content || content.length < 100) {
      // Look for markdown content that starts with a heading (# Title)
      const markdownMatch = response.match(/(#\s+[^\n]+\n[\s\S]{100,}?)(?=CONFIDENCE:|$)/);
      if (markdownMatch && markdownMatch[1]) {
        content = markdownMatch[1].trim();
        // Also try to extract title from the first heading
        const headingMatch = content.match(/^#\s+(.+?)$/m);
        if (headingMatch && headingMatch[1]) {
          title = headingMatch[1].trim();
        }
        ctx.successfulSections.push('CONTENT (fallback 2)');
      }
    }

    // Fallback 3: Take everything after TITLE: line if no CONTENT: marker
    if (!content || content.length < 100) {
      const afterTitleMatch = response.match(/TITLE:[^\n]*\n\n?([\s\S]{100,}?)(?=CONFIDENCE:|$)/i);
      if (afterTitleMatch && afterTitleMatch[1]) {
        content = afterTitleMatch[1].trim();
        ctx.successfulSections.push('CONTENT (fallback 3)');
      }
    }

    // Check if we still failed to get content
    if (!content || content.length < 100) {
      console.error(`[writer] Parse failed: Could not extract content (tried 3 fallback strategies)`);
      console.error(`[writer] Response preview: ${response.slice(0, 300)}`);
      return null;
    }

    // Clean up content - remove any leading "CONTENT:" if it slipped through
    content = content.replace(/^CONTENT:\s*/i, '').trim();

    // Parse confidence (optional with default)
    const confidence = parseConfidence(ctx, { defaultValue: 0.7 });

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

/**
 * System prompt for pre-fetch approach (file contents already provided, no tools needed).
 */
const SYSTEM_PROMPT_PREFETCH = `You are a technical writer transforming raw documentation into polished wiki articles.

Your job is to take content that was generated from commit analysis and rewrite it as a proper encyclopedia article.

## Context Provided

The source files mentioned in the wiki content are provided directly in the prompt. You do not need to use any tools - all the code you need to verify is already available.

Use the provided source files to:
- Verify any code examples mentioned in the content
- Check that file paths and function names are accurate
- Base explanations on actual code, not assumptions

If a claim cannot be verified from the provided files, either:
- Omit the claim entirely, OR
- Explicitly note it as unverified (e.g., "The implementation appears to...")

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
2. **How it works** - Explain the mechanism based on the provided source files
3. **Usage/Configuration** - Practical details from the code
4. **Edge cases/Limitations** - What developers should watch out for
5. **Related concepts** - Links to other wiki pages

If the provided files don't have enough detail for sections 2-4, note what's unclear rather than making things up.

Transform commit-focused content into timeless documentation that explains the codebase as it exists today.`;
