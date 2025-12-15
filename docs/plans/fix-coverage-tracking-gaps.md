# Plan: Fix Coverage Tracking Gaps

## Problem Summary

Coverage tracking is only recorded when wiki pages are successfully created. When page creation fails (due to similarity detection, validation, or empty LLM output), the exploration effort is lost:

1. `targetPaths` and `filesAccessed` never saved
2. Directory stays at 0% coverage
3. Same directory re-selected every cycle
4. Phase 2 stalls indefinitely

### Root Cause Locations

| Location | Issue |
|----------|-------|
| `executor.ts:631` | Loop only processes successful updates |
| `update-wiki-page.ts:63-70` | Similar page rejection loses tracking data |
| `update-wiki-page.ts:54-58` | Validation failure loses tracking data |
| `codebase-explorer-agent.ts:701-704` | Skipped pages lose tracking data |

## Solution Design

### Principle: Never Lose Exploration Effort

When exploration work is performed, coverage should increase regardless of whether new pages are created. The exploration metadata (targetPaths, filesAccessed) should be preserved.

### Strategy: Multi-Level Fallback

```
┌─────────────────────────────────────────────────────────────────┐
│ Agent explores directory, produces updates                      │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ LEVEL 1: Page created successfully                              │
│ → targetPaths/filesAccessed saved to new page ✓                │
└─────────────────────────────┬───────────────────────────────────┘
                              │ (page rejected)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ LEVEL 2: Similar page found                                     │
│ → Add targetPaths/filesAccessed to the SIMILAR page ✓          │
└─────────────────────────────┬───────────────────────────────────┘
                              │ (no similar page / validation fail)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ LEVEL 3: No pages created at all                                │
│ → Add targetPaths to project-overview page (if exists) ✓       │
│ → Or record at wiki level as exploredPaths ✓                   │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Handle Similar Page Rejection (LEVEL 2)

**File: `src/commands/update-wiki-page.ts`**

When a page is rejected due to similarity, transfer the tracking data to the similar page:

```typescript
// In the similarity check block (lines 63-70):
if (similarMatch) {
  // Transfer tracking data to the similar page instead of losing it
  if (update.filesAccessed?.length || update.targetPaths?.length) {
    await repos.wikiPages.updateContent(similarMatch.page.id, {
      content: similarMatch.page.content, // Keep content unchanged
      filesAccessed: update.filesAccessed,
      targetPaths: update.targetPaths,
    });
  }
  return failure(...); // Still reject the new page
}
```

**Tests needed:**
- `tests/unit/update-wiki-page.test.ts`: Add test for tracking transfer on similarity rejection

### Phase 2: Handle Empty Updates (LEVEL 3)

**File: `src/executor/executor.ts`**

After processing updates, if no pages were created but we have tracking data, record it:

```typescript
// After the updates loop (around line 700):
const anyPagesCreated = pagesCreated > 0 || pagesUpdated > 0;

if (!anyPagesCreated && targetPath && result.toolMetrics?.filesRead?.length) {
  // No pages created, but we did explore - record on project overview or wiki
  await this.recordExplorationFallback(
    wikiId,
    targetPath,
    result.toolMetrics.filesRead
  );
}
```

**New method in Executor:**
```typescript
private async recordExplorationFallback(
  wikiId: string,
  targetPath: string,
  filesRead: string[]
): Promise<void> {
  // Try to find project-overview page
  const overviewPage = await this.repos.wikiPages.findByPath(wikiId, 'project-overview');

  if (overviewPage) {
    // Add tracking to overview page
    await this.repos.wikiPages.updateContent(overviewPage.id, {
      content: overviewPage.content,
      filesAccessed: filesRead,
      targetPaths: [targetPath],
    });
  } else {
    // Fallback: Record at wiki level (requires wiki entity change)
    await this.repos.wikis.addExploredPath(wikiId, targetPath, filesRead);
  }
}
```

**Tests needed:**
- `tests/integration/executor-file-tracking.test.ts`: Add test for fallback recording

### Phase 3: Wiki-Level Exploration Tracking (Fallback Storage)

**File: `src/domain/wiki.ts`**

Add exploration tracking fields to Wiki entity:

```typescript
export interface Wiki {
  // ... existing fields

  // Exploration tracking for directories where no pages were created
  // Used as fallback when page creation fails
  exploredPaths?: Array<{
    path: string;
    filesAccessed: string[];
    exploredAt: Date;
  }>;
}
```

**File: `src/repositories/interfaces/wiki-repository.ts`**

Add method:
```typescript
addExploredPath(wikiId: string, path: string, filesAccessed: string[]): Promise<void>;
```

**File: `src/repositories/file-based/file-wiki-repository.ts`**

Implement the method.

### Phase 4: Update Coverage Calculation

**File: `src/agents/orchestrator/context-gatherer.ts`**

Include wiki-level explored paths in coverage:

```typescript
// In buildCoveredFilesSet or calculateUndocumentedDirectoriesAndFiles:

// Include wiki-level exploration tracking
const wiki = await this.repos.wikis.findById(wikiId);
if (wiki?.exploredPaths) {
  for (const explored of wiki.exploredPaths) {
    // Add filesAccessed
    for (const file of explored.filesAccessed) {
      coveredFiles.add(file);
    }
    // Expand directory path
    const pathWithSlash = explored.path.endsWith('/')
      ? explored.path
      : explored.path + '/';
    for (const file of sourceFiles) {
      if (file.startsWith(pathWithSlash)) {
        coveredFiles.add(file);
      }
    }
  }
}
```

### Phase 5: Handle Skipped Pages in Agent

**File: `src/agents/analysis/codebase-explorer-agent.ts`**

Currently skips pages silently. Should return tracking data even when pages skipped:

```typescript
// In generateUpdates(), track which paths were skipped
private generateUpdates(...): { updates: WikiPageUpdate[], skippedPaths: string[] } {
  const updates: WikiPageUpdate[] = [];
  const skippedPaths: string[] = [];

  for (const page of analysis.wikiPages) {
    if (existingPathsSet.has(page.path.toLowerCase())) {
      skippedPaths.push(page.path);
      continue;
    }
    // ... create update
  }

  return { updates, skippedPaths };
}
```

The executor can then handle skipped paths appropriately.

## Test Plan

### Unit Tests

**File: `tests/unit/update-wiki-page.test.ts`**

```typescript
describe('similarity rejection with tracking transfer', () => {
  it('transfers filesAccessed to similar page when rejected', async () => {
    // Create existing page
    const existingPage = createWikiPage({
      path: 'agents/overview',
      content: validContent('Agents Overview'),
      filesAccessed: ['src/agents/base.ts'],
    });
    repos._pages.set(existingPage.id, existingPage);

    // Try to create similar page with different targetPaths
    const command = createUpdateWikiPageCommand({
      type: 'create',
      path: 'utils/overview',
      content: validContent('Utils Overview'), // Similar enough
      filesAccessed: ['src/utils/helper.ts'],
      targetPaths: ['src/utils/'],
    });

    const result = await handleUpdateWikiPage(command, repos, wikiId);

    // Page rejected
    assert.strictEqual(result.success, false);

    // But tracking transferred to similar page
    const updated = repos._pages.get(existingPage.id);
    assert.ok(updated?.filesAccessed.includes('src/utils/helper.ts'));
    assert.ok(updated?.targetPaths?.includes('src/utils/'));
  });

  it('transfers targetPaths to similar page when rejected', async () => {
    // Similar test for targetPaths
  });
});
```

### Integration Tests

**File: `tests/integration/executor-file-tracking.test.ts`**

```typescript
describe('exploration fallback tracking', () => {
  it('records exploration on project-overview when no pages created', async () => {
    // Setup: Create wiki with project-overview page
    // Execute work item that produces no updates
    // Verify project-overview has targetPaths updated
  });

  it('records exploration at wiki level when no overview page', async () => {
    // Setup: Create wiki without project-overview
    // Execute work item that produces no updates
    // Verify wiki.exploredPaths includes the target
  });

  it('coverage increases after failed page creation', async () => {
    // Setup: Directory at 0% coverage
    // Execute work that fails to create page (similarity)
    // Verify coverage > 0% now
  });
});
```

### End-to-End Tests

**File: `tests/integration/phase2-progression.test.ts`** (new file)

```typescript
describe('Phase 2 progression with page rejections', () => {
  it('exits Phase 2 even when some pages are rejected', async () => {
    // Setup: Multiple directories
    // Configure some to succeed, some to fail (similar content)
    // Run orchestrator cycles
    // Verify Phase 2 eventually exits
  });

  it('does not get stuck on directories with rejected pages', async () => {
    // Setup: Directory that will always have pages rejected
    // Run multiple cycles
    // Verify directory is not selected repeatedly
    // Verify coverage increases
  });
});
```

## Implementation Order

1. **Phase 1** (Similar page tracking transfer) - Highest impact, simplest change
2. **Phase 5** (Agent skipped paths tracking) - Supports Phase 1
3. **Phase 3** (Wiki entity changes) - Enables Phase 2
4. **Phase 2** (Executor fallback) - Uses Phase 3
5. **Phase 4** (Coverage calculation update) - Integrates all changes

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Similar page gets bloated with unrelated targetPaths | Acceptable - semantic relationship exists |
| Wiki.exploredPaths grows unbounded | Add cleanup in maintenance phase |
| Coverage becomes inflated | Already an issue with targetPaths expansion - separate concern |
| Breaking existing behavior | Comprehensive test coverage before changes |

## Success Criteria

1. ✅ Coverage increases after every exploration, regardless of page creation success
2. ✅ Phase 2 exits within reasonable cycles for any repository
3. ✅ No directory gets stuck at 0% coverage after being explored
4. ✅ Work items don't repeatedly target the same directory
5. ✅ All existing tests continue to pass
