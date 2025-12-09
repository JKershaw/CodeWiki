# Architectural Analysis: Why the Wiki Isn't Growing as Expected

**Date:** 2025-12-09
**Analyzed By:** Claude (Opus 4)
**Repository:** CodeWiki

---

## Executive Summary

After tracing through the system architecture step by step, I've identified **8 critical architectural issues** that explain why the wiki exhibits the observed problems (poor navigation, duplicate content, broken links, low confidence scores, etc.).

The core problem is: **The system prioritizes breadth (creating new content) over depth (improving existing content), with insufficient feedback loops to trigger corrective work.**

---

## System Flow Overview

```
CLI Process Command
       ↓
   Executor.runIterations()
       ↓
   Orchestrator.generateWorkList()
       ↓
   Strategies (Exploration → Synthesis → Meta → Commits)
       ↓
   Work Queue (FIFO)
       ↓
   Agents Execute (create/update WikiPages)
       ↓
   Back to Orchestrator for more work
```

---

## Critical Issues Identified

### Issue 1: Confidence Score Bug (P0)

**Location:** `src/commands/update-wiki-page.ts` lines 42-84

**Problem:** When a page is **created**, the `confidenceDelta` from the agent is **never applied**. Pages are created with default confidence of 0.5 (from `createWikiPage`), and the delta is ignored.

**Code Evidence:**
```typescript
// Line 60 - creates page with confidence 0.5
const page = createWikiPage({...});

// Lines 62-71 - saves and updates links
await repos.wikiPages.save(page);

// NOTE: confidenceDelta from update is NEVER applied during create!
```

Only `update` and `merge` operations apply `confidenceDelta`:
```typescript
// Line 98 (update operation)
confidence: Math.min(1, existing.confidence + update.confidenceDelta)
```

**Impact:** All 173 pages have confidence ≤ 0.55 despite agents specifying high deltas (0.5-0.8). The confidence system is broken for new pages.

**Fix:** Apply `confidenceDelta` during create operation.

---

### Issue 2: Link Agent Only Runs Once Per Page (P0)

**Location:** `src/agents/meta/link-agent.ts` line 58

**Problem:** The link agent filters pages by `p.links.length === 0`. Once ANY link is added to a page, it's **never analyzed again** - even if new related pages are created later.

**Code Evidence:**
```typescript
// Line 58
const pagesToAnalyze = pages.filter(p => p.links.length === 0);

// Line 60-69
if (pagesToAnalyze.length === 0) {
  return { summary: 'All pages already have links analyzed', ... };
}
```

**Impact:**
- Pages created AFTER link agent runs may never get links from existing pages
- Navigation becomes progressively worse as wiki grows
- 45% orphan rate, 85% dead-end rate observed

**Fix:** Track "last linked at" timestamp and re-analyze pages when new related pages are created.

---

### Issue 3: Aggressive Cooldowns Prevent Self-Healing (P1)

**Location:** `src/agents/orchestrator/strategies.ts` lines 296-420

**Problem:** Meta agents (link, consistency, quality, consolidation) have cooldowns that check for ANY completed run. If an agent ran once successfully, it may not run again even when clearly needed.

**Code Evidence:**
```typescript
// Lines 310-311 (link agent)
const recentLinkRuns = recentRuns
  .filter(r => r.agentType === 'link' && r.status === 'completed')
  .slice(0, 1);
const hasRecentRun = recentLinkRuns.length > 0;

// Line 319
if (!ctx.existingWorkKeys.has(linkKey) && (!hasRecentRun || shouldOverrideCooldown)) {
```

The override only triggers when > 50% pages are unlinked. But if link agent ran when wiki had 10 pages and now has 100 pages (90% orphaned), it still might not trigger due to how `recentRuns` is queried.

**Impact:**
- Same 5 broken links persisted from 100 to 200 iterations
- Duplicates accumulate faster than they're consolidated
- Quality issues compound over time

**Fix:** Implement time-based cooldowns (e.g., "hasn't run in last 20 iterations") instead of "has ever completed".

---

### Issue 4: No Pre-Creation Similarity Check (P1)

**Location:** `src/commands/update-wiki-page.ts` lines 42-44

**Problem:** When creating a page, the only check is for exact path match:

```typescript
// Lines 42-44
if (update.type === 'create') {
  if (existing) {  // Only checks if exact path exists
    return failure(`Page already exists at path: ${update.path}`);
  }
```

There's no check for:
- Similar titles at different paths
- Similar content at different paths
- Same topic in different categories

**Impact:** 4 duplicate page pairs observed with identical titles:
- `commits/049d5dd1` AND `architecture/test-coverage` (same title)
- `commits/cd544448` AND `architecture/e2e-testing` (same title)

**Fix:** Add similarity check before page creation using title/content embedding comparison.

---

### Issue 5: Deduplication Is Reactive, Not Proactive (P1)

**Location:** Multiple files

**Problem:** The deduplication pipeline is:
1. `ConsistencyAgent` detects duplicates → creates findings
2. `ConsolidationAgent` processes findings → merges/deletes pages
3. Both agents have cooldowns

This means:
- Duplicates must first be created
- Then discovered by ConsistencyAgent (which has cooldown)
- Then processed by ConsolidationAgent (which also has cooldown)
- Meanwhile, more duplicates are being created

**Impact:** Duplicates accumulate faster than the repair pipeline can process them.

**Fix:** Add similarity check at creation time (Issue 4 fix) to prevent duplicates proactively.

---

### Issue 6: Template/Placeholder Leakage (P2)

**Location:** Response parsing throughout agent system

**Problem:** When LLM outputs include template patterns like `[Descriptive title]` or `[2-3 paragraph article]`, the system doesn't reject them.

**Evidence:** Page `commits/86e24e23` has literal title: `[Descriptive title]`

**Code Analysis:** Agents parse LLM responses with regex patterns, but don't validate that the extracted content looks "real" vs template.

**Fix:** Add validation that rejects responses containing:
- Square bracket placeholders: `[description]`, `[title]`, etc.
- Instruction text: "write a...", "describe the...", etc.
- Empty or very short content

---

### Issue 7: Getting Started Agent Doesn't Validate Tool Results (P2)

**Location:** `src/agents/synthesis/getting-started-agent.ts`

**Problem:** The agent uses tools to explore the codebase (good), but then uses `completion.content.trim()` directly as the page content (line 94). There's no validation that:
- The LLM actually read the files
- The content reflects what was in the files
- Version numbers match package.json

**Evidence:** `guides/getting-started` claimed Jest (wrong) and Node 18.18.0 (wrong - package.json says 24.x)

**Root Cause:** The agent relies on qwen/qwen-turbo to faithfully follow tool results, but small models may hallucinate or use training data instead.

**Fix:**
1. Extract key facts from tool results programmatically (parse package.json JSON)
2. Inject verified facts into the LLM prompt
3. Validate output contains the verified facts

---

### Issue 8: `calculateConfidence` Function Is Never Used (P2)

**Location:** `src/domain/wiki-page.ts` lines 85-97

**Problem:** There's a sophisticated `calculateConfidence` function that considers:
- Commit coverage
- Agent verifications
- Freshness (days since update)

But it's **never called** anywhere in the codebase. Confidence only changes via `confidenceDelta` additions.

**Code Evidence:**
```typescript
export function calculateConfidence(page: WikiPage, factors: {
  commitsAnalyzed: number;
  totalCommits: number;
  agentVerifications: number;
  daysSinceUpdate: number;
}): number {
  // This function exists but is never used!
}
```

**Impact:** Confidence scores are meaningless - they're just 0.5 + sum of deltas from agents that happened to touch the page.

**Fix:** Actually use `calculateConfidence` to compute meaningful scores based on coverage and freshness.

---

## Root Cause Summary

| Symptom | Root Cause | Issue # |
|---------|-----------|---------|
| 100% pages have confidence < 0.6 | confidenceDelta ignored on create | 1 |
| 45% orphan pages | Link agent only runs once per page | 2 |
| 85% dead-end pages | Link agent only runs once per page | 2 |
| Same broken links persist | Cooldown prevents consolidation | 3 |
| 4 duplicate page pairs | No pre-creation similarity check | 4, 5 |
| Template text in pages | No response validation | 6 |
| Incorrect facts in guides | No tool result validation | 7 |
| Confidence is meaningless | calculateConfidence never used | 8 |

---

## Recommended Fix Priority

### P0 (Critical - Fix Immediately)
1. **Issue 1:** Apply confidenceDelta on page creation
2. **Issue 2:** Allow link agent to re-analyze pages with new potential links

### P1 (High - Fix Soon)
3. **Issue 3:** Use time-based cooldowns, not "has ever completed"
4. **Issue 4:** Add similarity check before creating pages
5. **Issue 5:** Follows from Issue 4

### P2 (Medium - Quality Improvements)
6. **Issue 6:** Add response validation to reject templates
7. **Issue 7:** Validate tool results match output
8. **Issue 8:** Use calculateConfidence function

---

## Appendix: Files Analyzed

- `src/cli/commands/process.ts` - CLI entry point
- `src/executor/executor.ts` - Work execution loop
- `src/agents/orchestrator/orchestrator.ts` - Work generation
- `src/agents/orchestrator/strategies.ts` - Deterministic strategies
- `src/agents/meta/link-agent.ts` - Link creation
- `src/agents/meta/consistency-agent.ts` - Duplicate detection
- `src/agents/consolidation/handlers/duplicate-handler.ts` - Duplicate resolution
- `src/commands/update-wiki-page.ts` - Page CRUD
- `src/domain/wiki-page.ts` - Page model
- `src/agents/synthesis/getting-started-agent.ts` - Guide generation
- `src/agents/analysis/codebase-explorer-agent.ts` - Code documentation
