import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate, SynthesisType } from '../../domain/wiki-page.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';
import { createCodebaseToolExecutor } from '../agent-helpers.js';
import { extractLinksFromContent } from '../../utils/link-extraction.js';

/**
 * Testing Guide Agent - Creates a testing documentation guide.
 *
 * This agent uses tools to explore the actual codebase and create a practical
 * "testing" guide at guides/testing.md. It reads package.json for test commands,
 * explores test directories, finds testing frameworks, and documents testing patterns.
 *
 * Trigger: When wiki has 15+ pages but no guides/testing page.
 */
export class TestingGuideAgent implements Agent {
  readonly type: AgentType = 'testing-guide';

  private readonly MIN_PAGES_FOR_GUIDE = 15;
  private readonly GUIDE_PATH = 'guides/testing';

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isWikiTarget(target)) {
      throw new Error(`TestingGuideAgent cannot handle target type: ${target.type}`);
    }

    // Get wiki pages via CQRS query
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const pages = pagesResult.data || [];

    // Check if we have enough pages
    if (pages.length < this.MIN_PAGES_FOR_GUIDE) {
      return {
        result: createAgentResult({
          summary: `Wiki has ${pages.length} pages, need ${this.MIN_PAGES_FOR_GUIDE}+ for testing guide`,
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Check if a proper synthesis guide already exists (has synthesisType)
    // If an exploration page exists at the path but without synthesisType, we should UPDATE it
    const existingGuide = pages.find(p =>
      p.path === this.GUIDE_PATH ||
      p.path === 'guides/tests' ||
      p.path === 'guides/testing-guide'
    );
    const hasSynthesisGuide = existingGuide?.synthesisType === 'testing-guide';

    if (hasSynthesisGuide) {
      return {
        result: createAgentResult({
          summary: 'Testing guide already exists with proper synthesis',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Determine if we're creating or updating
    const isUpdate = !!existingGuide;

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
    const title = titleMatch?.[1] ?? 'Testing Guide';

    // Extract links from the generated content for graph tracking
    const links = extractLinksFromContent(content);

    const update: WikiPageUpdate = {
      type: isUpdate ? 'update' : 'create',
      path: this.GUIDE_PATH,
      title,
      content,
      sourceCommitId: '',
      agentRunId: '',
      confidenceDelta: 0.7,
      links,
      synthesisType: 'testing-guide' as SynthesisType,
    };

    const action = isUpdate ? 'Updated' : 'Created';
    return {
      result: createAgentResult({
        summary: `${action} testing guide from ${pages.length} wiki pages and ${completion.toolCalls.length} source file reads`,
        findings: [
          createFinding({
            type: 'SYNTHESIS',
            description: `${action} testing guide documenting test frameworks, patterns, and conventions`,
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
    return `Create a "Testing Guide" for developers working on this project.

## Context
The wiki has ${totalPages} pages of documentation about this project.

## Instructions

Use tools to explore the ACTUAL codebase and understand the testing setup:

1. **Read package.json** - Get test scripts (test, test:watch, test:coverage, etc.)
2. **Find test configuration files** - Look for jest.config.js, vitest.config.ts, .mocharc, pytest.ini, etc.
3. **Explore test directories** - Look for __tests__, tests/, test/, spec/, *.test.ts, *.spec.ts patterns
4. **Read sample test files** - Understand the testing patterns and conventions used
5. **Check for test utilities** - Look for test helpers, mocks, fixtures, factories

After exploring, write a practical testing guide in Markdown.

## Output Format

Write the guide starting with:

# Testing Guide

[1-2 sentence intro about the testing approach]

## Quick Start

\`\`\`bash
# Most common test commands
\`\`\`

## Testing Framework

- Framework name and version
- Why this framework was chosen (if apparent)
- Key concepts or patterns

## Running Tests

| Command | Description |
|---------|-------------|
| \`npm test\` | What it does |
| ... | ... |

### Watch Mode

How to run tests in watch mode.

### Coverage

How to generate and view coverage reports.

## Test Organization

\`\`\`
project/
  src/
    feature/
      feature.ts
      feature.test.ts   # or __tests__/feature.test.ts
\`\`\`

Explain where tests live and the naming conventions.

## Writing Tests

### Basic Test Structure

\`\`\`typescript
// Example from the actual codebase
\`\`\`

### Common Patterns

- Pattern 1: How it's used
- Pattern 2: How it's used

### Test Utilities

List any test helpers, mocks, or utilities available.

## Test Types

### Unit Tests
Where they are, what they test.

### Integration Tests
Where they are, what they test (if applicable).

### End-to-End Tests
Where they are, how to run them (if applicable).

## Best Practices

Based on patterns observed in the codebase.

---

Output ONLY the markdown content. No explanations before or after.
Be specific - use actual file names, actual commands, actual patterns from what you read.
`;
  }
}

const SYSTEM_PROMPT = `You are a technical writer creating a "Testing Guide" for developers.

You have tools to explore the actual codebase:
- read_file: Read any file (package.json, config files, test files)
- search_files: Find files matching patterns (e.g., "*.test.ts", "jest.config.*")
- list_directory: See directory structure

IMPORTANT: Use these tools to find REAL information. Do NOT guess or make up:
- Test frameworks that aren't actually used
- Commands that don't exist in package.json
- File structures you haven't verified

WORKFLOW:
1. Read package.json first - find test scripts and testing dependencies
2. Search for test config files (jest.config.*, vitest.config.*, etc.)
3. Find test directories and test files
4. Read a few representative test files to understand patterns
5. Look for test utilities, mocks, or fixtures

Then write a guide with ONLY information you've verified from the source files.

A good testing guide:
- Has actual commands that work (from package.json scripts)
- Shows real test patterns (from actual test files)
- Documents the actual project structure
- Explains conventions used in THIS codebase

Write in a direct, practical style. Use code blocks for commands and examples.
Focus on: How do developers actually test this project?`;
