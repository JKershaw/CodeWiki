import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';
import { createCodebaseToolExecutor } from '../agent-helpers.js';

/**
 * Bootstrap Agent - Creates foundation pages for empty wikis.
 *
 * This agent runs FIRST on a new repository, before any commit processing.
 * It scans the current repo state (README, PLAN.md, package.json, etc.) to
 * create initial skeleton pages that establish the wiki's foundation.
 *
 * Trigger: When wiki has 0 pages (empty wiki).
 * Priority: Highest - runs before any commit analysis.
 *
 * The pages created have moderate confidence (0.5-0.6) because they're
 * based on a snapshot, not full commit history analysis. Later agents
 * will enrich these pages with commit-backed information.
 */
export class BootstrapAgent implements Agent {
  readonly type: AgentType = 'bootstrap';

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isWikiTarget(target)) {
      throw new Error(`BootstrapAgent cannot handle target type: ${target.type}`);
    }
    return this.runOnWiki(context);
  }

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('BootstrapAgent does not run on commits. Use runOnWiki instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    // Get wiki pages via CQRS query
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const pages = pagesResult.data || [];

    // Only run on empty wikis
    if (pages.length > 0) {
      return {
        result: createAgentResult({
          summary: 'Wiki already has content - bootstrap skipped',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Set up codebase exploration tools (works with both local and GitHub repos)
    const toolExecutor = createCodebaseToolExecutor(context);

    // Call LLM with tools to explore the repo
    const completion = await context.llm.completeWithTools({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: USER_PROMPT }],
      tools: toolExecutor?.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })) ?? [],
      executeTools: toolExecutor?.executeTools ?? (async () => []),
      maxToolRounds: 5,
      maxTokens: 4000,
    });

    // Parse the response and generate wiki updates
    const content = completion.content.trim();
    const updates = this.generateUpdates(content, completion.toolCalls);

    // Determine confidence based on what was found
    const hasReadme = completion.toolCalls.some(c =>
      c.name === 'read_file' &&
      (c.input['path'] as string)?.toLowerCase().includes('readme')
    );
    const confidence = hasReadme ? 0.6 : 0.5;

    // Build findings
    const findings = [
      createFinding({
        type: 'BOOTSTRAP',
        description: `Created ${updates.length} foundation page(s) from repo snapshot`,
        relatedPaths: updates.map(u => u.path),
        importance: 'high',
      }),
    ];

    if (completion.toolCalls.length > 0) {
      findings.push(createFinding({
        type: 'TOOL_USE',
        description: `Explored ${completion.toolCalls.length} files/directories`,
        relatedPaths: completion.toolCalls
          .filter(c => c.name === 'read_file')
          .map(c => c.input['path'] as string)
          .filter(Boolean),
        importance: 'low',
      }));
    }

    return {
      result: createAgentResult({
        summary: `Bootstrapped wiki with ${updates.length} foundation page(s)`,
        findings,
        confidence,
      }),
      updates,
      costUsd: completion.costUsd,
    };
  }

  private generateUpdates(
    content: string,
    toolCalls: Array<{ name: string; input: Record<string, unknown> }>
  ): WikiPageUpdate[] {
    const updates: WikiPageUpdate[] = [];

    // Determine confidence delta based on source quality
    const hasReadme = toolCalls.some(c =>
      c.name === 'read_file' &&
      (c.input['path'] as string)?.toLowerCase().includes('readme')
    );
    const baseConfidence = hasReadme ? 0.5 : 0.4;

    // Parse structured pages from response
    const pages = this.parsePages(content);

    if (pages.length > 0) {
      // Use structured pages from LLM
      for (const page of pages) {
        updates.push({
          type: 'create',
          path: page.path,
          title: page.title,
          content: page.content,
          sourceCommitId: '', // Bootstrap has no source commit
          agentRunId: '',
          confidenceDelta: baseConfidence,
        });
      }
    } else {
      // Fallback: treat entire content as overview page
      const titleMatch = content.match(/^#\s+(.+?)(?:\s+-\s+Overview)?$/m);
      const title = titleMatch ? titleMatch[1]!.trim() : 'Project Overview';

      updates.push({
        type: 'create',
        path: 'architecture/overview',
        title: `${title} - Overview`,
        content: content,
        sourceCommitId: '',
        agentRunId: '',
        confidenceDelta: baseConfidence,
      });
    }

    return updates;
  }

  /**
   * Parse structured pages from LLM response.
   * Expected format: multiple ---PAGE--- blocks with PATH, TITLE, CONTENT.
   */
  private parsePages(content: string): Array<{ path: string; title: string; content: string }> {
    const pages: Array<{ path: string; title: string; content: string }> = [];

    // Match blocks like: ---PAGE---\nPATH: ...\nTITLE: ...\nCONTENT:\n...\n---END_PAGE---
    const pageBlocks = content.split(/---PAGE---/i).slice(1); // Skip content before first ---PAGE---

    for (const block of pageBlocks) {
      const cleanBlock = block.replace(/---END_PAGE---/gi, '').trim();
      if (!cleanBlock) continue;

      const pathMatch = cleanBlock.match(/PATH:\s*(.+?)(?:\n|$)/i);
      const titleMatch = cleanBlock.match(/TITLE:\s*(.+?)(?:\n|$)/i);
      const contentMatch = cleanBlock.match(/CONTENT:\s*([\s\S]*?)$/i);

      if (pathMatch && contentMatch) {
        const path = pathMatch[1]!.trim();
        const pageContent = contentMatch[1]!.trim();

        // Skip empty pages or commit-style paths
        if (!pageContent || path.startsWith('commits/')) continue;

        // Extract title from content heading if not explicitly provided
        let title = titleMatch?.[1]?.trim() || '';
        if (!title) {
          const headingMatch = pageContent.match(/^#\s+(.+)$/m);
          title = headingMatch ? headingMatch[1]!.trim() : this.pathToTitle(path);
        }

        pages.push({ path, title, content: pageContent });
      }
    }

    return pages;
  }

  /**
   * Convert a path to a title.
   */
  private pathToTitle(path: string): string {
    const lastPart = path.split('/').pop() ?? path;
    return lastPart
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}

const SYSTEM_PROMPT = `You are a technical writer creating FOUNDATION PAGES for a software project wiki.

Your job is to bootstrap the wiki by scanning the repository and creating 3-5 initial concept pages.
These pages form the foundation that other agents will build upon.

## Tools Available

- read_file: Read any file (README.md, package.json, source files)
- search_files: Find files matching glob patterns
- list_directory: See directory structure

## Exploration Strategy

1. Read README.md, PLAN.md, package.json (if they exist)
2. List the main source directories (src/, lib/, etc.)
3. Read 2-3 key source files to understand architecture
4. Identify the main concepts, components, or modules

## Output Format

Create 3-5 foundation pages using this EXACT format:

---PAGE---
PATH: architecture/overview
TITLE: Project Architecture Overview
CONTENT:
# Project Architecture Overview

[2-4 paragraphs describing the overall architecture]

## Key Components
- [Component 1]: [description]
- [Component 2]: [description]

## Technology Stack
[List key technologies]
---END_PAGE---

---PAGE---
PATH: components/[component-name]
TITLE: [Component Name]
CONTENT:
# [Component Name]

[Description of this component]

## Purpose
[Why this exists]

## Key Files
- [file1.ts]: [what it does]
---END_PAGE---

(Create 3-5 pages total)

## Required Pages

You MUST create at least:
1. **architecture/overview** - High-level project overview and architecture
2. **guides/getting-started** - How to set up and run the project
3. **components/[main-component]** - Documentation for the main component/module

You MAY also create (if relevant):
4. **architecture/[pattern]** - Key architectural patterns used
5. **components/[other]** - Other significant components

## Guidelines

- Use lowercase paths with hyphens (architecture/event-sourcing, NOT Architecture/EventSourcing)
- Write as encyclopedia articles, not changelogs
- Be factual - only document what you actually find
- Each page should have 2-4 paragraphs minimum
- These pages will be enriched by later agents - focus on structure over completeness`;

const USER_PROMPT = `Bootstrap this wiki by exploring the repository and creating 3-5 foundation pages.

1. First, read README.md and package.json to understand the project
2. List the main source directories
3. Read 2-3 key source files
4. Create foundation pages following the ---PAGE--- format

Remember: Create architecture/overview, guides/getting-started, and at least one component page.`;
