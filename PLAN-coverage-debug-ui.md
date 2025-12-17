# Plan: Coverage Information Section in Debug Page

## Overview

Add a collapsible file tree section to the debug page that displays all file and folder coverage metrics. This will help developers understand documentation coverage across the codebase.

## Implementation Steps

### Step 1: Create API Endpoint for Coverage Data

**File:** `src/web/routes/observability.ts`

Add a new endpoint `GET /api/repos/:id/coverage` that returns:
```typescript
interface CoverageResponse {
  tree: DirectoryNodeDTO;      // Hierarchical tree with coverage metrics
  summary: {
    totalFiles: number;
    documentedFiles: number;   // Files with coverage > 0
    lowCoverageFiles: number;  // Files with coverage < 40%
    averageCoverage: number;   // Weighted by LOC
  };
  thresholds: {
    lowCoverage: number;       // 40
  };
}

interface FileNodeDTO {
  type: 'file';
  name: string;
  path: string;
  loc: number;
  coveragePercent: number;
  priorityScore: number;
  isEntryPoint: boolean;
}

interface DirectoryNodeDTO {
  type: 'directory';
  name: string;
  path: string;
  files: FileNodeDTO[];
  children: DirectoryNodeDTO[];
  totalLoc: number;
  totalFileCount: number;
  coveragePercent: number;
  undocumentedCount: number;
  undocumentedRatio: number;
}
```

The endpoint will:
1. Get source files from repository via `GitService`
2. Get wiki pages with file tracking from database
3. Call `buildFileDocumentationScores()` to get scores
4. Call `buildCoverageTree()` to build the tree
5. Enhance nodes with priority scores and entry point flags
6. Calculate summary statistics

### Step 2: Add Coverage Tab to Debug Page

**File:** `src/web/views/pages/debug.ejs`

Add a third tab "Coverage" alongside "Orchestrator Decisions" and "Agent Runs":
```html
<button class="debug-tab" data-tab="coverage">Coverage</button>
```

Add tab content container:
```html
<div id="debug-coverage-tab" class="debug-tab-content">
  <div class="coverage-summary">
    <!-- Summary cards for total files, documented, low coverage, avg coverage -->
  </div>
  <div class="coverage-tree-container">
    <div id="coverage-tree" class="coverage-tree">
      <!-- File tree rendered here -->
    </div>
  </div>
</div>
```

### Step 3: Implement Coverage Tree UI Component

**File:** `src/web/public/modules/debug.js`

Add functions:
- `loadCoverageData(repoId)` - Fetch coverage data from API
- `renderCoverageTree(tree)` - Render hierarchical tree with expand/collapse
- `renderCoverageNode(node, level)` - Render individual file/directory node
- `toggleCoverageNode(path)` - Handle expand/collapse

Node display format:
```
📁 src/agents/ (75% coverage, 12 files)
  ├── 📄 orchestrator.ts (95%, 450 LOC, ★ entry)
  ├── 📄 coverage-agent.ts (60%, 200 LOC)
  └── 📁 helpers/ (40% coverage, 5 files)
      ├── 📄 utils.ts (80%, 50 LOC)
      └── ⚠️ parser.ts (15%, 100 LOC)  ← Low coverage indicator
```

Visual indicators:
- Coverage percentage with color coding (green >70%, yellow 40-70%, red <40%)
- ⚠️ icon for low coverage files (<40%)
- ★ icon for entry points
- LOC count
- Priority score (optional, on hover/expand)

### Step 4: Add CSS Styles

**File:** `src/web/public/styles.css`

Add styles for:
- `.coverage-tree` - Container with scrolling
- `.coverage-node` - File/directory row
- `.coverage-node-header` - Clickable row with toggle
- `.coverage-bar` - Visual coverage progress bar
- `.coverage-percent` - Percentage text with color classes
- `.coverage-badge` - Entry point and low coverage badges
- `.coverage-children` - Nested children container

Color scheme following existing patterns:
- `--coverage-high: var(--success)` (green, >70%)
- `--coverage-medium: var(--warning)` (yellow, 40-70%)
- `--coverage-low: var(--error)` (red, <40%)

### Step 5: Write Tests

#### Unit Test: API Endpoint
**File:** `tests/unit/coverage-api.test.ts`

Test cases:
- Returns correct tree structure
- Calculates summary statistics correctly
- Handles empty repository
- Handles repository with no wiki pages

#### Integration Test: Coverage Data Flow
**File:** `tests/integration/coverage-debug-page.test.ts`

Test cases:
- API returns coverage data for repository with pages
- Coverage percentages match expected calculations
- Entry points are correctly identified
- Low coverage files are flagged

## Files to Modify

| File | Changes |
|------|---------|
| `src/web/routes/observability.ts` | Add `/coverage` endpoint (~80 lines) |
| `src/web/views/pages/debug.ejs` | Add coverage tab and container (~30 lines) |
| `src/web/public/modules/debug.js` | Add coverage loading and rendering (~100 lines) |
| `src/web/public/styles.css` | Add coverage tree styles (~60 lines) |
| `tests/unit/coverage-api.test.ts` | New file (~80 lines) |
| `tests/integration/coverage-debug-page.test.ts` | New file (~60 lines) |

## Estimated Scope

- ~270 lines new code
- ~30 lines modified
- 2 new test files

## Dependencies

Uses existing functions (no new coverage logic needed):
- `buildFileDocumentationScores()` from `context-gatherer.ts`
- `buildCoverageTree()` from `file-coverage-tree.ts`
- `calculatePriorityScoreWithEntryPoint()` from `file-coverage-tree.ts`
- `LOW_COVERAGE_THRESHOLD` constant

## Implementation Order

1. Write failing integration test for API endpoint
2. Implement API endpoint
3. Verify test passes
4. Add UI tab and container (EJS)
5. Add JavaScript rendering logic
6. Add CSS styles
7. Write unit tests for edge cases
8. Run full test suite
