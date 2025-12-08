# Unified Repository Access - Implementation Plan

This document outlines the methodical, test-driven approach to unifying the repository access abstraction in CodeWiki.

## Problem Summary

AgentContext provides 5 different ways to access repository data:
1. `git` (GitService) - local only, deprecated
2. `repoService` (RepositoryService) - GitHub + local, preferred
3. `repos` (Repositories) - CQRS data access layer
4. `repo` (Repo entity) - metadata
5. `context.git.getRepoPath()` - filesystem path

This causes 100+ lines of conditional branches in agent-helpers.ts and inconsistent behavior.

## Solution Overview

Create a `UnifiedRepoAccess` interface that hides local vs GitHub distinction, reducing complexity to a single code path.

---

## Phase 1: Create UnifiedRepoAccess Interface

### Step 1.1: Write Interface Tests (TDD Red)

**File:** `tests/unit/unified-repo-access.test.ts`

Tests to write FIRST:
```typescript
describe('UnifiedRepoAccess', () => {
  describe('interface contract', () => {
    it('getFileContent returns file content as string')
    it('listDirectory returns FileEntry array')
    it('getFileTree returns all file paths')
    it('fileExists returns boolean')
    it('getCommitDiff returns diff string')
    it('isLocal returns true for local repos')
    it('isLocal returns false for GitHub repos')
    it('getLocalPath returns path for local repos')
    it('getLocalPath returns undefined for GitHub repos')
  })

  describe('LocalRepoAccess', () => {
    it('reads files from filesystem')
    it('lists directories from filesystem')
    it('gets file tree using cwignore filter')
    it('checks file existence on filesystem')
    it('gets commit diff via GitService')
    it('isLocal returns true')
    it('getLocalPath returns the repo path')
  })

  describe('GitHubRepoAccess', () => {
    it('reads files via GitHub API')
    it('lists directories via GitHub API')
    it('gets file tree via GitHub API')
    it('checks file existence via GitHub API')
    it('gets commit diff via GitHub API')
    it('isLocal returns false')
    it('getLocalPath returns undefined')
  })

  describe('createUnifiedRepoAccess factory', () => {
    it('creates LocalRepoAccess for local repos')
    it('creates GitHubRepoAccess for GitHub repos')
    it('uses authenticated service when token available')
    it('falls back to unauthenticated for missing token')
  })
})
```

### Step 1.2: Define Interface (TDD Green - Minimal)

**File:** `src/services/repository/unified-repo-access.ts`

```typescript
export interface UnifiedRepoAccess {
  // File operations
  getFileContent(path: string, ref?: string): Promise<string>;
  listDirectory(path: string, ref?: string): Promise<FileEntry[]>;
  getFileTree(ref?: string): Promise<string[]>;
  fileExists(path: string, ref?: string): Promise<boolean>;

  // Commit operations
  getCommitDiff(sha: string): Promise<string>;

  // Metadata
  isLocal(): boolean;
  getLocalPath(): string | undefined;
}

export interface UnifiedRepoAccessFactory {
  create(repoId: string): Promise<UnifiedRepoAccess>;
}
```

### Step 1.3: Implement LocalRepoAccess

**File:** `src/services/repository/local-repo-access.ts`

Wraps:
- `GitService.getRepoPath()` for path resolution
- `GitService.getCommitDiff()` for diffs
- Filesystem operations for file reading
- Existing cwignore filter for file tree

### Step 1.4: Implement GitHubRepoAccess

**File:** `src/services/repository/github-repo-access.ts`

Wraps:
- `RepositoryService.getFileContent()`
- `RepositoryService.listDirectory()`
- `RepositoryService.getFileTree()`
- `RepositoryService.getCommitDiff()`

### Step 1.5: Implement Factory

**File:** `src/services/repository/unified-repo-access-factory.ts`

Logic:
1. Look up Repo entity from repos.repos
2. If `repo.isGitHubRepo`:
   - If `repo.userId`: get token, create authenticated GitHubRepoAccess
   - Else: create unauthenticated GitHubRepoAccess
3. Else: create LocalRepoAccess

---

## Phase 2: Update AgentContext

### Step 2.1: Write Migration Tests (TDD Red)

**File:** `tests/unit/agent-context-migration.test.ts`

Tests:
```typescript
describe('AgentContext with UnifiedRepoAccess', () => {
  it('provides repoAccess for local repos')
  it('provides repoAccess for GitHub repos')
  it('repoAccess.getFileContent works for local')
  it('repoAccess.getFileContent works for GitHub')
  // Mirror existing agent-helpers tests but using new interface
})
```

### Step 2.2: Add repoAccess to AgentContext (Additive)

**File:** `src/agents/base-agent.ts`

```typescript
export interface AgentContext {
  repoId: string;
  wikiId: string;
  repos: Repositories;
  llm: LLMService;

  // NEW: Unified repository access
  repoAccess: UnifiedRepoAccess;

  // DEPRECATED: Keep for backwards compatibility during migration
  /** @deprecated Use repoAccess instead */
  git: GitService;
  /** @deprecated Use repoAccess instead */
  repoService?: RepositoryService;
  /** @deprecated Use repoAccess instead */
  repo?: Repo;
}
```

### Step 2.3: Update Executor to Create repoAccess

**File:** `src/executor/executor.ts`

Update context creation (lines 618-650) to:
1. Create UnifiedRepoAccess via factory
2. Add to context as `repoAccess`
3. Keep deprecated fields for backwards compatibility

---

## Phase 3: Migrate agent-helpers.ts

### Step 3.1: Update Tests to Use New Interface (TDD Red)

**File:** `tests/unit/agent-helpers.test.ts`

For each function, add tests using `repoAccess`:
```typescript
describe('getCommitDiff', () => {
  it('uses repoAccess when available', async () => {
    const mockRepoAccess = { getCommitDiff: mock.fn(async () => 'diff') };
    const context = { ...baseContext, repoAccess: mockRepoAccess };
    const diff = await getCommitDiff(context, 'sha');
    assert.strictEqual(diff, 'diff');
  })
})
```

### Step 3.2: Simplify Helper Functions (TDD Green)

**File:** `src/agents/agent-helpers.ts`

**Before (getCommitDiff):**
```typescript
export async function getCommitDiff(context: AgentContext, sha: string): Promise<string> {
  if (context.repoService && context.repo) {
    return context.repoService.getCommitDiff(context.repo, sha);
  }
  return context.git.getCommitDiff(context.repoId, sha);
}
```

**After:**
```typescript
export async function getCommitDiff(context: AgentContext, sha: string): Promise<string> {
  return context.repoAccess.getCommitDiff(sha);
}
```

### Step 3.3: Migrate Each Function

| Function | Lines | Estimated Reduction |
|----------|-------|---------------------|
| `getCommitDiff()` | 20-28 | 8 → 1 lines |
| `isLocalRepo()` | 36-39 | 4 → 1 lines |
| `getLocalRepoPath()` | 46-58 | 13 → 1 lines |
| `createCodebaseToolExecutor()` | 66-99 | 34 → 15 lines |
| `createApiCodebaseTools()` | 101-205 | DELETE (merge with above) |
| `fetchAffectedFileContents()` | 236-307 | 72 → 30 lines |

---

## Phase 4: Migrate Analysis Tools

### Step 4.1: Update source-tools Tests (TDD Red)

**File:** `tests/unit/analysis-tools.test.ts`

Add tests for new unified interface:
```typescript
describe('readSourceFileTool with UnifiedRepoAccess', () => {
  it('reads file via repoAccess')
  it('handles errors gracefully')
})
```

### Step 4.2: Simplify source-tools.ts

**File:** `src/services/llm/analysis-tools/source-tools.ts`

**Before (readSourceFileTool):**
```typescript
if (context.repoPath) {
  return readFileContent(path, context.repoPath, {...});
}
if (context.repoService && context.repo) {
  const content = await context.repoService.getFileContent(context.repo, path);
  // ...
}
return 'Source code access is not available...';
```

**After:**
```typescript
if (!context.repoAccess) {
  return 'Source code access is not available...';
}
return context.repoAccess.getFileContent(path);
```

### Step 4.3: Update AnalysisToolContext

**File:** `src/services/llm/tools.ts`

```typescript
export interface AnalysisToolContext {
  repos: Repositories;
  repoId: string;
  wikiId: string;
  repoAccess?: UnifiedRepoAccess;  // NEW

  // DEPRECATED
  repoPath?: string;
  repoService?: RepositoryService;
  repo?: Repo;
}
```

---

## Phase 5: Migrate Orchestrator Components

### Step 5.1: Update context-gatherer Tests (TDD Red)

**File:** `tests/unit/context-gatherer-unified.test.ts`

Tests for unified access:
```typescript
describe('ContextGatherer with UnifiedRepoAccess', () => {
  it('calculates directory coverage via repoAccess')
  it('builds coverage tree via repoAccess')
})
```

### Step 5.2: Simplify context-gatherer.ts

**File:** `src/agents/orchestrator/context-gatherer.ts`

Remove `getRepoService()` method, use factory-provided `repoAccess` instead.

### Step 5.3: Update orchestrator.ts

**File:** `src/agents/orchestrator/orchestrator.ts`

Remove direct `git` field, use `repoAccess` from context.

---

## Phase 6: Migrate Other Services

### Step 6.1: self-improvement-agent.ts

- Remove `this.git` field
- Use `repoAccess` from context
- Update `buildSourceContext()` method

### Step 6.2: self-improvement-chat-service.ts

- Same changes as above

### Step 6.3: benchmark-runner.ts

- Remove `this.git` field
- Use `repoAccess` from context

### Step 6.4: grader-agent.ts

- Update `createTools()` to use `repoAccess`

---

## Phase 7: Update Test Helpers

### Step 7.1: Update test-context.ts

**File:** `tests/helpers/test-context.ts`

```typescript
export async function createTestContext(): Promise<TestContext> {
  // ...existing setup...

  return {
    // ...existing fields...
    async agentContext(repoId: string): Promise<AgentContext> {
      const wiki = await getOrCreateActiveWiki(repoId, repos);
      const repoAccess = await createUnifiedRepoAccess(repoId, repos, gitService);
      return {
        repoId,
        wikiId: wiki.id,
        repos,
        llm,
        repoAccess,
        // Deprecated fields for backwards compatibility
        git: gitService,
      };
    },
  };
}
```

### Step 7.2: Update LLM test helpers

**File:** `tests/llm/helpers/test-context.ts`

Same changes as above.

---

## Phase 8: Cleanup Deprecated Code

### Step 8.1: Remove Deprecated Fields

After all migrations complete and tests pass:

1. Remove `git` from AgentContext (breaking change)
2. Remove `repoService` from AgentContext
3. Remove `repo` from AgentContext (keep if needed for metadata)
4. Remove `repoPath` from AnalysisToolContext

### Step 8.2: Delete Dead Code

- Remove `createApiCodebaseTools()` from agent-helpers.ts
- Remove `getRepoService()` from context-gatherer.ts
- Clean up unused imports

### Step 8.3: Update Documentation

- Update CLAUDE.md if needed
- Update any API documentation

---

## Execution Order

Execute phases in this order, running tests after each step:

```
Phase 1: Create UnifiedRepoAccess (foundation)
  ├── 1.1 Write tests (RED)
  ├── 1.2 Define interface
  ├── 1.3 Implement LocalRepoAccess (GREEN)
  ├── 1.4 Implement GitHubRepoAccess (GREEN)
  └── 1.5 Implement Factory (GREEN)

Phase 2: Update AgentContext (additive, non-breaking)
  ├── 2.1 Write migration tests (RED)
  ├── 2.2 Add repoAccess field (GREEN)
  └── 2.3 Update Executor (GREEN)

Phase 3: Migrate agent-helpers.ts
  ├── 3.1 Update tests (RED)
  ├── 3.2 Simplify functions (GREEN)
  └── 3.3 Verify all helper tests pass

Phase 4: Migrate Analysis Tools
  ├── 4.1 Update tests (RED)
  ├── 4.2 Simplify source-tools.ts (GREEN)
  └── 4.3 Update AnalysisToolContext

Phase 5: Migrate Orchestrator
  ├── 5.1 Update tests (RED)
  ├── 5.2 Simplify context-gatherer.ts (GREEN)
  └── 5.3 Update orchestrator.ts

Phase 6: Migrate Other Services
  ├── 6.1 self-improvement-agent.ts
  ├── 6.2 self-improvement-chat-service.ts
  ├── 6.3 benchmark-runner.ts
  └── 6.4 grader-agent.ts

Phase 7: Update Test Helpers
  ├── 7.1 test-context.ts
  └── 7.2 LLM test helpers

Phase 8: Cleanup (breaking changes)
  ├── 8.1 Remove deprecated fields
  ├── 8.2 Delete dead code
  └── 8.3 Update documentation
```

---

## Test Commands

Run after each step:

```bash
# Run unit tests for specific file
node --import tsx --test tests/unit/unified-repo-access.test.ts

# Run all unit tests
npm run test

# Run type checking
npm run typecheck

# Run linting
npm run lint

# Full verification before commit
npm run lint && npm run typecheck && npm run test
```

---

## Files to Create

| File | Phase | Purpose |
|------|-------|---------|
| `src/services/repository/unified-repo-access.ts` | 1.2 | Interface definition |
| `src/services/repository/local-repo-access.ts` | 1.3 | Local implementation |
| `src/services/repository/github-repo-access.ts` | 1.4 | GitHub implementation |
| `src/services/repository/unified-repo-access-factory.ts` | 1.5 | Factory |
| `tests/unit/unified-repo-access.test.ts` | 1.1 | Unit tests |

---

## Files to Modify

| File | Phase | Changes |
|------|-------|---------|
| `src/agents/base-agent.ts` | 2.2 | Add repoAccess to AgentContext |
| `src/executor/executor.ts` | 2.3 | Create repoAccess in context |
| `src/agents/agent-helpers.ts` | 3.2 | Simplify all functions |
| `src/services/llm/analysis-tools/source-tools.ts` | 4.2 | Use repoAccess |
| `src/services/llm/tools.ts` | 4.3 | Update AnalysisToolContext |
| `src/agents/orchestrator/context-gatherer.ts` | 5.2 | Use repoAccess |
| `src/agents/orchestrator/orchestrator.ts` | 5.3 | Remove git field |
| `src/analysis/self-improvement-agent.ts` | 6.1 | Use repoAccess |
| `src/services/self-improvement-chat-service.ts` | 6.2 | Use repoAccess |
| `src/benchmark/benchmark-runner.ts` | 6.3 | Use repoAccess |
| `src/benchmark/grader-agent.ts` | 6.4 | Use repoAccess |
| `tests/helpers/test-context.ts` | 7.1 | Create repoAccess |
| `tests/llm/helpers/test-context.ts` | 7.2 | Create repoAccess |
| `tests/unit/agent-helpers.test.ts` | 3.1 | Update for new interface |
| `tests/unit/analysis-tools.test.ts` | 4.1 | Update for new interface |

---

## Success Criteria

After completing all phases:

1. **No conditional branches** for repo type in agent-helpers.ts
2. **Single code path** for file operations regardless of repo type
3. **All existing tests pass** without modification (backwards compatible)
4. **New tests** verify unified interface works correctly
5. **Reduced code** - estimate 150+ lines removed from agent-helpers.ts alone
6. **Type safety** - TypeScript catches any missing implementations

---

## Rollback Plan

Each phase is independently deployable. If issues arise:

1. Phases 1-2 are purely additive - can be reverted without breaking existing code
2. Phases 3-7 modify existing code but keep deprecated fields - revert specific files
3. Phase 8 is breaking - do not proceed until all tests pass and system is stable

---

## Notes

- Keep `repos` (Repositories) as-is - it serves a different purpose (CQRS data access)
- The `repo` entity might still be useful for metadata - evaluate during Phase 8
- Consider caching in the factory to avoid repeated lookups
- Authentication handling moves into the factory, simplifying consuming code
