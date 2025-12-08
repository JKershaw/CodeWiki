# Observed Issues from Wiki Generation Review

**Date:** 2025-12-08
**Model:** meta-llama/llama-4-maverick
**Test Repository:** CodeWiki (this repo)

This document consolidates all issues observed during wiki generation testing. Issues are categorized by severity and component.

---

## Critical Bugs (System Breaking)

### 1. Work Queue Stalling Due to Insufficient Fetch Limit

**Location:** `src/repositories/file-based/file-work-queue-repository.ts:117`

**Problem:** The `claimBatch` function fetches only `maxItems * 3` pending items before filtering. When many blocked items accumulate at the front of the FIFO queue, claimable items are never fetched.

**Evidence:**
- 62 pending items in queue
- Positions 1-14: analysis agents waiting for code-change (all blocked)
- Position 15: first code-change item (never fetched when window is 12 items)
- Position 27+: codebase-explorer and meta agents (never fetched)

**Impact:** System stops processing despite having plenty of work available.

**Suggested Fix:** Increase multiplier to `maxItems * 20` or dynamically expand the fetch window when filtering removes most items.

---

## High Priority Issues

### 2. Duplicate Content Detection Missing

**Problem:** The system creates multiple pages documenting the same concept with no deduplication.

**Evidence:**
- `domain/repo-model` (title: "Untitled")
- `domain/repository-model` (title: "Repository Model")

Both describe the `Repo` interface with nearly identical content.

**Impact:** Wasted processing budget, confusing navigation, reduced wiki quality.

**Suggested Fix:** Before creating a page, check existing pages for semantic similarity. Use embedding comparison or keyword overlap detection.

---

### 3. Link Agent Creates Duplicate Links

**Problem:** The link agent adds the same link multiple times with slightly different reasons.

**Evidence:**
```markdown
## Related Pages

- [Repository Domain Model](domain/repo-model) - The overview mentions...
- [Repository Domain Model](domain/repo-model) - Both pages are related...
- [Repository Domain Model](domain/repo-model) - The overview mentions...
- [Repository Domain Model](domain/repo-model) - Both pages are related...
```

**Impact:** Cluttered pages, unprofessional appearance.

**Suggested Fix:** Deduplicate links before adding to page. Check if link target already exists in the links array.

---

### 4. High Agent Failure Rate with llama-4-maverick

**Problem:** 19.4% of agent runs failed due to tool enforcement errors.

**Evidence:**
- codebase-explorer: 6 failures (not using required `read_file` or making only 1 tool call)
- code-change: 1 failure (0 tool calls made)

**Impact:** Wasted processing budget, incomplete wiki coverage.

**Suggested Fix:**
- Improve prompts to emphasize tool usage requirements
- Add retry logic for soft failures
- Consider model-specific prompt tuning

---

### 5. Markdown Links Not Tracked in links Array

**Problem:** When agents write markdown links in page content, these links are not parsed and added to the page's `links` array.

**Evidence:** `architecture/repositories` page has:
```markdown
## Related Pages
- [Domain/Repo Model](domain/repo-model): Details about...
```
But `"links": []` in the page record.

**Impact:** Backlink tracking broken, link validation impossible, navigation graph incomplete.

**Suggested Fix:** Parse page content for markdown links and merge with explicit links array.

---

## Medium Priority Issues

### 6. Page Created with "Untitled" Title

**Problem:** Some pages are created without proper titles.

**Evidence:** `domain/repo-model` has `"title": "Untitled"`

**Impact:** Poor wiki quality, confusing navigation.

**Suggested Fix:** Validate that all page creation includes a meaningful title. Infer from path or content if not provided.

---

### 7. Empty Content Sections in Generated Pages

**Problem:** Pages are created with empty placeholder sections.

**Evidence:**
- `commits/0c4a07a3`: Empty description after title
- `decisions/codebase-explorer-agent-improvements`: Empty "Key Points" section

**Impact:** Low-quality pages, poor user experience.

**Suggested Fix:** Validate page content has minimum quality before saving. Retry generation if content is empty.

---

### 8. Agent Summaries Empty Despite Successful Exploration

**Problem:** Some codebase-explorer runs complete successfully but return empty `summary` fields.

**Evidence:**
- `src/services`: `"summary": ""`
- `src/queries`: `"summary": ""`
- `src/executor`: `"summary": ""`

**Impact:** No knowledge captured from these explorations despite spending budget.

**Suggested Fix:** Validate agent output includes non-empty summary. Fail or retry if summary is missing.

---

### 9. Hallucinated/Malformed Agent Output

**Problem:** Agent outputs sometimes contain raw code/prompt artifacts instead of proper content.

**Evidence:** codebase-explorer for `src/agents` returned:
```
"'Code analysis completed',\n        findings,\n...
```
This is clearly code from the agent's own implementation leaked into output.

**Impact:** Corrupt data in wiki, wasted processing budget.

**Suggested Fix:** Add output validation to detect code-like patterns or JSON artifacts. Retry if detected.

---

## Low Priority Issues

### 10. Inconsistent Page Path Organization

**Problem:** Pages use multiple path conventions with no clear hierarchy.

**Evidence:**
- Root level: `overview`
- Domain: `domain/repo-model`, `domain/repository-model`
- Architecture: `architecture/repositories`
- Services: `services/llm-service`
- Utils: `utils/concurrency-limiter`
- Commits: `commits/54c3f156`
- Guides: `guides/documentation-generation-guidelines`
- Decisions: `decisions/codebase-explorer-agent-improvements`

**Impact:** Difficult to navigate, no clear information architecture.

**Suggested Fix:** Define and enforce a path naming convention. Consider auto-generating an index page.

---

### 11. No Navigation Structure

**Problem:** Wiki has no index page, table of contents, or sitemap.

**Impact:** Users must guess page paths or browse aimlessly.

**Suggested Fix:** Auto-generate navigation pages when wiki reaches certain size thresholds.

---

### 12. Very Low Commit Coverage

**Problem:** Only 2 of 258 commits (0.8%) were processed.

**Impact:** Wiki captures almost none of the project's evolution and decision history.

**Root Cause:** Combination of work queue stalling (#1) and orchestrator prioritizing exploration over commit analysis.

---

## Orchestrator Issues

### 13. Orchestrator Over-Prioritizes Exploration

**Problem:** The orchestrator generates many codebase-explorer tasks but few code-change tasks, leading to a static wiki that doesn't capture project evolution.

**Evidence:** Of 62 pending items:
- codebase-explorer: 24 items
- code-change: 4 items
- Other analysis: 22 items

**Impact:** Historical context and decisions are not captured.

---

### 14. Orchestrator Generates Work Items for Non-Existent Commits

**Problem:** Log shows "Invalid commit ID for security: 0c4a07a386319be3adc56e83e887e03eafb24342"

**Evidence:** The 'e' in the SHA differs from actual commit SHA which has 'd'.

**Impact:** Wasted work items that can never be processed.

**Root Cause:** Likely LLM hallucinating or truncating commit SHAs when generating work items.

**Suggested Fix:** Strict validation of commit IDs against known commits before creating work items.

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Critical (System Breaking) | 1 |
| High Priority | 4 |
| Medium Priority | 4 |
| Low Priority | 3 |
| Orchestrator Issues | 2 |
| **Total** | **14** |

---

## Recommended Priority Order

1. **Fix work queue stalling** - Critical, system can't make progress without this
2. **Fix link deduplication** - High visibility, easy fix
3. **Add content deduplication** - Prevents wasted budget and confusion
4. **Improve tool enforcement prompts** - Reduce failure rate
5. **Parse markdown links** - Restore backlink functionality
6. **Validate page titles and content** - Quality improvement
7. **Add output validation** - Catch hallucinations early
8. **Improve orchestrator balance** - Better coverage distribution

---

*Note: Second 50 iterations were NOT run because these issues would compound and produce worse results.*
