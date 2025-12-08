# Backward Compatibility Removal Plan

## Overview
This plan removes unnecessary backward compatibility code from the CodeWiki codebase.
Since the project hasn't launched yet, we don't need to maintain backward compatibility.

## Progress Tracking
- [x] Phase 1: Remove deprecated agent methods
- [x] Phase 2: Remove WorkTarget backward compatibility
- [x] Phase 3: Remove EditSource backward compatibility
- [x] Phase 4: Remove legacy helper functions
- [x] Phase 5: Remove repository normalization code
- [x] Phase 6: Remove LLM parsing fallbacks
- [x] Phase 7: Clean up module re-exports (kept necessary re-exports, removed deprecated comments)
- [x] Phase 8: Final verification

---

## Phase 1: Remove Deprecated Agent Methods

### Files to modify:
- `src/agents/base-agent.ts` - Remove `runOnCommit?`, `runOnWiki?`, `runOnPath?` from interface
- All agent implementations that define these methods

### Tests to update:
- Check `tests/unit/` and `tests/integration/` for any tests using deprecated methods

---

## Phase 2: Remove WorkTarget Backward Compatibility

### Files to modify:
- `src/domain/work-target.ts`
  - Remove `legacyToWorkTarget()` function (lines 102-113)
  - Remove `workTargetToLegacy()` function (lines 119-131)
- `src/domain/work-item.ts`
  - Remove deprecated `targetCommitId`, `targetPath` params from `createWorkItem()`
  - Remove fallback logic using `legacyToWorkTarget()`
  - Remove deprecated `priority` field

### Tests to update:
- `tests/unit/domain/work-item.test.ts`
- `tests/unit/domain/work-target.test.ts`

---

## Phase 3: Remove EditSource Backward Compatibility

### Files to modify:
- `src/domain/edit-source.ts`
  - Remove `legacyToEditSource()` function (lines 116-121)
  - Remove `editSourceToLegacy()` function (lines 127-141)
- `src/domain/edit-request.ts`
  - Remove deprecated `sourceCommitSha`, `sourceCommitTimestamp` params
  - Remove fallback logic

### Tests to update:
- `tests/unit/domain/edit-request.test.ts`
- `tests/unit/domain/edit-source.test.ts`

---

## Phase 4: Remove Legacy Helper Functions

### Files to modify:
- `src/domain/work-item.ts`
  - Remove `getTargetCommitId()` (lines 54-58)
  - Remove `getTargetPath()` (lines 60-65)
- `src/domain/edit-request.ts`
  - Remove `getSourceCommitSha()` (lines 98-103)
  - Remove `getSourceCommitTimestamp()` (lines 105-109)

### Files using these functions (need migration):
- `src/executor/executor.ts`
- `src/web/routes/processing.ts`
- `src/domain/work-queue-logic.ts`
- `src/repositories/file-based/file-work-queue-repository.ts`
- `src/repositories/mongo-based/mongo-work-queue-repository.ts`
- `src/agents/meta/wiki-editor-agent.ts`

---

## Phase 5: Remove Repository Normalization Code

### Files to modify:
- `src/repositories/file-based/file-work-queue-repository.ts`
  - Remove legacy field handling in `normalizeWorkItem()`
- `src/repositories/file-based/file-wiki-page-repository.ts`
  - Remove `sourceAgentRunIds` lazy initialization

---

## Phase 6: Remove LLM Parsing Fallbacks

### Files to modify:
- `src/agents/analysis/narrative-agent.ts` (lines 240-260)
- `src/agents/analysis/code-change-agent.ts` (lines 242-261)
- `src/agents/analysis/dependency-agent.ts` (lines 345-365)

Remove legacy line-based format fallback parsing.

---

## Phase 7: Clean Up Module Re-exports

### Files to modify:
- `src/services/llm/analysis-tools.ts` - Remove entire file or update imports
- `src/services/llm/analysis-tools/index.ts` - Remove backward compat re-exports
- `src/services/llm/analysis-tools/types.ts` - Simplify
- `src/services/llm/wiki-tools.ts` - Remove WikiToolContext re-export

### Other cleanup:
- `src/agents/orchestrator/strategies.ts` - Make phase parameter required
- `src/domain/date-utils.ts` - Remove undefined/null backward compat behavior
- `src/web/public/styles.css` - Remove legacy CSS (optional)

---

## Verification Commands

```bash
# Run after each phase
npm run lint && npm run typecheck && npm run test

# Run specific test file
node --import tsx --test tests/unit/specific-file.test.ts
```

---

## Notes
- Each phase should be committed separately for easier review
- Run tests after each modification
- Update test files that test deprecated functionality
