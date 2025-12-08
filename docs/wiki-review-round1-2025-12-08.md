# Wiki Generation Review - Round 1

**Date:** 2025-12-08
**Model:** google/gemini-2.5-flash (via OpenRouter)
**Target Repository:** CodeWiki (self)
**Iterations Attempted:** 100 (across 2 runs of 50)

## Executive Summary

The wiki generation system was tested against the CodeWiki repository itself. Despite significant API connectivity issues (503 errors), the system generated 53 wiki pages. This review identifies critical issues with page titles, orphan pages, link tracking, and agent reliability.

## Run Statistics

### Overall Metrics
| Metric | Value |
|--------|-------|
| Total Wiki Pages | 53 |
| Total Agent Runs | 97 |
| Successful Runs | 39 (40.2%) |
| Failed Runs | 58 (59.8%) |
| Total Cost | $0.1089 |
| Commits Processed | 1 (of 265) |

### Agent Performance by Type
| Agent Type | Total Runs | Failures | Success Rate |
|------------|------------|----------|--------------|
| codebase-explorer | 72 | 51 | 29.2% |
| code-change | 6 | 5 | 16.7% |
| writer | 4 | 0 | 100% |
| link | 4 | 0 | 100% |
| overview | 2 | 0 | 100% |
| quality | 2 | 1 | 50% |
| extension-guide | 2 | 1 | 50% |
| bootstrap | 1 | 0 | 100% |
| getting-started | 1 | 0 | 100% |
| testing-guide | 1 | 0 | 100% |
| wiki-editor | 1 | 0 | 100% |
| dependency | 1 | 0 | 100% |

### Error Distribution
| Error Type | Count |
|------------|-------|
| Tool Enforcement Error | 38 |
| API 503 Error | 17 |
| Missing Required Tool | 3 |

## Critical Issues Identified

### 1. Page Titles Not Set (CRITICAL)
**Severity:** Critical
**Pages Affected:** 35 of 53 (66%)

All wiki pages have their title field set to "Untitled" despite having proper H1 headers in their content. This suggests the title extraction from content is not working.

**Example:**
- Page path: `overview`
- Title field: `"Untitled"`
- Content starts with: `**# CodeWiki - Overview**`

**Impact:** Navigation, search, and index functionality would show "Untitled" for most pages.

### 2. Orphan Pages (HIGH)
**Severity:** High
**Pages Affected:** 11 of 53 (20.8%)

These pages have no backlinks from other pages, making them effectively unreachable:
- `commits/e51de5c0`
- `architecture/query-design`
- `web/overview`
- `web/server-configuration`
- `web/routes`
- `web/available-models`
- `agents/consolidation/finding-handlers-overview`
- `agents/consolidation/handlers/broken-link-handler`
- `services/llm/analysis-tools/wiki-history-and-provenance`
- `guides/overview`
- `repositories/mongodb-implementations`

**Impact:** Users cannot navigate to these pages without knowing the exact path.

### 3. Links in Content Not Tracked (HIGH)
**Severity:** High

Markdown links in page content are not being parsed and added to the `links` array. Pages like `guides/overview` have markdown links in content but empty `links` arrays.

**Example from `guides/overview`:**
- Content contains: `[Getting Started](guides/getting-started.md)`
- Links array: `[]`

**Impact:** Link analysis and broken link detection fail because the system doesn't know about these links.

### 4. Inconsistent Link Formatting (MEDIUM)
**Severity:** Medium

Some pages use inconsistent link formats within the same content:
- `[Getting Started](guides/getting-started.md)` (with .md extension)
- `[guides/getting-started](guides/getting-started)` (without extension)

This inconsistency could cause broken links when the system expects one format.

### 5. Very Low Commit Coverage (HIGH)
**Severity:** High

Only 1 commit out of 265 has been processed into a wiki page, resulting in 0.4% commit coverage. The generated commit page (`commits/e51de5c0`) contains minimal content.

**Impact:** The wiki lacks historical context and code change documentation.

### 6. codebase-explorer Agent Unreliable (HIGH)
**Severity:** High
**Failure Rate:** 70.8%

The codebase-explorer agent has the highest failure rate. Most failures are "Tool Enforcement Errors" where the agent:
- Made 0 tool calls when 2 were required
- Didn't use required `list_directory` tool
- Made only 1 tool call when 2 were required

This suggests the model (gemini-2.5-flash) has difficulty following tool-use requirements consistently.

### 7. Narrow Confidence Score Range (LOW)
**Severity:** Low

All pages have confidence scores between 0.50 and 0.55, a very narrow range. This suggests the confidence calculation may not be meaningful or nuanced enough.

### 8. Commit Page Quality (MEDIUM)
**Severity:** Medium

The single commit page generated has very sparse content:
```markdown
# Merge pull request #232...

## Source
- **Commit:** e51de5c0
- **Files:** `tests/e2e/repositories.spec.ts`, `src/web/public/modules/repos.js`
```

This lacks the actual analysis of what the commit does, why it was made, and its impact.

## Content Quality Assessment

### Positive Observations

1. **Good Structure:** Most generated pages have proper markdown structure with headers, lists, and code blocks
2. **Accurate Technical Content:** The content generated from code exploration appears accurate (verified against actual codebase)
3. **Code Examples:** Many pages include relevant TypeScript code snippets
4. **Related Pages Sections:** 40 of 53 pages (75.5%) include "Related Pages" sections
5. **Documentation Attribution:** 46 of 53 pages (86.8%) include "Documentation generated by" attribution

### Areas for Improvement

1. **Page Length Consistency:** Most pages are 2,900-14,800 chars, but one page is only 212 chars
2. **Missing Guides:** Extension guide agent failed to complete, leaving that guide potentially incomplete
3. **Hierarchical Navigation:** No table of contents or index page to navigate the wiki

## Recommendations

### Immediate Fixes

1. **Fix Title Extraction:** Investigate why page titles aren't being extracted from H1 headers
2. **Parse Content Links:** Add logic to extract markdown links from content and add to links array
3. **Improve codebase-explorer Reliability:** Consider stricter prompt engineering or different model selection for tool-calling tasks

### System Improvements

1. **Add Wiki Index Page:** Auto-generate a root index page that links to all main sections
2. **Orphan Page Detection:** Add a meta agent that identifies and links orphan pages
3. **Confidence Score Refinement:** Make confidence scoring more granular based on source verification, depth of analysis, etc.
4. **Commit Analysis Quality:** Enhance code-change agent to produce richer commit documentation

### Testing Recommendations

1. Test with a more reliable model for tool-calling (e.g., Claude, GPT-4)
2. Run with lower concurrency to reduce API errors
3. Add monitoring for orphan page accumulation

## Raw Data Summary

### Wiki Pages by Category
| Category | Count |
|----------|-------|
| agents/ | 18 |
| services/ | 11 |
| guides/ | 4 |
| domain/ | 3 |
| web/ | 5 |
| repositories/ | 4 |
| queries/ | 2 |
| utils/ | 3 |
| architecture/ | 2 |
| quality-benchmark/ | 2 |
| commits/ | 1 |
| overview | 1 |

### Files Referenced
- `.codewiki-data/wiki-pages.json` - 53 pages, 1213 lines
- `.codewiki-data/agent-runs.json` - 97 runs
- `.codewiki-data/orchestrator-runs.json` - planning decisions
- `.codewiki-data/work-queue.json` - 124 items (39 completed, 61 failed, 24 pending)
