# Plan: Merge Content on Similarity Detection

## Problem Summary

When a page creation is rejected due to similarity detection, the current approach transfers only metadata (filesAccessed, targetPaths) to the similar page while losing the actual content. This is semantically dishonest:

1. **Inflated coverage**: Page claims to cover files whose content was never documented
2. **Lost insights**: New documentation content is discarded
3. **Misleading metrics**: Coverage tracking doesn't reflect actual documentation quality

## Root Cause

In `src/commands/update-wiki-page.ts`, when similarity is detected:
- Lines 64-78 (create operation): Transfers metadata only, returns failure
- Lines 209-223 (merge creating new page): Same issue

The system says "Consider updating the existing page instead" but doesn't actually do it.

## Solution: Merge Instead of Reject

When similarity is detected, redirect to a merge operation on the similar page instead of rejecting. This:
- Preserves content insights (appended to similar page)
- Transfers metadata accurately (files were actually documented)
- Returns success (work was accomplished)
- Prevents infinite loops (similar content consolidated)

### Implementation

**Replace rejection with merge redirect:**

```typescript
if (similarMatch) {
  // Redirect to merge operation on the similar page
  // This preserves both content AND metadata
  return handleUpdateWikiPage(
    createUpdateWikiPageCommand({
      ...update,
      type: 'merge',
      path: similarMatch.page.path,  // Target the similar page
    }),
    repos,
    wikiId
  );
}
```

**Why this works:**
1. Original call: `create` at path `components/auth-handler`
2. Similarity detected with `services/auth`
3. Redirect to: `merge` at path `services/auth`
4. `existing` found (the similar page)
5. Goes to merge branch: content merged, metadata accumulated
6. Returns success with updated page

No infinite loop because merging into an existing page doesn't re-check similarity.

## Files to Modify

### 1. `src/commands/update-wiki-page.ts`

**Location 1: Create operation (lines 64-78)**
- Remove metadata-only transfer
- Add merge redirect

**Location 2: Merge creating new page (lines 209-223)**
- Remove metadata-only transfer
- Add merge redirect

### 2. `tests/unit/update-wiki-page.test.ts`

**Replace "similarity rejection with tracking transfer" tests:**
- Change from "transfers metadata, returns failure"
- To "merges into similar page, returns success"

**New test cases:**
- `merges content into similar page when create detects similarity`
- `accumulates filesAccessed when merging into similar page`
- `accumulates targetPaths when merging into similar page`
- `merges content into similar page when merge-create detects similarity`

### 3. `tests/llm/similarity-merge.test.ts` (new file)

**LLM integration test to verify end-to-end behavior:**

```typescript
describe('Similarity-triggered merge', () => {
  it('merges content when agent produces similar page', async () => {
    // Setup: wiki with existing "Auth Service" page
    // documenting src/auth/login.ts

    // Run: simulate agent producing similar "Auth Handler" page
    // targeting src/handlers/

    // Verify:
    // - No new page created
    // - Existing page content includes new insights (merged)
    // - filesAccessed includes both original and new files
    // - targetPaths includes both directories
  });

  it('merged content is coherent (LLM-as-judge)', async () => {
    // Setup: existing page with specific content
    // Merge: new content about related topic
    // Judge: LLM evaluates if merged content is coherent and useful
  });
});
```

## Test Strategy

### Unit Tests (fast, no LLM)
- Verify merge redirect happens on similarity
- Verify content is appended
- Verify metadata is accumulated
- Verify returns success

### LLM Integration Tests (slower, uses real LLM)
- Verify full agent flow handles similarity correctly
- Use LLM-as-judge to verify merged content quality
- Located in `tests/llm/` directory
- Run with: `node --import tsx --test tests/llm/similarity-merge.test.ts`

## Implementation Order (TDD)

1. **Write failing unit tests** for new merge-on-similarity behavior
2. **Modify `update-wiki-page.ts`** to make tests pass
3. **Verify all existing tests still pass**
4. **Write LLM integration test**
5. **Run LLM test to verify end-to-end behavior**
6. **Commit and push**

## Success Criteria

1. ✅ When similarity detected, content is merged (not lost)
2. ✅ filesAccessed accumulated from both pages
3. ✅ targetPaths accumulated from both pages
4. ✅ Operation returns success (not failure)
5. ✅ No duplicate pages created
6. ✅ Coverage metrics are semantically accurate
7. ✅ All existing tests pass
8. ✅ LLM integration test passes

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Content becomes bloated from repeated merges | Merge function already appends with separator; future: smarter LLM merge |
| Infinite recursion in handleUpdateWikiPage | Merge on existing page doesn't re-check similarity |
| Breaking existing behavior | Comprehensive test coverage before changes |
