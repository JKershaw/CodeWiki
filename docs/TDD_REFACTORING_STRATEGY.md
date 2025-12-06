# TDD Strategy for Tool System Refactoring

**Date:** 2025-12-06
**Related:** AGENT_TOOL_AUDIT.md

## Principles

1. **Test first, always** - Write failing tests before any production code changes
2. **Small steps** - Each change should be independently deployable
3. **Backwards compatibility** - Never break existing consumers during migration
4. **Green to green** - All tests must pass before and after each step
5. **One thing at a time** - Fix one category of issues per phase

---

## Dependency Risk Assessment

Based on dependency analysis, refactoring risk levels:

| Module | Risk | Reason |
|--------|------|--------|
| `tools.ts` | LOW | Pure types, easy to extend |
| `wiki-tools.ts` | LOW | Only 1 consumer (research-agent) |
| `analysis-tools/` | LOW | Modular, 2 consumers |
| `codebase-tools.ts` | MEDIUM | Multiple direct consumers |
| `agent-helpers.ts` | HIGH | 12+ agent dependencies |

**Strategy:** Start with LOW risk modules, build confidence, then tackle higher risk.

---

## Phase 1: Characterization Tests (Safety Net)

**Goal:** Ensure existing behavior is captured in tests before any changes.

**Risk:** None - only adding tests, no production changes.

### Step 1.1: Test codebase-tools.ts (CRITICAL GAP)

```typescript
// tests/unit/codebase-tools.test.ts
describe('codebase-tools', () => {
  describe('readFileTool', () => {
    it('reads file contents within repo boundary');
    it('returns error string for files outside repo');
    it('returns error string for files exceeding size limit');
    it('returns error string for non-existent files');
    it('uses context.maxFileSize when provided');
    it('uses DEFAULT_MAX_FILE_SIZE when not provided');
  });

  describe('searchFilesTool', () => {
    it('finds files matching glob pattern');
    it('returns "No files found" for no matches');
    it('respects .cwignore patterns');
    it('returns error string on glob errors');
  });

  describe('listDirectoryTool', () => {
    it('lists directory contents with / suffix for dirs');
    it('filters out ignored entries');
    it('returns error for paths outside repo');
    it('returns error for non-existent directories');
  });

  describe('validatePath', () => {
    it('allows paths within repo root');
    it('throws for paths outside repo root');
    it('handles relative path traversal attempts');
  });
});
```

**Test doubles needed:**
- Mock filesystem (use memfs or mock fs/promises)
- Mock .cwignore file

### Step 1.2: Test source-tools.ts (Verify duplication)

```typescript
// tests/unit/source-tools.test.ts
describe('source-tools', () => {
  describe('readSourceFileTool', () => {
    // Same tests as codebase-tools BUT:
    it('falls back to GitHub API when repoPath not available');
    it('formats output with markdown headers');
    it('handles ENOENT with specific message');
    it('handles EACCES with specific message');
  });

  describe('searchSourceFilesTool', () => {
    it('limits results to 50 files');
    it('shows truncation message when over limit');
    // ... similar to codebase-tools
  });
});
```

### Step 1.3: Test agent tool integration patterns

```typescript
// tests/integration/agent-tool-integration.test.ts
describe('agent tool integration', () => {
  describe('CodeChangeAgent', () => {
    it('calls createCodebaseToolExecutor');
    it('passes tools to completeWithTools');
    it('includes tool calls in findings');
  });

  describe('SecurityAgent', () => {
    it('does NOT use tools (current behavior)');
    it('uses complete() not completeWithTools()');
  });
});
```

### Step 1.4: Verify test coverage

```bash
npm run test -- --coverage
```

**Exit criteria:** All new tests pass, coverage increased for tool modules.

---

## Phase 2: Unify Type Definitions

**Goal:** Single source of truth for tool types with backwards compatibility.

**Risk:** LOW - type changes are compile-time only.

### Step 2.1: Write tests for unified types

```typescript
// tests/unit/tool-types.test.ts
describe('unified tool types', () => {
  it('ToolDefinition is compatible with existing codebase-tools');
  it('ToolDefinition is compatible with existing wiki-tools');
  it('ToolDefinition is compatible with existing analysis-tools');
  it('ToolContext can be extended for specialized contexts');
});
```

### Step 2.2: Extend tools.ts (additive only)

```typescript
// src/services/llm/tools.ts

// EXISTING (unchanged)
export interface ToolContext {
  repoPath: string;
  maxFileSize?: number;
}

// NEW: Extended context for wiki tools
export interface WikiToolContext extends ToolContext {
  pages: WikiPage[];
  maxContentLength?: number;
}

// NEW: Extended context for analysis tools
export interface AnalysisToolContext extends ToolContext {
  repos: Repositories;
  repoId: string;
  wikiId: string;
  // ... rest of analysis context
}

// EXISTING inputSchema (unchanged)
// NEW: Allow enum in schema properties
export interface ToolDefinition<TContext extends ToolContext = ToolContext> {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];  // NEW: optional enum support
    }>;
    required: string[];
  };
  execute: (input: Record<string, unknown>, context: TContext) => Promise<string>;
}
```

### Step 2.3: Add type aliases for backwards compatibility

```typescript
// src/services/llm/wiki-tools.ts
import { ToolDefinition, WikiToolContext } from './tools.js';

// DEPRECATED: Use ToolDefinition<WikiToolContext> instead
/** @deprecated Use ToolDefinition<WikiToolContext> */
export type WikiToolDefinition = ToolDefinition<WikiToolContext>;

// Existing code continues to work
```

```typescript
// src/services/llm/analysis-tools/types.ts
import { ToolDefinition, AnalysisToolContext } from '../tools.js';

// DEPRECATED alias
/** @deprecated Use ToolDefinition<AnalysisToolContext> */
export type AnalysisToolDefinition = ToolDefinition<AnalysisToolContext>;
```

### Step 2.4: Run all tests

```bash
npm run typecheck && npm run test
```

**Exit criteria:** All existing tests pass, new type tests pass, no breaking changes.

---

## Phase 3: Extract Shared Tool Functionality

**Goal:** Single implementation of file reading, searching, directory listing.

**Risk:** MEDIUM - changes core functionality, but with tests as safety net.

### Step 3.1: Create base tool module with tests first

```typescript
// tests/unit/base-tools.test.ts
describe('base-tools', () => {
  describe('createReadFileTool', () => {
    it('creates tool with configurable options');
    it('respects maxFileSize option');
    it('respects formatOutput option');
    it('supports GitHub API fallback when configured');
  });

  describe('createSearchFilesTool', () => {
    it('creates tool with configurable maxResults');
    it('respects ignore patterns');
  });

  describe('createListDirectoryTool', () => {
    it('creates tool with configurable formatting');
  });

  describe('validatePath (shared)', () => {
    it('validates paths within repo boundary');
    it('throws for path traversal');
  });
});
```

### Step 3.2: Implement base-tools.ts

```typescript
// src/services/llm/base-tools.ts

export interface BaseToolOptions {
  /** Maximum file size in bytes */
  maxFileSize?: number;
  /** Maximum search results */
  maxResults?: number;
  /** Format output with markdown headers */
  formatOutput?: boolean;
  /** GitHub API fallback support */
  githubFallback?: {
    repoService: RepositoryService;
    repo: Repo;
  };
}

/**
 * Shared path validation - single source of truth.
 */
export function validatePath(requestedPath: string, repoRoot: string): string {
  // Implementation (moved from codebase-tools.ts)
}

/**
 * Factory to create a read_file tool with options.
 */
export function createReadFileTool(options: BaseToolOptions = {}): ToolDefinition {
  // Unified implementation
}

/**
 * Factory to create a search_files tool with options.
 */
export function createSearchFilesTool(options: BaseToolOptions = {}): ToolDefinition {
  // Unified implementation
}

/**
 * Factory to create a list_directory tool with options.
 */
export function createListDirectoryTool(options: BaseToolOptions = {}): ToolDefinition {
  // Unified implementation
}
```

### Step 3.3: Migrate codebase-tools.ts to use base-tools

```typescript
// src/services/llm/codebase-tools.ts
import { createReadFileTool, createSearchFilesTool, createListDirectoryTool } from './base-tools.js';

// Delegate to base tools with codebase-specific defaults
export const readFileTool = createReadFileTool({
  maxFileSize: 100_000,
  formatOutput: false,
});

export const searchFilesTool = createSearchFilesTool({
  formatOutput: false,
});

export const listDirectoryTool = createListDirectoryTool({
  formatOutput: false,
});

// UNCHANGED: existing exports
export const codebaseTools = [readFileTool, searchFilesTool, listDirectoryTool];
```

### Step 3.4: Migrate source-tools.ts to use base-tools

```typescript
// src/services/llm/analysis-tools/source-tools.ts
import { createReadFileTool, createSearchFilesTool, createListDirectoryTool } from '../base-tools.js';

export const readSourceFileTool = createReadFileTool({
  maxFileSize: 100_000,
  maxResults: 50,
  formatOutput: true,  // Markdown headers
  // githubFallback configured at runtime via context
});

// ... similar for other tools
```

### Step 3.5: Run all tests

```bash
npm run lint && npm run typecheck && npm run test
```

**Exit criteria:** All tests pass, code duplication eliminated.

---

## Phase 4: Add Tool Support to More Agents

**Goal:** Security, pattern, technical-debt agents can explore codebase.

**Risk:** MEDIUM - changes agent behavior, but additive.

### Step 4.1: Write integration tests first

```typescript
// tests/integration/security-agent-tools.test.ts
describe('SecurityAgent with tools', () => {
  it('can read full file contents for security analysis');
  it('can search for related security files');
  it('includes tool usage in findings');
  it('falls back gracefully if tools unavailable');
});
```

### Step 4.2: Add tool support to SecurityAgent

```typescript
// src/agents/analysis/security-agent.ts

// BEFORE (line 44):
const completion = await context.llm.complete({...});

// AFTER:
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
  maxToolRounds: 3,  // Security analysis needs fewer rounds
  maxTokens: 2500,
  temperature: 0.2,
});
```

### Step 4.3: Update security agent prompt

Add tool usage instructions to SYSTEM_PROMPT:

```typescript
const SYSTEM_PROMPT = `You are a security audit agent...

You have access to tools to explore the codebase:
- read_file: Read complete file contents (not just diff lines)
- search_files: Find related security files (e.g., auth, crypto, config)
- list_directory: Understand project structure

WORKFLOW:
1. Review the diff for security-relevant changes
2. Use read_file to see full context of security-sensitive code
3. Use search_files to find related auth/crypto/config files
4. Provide comprehensive security analysis

...rest of existing prompt...`;
```

### Step 4.4: Repeat for pattern-agent and technical-debt-agent

Same pattern: tests first, then add tool support, update prompt.

### Step 4.5: Run full test suite

```bash
npm run test && npm run test:e2e
```

**Exit criteria:** Agents use tools, all tests pass.

---

## Phase 5: Standardize Configurations

**Goal:** Centralized configuration for limits and defaults.

**Risk:** LOW - configuration changes are straightforward.

### Step 5.1: Write configuration tests

```typescript
// tests/unit/tool-config.test.ts
describe('tool configuration', () => {
  it('provides default file size limit');
  it('provides default max results');
  it('provides default token limits per agent type');
  it('allows environment variable overrides');
});
```

### Step 5.2: Create centralized config

```typescript
// src/config/tool-config.ts

export const TOOL_DEFAULTS = {
  maxFileSize: 100_000,
  maxSearchResults: 50,
  maxContentLength: 4000,
  diffTruncationLimit: 10_000,
} as const;

export const AGENT_TOKEN_LIMITS = {
  'code-change': { maxTokens: 3000, temperature: 0.3 },
  'security': { maxTokens: 2500, temperature: 0.2 },
  'pattern': { maxTokens: 3500, temperature: 0.3 },
  // ... etc
} as const;
```

### Step 5.3: Migrate hardcoded values

Update each file to import from config:

```typescript
// src/services/llm/codebase-tools.ts
import { TOOL_DEFAULTS } from '../../config/tool-config.js';

const DEFAULT_MAX_FILE_SIZE = TOOL_DEFAULTS.maxFileSize;
```

### Step 5.4: Run all tests

```bash
npm run lint && npm run typecheck && npm run test
```

**Exit criteria:** All magic numbers centralized, tests pass.

---

## Implementation Order Summary

```
Week 1: Phase 1 (Characterization Tests)
├── Step 1.1: codebase-tools tests
├── Step 1.2: source-tools tests
├── Step 1.3: agent integration tests
└── Step 1.4: coverage verification

Week 2: Phase 2 (Type Unification)
├── Step 2.1: unified type tests
├── Step 2.2: extend tools.ts
├── Step 2.3: backwards-compat aliases
└── Step 2.4: verify all tests pass

Week 3: Phase 3 (Extract Shared Functionality)
├── Step 3.1: base-tools tests
├── Step 3.2: implement base-tools
├── Step 3.3: migrate codebase-tools
├── Step 3.4: migrate source-tools
└── Step 3.5: verify all tests pass

Week 4: Phase 4 (Agent Tool Support)
├── Step 4.1: security-agent tool tests
├── Step 4.2: add tools to security-agent
├── Step 4.3: update security prompt
├── Step 4.4: repeat for pattern, technical-debt
└── Step 4.5: full test suite

Week 5: Phase 5 (Configuration)
├── Step 5.1: config tests
├── Step 5.2: centralized config
├── Step 5.3: migrate hardcoded values
└── Step 5.4: final verification
```

---

## Rollback Strategy

Each phase is independently deployable. If issues arise:

1. **Phase fails tests:** Don't merge, fix or revert
2. **Production issue after merge:** Revert entire phase PR
3. **Partial phase issue:** Feature flags for new behavior

---

## Success Metrics

| Metric | Before | Target |
|--------|--------|--------|
| Tool test coverage | ~30% | >80% |
| Code duplication | 3 major | 0 |
| Type definitions | 3 incompatible | 1 unified |
| Agents with tools | 1 | 4+ |
| Hardcoded configs | 15+ | 0 |

---

## Files to Create/Modify

### New Files
- `tests/unit/codebase-tools.test.ts`
- `tests/unit/base-tools.test.ts`
- `tests/unit/tool-types.test.ts`
- `tests/unit/tool-config.test.ts`
- `tests/integration/agent-tool-integration.test.ts`
- `tests/integration/security-agent-tools.test.ts`
- `src/services/llm/base-tools.ts`
- `src/config/tool-config.ts`

### Modified Files
- `src/services/llm/tools.ts` (extend types)
- `src/services/llm/codebase-tools.ts` (delegate to base)
- `src/services/llm/wiki-tools.ts` (add deprecation alias)
- `src/services/llm/analysis-tools/types.ts` (add deprecation alias)
- `src/services/llm/analysis-tools/source-tools.ts` (delegate to base)
- `src/agents/analysis/security-agent.ts` (add tools)
- `src/agents/analysis/pattern-agent.ts` (add tools)
- `src/agents/analysis/technical-debt-agent.ts` (add tools)
