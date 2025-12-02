# Technical Debt Review

*Generated: 2025-12-02*
*Updated: 2025-12-02 - Large Files refactoring completed*

## Overview

Analysis of CodeWiki codebase (~10,800 lines TypeScript) to identify technical debt, prioritized by **code importance × effort × reward**.

---

## ✅ COMPLETED: Large File Decomposition

### Refactoring Summary

| File | Before | After | Reduction | Status |
|------|--------|-------|-----------|--------|
| `analysis-tools.ts` | 1,613 | 16 lines (re-export) | 99% | ✅ Split into 6 modules |
| `orchestrator.ts` | 1,214 | 519 | 57% | ✅ Strategies extracted |
| `executor.ts` | 783 | 722 | 8% | ✅ Uses registry |

**All 633 tests pass after refactoring.**

### Changes Made:

1. **analysis-tools.ts** → Split into `src/services/llm/analysis-tools/`:
   - `types.ts` - Common interfaces (AnalysisToolContext, AnalysisToolDefinition)
   - `benchmark-tools.ts` - Accuracy benchmark analysis (4 tools)
   - `quality-tools.ts` - Quality benchmark analysis (2 tools)
   - `wiki-page-tools.ts` - Wiki content and agent prompt tools (3 tools)
   - `source-tools.ts` - Source code exploration tools (3 tools)
   - `provenance-tools.ts` - Traceability tools (5 tools)
   - `index.ts` - Re-exports for backwards compatibility

2. **orchestrator.ts** → Extracted `strategies.ts` (768 lines):
   - 8 isolated strategy functions for deterministic work generation
   - `bootstrapStrategy`, `pendingEditsStrategy`, `codebaseExplorationStrategy`
   - `commitAnalysisStrategy`, `conflictResolutionStrategy`, `lowConfidenceStrategy`
   - `metaAgentsStrategy`, `synthesisStrategy`
   - Priority constants centralized and exported

3. **executor.ts** → Uses centralized agent registry:
   - Removed 21 individual agent imports
   - Removed manual agent registration (40 lines)
   - Uses `getAgent()` from `src/agents/registry.ts`

4. **registry.ts** → Enhanced with exports:
   - Added `ANALYSIS_AGENTS` and `META_AGENTS` constants
   - Re-exports `AgentType` type for convenience

---

## HIGH Priority (Remaining)

### 1. Large File Decomposition (Remaining Items)

| File | Lines | Issue | Recommendation |
|------|-------|-------|----------------|
| `src/agents/analysis/technical-debt-agent.ts` | 609 | Large but cohesive | Consider if parsing can be extracted |
| `src/cli.ts` | 568 | All commands inline | Extract commands to separate modules |

### 2. Unused Exports (Dead Code)

`ts-unused-exports` found **19 modules** with unused exports:

**Consolidation module (all unused):**
- `ConsolidationAgent`, `FindingHandler`, `FindingHandlerResult`
- All handlers: `BrokenLinkHandler`, `CategoryMismatchHandler`, `ContradictionHandler`, `DuplicateHandler`, `OrphanedPageHandler`, `TerminologyHandler`

**Self-improvement module (all unused):**
- `createSelfImprovementAgent`
- All commands: `StartSelfImprovementCommand`, `CompleteSelfImprovementCommand`, `FailSelfImprovementCommand`
- All queries: `GetSelfImprovementRunQuery`, `GetSelfImprovementHistoryQuery`

**Analysis tools (all 17 tools unused):**
- `getBenchmarkSummaryTool`, `getQuestionTrendsTool`, `getQuestionHistoryTool`
- `getIterationsBetweenTool`, `getQualityTrendsTool`, `getQualityDimensionDetailTool`
- `getPageContentTool`, `listWikiPagesTool`, `getAgentPromptTool`
- `readSourceFileTool`, `searchSourceFilesTool`, `listSourceDirectoryTool`
- `getPageProvenanceTool`, `getAgentContributionsTol`, `getOrchestratorDecisionsTool`
- `getProvenanceTraceTool`, `getWorkItemOutcomesTool`

**Public API (unused):**
- `src/index.ts`: `createRepositories`, `AppConfig`, `createApp`

**Recommendation:** Delete unused code or mark as `@internal`. Reduces bundle size and maintenance burden.

### ~~3. Type Safety Escapes~~ ✅ FIXED

~~Found `as any` casts that bypass TypeScript~~ - **All removed**

| File | Issue | Status |
|------|-------|--------|
| `openrouter-llm-service.ts` | fetch options cast | ✅ Uses `UndiciRequestInit` type |
| `benchmark.ts` | dynamic property assignment | ✅ Object spread pattern |
| `quality-benchmark.ts` | same pattern | ✅ Object spread pattern |
| `analysis-tools.ts` | agent type cast | ✅ Removed during refactoring |

---

## MEDIUM Priority

### 4. CQRS Verbosity

The CQRS pattern creates ~30 lines of boilerplate per operation:

```typescript
// For a simple "get by ID" you need:
interface GetCommitQuery extends Query { readonly type: 'GetCommit'; readonly commitId: string; }
function createGetCommitQuery(commitId: string): GetCommitQuery { ... }
async function handleGetCommit(query: GetCommitQuery, repos: Repositories): Promise<QueryResult<Commit>> { ... }
```

**Scale of infrastructure:**
- 21 query files = 2,308 lines
- 14 command files = 2,797 lines
- **Total: 5,105 lines of CQRS infrastructure**

**Recommendation:** Evaluate if this abstraction level is justified for internal code. Consider:
- Keep CQRS only at API boundaries (web routes, MCP)
- Use direct repository calls internally
- Or create a generic query/command factory

### 5. Agent Boilerplate Duplication

All 25 agents follow the same pattern:
1. Get commit via CQRS query
2. Get diff from git service
3. Build prompt string
4. Call LLM (with or without tools)
5. Parse response with regex
6. Generate wiki updates

**Repeated in:**
- 6 analysis agents
- 5 meta agents
- 9 synthesis agents
- 5 special agents

**Recommendation:** Extract a base class or composition helper:

```typescript
// Example simplification
class BaseCommitAgent {
  protected async runOnCommitBase(commitId: string, context: AgentContext) {
    const commit = await this.getCommit(commitId, context);
    const diff = await context.git.getCommitDiff(context.repoId, commit.sha);
    const prompt = this.buildPrompt(commit, diff);
    const response = await this.callLLM(prompt, context);
    return this.parseResponse(response);
  }

  abstract buildPrompt(commit: Commit, diff: string): string;
  abstract parseResponse(response: string): Analysis;
}
```

### 6. Repository Interface Proliferation

17 repository interfaces with 16 file-based implementations:
- `RepoRepository`, `CommitRepository`, `WikiRepository`, `WikiPageRepository`
- `AgentRunRepository`, `WorkQueueRepository`, `IterationRepository`
- `ProcessingRunRepository`, `ConflictRepository`, `FindingRepository`
- `EditRequestRepository`, `LearningRepository`, `BenchmarkRepository`
- `QualityBenchmarkRepository`, `OrchestratorRunRepository`, `SelfImprovementRepository`

Many have similar CRUD patterns.

**Recommendation:** Consider generic `Repository<T>` base:

```typescript
interface Repository<T extends { id: string }> {
  findById(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  save(item: T): Promise<void>;
  delete(id: string): Promise<void>;
}
```

---

## LOW Priority

### 7. TODO/FIXME Comments

Only 4 actual TODOs in source code (excluding agent-generated content):

| File | Line | Comment |
|------|------|---------|
| `orchestrator.ts` | 568 | "Add conflict resolution work items when we have a conflict resolution agent" |
| `orchestrator.ts` | 577 | "Add quality improvement work items when we have meta agents" |
| `repositories/index.ts` | 38 | "Implement MongoDB repositories" |

These represent planned features, not debt.

### 8. Minor Issues

- ~~**eslint-disable** found in `openrouter-llm-service.ts:151`~~ - ✅ Removed (proper type used)
- **Model cache** exports unused: `fetchModelsFromAPI`, `getModelCost`, `clearModelCache`, `isCachePopulated`
- **cwignore** utilities unused: `DEFAULT_IGNORE_PATTERNS`, `parseIgnorePatterns`, `clearIgnoreCache`

---

## Prioritized Action Plan

| Priority | Action | Effort | Impact | Risk | Status |
|----------|--------|--------|--------|------|--------|
| 1 | Remove unused consolidation/self-improvement code | Low | Clarifies scope, reduces maintenance | Low | Pending |
| ~~2~~ | ~~Fix `as any` casts (4 instances)~~ | ~~Low~~ | ~~Better type safety~~ | ~~Low~~ | ✅ Done |
| ~~3~~ | ~~Split `analysis-tools.ts` into modules~~ | ~~Medium~~ | ~~Better maintainability~~ | ~~Low~~ | ✅ Done |
| 4 | Create agent base class with common flow | Medium | Reduces duplication in 25 files | Medium | Pending |
| 5 | Simplify CQRS (evaluate if needed internally) | High | 5K+ lines potentially simplified | High | Pending |
| ~~6~~ | ~~Split `orchestrator.ts` into strategies~~ | ~~Medium~~ | ~~Better testability~~ | ~~Medium~~ | ✅ Done |
| 7 | Extract CLI commands to separate modules | Low | Better organization | Low | Pending |

---

## Quick Wins (< 1 hour each)

1. **Delete unused analysis-tools exports** - All 17 tools appear unused
2. **Delete unused consolidation handlers** - 6 handler classes unused
3. ~~**Fix the 4 `as any` type casts**~~ - ✅ Done
4. **Remove unused public API from `index.ts`** - `createApp`, `createRepositories`, `AppConfig`
5. **Clean up unused cwignore utilities** - Keep only `loadIgnorePatterns`

---

## Notes

- The codebase is generally well-structured with clear separation of concerns
- CQRS pattern provides good boundaries but may be over-engineering for internal use
- The unused code suggests features that were planned but not completed (consolidation, self-improvement)
- Agent architecture is sound but could benefit from less boilerplate
