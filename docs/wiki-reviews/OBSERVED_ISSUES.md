# Observed Issues Holding the Wiki Back

**Analysis Date:** 2025-12-09
**Iterations Analyzed:** 200 total (two runs of 100)
**Model:** qwen/qwen-turbo
**Repository:** CodeWiki (this repo)

---

## Critical Issues (High Impact)

### 1. Navigation/Connectivity Collapse

**Problem:** The wiki becomes increasingly disconnected as it grows.

| Metric | 100 Iterations | 200 Iterations |
|--------|---------------|----------------|
| Orphan pages (unreachable) | 38% | 45% |
| Dead-end pages (no outlinks) | 83% | 85% |

**Evidence:**
- Main overview page has only 3 outgoing links despite 173 pages existing
- No global table of contents or sitemap page exists
- 78 of 173 pages have zero incoming links

**Root Cause:** The Link Agent runs infrequently and doesn't prioritize connecting orphaned pages. New pages are created without ensuring they're linked from somewhere.

**Impact:** Users cannot discover content. The wiki feels like isolated islands rather than connected knowledge.

---

### 2. Content Duplication

**Problem:** Multiple pages are created for the same topic with identical or near-identical titles.

**Evidence (4 duplicate pairs found):**
- `agents/meta/category-agent` vs `architecture/category-agent`
- `commits/049d5dd1` vs `architecture/test-coverage` (same title: "Test Coverage Configuration with c8")
- `commits/cd544448` vs `architecture/e2e-testing` (same title: "End-to-End Testing Infrastructure")
- `commands/agent-run-management` vs `domain/agent-run`

**Root Cause:**
- Commit analysis creates pages that overlap with codebase exploration pages
- No similarity check before creating new pages
- The "skip similar page" mechanism appears to only work on exact path matches

**Impact:** Confusion, inconsistent information, wasted generation effort.

---

### 3. Factual Inaccuracies Not Corrected

**Problem:** Pages contain verifiably wrong information that persists across iterations.

**Evidence:**
- `guides/testing` claims project uses Jest - it actually uses Node's built-in test runner
- `guides/testing` references `npm run test:watch` - this command doesn't exist
- `guides/getting-started` lists Node.js 18.18.0 - package.json specifies 24.x
- Incorrect npm version listed

**Root Cause:**
- No fact-checking against actual source files (package.json, scripts)
- No agent specifically tasked with verifying claims against source code
- Getting Started agent appears to use generic templates

**Impact:** Developers following the wiki will encounter errors and lose trust.

---

### 4. Template/Placeholder Leakage

**Problem:** Raw LLM template text appears in published wiki pages.

**Evidence:**
Page `commits/86e24e23` contains:
```
Title: [Descriptive title]`
Content: # [Descriptive title]`
[2-3 paragraph article]`
### Findings
`
```

**Root Cause:**
- Response parsing doesn't validate output quality
- No rejection of responses containing obvious template patterns
- Backticks included in template were not stripped

**Impact:** Unprofessional, confusing content that damages wiki credibility.

---

### 5. Broken Links Never Fixed

**Problem:** The same 5 broken links persisted from 100 to 200 iterations with no attempt to fix them.

**Evidence:**
- `guides/getting-started` -> `wiki/understanding-cli` (doesn't exist)
- `guides/getting-started` -> `wiki/environment-variables` (doesn't exist)
- `agents/synthesis/project-overview-agent` links to file names not wiki pages

**Root Cause:**
- Broken link handler exists but doesn't run effectively
- No prioritization of fixing existing issues over creating new content

**Impact:** Dead ends frustrate users, suggest wiki is unmaintained.

---

## Moderate Issues (Medium Impact)

### 6. Low Confidence Scores Universal

**Problem:** Every single page (100%) has confidence below 0.6, with most at 0.5.

**Evidence:** All 173 pages have confidence ≤ 0.55

**Root Cause:**
- Confidence appears to be a static default rather than dynamically calculated
- No mechanism to improve confidence through iteration

**Impact:** System can't distinguish high-quality from low-quality pages.

---

### 7. Short/Stub Pages Proliferating

**Problem:** Pages with minimal content (under 1000 chars) are published.

**Evidence:** 12 pages under 1000 characters including:
- Architecture pages averaging ~850 chars
- Handler documentation pages ~960 chars
- Commit pages as low as 664 chars

**Root Cause:**
- No minimum content threshold for publishing
- Writer agent doesn't expand stub pages

**Impact:** Pages provide little value, poor information density.

---

### 8. Inconsistent Page Organization

**Problem:** Similar content placed in different category hierarchies.

**Evidence:**
- `agents/dependency-agent` should be `agents/analysis/dependency-agent`
- `agents/quality-agent` should be `agents/meta/quality-agent`
- `analysis/narrative-agent` vs `agents/analysis/narrative-agent` (two pages)

**Root Cause:**
- No enforcement of category hierarchy rules
- Different agents create pages in different locations

**Impact:** Users can't predict where to find content.

---

## Minor Issues (Low Impact)

### 9. No Root Navigation

**Problem:** Only 2 root-level pages exist (overview, web-server).

**Root Cause:** Bootstrap agent creates minimal structure.

**Impact:** No clear entry points to major wiki sections.

---

### 10. Category Overview Pages Incomplete

**Problem:** Category pages like `commands/overview` exist but aren't comprehensive.

**Root Cause:** Overview agent runs but doesn't ensure all pages in category are listed.

**Impact:** Missing cross-references within categories.

---

## System Behavior Observations

### What the System Does Well:
1. Generates reasonable individual page content
2. Explores codebase breadth efficiently
3. Creates source code documentation
4. Handles rate limiting/retries gracefully

### What the System Does Poorly:
1. **Prioritization**: Creates new content over fixing problems
2. **Connectivity**: Pages created in isolation without links
3. **Quality gates**: No rejection of low-quality output
4. **Self-healing**: Known issues persist indefinitely
5. **Deduplication**: Same topics documented multiple times

---

## Recommended Priority Fixes

### P0 (Critical):
1. **Enforce connectivity**: New pages must link to/from existing content
2. **Deduplicate**: Check for similar titles/content before creating pages
3. **Validate output**: Reject responses with template patterns

### P1 (High):
4. **Fix broken links**: Prioritize broken link repair over new content
5. **Fact verification**: Check claims against source files
6. **Navigation structure**: Create global TOC, improve overview pages

### P2 (Medium):
7. **Minimum content threshold**: Don't publish pages under 1500 chars
8. **Category enforcement**: Validate page paths match expected patterns
9. **Confidence scoring**: Make confidence meaningful/dynamic

---

## Appendix: Test Methodology

1. Cleared any existing wiki data
2. Set up fresh .env with OpenRouter API key
3. Ran `npm run cli -- process . 100` (first run)
4. Analyzed wiki-pages.json for metrics
5. Ran `npm run cli -- process . 100` (second run)
6. Compared metrics before/after
7. Manually reviewed problematic pages

Scripts used for analysis are in `scripts/analyze-wiki.cjs` and `scripts/check-nav.cjs`.
