import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { codebaseTools } from '../../services/llm/codebase-tools.js';
import type { ToolContext } from '../../services/llm/tools.js';

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

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('GettingStartedAgent does not run on commits. Use runOnWiki instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    const pages = await context.repos.wikiPages.findByRepo(context.repoId);

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

    // Set up tool context for codebase exploration
    const repoPath = context.git.getRepoPath(context.repoId);
    const toolContext: ToolContext = {
      repoPath,
      maxFileSize: 50000, // 50KB limit per file
    };

    // Create tool executor
    const executeTools = async (calls: Array<{ id: string; name: string; input: Record<string, unknown> }>) => {
      const results = await Promise.all(calls.map(async (call) => {
        const tool = codebaseTools.find(t => t.name === call.name);
        if (!tool) {
          return { id: call.id, result: `Error: Unknown tool "${call.name}"` };
        }
        try {
          const result = await tool.execute(call.input, toolContext);
          return { id: call.id, result };
        } catch (error) {
          return { id: call.id, result: `Error: ${error instanceof Error ? error.message : String(error)}` };
        }
      }));
      return results;
    };

    // Build the prompt
    const prompt = this.buildPrompt(pages.length);

    // Use completeWithTools for agentic exploration
    const completion = await context.llm.completeWithTools({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      tools: codebaseTools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      executeTools,
      maxToolRounds: 5,
      maxTokens: 4000,
    });

    // Use the LLM output directly as markdown content
    const content = completion.content.trim();

    // Extract title from first heading or use default
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1] ?? 'Getting Started';

    const update: WikiPageUpdate = {
      type: 'create',
      path: this.GUIDE_PATH,
      title,
      content,
      sourceCommitId: '',
      agentRunId: '',
      confidenceDelta: 0.7,
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
