import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate, SynthesisType } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';
import { createCodebaseToolExecutor } from '../agent-helpers.js';
import { extractLinksFromContent } from '../../utils/link-extraction.js';

/**
 * Getting Started Agent - Creates entry point documentation for new developers.
 *
 * This agent uses tools to explore the actual codebase and create a practical
 * "getting started" guide at guides/getting-started.md. It reads package.json
 * for real commands, explores the directory structure, and finds actual entry points.
 *
 * Trigger: When wiki has 10+ pages but no guides/getting-started page.
 */
export class GettingStartedAgent implements Agent {
  readonly type: AgentType = 'getting-started';

  private readonly MIN_PAGES_FOR_GUIDE = 10;
  private readonly GUIDE_PATH = 'guides/getting-started';

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isWikiTarget(target)) {
      throw new Error(`GettingStartedAgent cannot handle target type: ${target.type}`);
    }

    // Get wiki pages via CQRS query
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const pages = pagesResult.data || [];

    // Check if we have enough pages
    if (pages.length < this.MIN_PAGES_FOR_GUIDE) {
      return {
        result: createAgentResult({
          summary: `Wiki has ${pages.length} pages, need ${this.MIN_PAGES_FOR_GUIDE}+ for getting started guide`,
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Check if guide already exists
    const hasGuide = pages.some(p =>
      p.path === this.GUIDE_PATH ||
      p.path === 'guides/quickstart' ||
      p.path === 'guides/index'
    );

    if (hasGuide) {
      return {
        result: createAgentResult({
          summary: 'Getting started guide already exists',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Set up codebase exploration tools (works with both local and GitHub repos)
    const toolExecutor = createCodebaseToolExecutor(context);

    // Build the prompt
    const prompt = this.buildPrompt(pages.length);

    // Use completeWithTools for agentic exploration
    const completion = await context.llm.completeWithTools({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      tools: toolExecutor?.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })) ?? [],
      executeTools: toolExecutor?.executeTools ?? (async () => []),
      maxToolRounds: 5,
      maxTokens: 4000,
    });

    // Use the LLM output directly as markdown content
    const content = completion.content.trim();

    // Extract title from first heading or use default
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1] ?? 'Getting Started';

    // Extract links from the generated content for graph tracking
    const links = extractLinksFromContent(content);

    const update: WikiPageUpdate = {
      type: 'create',
      path: this.GUIDE_PATH,
      title,
      content,
      sourceCommitId: '',
      agentRunId: '',
      confidenceDelta: 0.7,
      links,
      synthesisType: 'getting-started' as SynthesisType,
    };

    return {
      result: createAgentResult({
        summary: `Created getting started guide from ${pages.length} wiki pages and ${completion.toolCalls.length} source file reads`,
        findings: [
          createFinding({
            type: 'SYNTHESIS',
            description: 'Generated getting started guide for new developers',
            relatedPaths: [this.GUIDE_PATH],
            importance: 'high',
          }),
          createFinding({
            type: 'TOOL_USE',
            description: `Used ${completion.toolCalls.length} tool calls to explore codebase`,
            relatedPaths: [],
            importance: 'medium',
          }),
        ],
        confidence: 0.8,
      }),
      updates: [update],
      costUsd: completion.costUsd,
    };
  }

  private buildPrompt(totalPages: number): string {
    return `Create a "Getting Started" guide for new developers.

## Context
The wiki has ${totalPages} pages of documentation about this project.

## Instructions

Use tools to explore the ACTUAL codebase:

1. **Read package.json** - Get the real project name, scripts (build, test, start), and dependencies
2. **List the src/ directory** - See the actual project structure
3. **Read README.md** - Find any existing setup instructions
4. **Look for config files** - Check for .env.example, tsconfig.json, etc.
5. **Find the entry point** - Read src/index.ts or src/cli.ts or similar

After exploring, write a practical getting started guide in Markdown.

## Output Format

Write the guide starting with:

# Getting Started

[1-2 sentence intro]

## Prerequisites

- List actual requirements (Node version from package.json, etc.)

## Installation

\`\`\`bash
# Actual commands from package.json
\`\`\`

## Project Structure

\`\`\`
actual/
  directory/
    structure/
\`\`\`

Brief explanation of each main directory.

## Running the Project

Actual commands from package.json scripts.

## Key Files to Understand

- **\`actual/path/to/file.ts\`**: Why it matters
- List real files you found

## Common Commands

| Command | Description |
|---------|-------------|
| \`npm run X\` | What it does |

## Next Steps

Links to other wiki pages if they exist.

---

Output ONLY the markdown content. No explanations before or after.
Be specific - use actual file names, actual commands, actual paths from what you read.
`;
  }
}

const SYSTEM_PROMPT = `You are a technical writer creating a "Getting Started" guide.

You have tools to explore the actual codebase:
- read_file: Read any file (package.json, README.md, source files)
- search_files: Find files matching patterns (e.g., "*.config.js")
- list_directory: See directory structure

IMPORTANT: Use these tools to find REAL information. Do NOT guess or make up:
- File paths that don't exist
- Commands that aren't in package.json
- Directory structures you haven't verified

WORKFLOW:
1. Read package.json first - it has project name, scripts, dependencies
2. List src/ to understand the structure
3. Read README.md if it exists
4. Check for .env.example or config files
5. Look at the main entry point

Then write a guide with ONLY information you've verified from the source files.

A good getting started guide:
- Has actual commands that work (from package.json scripts)
- Lists real file paths (that you've seen)
- Shows the actual project structure (from list_directory)
- Includes real prerequisites (from package.json engines, dependencies)

Write in a direct, practical style. Use code blocks for commands.
Focus on: What does someone ACTUALLY need to do to get started?`;
