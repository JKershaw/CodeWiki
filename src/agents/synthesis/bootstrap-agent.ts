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
    const confidenceDelta = hasReadme ? 0.6 : 0.5;

    // Extract title from content or use default
    const titleMatch = content.match(/^#\s+(.+?)(?:\s+-\s+Overview)?$/m);
    const title = titleMatch ? titleMatch[1]!.trim() : 'Project Overview';

    // Create the main overview page
    updates.push({
      type: 'create',
      path: 'overview',
      title: `${title} - Overview`,
      content: content,
      sourceCommitId: '', // Bootstrap has no source commit
      agentRunId: '',
      confidenceDelta,
    });

    return updates;
  }
}

const SYSTEM_PROMPT = `You are a technical writer creating initial documentation for a software project wiki.

Your job is to bootstrap the wiki by scanning the current repository state and creating a comprehensive overview page.

You have access to tools to explore the codebase:
- read_file: Read any file (README.md, PLAN.md, package.json, source files)
- search_files: Find files matching glob patterns
- list_directory: See directory structure

## Instructions

1. FIRST, try to read these files (they may not all exist):
   - README.md (primary source of project info)
   - PLAN.md (architecture/planning info)
   - package.json (project metadata, scripts)

2. THEN, list the src/ or main source directory to understand structure

3. Based on what you find, write a comprehensive overview page in Markdown.

## Output Format

Output ONLY the markdown content for the overview page. Start with:
# [Project Name] - Overview

Include sections for:
- What the project does (from README or inferred)
- Project structure (from directory listing)
- Getting started / key commands (from package.json scripts if available)
- Key files or entry points

## Important Guidelines

- If README.md exists, extract its key information
- If no README exists, infer purpose from code structure and package.json
- Be factual - only document what you actually find
- Don't make up features or functionality that isn't evident
- Keep it concise but comprehensive
- This page will be the starting point for new developers

Do NOT include:
- Explanations of what you're doing
- Meta-commentary about the documentation
- Apologies for missing information`;

const USER_PROMPT = `Please bootstrap the wiki by exploring this repository and creating an overview page.

Start by reading README.md, PLAN.md, and package.json (if they exist), then list the source directory structure. Based on what you find, create a comprehensive overview page.`;
