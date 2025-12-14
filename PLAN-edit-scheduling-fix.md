# Plan: Fix Edit Request Scheduling & Simplify Work Generation

## Problem Statement

Edit requests are backlogging because they're only processed once per RUN (CLI invocation), not per iteration. Analysis agents generate edit requests during their execution, but these edits accumulate and aren't applied until the next CLI run.

**Current flow:**
```
executor.runIterations(repoId, 100)
  ├─ Process pending edits (ONCE at start)  ← Lines 196-288
  └─ Loop iterations via continuous pool
      └─ Analysis agents queue MORE edit requests
          └─ These backlog until NEXT CLI run!
```

## Proposed Solution

### Change 1: Process Edit Requests Per Iteration

Move edit processing into the main iteration loop so edits are processed before each unit of work.

**New flow:**
```
executor.runIterations(repoId, 100)
  └─ Loop iterations
      ├─ Check for pending edits FIRST
      │   └─ If any: run wiki-editor, then continue loop
      └─ Then do analysis/synthesis work
```

### Change 2: On-Demand Work Computation

Since work item IDs are deterministic (`SHA256(repoId:agentType:target)`), we can compute the next work item on-demand instead of pre-filling a queue.

**Remove:**
- Queue water marks (QUEUE_LOW_WATER_MARK=12, QUEUE_HIGH_WATER_MARK=50)
- Async refill logic (`triggerAsyncRefill`, `refillPromise`, `refillInProgress`)
- Batch save/claim pattern

**Add:**
- Simple `computeNextWorkItem()` function that returns the next item deterministically
- Edit request check integrated into work claiming

## Implementation Plan

### File Changes

#### 1. `src/executor/executor.ts` (~150 lines modified)

**Remove:**
- Lines 93-95: Queue water mark constants
- Lines 109-110: `refillInProgress`, `refillPromise` state
- Lines 319-373: Complex queue refill logic in `claimWork`
- Lines 546-575: `triggerAsyncRefill` method

**Add/Modify:**
- Add `computeNextWorkItem()` method that:
  1. Checks for pending edit requests → returns wiki-editor work item
  2. Calls orchestrator for next work item (single item, not batch)
  3. Returns null when no work
- Simplify `claimWork` callback to use `computeNextWorkItem()`
- Move edit request checking into `claimWork` flow (every claim checks edits first)

**Key logic for `computeNextWorkItem()`:**
```typescript
private async computeNextWorkItem(
  repoId: string,
  wikiId: string,
  processedCommits: Set<string>
): Promise<WorkItem | null> {
  // 1. Always prioritize pending edits
  const pendingEdits = await this.repos.editRequests.countPending(wikiId);
  if (pendingEdits > 0) {
    const target = { type: 'wiki' as const };
    return createWorkItem({
      id: generateWorkItemId(repoId, 'wiki-editor', target),
      repoId,
      agentType: 'wiki-editor',
      target,
    });
  }

  // 2. Ask orchestrator for next work (single item)
  const workItems = await this.orchestrator.generateWorkList(repoId, wikiId, 1);
  if (workItems.length === 0) {
    return null;
  }

  // 3. Save and claim the work item
  const workItem = workItems[0];
  await handleSaveWorkItems(createSaveWorkItemsCommand([workItem]), this.repos);

  // 4. Apply ordering constraints (code-change must precede other analysis)
  if (!this.canClaim(workItem, processedCommits)) {
    return null; // Will retry next iteration
  }

  return workItem;
}
```

#### 2. `src/agents/orchestrator/phased-orchestrator.ts` (~20 lines modified)

- Optimize `generateWorkList` for single-item requests (common case now)
- Consider caching phase detection for short periods

#### 3. Tests to Update

**`tests/integration/executor-edit-processing.test.ts`:**
- Update "continues with Orchestrator work after edit processing completes" test
- Add test: "processes edits generated during same run"
- Add test: "edit created in iteration N is processed in iteration N+1"

**`tests/unit/executor-continuous-pool.test.ts`:**
- Remove water mark tests (no longer applicable)
- Update to test on-demand computation behavior

#### 4. New Tests to Add

**`tests/integration/executor-on-demand-work.test.ts`:**
```typescript
describe('On-Demand Work Generation', () => {
  it('computes next work item on demand without queue', async () => {
    // Verify no pre-filling, just on-demand computation
  });

  it('prioritizes edit requests over analysis work', async () => {
    // Create analysis work + edit request
    // Verify edit is processed first
  });

  it('processes edits created during analysis within same run', async () => {
    // Run analysis that creates edits
    // Verify edits processed before next analysis starts
  });

  it('handles rapid edit creation without backlog', async () => {
    // Create multiple edits across iterations
    // Verify all processed without backlog
  });
});
```

## Implementation Steps

### Step 1: Write Failing Tests (TDD)
1. Add test for "edits processed per iteration" to `executor-edit-processing.test.ts`
2. Add test for "edits created during run are processed in same run"
3. Verify tests fail with current implementation

### Step 2: Refactor Executor
1. Remove queue water marks and async refill
2. Add `computeNextWorkItem()` method
3. Simplify `claimWork` callback
4. Ensure edit checking happens on every claim

### Step 3: Update Orchestrator (if needed)
1. Optimize for single-item requests
2. Remove batch-oriented logic if no longer needed

### Step 4: Update Existing Tests
1. Fix any broken tests due to behavior changes
2. Remove obsolete queue-related tests

### Step 5: Run Full Test Suite
```bash
npm run lint && npm run typecheck && npm run test
```

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Performance: More orchestrator calls | Orchestrator is cheap (deterministic, no LLM for phased). Monitor if LLM mode is slower. |
| Race conditions: Concurrent edit processing | Deterministic work IDs prevent duplicates. Wiki-editor agent handles concurrent edits. |
| Breaking changes: Existing behavior relies on batching | Comprehensive test coverage ensures behavior preserved. |

## Success Criteria

1. Edit requests created in iteration N are processed in iteration N+1 (not next CLI run)
2. No edit request backlog accumulates during a run
3. All existing tests pass
4. New tests verify per-iteration edit processing
5. Code is simpler (less queue machinery)

## Estimated Changes

- **New code:** ~50 lines (computeNextWorkItem, tests)
- **Modified code:** ~100 lines (executor simplification)
- **Removed code:** ~80 lines (queue water marks, async refill)
- **Net:** Slight reduction in code complexity
