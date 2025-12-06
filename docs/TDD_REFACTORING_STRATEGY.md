# TDD Strategy for Tool System Refactoring

**Date:** 2025-12-06
**Related:** AGENT_TOOL_AUDIT.md

## Principles

1. **Test first, always** - Write failing tests before any production code changes
2. **Small steps** - Each change should be independently deployable
3. **Clean as you go** - Delete duplicate code, don't preserve backwards compatibility
4. **Green to green** - All tests must pass before and after each step
5. **Tidy up after** - Each phase ends with cleanup and verification

---

## Phase 1: Characterization Tests (Safety Net)

**Goal:** Capture existing behavior in tests before any changes.

### Step 1.1: Test codebase-tools.ts

```typescript
// tests/unit/codebase-tools.test.ts
describe('codebase-tools', () => {
  describe('readFileTool', () => {
    it('reads file contents within repo boundary');
    it('returns error string for files outside repo');
    it('returns error string for files exceeding size limit');
    it('returns error string for non-existent files');
  });

  describe('searchFilesTool', () => {
    it('finds files matching glob pattern');
    it('returns "No files found" for no matches');
    it('respects .cwignore patterns');
  });

  describe('listDirectoryTool', () => {
    it('lists directory contents with / suffix for dirs');
    it('filters out ignored entries');
    it('returns error for paths outside repo');
  });
});
```

### Step 1.2: Verify all tests pass

```bash
npm run typecheck && npm run test
```

---

## Phase 2: Unify Type Definitions

**Goal:** Single `ToolDefinition` type used everywhere.

### Step 2.1: Update tools.ts with unified types

```typescript
// src/services/llm/tools.ts

export interface ToolContext {
  repoPath: string;
  maxFileSize?: number;
}

export interface WikiToolContext {
  pages: WikiPage[];
  maxContentLength?: number;
}

export interface AnalysisToolContext {
  repos: Repositories;
  repoId: string;
  wikiId: string;
  repoPath?: string;
  repoService?: RepositoryService;
  repo?: Repo;
  benchmarkRuns: BenchmarkRun[];
  qualityBenchmarkRuns: QualityBenchmarkRun[];
  wikiPages: WikiPage[];
}

export interface ToolDefinition<TContext = ToolContext> {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
  execute: (input: Record<string, unknown>, context: TContext) => Promise<string>;
}
```

### Step 2.2: Update wiki-tools.ts - DELETE WikiToolDefinition

- Remove `WikiToolDefinition` interface
- Use `ToolDefinition<WikiToolContext>` directly

### Step 2.3: Update analysis-tools/types.ts - DELETE AnalysisToolDefinition

- Remove `AnalysisToolDefinition` interface
- Use `ToolDefinition<AnalysisToolContext>` directly
- Update all analysis tool files to import from `tools.ts`

### Step 2.4: Cleanup

- Delete any unused type exports
- Run `npm run typecheck && npm run test`

---

## Phase 3: Extract Shared Tool Functionality

**Goal:** Single implementation, delete duplicates.

### Step 3.1: Write tests for base-tools.ts

```typescript
// tests/unit/base-tools.test.ts
describe('base-tools', () => {
  describe('validatePath', () => {
    it('allows paths within repo root');
    it('throws for paths outside repo root');
    it('handles path traversal attempts');
  });

  describe('createReadFileTool', () => {
    it('reads files with size limit');
    it('supports markdown formatting option');
    it('supports GitHub API fallback');
  });

  describe('createSearchFilesTool', () => {
    it('finds files matching glob');
    it('respects maxResults option');
  });

  describe('createListDirectoryTool', () => {
    it('lists directory contents');
    it('supports markdown formatting option');
  });
});
```

### Step 3.2: Create base-tools.ts

```typescript
// src/services/llm/base-tools.ts

export interface BaseToolOptions {
  maxFileSize?: number;
  maxResults?: number;
  formatOutput?: boolean;
}

export function validatePath(requestedPath: string, repoRoot: string): string {
  // Single implementation
}

export function createReadFileTool<T>(options?: BaseToolOptions): ToolDefinition<T> {
  // Unified implementation with options
}

export function createSearchFilesTool<T>(options?: BaseToolOptions): ToolDefinition<T> {
  // Unified implementation with options
}

export function createListDirectoryTool<T>(options?: BaseToolOptions): ToolDefinition<T> {
  // Unified implementation with options
}
```

### Step 3.3: Simplify codebase-tools.ts

```typescript
// src/services/llm/codebase-tools.ts
import { createReadFileTool, createSearchFilesTool, createListDirectoryTool } from './base-tools.js';

export const readFileTool = createReadFileTool({ maxFileSize: 100_000 });
export const searchFilesTool = createSearchFilesTool();
export const listDirectoryTool = createListDirectoryTool();
export const codebaseTools = [readFileTool, searchFilesTool, listDirectoryTool];
```

### Step 3.4: DELETE source-tools.ts duplication

- Update `analysis-tools/source-tools.ts` to use base-tools
- Or DELETE it entirely if codebase-tools can be reused with options

### Step 3.5: Cleanup agent-helpers.ts

- Remove inline tool definitions in `createApiCodebaseTools()`
- Remove duplicate `filterByGlob()` function
- Use base-tools directly

### Step 3.6: Verify and tidy

```bash
npm run typecheck && npm run test
```

- Delete any dead code
- Remove unused imports

---

## Phase 4: Add Tool Support to More Agents

**Goal:** Security, pattern, technical-debt agents use tools.

### Step 4.1: Add tools to SecurityAgent

```typescript
// src/agents/analysis/security-agent.ts

import { createCodebaseToolExecutor } from '../agent-helpers.js';

// In runOnCommit():
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
  maxTokens: 2500,
  temperature: 0.2,
});
```

Update SYSTEM_PROMPT to include tool usage instructions.

### Step 4.2: Add tools to PatternAgent

Same pattern as SecurityAgent.

### Step 4.3: Add tools to TechnicalDebtAgent

Same pattern as SecurityAgent.

### Step 4.4: Verify

```bash
npm run typecheck && npm run test
```

---

## Phase 5: Standardize Configurations and Final Cleanup

**Goal:** Centralize all config, final tidy up.

### Step 5.1: Create tool-config.ts

```typescript
// src/config/tool-config.ts

export const TOOL_DEFAULTS = {
  maxFileSize: 100_000,
  maxSearchResults: 50,
  maxContentLength: 4000,
  diffTruncationLimit: 10_000,
} as const;

export const AGENT_DEFAULTS = {
  'code-change': { maxTokens: 3000, temperature: 0.3, maxToolRounds: 5 },
  'security': { maxTokens: 2500, temperature: 0.2, maxToolRounds: 3 },
  'pattern': { maxTokens: 3500, temperature: 0.3, maxToolRounds: 3 },
  'technical-debt': { maxTokens: 2500, temperature: 0.3, maxToolRounds: 3 },
} as const;
```

### Step 5.2: Update all files to use config

Replace all hardcoded values with config imports.

### Step 5.3: Final cleanup checklist

- [ ] Delete `analysis-tools/source-tools.ts` if fully replaced
- [ ] Delete `WikiToolDefinition` type alias
- [ ] Delete `AnalysisToolDefinition` type alias
- [ ] Remove `validateSourcePath` (use `validatePath`)
- [ ] Remove duplicate `filterByGlob` from agent-helpers
- [ ] Remove inline API tools from agent-helpers
- [ ] Update all imports to use unified locations
- [ ] Remove any unused exports from index files

### Step 5.4: Final verification

```bash
npm run typecheck && npm run test && npm run test:e2e
```

---

## Files to Delete

After refactoring:
- `src/services/llm/analysis-tools/source-tools.ts` (if fully replaced by base-tools)
- Duplicate type definitions
- Unused helper functions

## Files to Create

- `tests/unit/codebase-tools.test.ts`
- `tests/unit/base-tools.test.ts`
- `src/services/llm/base-tools.ts`
- `src/config/tool-config.ts`

## Files to Modify

- `src/services/llm/tools.ts` - Add unified context types
- `src/services/llm/codebase-tools.ts` - Simplify to use base-tools
- `src/services/llm/wiki-tools.ts` - Remove duplicate type
- `src/services/llm/analysis-tools/types.ts` - Remove duplicate type
- `src/agents/agent-helpers.ts` - Remove duplicates, use base-tools
- `src/agents/analysis/security-agent.ts` - Add tool support
- `src/agents/analysis/pattern-agent.ts` - Add tool support
- `src/agents/analysis/technical-debt-agent.ts` - Add tool support

---

## Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| Duplicate tool implementations | 3 | 0 |
| Duplicate type definitions | 3 | 1 |
| Agents with tool support | 1 | 4 |
| Files with hardcoded limits | 8+ | 0 |
| Tool test coverage | ~30% | >80% |
