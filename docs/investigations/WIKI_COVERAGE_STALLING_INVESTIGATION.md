# Wiki Coverage KPI Stalling Investigation

## Issue Summary

Users reported that the wiki coverage KPI appears to "stall" for GitHub-based repositories even as more wiki pages are created.

## Key Finding

**The stalling is expected behavior, not a bug.** The file documentation coverage metric (`fileDocCoverage`) is structurally limited by how wiki content is generated.

## How Coverage is Calculated

### Source Files

1. **File Tree Retrieval** (`src/services/repository/repository-service.ts:151-182`)
   - For GitHub repos: Fetches via `githubService.getTree()` API
   - Applies cwignore filtering (`.gitignore` + `.cwignore`)
   - Returns list of file paths

2. **Source File Filtering** (`src/agents/orchestrator/orchestrator.ts:842-865`)
   - Filters to TypeScript/JavaScript files only
   - Excludes test files, type definitions, and common non-source directories

### Coverage Calculation

1. **Per-File Coverage** (`src/agents/orchestrator/file-coverage-tree.ts:247-325`)

   The `calculateGraduatedCoverage()` function assigns coverage tiers:
   - **0%** - File not mentioned anywhere in wiki pages
   - **25%** - File name mentioned at least once (in passing)
   - **50%** - File has dedicated heading OR 3+ mentions
   - **100%** - Wiki page path matches file name (dedicated page)

2. **Aggregate Calculation** (`src/agents/orchestrator/file-coverage-tree.ts:790-843`)

   `calculateAggregateFileCoverage()` computes weighted average:
   - Each file contributes `coverage * LOC` to numerator
   - Denominator is total LOC
   - For GitHub repos: All files get `DEFAULT_LOC = 75` (estimated)

### KPI Capture and Display

1. **Capture** (`src/executor/executor.ts:238-245, 408-415`)
   - Called via `orchestrator.getWorkSummary()` after each iteration
   - Stored in `iteration.kpiSnapshot`

2. **Retrieval** (`src/web/routes/processing.ts:477-552`)
   - Endpoint: `GET /api/repos/{id}/page-history`
   - Returns `fileCoverage` from each iteration's KPI snapshot

3. **Display** (`src/web/public/modules/benchmark.js:361-377`)
   - Shows as "File Coverage" line in benchmark chart

## Why Coverage Stalls

### Root Cause: Semantic Mismatch

Wiki pages are designed to be **conceptual documentation** about architecture and patterns, NOT file-level documentation:

- `code-change-agent` creates "encyclopedia articles" about what changed
- `codebase-explorer-agent` documents undocumented parts of the codebase
- Neither explicitly lists every source file by name

Example scenario:
- Repository has 500 source files
- Wiki has 100 pages about patterns like "CQRS", "Error Handling", "Auth Flow"
- Pages might only mention ~50 unique file names
- Coverage caps at ~10% even with many pages

### GitHub-Specific Factors

1. **API Tree Truncation** (`src/services/github/github-repo-service.ts:383-385`)
   - GitHub's Git Trees API may return truncated results for large repos
   - Only logged as warning, calculation proceeds with partial list

2. **Tree Caching** (`src/services/github/github-api-cache.ts:52, 262-264`)
   - File trees cached for 5 minutes using branch name as cache key
   - Multiple iterations within window use same file list

3. **No Actual LOC** (`src/agents/orchestrator/orchestrator.ts:801`)
   - All GitHub repo files get `DEFAULT_LOC = 75`
   - Coverage weighting treats all files equally

## Source Files Referenced

| File | Lines | Purpose |
|------|-------|---------|
| `src/agents/orchestrator/file-coverage-tree.ts` | 247-325, 790-843 | Coverage calculation logic |
| `src/agents/orchestrator/orchestrator.ts` | 746-837, 842-865 | `getWorkSummary()` and file filtering |
| `src/services/repository/repository-service.ts` | 151-182 | GitHub file tree retrieval |
| `src/services/github/github-repo-service.ts` | 364-394, 383-385 | GitHub Trees API, truncation warning |
| `src/services/github/github-api-cache.ts` | 47-54, 262-264 | Cache TTLs and tree caching |
| `src/executor/executor.ts` | 238-245, 408-415 | KPI snapshot capture |
| `src/web/routes/processing.ts` | 477-552 | Page history endpoint |
| `src/web/public/modules/benchmark.js` | 228-377 | Chart rendering with coverage lines |

## Recommendations

1. **Consider renaming the metric** - "File Coverage" implies all files should be covered. "File Documentation Mentions" would be more accurate.

2. **Add tooltip explanation** - Explain in the UI that this metric tracks how many source files are explicitly mentioned in wiki pages.

3. **Consider alternative metrics**:
   - Ratio of documented directories vs total directories
   - Percentage of significant files (entry points, configs) documented
   - Count of files with dedicated wiki pages

4. **For GitHub repos specifically**:
   - Consider fetching actual LOC for weighted calculations
   - Handle API truncation more gracefully (paginate or warn user)
