# Implementation Plan: Coverage-Aware Codebase Explorer

## Overview

Make the codebase-explorer agent aware of per-file coverage data so it prioritizes reading undocumented files instead of using deterministic (and coverage-blind) file selection.

## Goals

1. **Primary**: Pass per-file coverage data to codebase-explorer so `selectKeyFiles()` prioritizes low-coverage files
2. **Improvement #1**: Track which files were actually documented (not just read) in agent results
3. **Improvement #2**: Include undocumented file count in work item deduplication keys
4. **Improvement #4**: Handle index files properly (they define public API, shouldn't be skipped)

## Current State Analysis

### File Selection (The Blind Spot)
```typescript
// codebase-explorer-agent.ts:345-362
private selectKeyFiles(files: string[]): string[] {
  const sorted = [...files].sort((a, b) => {
    // Deprioritize index files
    const aIsIndex = aName.startsWith('index.');
    // Sort by name length
    return aName.length - bName.length;
  });
  return sorted.slice(0, this.MAX_FILES_TO_PREFETCH);  // Always first 10
}
```

### Coverage Data Available
- `OrchestratorContext.undocumentedDirectories` - per-directory stats
- `calculateGraduatedCoverage()` - returns 0/25/50/100% per file
- `OrchestratorContext.fileCoverageTree` - formatted string (not programmatic)

### Work Target Structure
```typescript
export interface PathTarget {
  type: 'path';
  path: string;
  // NO per-file hints currently
}
```

---

## Implementation Steps

### Phase 1: Extend PathTarget with Priority Files

**File: `src/domain/work-target.ts`**

Add optional `priorityFiles` to PathTarget:
```typescript
export interface PathTarget {
  type: 'path';
  path: string;
  /** Files to prioritize reading (low-coverage files) */
  priorityFiles?: string[];
}
```

Update `getWorkTargetKey()` to include undocumented count for smarter deduplication:
```typescript
case 'path':
  const undocCount = target.priorityFiles?.length ?? 0;
  return `path:${target.path}:undoc=${undocCount}`;
```

**Tests to write first** (`tests/unit/work-target.test.ts`):
- `createPathTarget` with priorityFiles
- `getWorkTargetKey` includes undoc count
- Type guard still works with extended type

### Phase 2: Extend Context Gatherer with Low-Coverage File List

**File: `src/agents/orchestrator/context-gatherer.ts`**

Add to `OrchestratorContext` interface (around line 92):
```typescript
/** Files with coverage < 50%, sorted by priority (lowest coverage first) */
lowCoverageFiles: Array<{ path: string; coverage: number; directory: string }>;
```

Modify existing `calculateUndocumentedDirectories()` (line 335-403) to return both.
The method already iterates over sourceFiles and calls `calculateGraduatedCoverage()`.
Just need to collect the low-coverage files at the same time:

```typescript
// Change method signature to return both
private async calculateUndocumentedDirectoriesAndFiles(
  repoId: string,
  wikiPages: Array<{ path: string; content: string }>
): Promise<{
  directories: UndocumentedDirectory[];
  files: Array<{ path: string; coverage: number; directory: string }>;
}>

// Inside the existing loop (line 355), add file collection:
const lowCoverageFiles: Array<{ path: string; coverage: number; directory: string }> = [];

for (const filePath of sourceFiles) {
  // ... existing logic ...
  const coverage = calculateGraduatedCoverage(filePath, wikiPages);
  const isUndocumented = coverage < FILE_COVERAGE_THRESHOLD;

  // NEW: Collect individual files
  if (isUndocumented) {
    lowCoverageFiles.push({ path: filePath, coverage, directory: dirPath });
  }
  // ... existing directory stats update ...
}

// Sort: 0% coverage first, then by path length (shorter = more core)
lowCoverageFiles.sort((a, b) => {
  if (a.coverage !== b.coverage) return a.coverage - b.coverage;
  return a.path.length - b.path.length;
});

return { directories: undocumentedDirs, files: lowCoverageFiles };
```

Update `gather()` method (line ~277) to use new return:
```typescript
const { directories: undocumentedDirectories, files: lowCoverageFiles } =
  await this.calculateUndocumentedDirectoriesAndFiles(repoId, wikiPages);
```

**Tests to write first** (`tests/unit/context-gatherer-low-coverage-files.test.ts`):
- Returns files with coverage < 50%
- Sorted by coverage ascending
- Includes directory path for each file
- Handles empty wiki (all files are low coverage)
- Filters out test/declaration files

### Phase 3: Update Strategy to Pass Priority Files

**File: `src/agents/orchestrator/strategies.ts`**

Modify `codebaseExplorationStrategy` to include priority files in target:
```typescript
for (const dir of dirsToExplore) {
  // Get low-coverage files in this directory
  const priorityFiles = context.lowCoverageFiles
    .filter(f => f.directory === dir.path)
    .map(f => f.path)
    .slice(0, 20);  // Cap to prevent huge payloads

  workItems.push(
    createWorkItem({
      id: uuid(),
      repoId: ctx.repoId,
      agentType: 'codebase-explorer',
      target: { type: 'path', path: dir.path, priorityFiles },
    })
  );
}
```

**Tests to write first** (`tests/unit/orchestrator-priority-files.test.ts`):
- Work items include priorityFiles from lowCoverageFiles
- Only includes files in the target directory
- Caps priorityFiles to reasonable limit
- Handles directory with no low-coverage files

### Phase 4: Make selectKeyFiles Coverage-Aware

**File: `src/agents/analysis/codebase-explorer-agent.ts`**

Modify `selectKeyFiles()` to accept and use priority files:
```typescript
private selectKeyFiles(files: string[], priorityFiles?: string[]): string[] {
  if (priorityFiles && priorityFiles.length > 0) {
    // Prioritize files explicitly marked as low-coverage
    const prioritySet = new Set(priorityFiles);
    const priority = files.filter(f => prioritySet.has(f));
    const others = files.filter(f => !prioritySet.has(f));

    // Fill remaining slots with other files (still sorted by existing logic)
    const othersSorted = this.sortByDefaultPriority(others);
    return [...priority, ...othersSorted].slice(0, this.MAX_FILES_TO_PREFETCH);
  }

  // Fallback to existing behavior
  return this.sortByDefaultPriority(files).slice(0, this.MAX_FILES_TO_PREFETCH);
}

private sortByDefaultPriority(files: string[]): string[] {
  return [...files].sort((a, b) => {
    const aName = a.split('/').pop() || '';
    const bName = b.split('/').pop() || '';
    // Deprioritize index files (but don't skip entirely - see Phase 6)
    const aIsIndex = aName.startsWith('index.');
    const bIsIndex = bName.startsWith('index.');
    if (aIsIndex && !bIsIndex) return 1;
    if (!aIsIndex && bIsIndex) return -1;
    return aName.length - bName.length;
  });
}
```

Pass priority files through the call chain:

1. **In `run()` method** (line 46): Extract priorityFiles from target
```typescript
const targetPath = target.path;
const priorityFiles = target.priorityFiles;  // NEW
```

2. **Pass to `runWithPrefetch()`** (line 60): Add parameter
```typescript
const prefetchResult = await this.runWithPrefetch(
  targetPath, existingPagePaths, context, priorityFiles
);
```

3. **In `runWithPrefetch()`** (line 74): Accept and use
```typescript
private async runWithPrefetch(
  targetPath: string,
  existingPagePaths: string[],
  context: AgentContext,
  priorityFiles?: string[]  // NEW
): Promise<AgentRunResult | null> {
  // ...line 97:
  const keyFiles = this.selectKeyFiles(dirListing.files, priorityFiles);
}
```

4. **In `runWithTools()`** (line 167): Also pass through for consistency
```typescript
return this.runWithTools(targetPath, existingPagePaths, context, priorityFiles);
```

**Tests to write first** (`tests/unit/codebase-explorer-priority-files.test.ts`):
- Priority files are read first
- Remaining slots filled with other files
- Falls back to default behavior when no priority files
- Priority files outside directory are filtered out
- Handles more priority files than MAX_FILES_TO_PREFETCH

### Phase 5: Track Files Actually Documented (Improvement #1)

**File: `src/agents/analysis/codebase-explorer-agent.ts`**

Add to result tracking which files got wiki pages:
```typescript
// In generateUpdates() or after parsing response
const documentedFiles = analysis.wikiPages.flatMap(page => {
  // Extract file paths mentioned in the wiki page
  return page.relatedPaths || [];  // If we track this
});

// Add to tool metrics or findings
return {
  result: createAgentResult({...}),
  updates,
  costUsd: completion.costUsd,
  toolMetrics: {
    ...existingMetrics,
    filesDocumented: documentedFiles,  // NEW
  },
};
```

**Note**: This requires extending `ToolMetrics` interface in `base-agent.ts`:
```typescript
export interface ToolMetrics {
  toolCallCount: number;
  toolsUsed: Record<string, number>;
  filesRead: string[];
  filesDocumented?: string[];  // NEW
}
```

**Tests to write first** (`tests/unit/codebase-explorer-files-documented.test.ts`):
- Tracks files that got dedicated wiki pages
- Differentiates between files read vs files documented
- Empty when no wiki pages created

### Phase 6: Handle Index Files Properly (Improvement #4)

**File: `src/agents/analysis/codebase-explorer-agent.ts`**

Currently, index files are:
1. Filtered OUT from source files (line 332): `skipPatterns = ['.test.', '.spec.', '.d.ts', 'index.ts', 'index.js']`
2. Deprioritized in selection (line 351): `if (aIsIndex && !bIsIndex) return 1`

Change approach:
- **Don't filter out index files** - they define public API
- **Still deprioritize** in default sorting (they're less detailed than implementations)
- **BUT**: if index file has low coverage, it should be included via priorityFiles

```typescript
// Change isSourceFile to NOT skip index files
private isSourceFile(filename: string): boolean {
  const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt'];
  const skipPatterns = ['.test.', '.spec.', '.d.ts'];  // REMOVED index.ts, index.js

  if (skipPatterns.some(p => filename.includes(p))) {
    return false;
  }
  return sourceExtensions.some(ext => filename.endsWith(ext));
}
```

**Tests to write first** (`tests/unit/codebase-explorer-index-files.test.ts`):
- Index files are included in source files
- Index files are deprioritized in default sort
- Index files with low coverage ARE included via priorityFiles
- Index files can get wiki documentation

---

## Test Summary

### New Test Files
1. `tests/unit/work-target-priority-files.test.ts` - PathTarget extension
2. `tests/unit/context-gatherer-low-coverage-files.test.ts` - Low coverage file collection
3. `tests/unit/orchestrator-priority-files.test.ts` - Strategy passing priority files
4. `tests/unit/codebase-explorer-priority-files.test.ts` - Coverage-aware file selection
5. `tests/unit/codebase-explorer-files-documented.test.ts` - Tracking documented files
6. `tests/unit/codebase-explorer-index-files.test.ts` - Index file handling

### Existing Tests to Update
- `tests/unit/work-target.test.ts` - New key format with undoc count
- `tests/unit/codebase-explorer-depth.test.ts` - May need mock updates
- `tests/unit/orchestrator-deep-targeting.test.ts` - Add priorityFiles expectations

---

## Rollout Strategy

1. **Phase 1-2**: Domain/context changes (low risk, no behavior change)
2. **Phase 3-4**: Strategy and agent changes (core feature)
3. **Phase 5**: Metrics enhancement (additive)
4. **Phase 6**: Index file handling (behavior change, test carefully)

---

## Success Metrics

After implementation, we can measure:
- **Files with 0% coverage** should decrease over iterations
- **Re-exploration of same directory** should read different files
- **Index files** should appear in wiki documentation
- **Large directories (30+ files)** should eventually reach full coverage

---

## Estimated Scope

- ~150 lines new code
- ~100 lines modified
- ~300 lines of tests
- 6 new test files
