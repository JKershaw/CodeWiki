import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';
import { createCodebaseToolExecutor } from '../agent-helpers.js';

/**
 * Extension Guide Agent - Creates documentation for extending the codebase.
 *
 * This agent uses tools to explore the actual codebase and create a practical
 * "extension patterns" guide at guides/extension-patterns.md. It identifies
 * common patterns for adding new features (new agents, API endpoints, components, etc.)
 * and documents how to follow those patterns.
 *
 * Trigger: When wiki has 15+ pages but no guides/extension-patterns page.
 */
export class ExtensionGuideAgent implements Agent {
  readonly type: AgentType = 'extension-guide';

  private readonly MIN_PAGES_FOR_GUIDE = 15;
  private readonly GUIDE_PATH = 'guides/extension-patterns';

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isWikiTarget(target)) {
      throw new Error(`ExtensionGuideAgent cannot handle target type: ${target.type}`);
    }
    return this.runOnWiki(context);
  }

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('ExtensionGuideAgent does not run on commits. Use runOnWiki instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    // Get wiki pages via CQRS query
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const pages = pagesResult.data || [];

    // Check if we have enough pages
    if (pages.length < this.MIN_PAGES_FOR_GUIDE) {
      return {
        result: createAgentResult({
          summary: `Wiki has ${pages.length} pages, need ${this.MIN_PAGES_FOR_GUIDE}+ for extension guide`,
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
      p.path === 'guides/extending' ||
      p.path === 'guides/adding-features' ||
      p.path === 'guides/patterns'
    );

    if (hasGuide) {
      return {
        result: createAgentResult({
          summary: 'Extension patterns guide already exists',
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
      maxToolRounds: 7, // More rounds for deeper exploration
      maxTokens: 5000,
    });

    // Use the LLM output directly as markdown content
    const content = completion.content.trim();

    // Extract title from first heading or use default
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1] ?? 'Extension Patterns';

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
        summary: `Created extension patterns guide from ${pages.length} wiki pages and ${completion.toolCalls.length} source file reads`,
        findings: [
          createFinding({
            type: 'SYNTHESIS',
            description: 'Generated extension patterns guide documenting how to add new features',
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
    return `Create an "Extension Patterns" guide that documents how to add new features to this project.

## Context
The wiki has ${totalPages} pages of documentation about this project.

## Instructions

Use tools to explore the ACTUAL codebase and identify extension patterns:

1. **Explore the project structure** - Understand how code is organized
2. **Find repeating patterns** - Look for similar files that follow a pattern:
   - Multiple agents/handlers/controllers with similar structure
   - Multiple components/modules following the same template
   - Registration patterns (how things get "plugged in")
3. **Read representative examples** - Find the simplest, clearest examples of each pattern
4. **Find index files or registries** - Where do new features get registered?
5. **Look for interfaces/base classes** - What contracts must new features implement?

After exploring, write a practical extension guide in Markdown.

## Output Format

Write the guide starting with:

# Extension Patterns

[1-2 sentence intro about extending this codebase]

## Overview

Brief explanation of the extension points in this project.

## Pattern 1: Adding a New [Thing]

### When to Use

When you need to...

### Files to Create

| File | Purpose |
|------|---------|
| \`path/to/new-thing.ts\` | Main implementation |
| ... | ... |

### Step-by-Step

1. Create the new file at \`path/to/new-thing.ts\`

\`\`\`typescript
// Template based on existing examples
\`\`\`

2. Register it in \`path/to/registry.ts\`

\`\`\`typescript
// How to register
\`\`\`

3. Any additional steps

### Example: [Existing Example]

Point to an existing simple example they can reference.

## Pattern 2: Adding a New [Other Thing]

(Repeat the same structure)

## Common Interfaces

Document key interfaces that new features must implement.

\`\`\`typescript
interface Thing {
  // From the actual codebase
}
\`\`\`

## Where Things Live

| Type | Directory | Naming Convention |
|------|-----------|-------------------|
| Agents | \`src/agents/\` | \`*-agent.ts\` |
| ... | ... | ... |

## Checklist for New Features

- [ ] Created the main implementation file
- [ ] Implemented required interface
- [ ] Registered in appropriate location
- [ ] Added tests (if applicable)
- [ ] Updated exports (if applicable)

---

Output ONLY the markdown content. No explanations before or after.
Be specific - use actual file names, actual patterns, actual code from what you read.
Focus on the 2-4 most common extension patterns in this codebase.
`;
  }
}

const SYSTEM_PROMPT = `You are a technical writer creating an "Extension Patterns" guide for developers.

You have tools to explore the actual codebase:
- read_file: Read any file (source files, config files)
- search_files: Find files matching patterns (e.g., "*-agent.ts", "*-controller.ts")
- list_directory: See directory structure

IMPORTANT: Use these tools to find REAL patterns. Do NOT guess or make up:
- Patterns that don't exist in the codebase
- File paths that don't exist
- Interfaces that don't exist

WORKFLOW:
1. List the main source directories to understand structure
2. Search for groups of similar files (agents, handlers, controllers, components, etc.)
3. Read 2-3 examples of each pattern you find
4. Look for registration/index files where things get "plugged in"
5. Find base classes or interfaces that define the contracts

Then write a guide with ONLY patterns you've verified from the source files.

A good extension patterns guide:
- Documents REAL patterns from this codebase (not generic patterns)
- Shows actual file paths and naming conventions
- Includes real code examples (simplified if needed)
- Explains the registration/wiring process
- Points to simple existing examples developers can reference

Write in a direct, practical style. Think "recipe book" - step-by-step instructions.
Focus on: How do I add a new [X] to this project?

Common patterns to look for:
- Plugin/Agent patterns (similar classes implementing an interface)
- API endpoints/routes
- Components/modules
- Commands/handlers
- Repositories/services`;
