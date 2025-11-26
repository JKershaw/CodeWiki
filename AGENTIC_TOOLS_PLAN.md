# Agentic Tools Implementation Plan

## Problem Statement

Currently, CodeWiki agents are "blind" - they only see:
1. **Commit diffs** - what changed, not full file context
2. **Existing wiki pages** - content already generated

This leads to poor quality output like "project purpose cannot be determined" even when README.md clearly explains the project.

## Solution: Tool-Using Agents

Give agents the ability to explore the codebase using tools, following Anthropic's recommended patterns for building effective agents.

## Research Summary

### Anthropic Best Practices (2025)

From [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents):

1. **Start simple** - Add agentic capabilities only when simpler solutions fall short
2. **Augmented LLM** - Combine LLM with retrieval, tools, and memory
3. **Tool design matters** - "We spent more time optimizing tools than the overall prompt"
4. **Agentic loop pattern**: Gather context → Take action → Verify work → Repeat

From [Anthropic SDK Documentation](https://github.com/anthropics/anthropic-sdk-typescript):

1. **Tool definitions** use JSON Schema for input validation
2. **Zod helpers** available via `betaZodTool`
3. **Tool runner** automates the tool call loop
4. **Parallel tool calls** supported for independent operations

### Current CodeWiki Architecture

```
src/services/llm/
├── llm-service.ts         # Interface (completion only, no tools)
├── anthropic-llm-service.ts  # Implementation (uses @anthropic-ai/sdk v0.52.0)
└── mock-llm-service.ts

src/agents/
├── base-agent.ts          # Agent interface (single-shot, no iteration)
├── analysis/              # Commit-focused agents
└── synthesis/             # Wiki-focused agents (project-overview, getting-started)
```

**Gap**: No tool use support. Agents make one LLM call, parse response, return.

## Implementation Plan

### Phase 1: Tool Infrastructure

#### 1.1 Define Tool Interface

```typescript
// src/services/llm/tools.ts

import { z } from 'zod';

export interface ToolDefinition<T = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<T>;
  execute: (input: T, context: ToolContext) => Promise<string>;
}

export interface ToolContext {
  repoPath: string;      // Root of the repository
  maxFileSize?: number;  // Limit file reads
  allowedPaths?: string[]; // Sandbox paths
}

export interface ToolResult {
  toolUseId: string;
  result: string;
  isError: boolean;
}
```

#### 1.2 Implement Core Tools

```typescript
// src/services/llm/codebase-tools.ts

export const readFileTool: ToolDefinition<{ path: string }> = {
  name: 'read_file',
  description: 'Read the contents of a file from the repository. Use for README.md, package.json, source files, etc.',
  inputSchema: z.object({
    path: z.string().describe('Relative path from repository root (e.g., "README.md", "src/index.ts")')
  }),
  execute: async (input, ctx) => {
    const fullPath = path.join(ctx.repoPath, input.path);
    // Security: verify path is within repo
    // Read and return file contents
  }
};

export const searchFilesTool: ToolDefinition<{ pattern: string }> = {
  name: 'search_files',
  description: 'Find files matching a glob pattern. Returns list of matching file paths.',
  inputSchema: z.object({
    pattern: z.string().describe('Glob pattern (e.g., "**/*.md", "src/**/*.ts")')
  }),
  execute: async (input, ctx) => {
    // Use fast-glob to find matching files
    // Return as newline-separated list
  }
};

export const searchContentTool: ToolDefinition<{ query: string; filePattern?: string }> = {
  name: 'search_content',
  description: 'Search for text content across repository files. Returns matching lines with file paths.',
  inputSchema: z.object({
    query: z.string().describe('Text or regex pattern to search for'),
    filePattern: z.string().optional().describe('Optional glob to limit search scope')
  }),
  execute: async (input, ctx) => {
    // Use ripgrep or node-based search
    // Return matches with context
  }
};

export const listDirectoryTool: ToolDefinition<{ path: string }> = {
  name: 'list_directory',
  description: 'List contents of a directory to understand project structure.',
  inputSchema: z.object({
    path: z.string().describe('Directory path relative to repo root (e.g., "src", "docs")')
  }),
  execute: async (input, ctx) => {
    // List directory contents with type indicators
  }
};
```

#### 1.3 Extend LLM Service for Tool Use

```typescript
// src/services/llm/llm-service.ts (extended interface)

export interface ToolUseOptions extends CompletionOptions {
  tools?: ToolDefinition[];
  maxToolRounds?: number;  // Default: 5
}

export interface ToolUseResult extends CompletionResult {
  toolCalls: Array<{
    name: string;
    input: unknown;
    result: string;
  }>;
  totalRounds: number;
}

export interface LLMService {
  complete(options: CompletionOptions): Promise<CompletionResult>;

  // New method for tool-using completions
  completeWithTools(options: ToolUseOptions): Promise<ToolUseResult>;
}
```

#### 1.4 Implement Tool Loop in Anthropic Service

```typescript
// src/services/llm/anthropic-llm-service.ts (extended)

async completeWithTools(options: ToolUseOptions): Promise<ToolUseResult> {
  const tools = options.tools?.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: zodToJsonSchema(t.inputSchema)
  }));

  let messages = [...options.messages];
  let totalRounds = 0;
  const toolCalls: ToolUseResult['toolCalls'] = [];

  while (totalRounds < (options.maxToolRounds ?? 5)) {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options.maxTokens ?? 4000,
      system: options.system,
      messages,
      tools,
    });

    // Check if we're done (no tool use)
    if (response.stop_reason === 'end_turn') {
      return this.buildResult(response, toolCalls, totalRounds);
    }

    // Process tool calls
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) {
      return this.buildResult(response, toolCalls, totalRounds);
    }

    // Execute tools (can be parallel for independent calls)
    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const tool = options.tools?.find(t => t.name === block.name);
        const result = await tool?.execute(block.input, this.toolContext);
        toolCalls.push({ name: block.name, input: block.input, result });
        return { type: 'tool_result', tool_use_id: block.id, content: result };
      })
    );

    // Add assistant response and tool results to messages
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    totalRounds++;
  }

  // Max rounds reached
  return this.buildResult(lastResponse, toolCalls, totalRounds);
}
```

### Phase 2: Upgrade Agents

#### 2.1 Update AgentContext

```typescript
// src/agents/base-agent.ts

export interface AgentContext {
  repoId: string;
  repoPath: string;  // NEW: Physical path to repository
  repos: Repositories;
  git: GitService;
  llm: LLMService;
  tools: ToolDefinition[];  // NEW: Available tools
}
```

#### 2.2 Upgrade Project Overview Agent

```typescript
// src/agents/synthesis/project-overview-agent.ts

async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
  // Use tools to gather real project information
  const completion = await context.llm.completeWithTools({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: this.buildPrompt(pages) }],
    tools: [readFileTool, searchFilesTool, listDirectoryTool],
    maxToolRounds: 5,
    maxTokens: 4000,
  });

  // Agent can now:
  // 1. read_file("README.md") - Get project description
  // 2. read_file("package.json") - Get dependencies, scripts
  // 3. search_files("src/**/index.ts") - Find entry points
  // 4. list_directory("src") - Understand structure
}
```

Update system prompt to instruct tool use:

```typescript
const SYSTEM_PROMPT = `You are creating a project overview for a software project wiki.

You have access to tools to explore the codebase:
- read_file: Read any file (README.md, package.json, source files)
- search_files: Find files matching patterns
- list_directory: See directory structure

WORKFLOW:
1. First, read README.md to understand the project purpose
2. Read package.json for dependencies and scripts
3. List the src/ directory to understand structure
4. Read key entry point files if needed
5. Then synthesize a comprehensive overview

Focus on creating a useful overview that helps developers understand:
- What this project does and why
- How the code is organized
- Key components and their purposes
- Where to start reading the code
`;
```

#### 2.3 Upgrade Getting Started Agent

Similar pattern - can now read:
- `package.json` for actual install/build commands
- `.env.example` for required configuration
- `docs/` directory for existing documentation
- Test files for how to run tests

#### 2.4 Upgrade Code Change Agent (Optional)

Can read full files for better context when analyzing commits:
- Read the complete file, not just the diff
- Understand where changes fit in the broader module
- Find related test files

### Phase 3: Safety & Limits

#### 3.1 Path Sandboxing

```typescript
function validatePath(requestedPath: string, repoRoot: string): string {
  const resolved = path.resolve(repoRoot, requestedPath);
  if (!resolved.startsWith(repoRoot)) {
    throw new Error('Path traversal attempt blocked');
  }
  return resolved;
}
```

#### 3.2 File Size Limits

```typescript
const MAX_FILE_SIZE = 100_000; // 100KB default

async function readFileWithLimit(path: string, maxSize: number): Promise<string> {
  const stats = await fs.stat(path);
  if (stats.size > maxSize) {
    return `[File too large: ${stats.size} bytes, limit is ${maxSize}]`;
  }
  return fs.readFile(path, 'utf-8');
}
```

#### 3.3 Tool Round Limits

- Default `maxToolRounds: 5` prevents infinite loops
- Track total tokens across all rounds for cost control
- Timeout for long-running tool operations

### Phase 4: Cost Tracking

Update cost tracking to account for multi-round conversations:

```typescript
interface ToolUseResult extends CompletionResult {
  // Aggregate across all rounds
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  roundBreakdown: Array<{
    round: number;
    inputTokens: number;
    outputTokens: number;
  }>;
}
```

## Migration Strategy

1. **Non-breaking** - Add `completeWithTools` alongside `complete`
2. **Opt-in per agent** - Agents choose whether to use tools
3. **Gradual rollout**:
   - Start with project-overview (highest impact)
   - Then getting-started
   - Then code-change for enhanced context
4. **Feature flag** - Allow disabling tool use if issues arise

## Testing Strategy

1. **Unit tests** for each tool (mock filesystem)
2. **Integration tests** with real LLM (tool loop execution)
3. **E2E tests** comparing wiki quality with/without tools
4. **Cost monitoring** to ensure tool use doesn't explode costs

## Expected Impact

| Agent | Current Output | With Tools |
|-------|---------------|------------|
| project-overview | "Cannot be determined" | Actual project description from README |
| getting-started | Generic/guessed steps | Real commands from package.json |
| code-change | Diff-only context | Full file understanding |

## Implementation Order

1. `src/services/llm/tools.ts` - Tool interface and types
2. `src/services/llm/codebase-tools.ts` - Core tool implementations
3. `src/services/llm/anthropic-llm-service.ts` - Tool loop support
4. `src/agents/synthesis/project-overview-agent.ts` - First agentic agent
5. `src/agents/synthesis/getting-started-agent.ts` - Second upgrade
6. Tests and validation
7. Documentation

## References

- [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [Building Agents with Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript)
- [Tool Use Documentation](https://platform.claude.com/docs/en/build-with-claude/tool-use/overview)
