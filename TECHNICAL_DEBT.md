# Technical Debt Review

*Generated: 2025-12-02*
*Updated: 2025-12-02 - Large Files refactoring, type safety fixes, dead code cleanup*

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

## ✅ COMPLETED: Type Safety Fixes

| File | Issue | Status |
|------|-------|--------|
| `openrouter-llm-service.ts` | fetch options cast | ✅ Uses `UndiciRequestInit` type |
| `benchmark.ts` | dynamic property assignment | ✅ Object spread pattern |
| `quality-benchmark.ts` | same pattern | ✅ Object spread pattern |
| `analysis-tools.ts` | agent type cast | ✅ Removed during refactoring |

All `as any` casts removed from codebase.

---

## ✅ COMPLETED: Dead Code Cleanup

### Removed from `src/index.ts`:
- `createApp` - Unused factory function for library consumers that never materialized
- `AppConfig` - Unused type only referenced by `createApp`
- Misleading "library module" messaging

### Corrected Analysis: NOT Dead Code

Investigation revealed several items flagged by `ts-unused-exports` are **actually used dynamically**:

| Module | Status | How It's Used |
|--------|--------|---------------|
| **Consolidation** | ✅ Active | Orchestrator creates work items when findings exist; executed via agent registry |
| **Self-improvement** | ✅ Active | Full web UI, REST API, frontend integration, unit tests |
| **17 Analysis tools** | ✅ Active | Dynamically consumed by SelfImprovementAgent via LLM tool calling |

**Key insight:** Static analysis tools miss dynamic dispatch patterns used by LLM-driven agents.

---

## HIGH Priority (Remaining)

### 1. Large File Decomposition (Remaining Items)

| File | Lines | Issue | Recommendation |
|------|-------|-------|----------------|
| `src/agents/analysis/technical-debt-agent.ts` | 609 | Large but cohesive | Consider if parsing can be extracted |
| `src/cli.ts` | 568 | All commands inline | Extract commands to separate modules |

### 2. CQRS Architectural Inconsistency

The self-improvement module has CQRS commands/queries defined but bypassed:
- Web routes call repository methods directly instead of command handlers
- `StartSelfImprovementCommand`, `CompleteSelfImprovementCommand`, `FailSelfImprovementCommand` handlers exist but are never called
- `GetSelfImprovementRunQuery`, `GetSelfImprovementHistoryQuery` handlers exist but are never called

**Options:**
1. Wire commands/queries through a dispatcher (consistent architecture)
2. Remove the unused handlers (simpler, but loses CQRS benefits)

---

## MEDIUM Priority

### 3. CQRS Verbosity

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

### 4. Agent Boilerplate Duplication

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

### 5. Repository Interface Proliferation

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

### 6. TODO/FIXME Comments

Only 3 actual TODOs in source code (excluding agent-generated content):

| File | Line | Comment |
|------|------|---------|
| `orchestrator.ts` | 568 | "Add conflict resolution work items when we have a conflict resolution agent" |
| `orchestrator.ts` | 577 | "Add quality improvement work items when we have meta agents" |
| `repositories/index.ts` | 38 | "Implement MongoDB repositories" |

These represent planned features, not debt.

### 7. Minor Unused Utilities

- **Model cache** exports unused: `fetchModelsFromAPI`, `getModelCost`, `clearModelCache`, `isCachePopulated`
- **cwignore** utilities unused: `DEFAULT_IGNORE_PATTERNS`, `parseIgnorePatterns`, `clearIgnoreCache`

---

## Prioritized Action Plan

| Priority | Action | Effort | Impact | Risk | Status |
|----------|--------|--------|--------|------|--------|
| ~~1~~ | ~~Remove dead code from index.ts~~ | ~~Low~~ | ~~Cleaner public API~~ | ~~Low~~ | ✅ Done |
| ~~2~~ | ~~Fix `as any` casts (4 instances)~~ | ~~Low~~ | ~~Better type safety~~ | ~~Low~~ | ✅ Done |
| ~~3~~ | ~~Split `analysis-tools.ts` into modules~~ | ~~Medium~~ | ~~Better maintainability~~ | ~~Low~~ | ✅ Done |
| ~~4~~ | ~~Split `orchestrator.ts` into strategies~~ | ~~Medium~~ | ~~Better testability~~ | ~~Medium~~ | ✅ Done |
| 5 | Create agent base class with common flow | Medium | Reduces duplication in 25 files | Medium | Pending |
| 6 | Simplify CQRS (evaluate if needed internally) | High | 5K+ lines potentially simplified | High | Pending |
| 7 | Extract CLI commands to separate modules | Low | Better organization | Low | Pending |
| 8 | Resolve self-improvement CQRS inconsistency | Low | Architectural consistency | Low | Pending |

---

## Notes

- The codebase is generally well-structured with clear separation of concerns
- CQRS pattern provides good boundaries but may be over-engineering for internal use
- Static analysis tools (`ts-unused-exports`) miss dynamic patterns like LLM tool calling and orchestrator-triggered agents
- Consolidation and self-improvement modules are feature-complete and actively integrated
- Agent architecture is sound but could benefit from less boilerplate
