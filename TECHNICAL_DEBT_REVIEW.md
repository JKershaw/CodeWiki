# Technical Debt Review - CodeWiki

**Date:** December 2025
**Review Type:** Comprehensive Technical Debt Analysis

---

## Executive Summary

The CodeWiki codebase is generally well-architected with clean separation of concerns (CQRS, repository pattern). However, there are several areas of technical debt that could benefit from attention. This review identifies **quick wins** (low effort, high impact) and **larger refactoring opportunities**.

---

## Findings by Priority

### Priority 1: Quick Wins (High Impact, Low Effort)

#### 1.1 Duplicated `executeTools` Function Across Agents

**Location:** 7 agent files contain identical `executeTools` implementations
**Files affected:**
- `src/agents/analysis/code-change-agent.ts:37`
- `src/agents/analysis/codebase-explorer-agent.ts:52`
- `src/agents/synthesis/bootstrap-agent.ts:53`
- `src/agents/synthesis/extension-guide-agent.ts:76`
- `src/agents/synthesis/getting-started-agent.ts:74`
- `src/agents/synthesis/project-overview-agent.ts:74`
- `src/agents/synthesis/testing-guide-agent.ts:74`

**Recommendation:** Extract into a shared utility function in `src/agents/utils/tool-executor.ts`

**Estimated effort:** 1-2 hours

---

#### 1.2 Remove Incomplete MongoDB Implementation

**Location:** `src/repositories/index.ts:38`
```typescript
if (effectiveConfig.type === 'mongodb') {
  // TODO: Implement MongoDB repositories
  throw new Error('MongoDB repositories not yet implemented');
}
```

**Issue:** Dead code path that throws at runtime. Either implement or remove.

**Recommendation:**
- If MongoDB support is not planned short-term, remove the `mongodb` type from `RepositoryConfig` and delete the code path
- Remove `mongodb` from `package.json` dependencies (saves ~1MB)

**Estimated effort:** 30 minutes

---

#### 1.3 Console.log Cleanup

**Location:** 102 occurrences across 8 files

**Files with most occurrences:**
- `src/cli.ts` (78 occurrences)
- `src/executor/executor.ts` (12 occurrences)
- `src/web/server.ts` (1 occurrence)
- Various agents

**Recommendation:**
- CLI output is appropriate for CLI files
- Consider adding a proper logging abstraction for non-CLI code
- Remove debug console.log statements from agents and executor

**Estimated effort:** 1-2 hours

---

#### 1.4 Commit Loading Code Duplication

**Location:** Duplicated in two places:
- `src/cli.ts:185-228`
- `src/web/routes/repos.ts:165-204`

**Recommendation:** Extract commit loading logic into a shared service function:
```typescript
// src/services/git/commit-loader.ts
export async function loadCommitsFromRepo(repoPath: string, repoId: string): Promise<Commit[]>
```

**Estimated effort:** 1 hour

---

### Priority 2: Medium-Term Improvements

#### 2.1 Test Coverage Gap

**Current state:**
- 179 source files
- 37 test files (~20% coverage by file count)

**Untested areas:**
- Most analysis agents (only pattern-agent and technical-debt-agent have tests)
- Most synthesis agents
- Most meta agents
- Web routes (only wiki-api.test.ts exists)
- MCP server
- Many queries

**Recommendation:** Focus on adding tests for:
1. Core orchestrator logic
2. Web API routes (critical for production)
3. Agent response parsing functions

**Estimated effort:** 1-2 weeks

---

#### 2.2 Large Files That Could Be Split

**Files over 500 lines:**

| File | Lines | Recommendation |
|------|-------|----------------|
| `src/services/llm/analysis-tools.ts` | 1305 | Split into tool groups |
| `src/agents/orchestrator/orchestrator.ts` | 1213 | Extract strategies |
| `src/executor/executor.ts` | 782 | Extract agent registry |
| `src/agents/analysis/technical-debt-agent.ts` | 605 | Consider splitting prompts |
| `src/cli.ts` | 568 | Extract command handlers |
| `src/agents/meta/consistency-agent.ts` | 566 | Split analysis from prompts |
| `src/agents/analysis/pattern-agent.ts` | 565 | Split analysis from prompts |

**Estimated effort:** 2-3 days

---

#### 2.3 Route Handler Boilerplate

**Issue:** All route handlers have similar patterns for:
- Error handling (`try/catch` with `res.status(500)`)
- Repository lookup with 404 handling
- CQRS query creation

**Recommendation:** Create middleware or helper functions:
```typescript
// src/web/middleware/async-handler.ts
export const asyncHandler = (fn: RequestHandler) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// src/web/middleware/require-repo.ts
export const requireRepo = async (req, res, next) => {
  const repo = await repos.repos.findById(req.params.id);
  if (!repo) return res.status(404).json({ error: 'Repository not found' });
  req.repo = repo;
  next();
};
```

**Estimated effort:** 2-3 hours

---

### Priority 3: Long-Term Architectural Improvements

#### 3.1 Outdated Dependencies

| Package | Current | Latest | Breaking Changes? |
|---------|---------|--------|-------------------|
| Express | 4.x | 5.x | Yes - Major |
| MongoDB | 6.x | 7.x | Yes - Major |
| UUID | 9.x | 13.x | Yes - Major |
| Zod | 3.x | 4.x | Yes - Major |

**Recommendation:**
- Express 5.x upgrade should be planned (async route handler improvements)
- UUID 13.x is optional (current version works fine)
- Zod 4.x has significant API changes - evaluate benefits
- MongoDB can be deferred since it's not currently used

**Estimated effort:** 1-2 days for Express upgrade with testing

---

#### 3.2 Unfinished TODOs in Code

**Total TODOs found:** 3

| Location | TODO |
|----------|------|
| `src/repositories/index.ts:38` | Implement MongoDB repositories |
| `src/agents/orchestrator/orchestrator.ts:567` | Add conflict resolution work items |
| `src/agents/orchestrator/orchestrator.ts:576` | Add quality improvement work items |

**Recommendation:** Either implement or convert to GitHub issues with links in code

---

#### 3.3 Type Safety - Single Issue

**Location:** `src/services/llm/openrouter-llm-service.ts:152`
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const options: any = { ...init, dispatcher };
```

**Issue:** The `any` type is used due to `undici` type compatibility

**Recommendation:** Add proper type definition for the options object

**Estimated effort:** 30 minutes

---

## Summary Table

| Category | Items Found | Quick Wins | Medium | Long-term |
|----------|-------------|------------|--------|-----------|
| Code Duplication | 3 patterns | 2 | 1 | - |
| Dead Code | 1 (MongoDB) | 1 | - | - |
| Test Coverage | ~80% gap | - | 1 | - |
| Large Files | 7 files | - | 1 | - |
| Outdated Deps | 4 major | - | - | 1 |
| TODOs | 3 | - | - | 1 |
| Type Safety | 1 | 1 | - | - |

---

## Recommended Action Plan

### Week 1: Quick Wins
1. [ ] Extract shared `executeTools` function
2. [ ] Remove or implement MongoDB code path
3. [ ] Extract commit loading into shared service
4. [ ] Add route middleware for error handling

### Week 2-3: Testing
1. [ ] Add tests for orchestrator
2. [ ] Add tests for web routes
3. [ ] Add tests for critical agent parsing

### Month 2: Larger Refactoring
1. [ ] Split large files (analysis-tools.ts, orchestrator.ts)
2. [ ] Evaluate Express 5.x upgrade
3. [ ] Address remaining TODOs or convert to issues

---

## Code Quality Positives

The codebase shows several good practices:
- Clean CQRS architecture with clear separation
- Repository pattern with good abstraction (FileStore is well-designed)
- Type safety is excellent (only 1 `any` type)
- No deprecated patterns or outdated syntax
- Consistent code formatting
- Good use of TypeScript strict mode
