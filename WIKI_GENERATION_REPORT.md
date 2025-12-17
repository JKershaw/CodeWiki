# Wiki Generation Report: 200-Iteration Analysis

**Generated**: December 17, 2025
**Repository**: CodeWiki (self-documentation run)
**Iterations**: 200

## Executive Summary

This report analyzes the output of a 200-iteration wiki generation run to identify bugs and improvement opportunities. Two critical bugs were found that significantly impact wiki quality.

---

## Overview Metrics

| Metric | Value | Assessment |
|--------|-------|------------|
| Total iterations | 200 | Completed |
| Wiki pages created | 134 | Good output |
| Commits processed | 10 / 978 | **1% - Critical issue** |
| File coverage | 97% touched (300/309 files) | Good |
| Avg confidence | 91.5% | Good |
| Errors | 0 | Clean run |

---

## Issues Identified

### BUG 1: Only 10 Commits Processed (Critical)

**Problem**: Despite 200 iterations and 978 commits in the repository, only 10 commits were analyzed by commit-processing agents.

**Evidence**:
```
Total commits: 978
Commits with processing records: 10
  code-change: 10
  security: 10
  dependency: 10
  narrative: 3
```

**Root Cause**: In `src/agents/orchestrator/context-gatherer.ts`:

```typescript
// Line 336: Only fetches 20 commits total
const commitsQuery = createListCommitsQuery(repoId, { limit: 20 });

// Lines 371-379: Takes only the 10 most recent
const recentCommits = commits
  .sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime())
  .slice(0, 10)  // <-- HARD LIMIT OF 10 COMMITS
```

The orchestrator only ever sees the 10 most recent commits. Once those are processed, `recentCommits` shows them all as processed, and no more commit work is generated - even though 968 commits remain completely unprocessed.

**Impact**: Historical commit analysis is effectively broken. The wiki misses 99% of the codebase's evolution history.

**Recommended Fix**:
- Option A: Remove or significantly increase the limit (paginate through all unprocessed commits)
- Option B: Use `commitsByAgent.pending` counts (which are correct at 968+) to generate work for older commits, not just `recentCommits`

---

### BUG 2: Category Field Never Populated

**Problem**: All 134 wiki pages have `undefined` category, despite the schema supporting it.

**Evidence**:
```javascript
// Wiki page fields include 'category' in schema
// But all pages have: category: undefined
```

**Root Cause**:
1. The `WikiPage` domain has an optional `category` field (`src/domain/wiki-page.ts:31`)
2. Agents must explicitly set `category` in their `WikiPageUpdate` objects
3. No agents currently set this field
4. The system doesn't auto-derive category from the page path

**Impact**: Category-based filtering, organization, and overview generation are impaired. The workaround (using path prefix as implicit category) works but loses explicit metadata.

**Recommended Fix**: When saving a wiki page without a category, auto-derive it from the first path segment:
```typescript
// e.g., path "architecture/overview" -> category: "architecture"
const category = update.category ?? update.path.split('/')[0];
```

---

### ISSUE 3: Work Distribution Heavily Skewed

**Problem**: Work allocation is heavily biased toward file exploration (52.5%) with minimal commit analysis (5%).

**Evidence from orchestrator decisions**:
```
Agent Type          | Work Items | Percentage
--------------------|------------|------------
codebase-explorer   | 105        | 52.5%
overview            | 30         | 15.0%
project-overview    | 17         | 8.5%
code-change         | 10         | 5.0%
security            | 10         | 5.0%
dependency          | 10         | 5.0%
link                | 9          | 4.5%
narrative           | 3          | 1.5%
wiki-index          | 2          | 1.0%
synthesis guides    | 4          | 2.0%
```

**Root Cause**: The phased orchestrator prioritizes breadth coverage (codebase-explorer) over commit analysis. Combined with Bug #1, commit-based agents starve for work.

**Impact**: The wiki becomes a snapshot of current code structure rather than a living history showing how the code evolved.

**Recommended Fix**: Rebalance allocation in the phased orchestrator, especially in Phase 2 (Breadth) and Phase 3 (DepthAndGuides).

---

## Phase Transition Analysis

The phased orchestrator correctly progresses through phases:

| Run | Phase | Pages | Files Touched | Transition Trigger |
|-----|-------|-------|---------------|-------------------|
| 1 | Reconnaissance | 0 | 0/309 | Wiki empty |
| 3 | Skeleton | 5 | 8/309 | pages > 0 |
| 5 | Breadth | 10 | 10/309 | pages >= 10 |
| 48 | DepthAndGuides | 104 | 280/309 (90.6%) | touchedRatio >= 90% |

**Observation**: The 90% touched files threshold for Breadth→DepthAndGuides transition works correctly. The system appropriately spent 43 runs in Breadth phase reaching this threshold.

---

## Synthesis Pages

The system correctly created all key synthesis pages:

| Page Type | Status | Runs |
|-----------|--------|------|
| project-overview | Created | 17 |
| getting-started | Created | 1 |
| testing-guide | Created | 1 |
| extension-guide | Created | 1 |

---

## Root Cause Summary

| Issue | Location | Severity | Fix Complexity |
|-------|----------|----------|----------------|
| 10-commit limit | `context-gatherer.ts:336, 371-379` | Critical | Low |
| Missing categories | Agent outputs + `update-wiki-page.ts` | Medium | Low |
| Work distribution | Phased orchestrator design | Medium | Medium |

---

## Data Files Reference

The following data files were analyzed:
- `.codewiki-data/iterations.json` - 200 iteration records
- `.codewiki-data/orchestrator-runs.json` - 95 orchestrator decisions (7MB)
- `.codewiki-data/wiki-pages.json` - 134 wiki pages
- `.codewiki-data/commits.json` - 978 commits (10 processed)
- `.codewiki-data/work-queue.json` - 79 completed work items
- `.codewiki-data/agent-runs.json` - 200 agent execution records

---

## Recommendations Priority

1. **[P0]** Fix commit visibility bug - This is breaking core functionality
2. **[P1]** Auto-derive category from path - Simple fix with immediate UX benefit
3. **[P2]** Rebalance work allocation - Consider after fixing Bug #1

---

## Appendix: Orchestrator Run Distribution

```
Phase Distribution (95 runs):
  Breadth: 50 runs (52.6%)
  DepthAndGuides: 41 runs (43.2%)
  Reconnaissance: 2 runs (2.1%)
  Skeleton: 2 runs (2.1%)

Work Items Per Run:
  1 item: 48 runs
  2 items: 30 runs
  3-5 items: 10 runs
  6-9 items: 7 runs

Total work items created: 200
```
