# Plan: Add Coverage Metrics Dashboard to Main Card

## Overview

Add comprehensive coverage metrics to the repository card on the main UI, displaying:
1. **File Documentation Coverage** - Aggregate percentage of source files documented in wiki
2. **Per-Agent Coverage Breakdown** - Visual breakdown of security/architecture/quality agent progress
3. **Average Confidence** - Wiki page quality indicator
4. **Open Issues** - Combined conflicts + findings count

## Current State

The main card currently shows 4 stats:
- Commits (total)
- Processed (commits processed)
- Wiki Pages (count)
- Coverage (commit-based %)

The `WorkSummary` interface already provides `agentCoverage`, `avgConfidence`, `openConflicts`, and `openFindings` - but they're not displayed.

**File documentation coverage is NOT currently calculated** - the graduated coverage system exists but only for orchestrator context, not as an aggregate metric.

## Implementation Steps

### Step 1: Backend - Add File Documentation Coverage Calculation

**File:** `src/agents/orchestrator/orchestrator.ts`

1. Add new fields to `WorkSummary` interface:
   ```typescript
   export interface WorkSummary {
     // ... existing fields ...
     fileDocCoverage: number;        // Aggregate file documentation coverage (0-100)
     totalSourceFiles: number;       // Total source files in repo
     documentedFiles: number;        // Files with coverage > 0
   }
   ```

2. Create helper function to calculate aggregate file coverage:
   - Reuse `calculateGraduatedCoverage` from `file-coverage-tree.ts`
   - Calculate weighted average across all source files
   - Return aggregate percentage

3. Update `getWorkSummary()` in both:
   - `src/agents/orchestrator/orchestrator.ts` (DefaultOrchestrator)
   - `src/agents/orchestrator/phased-orchestrator.ts` (PhasedOrchestrator)

**Dependencies:**
- Need `repoAccessFactory` to get file tree (currently optional in orchestrator)
- May need to pass it through from routes

### Step 2: Backend - Update API Response

**File:** `src/web/routes/repos.ts`

1. Ensure orchestrator is created with `repoAccessFactory` for file coverage:
   ```typescript
   const orchestrator = createOrchestrator(repos, undefined, undefined, repoAccessFactory);
   ```

2. The `...summary` spread already includes all WorkSummary fields, so new fields will be automatically included.

### Step 3: Frontend - Redesign Stats Section

**File:** `src/web/public/modules/repos.js`

Redesign the card-stats section to show two rows:

**Row 1 - Primary Metrics (existing):**
- Commits / Processed / Wiki Pages / Coverage

**Row 2 - Quality Metrics (new):**
- File Coverage (with color indicator)
- Confidence (with color indicator)
- Open Issues (conflicts + findings, red if > 0)
- Agent Progress (mini breakdown or summary)

```javascript
<div class="card-stats">
  <!-- Row 1: Primary -->
  <div class="stat">...</div>
  ...
</div>
<div class="card-stats card-stats-secondary">
  <!-- Row 2: Quality -->
  <div class="stat">
    <div class="stat-value ${getColorClass(repo.fileDocCoverage)}">${(repo.fileDocCoverage || 0).toFixed(0)}%</div>
    <div class="stat-label">File Coverage</div>
  </div>
  <div class="stat">
    <div class="stat-value ${getColorClass(repo.avgConfidence)}">${(repo.avgConfidence || 0).toFixed(0)}%</div>
    <div class="stat-label">Confidence</div>
  </div>
  <div class="stat">
    <div class="stat-value ${(repo.openConflicts + repo.openFindings) > 0 ? 'stat-warning' : ''}">${(repo.openConflicts || 0) + (repo.openFindings || 0)}</div>
    <div class="stat-label">Open Issues</div>
  </div>
  <div class="stat stat-agents">
    <!-- Agent coverage mini-bars or summary -->
  </div>
</div>
```

### Step 4: Frontend - Add Agent Coverage Visualization

**File:** `src/web/public/modules/repos.js`

Create a mini-visualization for per-agent coverage:
- Show 3-4 key agents as small progress bars or dots
- Color-coded by coverage level
- Hover tooltip with exact percentages

### Step 5: CSS Styling Updates

**File:** `src/web/public/styles.css`

Add styles for:
1. Secondary stats row (`.card-stats-secondary`)
2. Color classes for coverage levels:
   - `.stat-high` (green, >= 70%)
   - `.stat-medium` (amber, >= 40%)
   - `.stat-low` (red, < 40%)
3. Warning indicator for open issues (`.stat-warning`)
4. Agent coverage mini-bars (`.agent-coverage-mini`)

### Step 6: Testing

1. **Unit tests** for file coverage calculation:
   - `tests/unit/file-doc-coverage.test.ts` (new)
   - Test aggregate calculation with various file/wiki combinations

2. **Integration tests** for API:
   - Update existing repos API tests to verify new fields

3. **E2E tests**:
   - Update `tests/e2e/repositories.spec.ts` to check for new stats

## File Changes Summary

| File | Changes |
|------|---------|
| `src/agents/orchestrator/orchestrator.ts` | Add WorkSummary fields, implement file coverage calc |
| `src/agents/orchestrator/phased-orchestrator.ts` | Same changes for phased orchestrator |
| `src/agents/orchestrator/file-coverage-tree.ts` | Export helper for aggregate calculation |
| `src/web/routes/repos.ts` | Pass repoAccessFactory to orchestrator |
| `src/web/public/modules/repos.js` | Add new stats display |
| `src/web/public/styles.css` | Add styling for new elements |
| `tests/unit/file-doc-coverage.test.ts` | New test file |
| `tests/e2e/repositories.spec.ts` | Update stat count expectations |

## Estimated Scope

- ~100 lines new TypeScript (backend)
- ~80 lines new JavaScript (frontend)
- ~50 lines new CSS
- ~60 lines new tests
- ~20 lines modified across existing files

## Risk Considerations

1. **Performance**: File coverage calculation requires file tree access - may be slow for large repos
   - Mitigation: Cache the result, only recalculate when wiki changes

2. **Missing repoAccessFactory**: Some orchestrator instances may not have it
   - Mitigation: Return null/0 for file coverage when unavailable

3. **UI Clutter**: Adding too many stats could overwhelm the card
   - Mitigation: Use secondary row with smaller styling, collapsible on mobile
