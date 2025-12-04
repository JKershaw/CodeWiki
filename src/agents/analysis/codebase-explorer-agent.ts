import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isPathTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import {
  createListWikiPagesQuery,
  handleListWikiPages,
} from '../../queries/index.js';
import { createCodebaseToolExecutor } from '../agent-helpers.js';

/**
 * Codebase Explorer Agent - Documents undocumented parts of the codebase.
 *
 * Unlike analysis agents that run on commits, this agent runs on a specific
 * directory or file path. It explores the code structure and creates wiki
 * documentation for parts of the codebase that haven't been touched by commits.
 *
 * This agent addresses the "coverage plateau" problem where commit-driven
 * analysis never documents stable, foundational code that hasn't changed.
 */
export class CodebaseExplorerAgent implements Agent {
  readonly type: AgentType = 'codebase-explorer';

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isPathTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isPathTarget(target)) {
      throw new Error(`CodebaseExplorerAgent cannot handle target type: ${target.type}`);
    }
    return this.runOnPathImpl(target.path, context);
  }

  /**
   * @deprecated Use run() with PathTarget instead
   */
  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('CodebaseExplorerAgent does not run on commits. Use run() with PathTarget instead.');
  }

  /**
   * @deprecated Use run() with PathTarget instead
   */
  async runOnPath(targetPath: string, context: AgentContext): Promise<AgentRunResult> {
    return this.runOnPathImpl(targetPath, context);
  }

  private async runOnPathImpl(targetPath: string, context: AgentContext): Promise<AgentRunResult> {
    // Check existing wiki pages to avoid duplication
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const existingPages = pagesResult.data || [];
    const existingPagePaths = existingPages.map(p => p.path);
    const existingContent = existingPages.map(p => p.content.toLowerCase()).join('\n');

    // Build the prompt for the LLM
    const prompt = this.buildPrompt(targetPath, existingPagePaths, existingContent);

    // Set up codebase exploration tools (works with both local and GitHub repos)
    const toolExecutor = createCodebaseToolExecutor(context);

    // Get LLM analysis with tool use for deep exploration
    const completion = await context.llm.completeWithTools({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      tools: toolExecutor?.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })) ?? [],
      executeTools: toolExecutor?.executeTools ?? (async () => []),
      maxToolRounds: 10, // Allow more exploration for directories
      maxTokens: 4000,
      temperature: 0.3,
    });

    // Parse the LLM response
    const analysis = this.parseResponse(completion.content);

    // Generate wiki updates based on the analysis
    const updates = this.generateUpdates(targetPath, analysis, existingPagePaths);

    // Include tool usage in findings
    const filesRead = completion.toolCalls
      .filter(c => c.name === 'read_file')
      .map(c => c.input['path'] as string)
      .filter(Boolean);

    const toolUsageFinding = completion.toolCalls.length > 0
      ? [createFinding({
          type: 'EXPLORATION',
          description: `Explored ${filesRead.length} source files in ${targetPath}`,
          relatedPaths: filesRead,
          importance: 'low',
        })]
      : [];

    return {
      result: createAgentResult({
        summary: analysis.summary,
        findings: [
          ...analysis.findings.map(f => createFinding({
            type: f.type,
            description: f.description,
            relatedPaths: f.paths,
            importance: f.importance,
          })),
          ...toolUsageFinding,
        ],
        confidence: analysis.confidence,
      }),
      updates,
      costUsd: completion.costUsd,
    };
  }

  private buildPrompt(
    targetPath: string,
    existingPagePaths: string[],
    _existingContent: string
  ): string {
    const existingPagesInfo = existingPagePaths.length > 0
      ? `\n\n## Existing Wiki Pages (avoid duplication)\n${existingPagePaths.slice(0, 20).map(p => `- ${p}`).join('\n')}`
      : '';

    return `Document the undocumented code in: ${targetPath}

This directory/file has low wiki coverage, meaning the wiki doesn't have good documentation about it.

Your task:
1. Use list_directory to understand the structure
2. Use read_file to read the key files (index.ts, main implementations, interfaces)
3. Use search_files to find related tests and usage examples
4. Create comprehensive wiki documentation

Focus on:
- What this code does and its purpose in the system
- Key interfaces, types, and abstractions
- Important functions and their responsibilities
- How this code fits into the larger architecture
- Usage patterns and examples (especially from tests)
- Configuration options and extension points
${existingPagesInfo}

IMPORTANT: Check what documentation already exists. Don't create pages that duplicate existing content.
If a topic is already covered, either skip it or create a page that adds new information.

Format your response as follows:

SUMMARY:
[2-3 paragraph overview of what you found in this part of the codebase]

FINDINGS:
- [TYPE] [IMPORTANCE:low/medium/high] [Description] [Related paths comma-separated]

WIKI_PAGES:
---PAGE---
PATH: [category/page-name]
TITLE: [Descriptive title]
CONTENT:
[Full markdown content for this wiki page, including headings, code examples, etc.]
---END_PAGE---

(You can include multiple ---PAGE--- blocks if the code area needs multiple pages)

CONFIDENCE: [0-1 value]

Guidelines for wiki pages:
- Use lowercase paths with hyphens (e.g., "services/llm-service", "architecture/cqrs")
- Write in encyclopedia style, not as documentation of exploration
- Include code examples from actual tests when available
- Explain WHY the code exists and how it fits the system
- Each page should be 200-500 words minimum
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const analysis: ParsedAnalysis = {
      summary: '',
      findings: [],
      wikiPages: [],
      confidence: 0.7,
    };

    // Parse summary
    const summaryMatch = response.match(/SUMMARY:\s*([\s\S]*?)(?=FINDINGS:|$)/i);
    if (summaryMatch) {
      analysis.summary = summaryMatch[1]!.trim();
    }

    // Parse findings
    const findingsMatch = response.match(/FINDINGS:\s*([\s\S]*?)(?=WIKI_PAGES:|CONFIDENCE:|$)/i);
    if (findingsMatch) {
      const findingLines = findingsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of findingLines) {
        const match = line.match(/^-\s*\[([^\]]+)\]\s*\[IMPORTANCE:(\w+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i);
        if (match) {
          analysis.findings.push({
            type: match[1]!.trim(),
            importance: (match[2]!.toLowerCase() as 'low' | 'medium' | 'high'),
            description: match[3]!.trim(),
            paths: match[4]?.split(',').map(p => p.trim()).filter(p => p) ?? [],
          });
        }
      }
    }

    // Parse wiki pages (can be multiple)
    const pagesSection = response.match(/WIKI_PAGES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (pagesSection) {
      const pageBlocks = pagesSection[1]!.split('---PAGE---').filter(b => b.trim());

      for (const block of pageBlocks) {
        const cleanBlock = block.replace(/---END_PAGE---/g, '').trim();
        if (!cleanBlock) continue;

        const pathMatch = cleanBlock.match(/PATH:\s*(.+?)(?:\n|$)/i);
        const titleMatch = cleanBlock.match(/TITLE:\s*(.+?)(?:\n|$)/i);
        const contentMatch = cleanBlock.match(/CONTENT:\s*([\s\S]*?)$/i);

        if (pathMatch && contentMatch) {
          analysis.wikiPages.push({
            path: pathMatch[1]!.trim(),
            title: titleMatch?.[1]?.trim() ?? pathToTitle(pathMatch[1]!.trim()),
            content: contentMatch[1]!.trim(),
          });
        }
      }
    }

    // Parse confidence
    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    if (confidenceMatch) {
      analysis.confidence = parseFloat(confidenceMatch[1]!);
    }

    return analysis;
  }

  private generateUpdates(
    targetPath: string,
    analysis: ParsedAnalysis,
    existingPagePaths: string[]
  ): WikiPageUpdate[] {
    const updates: WikiPageUpdate[] = [];
    const existingPathsSet = new Set(existingPagePaths.map(p => p.toLowerCase()));

    for (const page of analysis.wikiPages) {
      // Skip if a similar page already exists
      if (existingPathsSet.has(page.path.toLowerCase())) {
        console.log(`Skipping wiki page ${page.path} - similar page already exists`);
        continue;
      }

      // Add source attribution to the content
      const contentWithAttribution = `${page.content}

---
*Documentation generated by codebase-explorer from \`${targetPath}\`*
`;

      updates.push({
        type: 'create',
        path: page.path,
        title: page.title,
        content: contentWithAttribution,
        // sourceCommitId omitted - this is exploration-based, not commit-based
        agentRunId: '', // Will be set by the executor
        confidenceDelta: 0.3, // New content from exploration
      });
    }

    return updates;
  }
}

interface ParsedAnalysis {
  summary: string;
  findings: Array<{
    type: string;
    importance: 'low' | 'medium' | 'high';
    description: string;
    paths: string[];
  }>;
  wikiPages: Array<{
    path: string;
    title: string;
    content: string;
  }>;
  confidence: number;
}

/**
 * Convert a path like "services/llm-service" to a title like "LLM Service".
 */
function pathToTitle(path: string): string {
  const lastPart = path.split('/').pop() ?? path;
  return lastPart
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const SYSTEM_PROMPT = `You are a technical documentation writer exploring and documenting a codebase.

You have access to tools to explore the source code:
- read_file: Read the FULL contents of any file
- search_files: Find related files by glob pattern (e.g., find test files)
- list_directory: Understand project structure

WORKFLOW - Systematically explore the target area:
1. Start with list_directory to understand the structure
2. Read index.ts or main entry points first
3. Read key interfaces and types
4. Search for and read related test files for usage examples
5. Read important implementations
6. Create comprehensive documentation

TEST-BASED EXAMPLES - Always look for tests:
When documenting a module, search for test files (*.test.ts, *.spec.ts) and extract
real usage examples. Test code shows how the component is actually used.

CRITICAL: Write as encyclopedia articles.
- Describe WHAT EXISTS and WHY it exists
- Explain how components fit into the larger system
- Include practical code examples (preferably from tests)
- Help developers understand and use the code

Your documentation should:
- Be comprehensive but focused
- Include code examples and interface definitions
- Explain architectural decisions and patterns
- Be useful to a developer trying to understand the codebase

When creating wiki pages:
- Use lowercase paths with hyphens (e.g., "services/llm-service")
- Group related content by category
- Create separate pages for major components (don't cram everything into one)
- Each page should have a clear focus

Your confidence should reflect:
- 0.9+: Clear implementation, comprehensive exploration, well-documented
- 0.7-0.9: Good understanding but some parts unclear
- 0.5-0.7: Partial understanding, might need more exploration
- <0.5: Limited visibility, needs review`;
