# Code Duplication Root Cause Analysis

**Analysis Date:** 2025-12-10
**Analyst:** Claude (AI)
**Branch:** `claude/fix-code-duplication-01FYTVwwQQCb8CCgS31D12Fv`

## Executive Summary

This document provides a deep-dive analysis into why the CodeWiki system creates duplicate and fragmented content. The analysis identifies **7 root causes** across the page creation, agent output, and orchestration systems. The issues stem from a fundamental architectural gap: **the system lacks pre-creation semantic validation**.

---

## Observed Symptoms

From `OBSERVED_ISSUES.md` and `OBSERVED_ISSUES_LIST.md`:

| Issue ID | Description | Severity |
|----------|-------------|----------|
| BUG-002 | No Deduplication Check for Similar Content | Critical |
| BUG-005 | Duplicate Page Titles Allowed | Medium |
| Issue #7 | Topic Fragmentation Without Consolidation | High |
| DESIGN-002 | No Content Similarity Detection | Systemic |

**Evidence:**
- LLM Service documented in 3 separate pages: `services/llm`, `services/llm-service`, `components/llm-service`
- 6 pages about "bootstrap", 14 pages about "link agent"
- Duplicate: "Wiki Page Confidence Management" at 2 different paths
- Two pages titled "Auth" at different paths

---

## System Flow Overview

Understanding the duplication problem requires understanding how pages are created:

```
Agent generates WikiPageUpdate[]
         │
         ▼
┌─────────────────────────────────────┐
│  Analysis Agent (code-change,       │
│  codebase-explorer, etc.)           │
│  - LLM picks path and title         │
│  - No similarity check              │
└────────────────┬────────────────────┘
                 │
         ┌───────┴───────┐
         │               │
         ▼               ▼
┌─────────────┐  ┌─────────────────┐
│ EditRequest │  │ Direct Update   │
│ Queue       │  │ (meta/synthesis)│
└──────┬──────┘  └───────┬─────────┘
       │                 │
       ▼                 │
┌─────────────┐          │
│ WikiEditor  │          │
│ Agent       │          │
└──────┬──────┘          │
       │                 │
       └────────┬────────┘
                │
                ▼
┌─────────────────────────────────────┐
│  handleUpdateWikiPage()             │
│  - Checks exact path exists         │
│  - Checks exact title match         │
│  - NO semantic similarity check     │
└─────────────────────────────────────┘
```

---

## Root Cause #1: No Pre-Creation Semantic Similarity Check

**Severity:** Critical
**Location:** `src/commands/update-wiki-page.ts:57-67`

### Problem

The page creation validation only checks for **exact title match** (case-insensitive):

```typescript
// src/commands/update-wiki-page.ts:60-62
const duplicatePage = existingPages.find(
  page => page.title.toLowerCase() === newTitle.toLowerCase()
);
```

### What's Missing

There is no check for:
- **Semantic similarity** (e.g., "LLM Service" vs "LLM Service Overview")
- **Path pattern overlap** (e.g., `services/llm` vs `services/llm-service`)
- **Content similarity** to existing pages

### Impact

| Scenario | Expected | Actual |
|----------|----------|--------|
| Create "LLM Service Overview" when "LLM Service" exists | Blocked or merged | Created as separate page |
| Create `services/llm-service` when `services/llm` exists | Blocked or merged | Created as separate page |

### Evidence

The validation at `src/commands/update-wiki-page.ts:59-67` and `src/commands/update-wiki-page.ts:168-177` (for merge operations) performs the same exact-match logic.

---

## Root Cause #2: LLM-Generated Paths Without Consistency Validation

**Severity:** Critical
**Location:** `src/agents/analysis/code-change-agent.ts:247-259`

### Problem

The code-change agent's prompt instructs the LLM to generate paths directly:

```
WIKI_UPDATES:
=== path: category/page-name | action: create ===
```

There is **no validation** that:
1. The category matches existing wiki structure
2. The path doesn't semantically overlap with existing pages
3. The naming convention is consistent with existing pages

### Impact

Different LLM calls generate inconsistent paths for the same concepts:
- Commit A: Creates `services/llm`
- Commit B: Creates `components/llm-service`
- Commit C: Creates `architecture/llm-layer`

All three may describe the same code, but appear as separate wiki pages.

### Evidence

From `src/agents/analysis/code-change-agent.ts:247-259` (prompt template):
```typescript
WIKI_UPDATES:
=== path: category/page-name | action: create ===
[Write the FULL markdown content for this wiki page here...]
```

The path is entirely LLM-generated with no normalization or validation against existing wiki structure.

---

## Root Cause #3: Codebase Explorer Only Checks Exact Path Match

**Severity:** High
**Location:** `src/agents/analysis/codebase-explorer-agent.ts:544-549`

### Problem

The codebase explorer creates a set of existing paths and only skips pages with exact matches:

```typescript
// src/agents/analysis/codebase-explorer-agent.ts:544-548
const existingPathsSet = new Set(existingPagePaths.map(p => p.toLowerCase()));

for (const page of analysis.wikiPages) {
  // Skip if a similar page already exists
  if (existingPathsSet.has(page.path.toLowerCase())) {
    console.log(`Skipping wiki page ${page.path} - similar page already exists`);
```

### What's Missing

The "similar page already exists" message is misleading - it only detects **exact** path matches, not similar content or related topics.

### Impact

| Existing Page | New Page Path | Blocked? |
|--------------|---------------|----------|
| `services/llm` | `services/llm` | Yes |
| `services/llm` | `services/llm-service` | **No** |
| `services/llm` | `components/llm` | **No** |

---

## Root Cause #4: Consistency Agent is Reactive, Not Preventive

**Severity:** High
**Location:** `src/agents/meta/consistency-agent.ts:273-315`

### Problem

The consistency agent **detects** duplicates after they're created but doesn't **prevent** them:

```typescript
// src/agents/meta/consistency-agent.ts:273-288
private findPotentialDuplicates(pages: WikiPage[]): ConsistencyIssue[] {
  // ...
  // Check for duplicate titles (case-insensitive)
  const normalizedTitle = page.title.toLowerCase().trim();
  const existing = seen.get(normalizedTitle);
  if (existing && existing.path !== page.path) {
    issues.push({
      type: 'duplicate_title',
      description: `Duplicate titles found...`,
      // ...
    });
  }
```

### Detection vs Prevention

| System | When it runs | What it does |
|--------|--------------|--------------|
| Consistency Agent | After pages created | Creates "findings" |
| Consolidation Agent | Later, subject to cooldowns | Merges one group at a time |
| Page Creation | During creation | **Doesn't use consistency logic** |

### Impact

The valuable duplicate detection logic in consistency agent (`findPotentialDuplicates`, `calculateSimpleSimilarity`) is **not reused** at page creation time, creating a feedback loop where:
1. Duplicates are created
2. Consistency agent detects them
3. Consolidation agent slowly processes them
4. More duplicates are created faster than consolidation can merge them

---

## Root Cause #5: Consolidation Agent Runs Infrequently and Processes Slowly

**Severity:** High
**Location:** `src/agents/orchestrator/strategies.ts:396-416`, `src/agents/consolidation/consolidation-agent.ts:71`

### Problem 1: Subject to Cooldowns

The consolidation agent is scheduled like other meta agents:

```typescript
// src/agents/orchestrator/strategies.ts:404
if (!ctx.existingWorkKeys.has(consolidationKey) && !hasRunWithinCooldown('consolidation')) {
```

### Problem 2: Processes One Group Per Run

```typescript
// src/agents/consolidation/consolidation-agent.ts:70-71
// Process the highest priority finding group
const group = findingGroups[0]!;
```

The consolidation agent only processes **one finding group per execution**, regardless of how many duplicates exist.

### Problem 3: Lower Priority Than Exploration

From the strategy execution order in `src/agents/orchestrator/strategies.ts`:
1. `codebaseExplorationStrategy` - runs first
2. `commitProcessingStrategy` - runs second
3. `metaAgentStrategy` - consolidation is at the end of this strategy

### Impact

With 200 iterations:
- ~190 were codebase-explorer
- ~30 were code-change
- Consolidation ran < 10 times
- Each run processed only 1 duplicate group
- Duplicates accumulate faster than they're merged

---

## Root Cause #6: No Centralized Path/Title Resolution Service

**Severity:** High
**Architectural Gap**

### What's Missing

There is no service that:
1. Normalizes page paths before creation (e.g., `llm-service` → `llm` if `llm` exists)
2. Suggests canonical paths based on content analysis
3. Resolves path conflicts before they happen
4. Maintains a registry of "authoritative" pages per topic

### Current Architecture Gap

```
┌──────────────────┐     ┌──────────────────┐
│  Code-Change     │     │ Codebase-Explorer│
│  Agent           │     │ Agent            │
└────────┬─────────┘     └────────┬─────────┘
         │                        │
         │   Path = LLM output    │
         │   (no validation)      │
         ▼                        ▼
┌─────────────────────────────────────────────┐
│              Wiki Page Repository           │
│  (stores whatever paths agents generate)    │
└─────────────────────────────────────────────┘
```

### What Should Exist

```
┌──────────────────┐     ┌──────────────────┐
│  Code-Change     │     │ Codebase-Explorer│
│  Agent           │     │ Agent            │
└────────┬─────────┘     └────────┬─────────┘
         │                        │
         ▼                        ▼
┌─────────────────────────────────────────────┐
│         Path Resolution Service             │
│  - Check for semantic overlap               │
│  - Suggest canonical path                   │
│  - Resolve to existing page if similar      │
└────────────────────┬────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│              Wiki Page Repository           │
└─────────────────────────────────────────────┘
```

---

## Root Cause #7: Work Deduplication is Path/Commit Based, Not Content Based

**Severity:** Medium
**Location:** `src/agents/orchestrator/orchestrator.ts:278-290`

### Problem

Work item deduplication uses these keys:

```typescript
// src/agents/orchestrator/orchestrator.ts:278-287
if (item.targetPath) {
  key = `codebase-explorer:path:${item.targetPath}`;
} else if (item.targetCommitId) {
  key = `${item.agentType}:commit:${item.targetCommitId}`;
} else {
  key = `${item.agentType}:wiki`;
}
```

### What This Deduplicates

| Key Format | Prevents |
|------------|----------|
| `codebase-explorer:path:src/services` | Re-exploring same directory |
| `code-change:commit:abc123` | Re-analyzing same commit |
| `link:wiki` | Running link agent twice |

### What This Doesn't Prevent

- Two commits touching `src/services/llm.ts` from creating overlapping pages
- Exploration of `src/services/` and `src/components/` from documenting the same LLM service
- Multiple agents from creating semantically duplicate content

---

## Summary: Chain of Root Causes

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CONTENT DUPLICATION                               │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
┌─────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│ No Pre-Creation │  │ LLM-Generated Paths │  │ Work Deduplication  │
│ Similarity Check│  │ Without Validation  │  │ is Path-Based Only  │
│ (Root Cause #1) │  │ (Root Cause #2)     │  │ (Root Cause #7)     │
└────────┬────────┘  └──────────┬──────────┘  └──────────┬──────────┘
         │                      │                        │
         └──────────────────────┼────────────────────────┘
                                │
                                ▼
                 ┌──────────────────────────────┐
                 │ Pages Created Without        │
                 │ Semantic Validation          │
                 └──────────────┬───────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
┌─────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│ Codebase-Explr  │  │ Consistency Agent   │  │ Consolidation       │
│ Exact Path Only │  │ Reactive Detection  │  │ Runs Infrequently   │
│ (Root Cause #3) │  │ (Root Cause #4)     │  │ (Root Cause #5)     │
└─────────────────┘  └─────────────────────┘  └─────────────────────┘
                                │
                                ▼
                 ┌──────────────────────────────┐
                 │ No Centralized Path/Title    │
                 │ Resolution Service           │
                 │ (Root Cause #6)              │
                 └──────────────────────────────┘
```

---

## Recommended Fixes (Priority Order)

### P0: Critical - Fix First

#### Fix 1: Add Semantic Similarity Check at Page Creation

**File:** `src/commands/update-wiki-page.ts`

Add a check before page creation:
1. Extract the consistency agent's `calculateSimpleSimilarity()` to a shared utility
2. Before creating a page, check similarity against all existing pages
3. Block creation if similarity > 60% and suggest using the existing page

#### Fix 2: Validate LLM-Generated Paths Against Existing Wiki Structure

**File:** `src/agents/analysis/code-change-agent.ts`, `src/agents/analysis/codebase-explorer-agent.ts`

Before generating wiki updates:
1. Fetch existing wiki page paths and titles
2. Include them in the LLM prompt with clear instructions to avoid duplication
3. Post-process LLM output to validate paths against existing structure

### P1: High - Fix Soon

#### Fix 3: Create a Path Resolution Service

**New file:** `src/services/path-resolution-service.ts`

Centralized service that:
1. Normalizes incoming paths
2. Checks for semantic overlap with existing pages
3. Returns either a canonical path or indicates a merge target

#### Fix 4: Make Consolidation Agent Run Faster

**Files:** `src/agents/consolidation/consolidation-agent.ts`, `src/agents/orchestrator/strategies.ts`

1. Process multiple finding groups per run (not just one)
2. Reduce or bypass cooldowns when duplicate count is high
3. Prioritize consolidation when duplicates exceed threshold (e.g., > 5)

### P2: Medium - Fix Later

#### Fix 5: Extract and Reuse Similarity Logic

**Current:** `src/agents/meta/consistency-agent.ts:415-429`

Move `calculateSimpleSimilarity()` to a shared utility and use it in:
- Page creation validation
- Codebase explorer duplicate check
- Orchestrator work generation

---

## Appendix: Key Code Locations

| Component | File | Key Lines | Responsibility |
|-----------|------|-----------|----------------|
| Page Creation Validation | `src/commands/update-wiki-page.ts` | 57-67, 168-177 | Only checks exact title match |
| Code-Change Path Generation | `src/agents/analysis/code-change-agent.ts` | 247-259, 315-328 | LLM generates arbitrary paths |
| Codebase-Explorer Duplicate Check | `src/agents/analysis/codebase-explorer-agent.ts` | 544-549 | Only checks exact path match |
| Consistency Agent Detection | `src/agents/meta/consistency-agent.ts` | 273-315 | Reactive detection of duplicates |
| Similarity Calculation | `src/agents/meta/consistency-agent.ts` | 415-429 | Jaccard similarity (not reused) |
| Consolidation Agent | `src/agents/consolidation/consolidation-agent.ts` | 70-71 | Processes one group per run |
| Consolidation Scheduling | `src/agents/orchestrator/strategies.ts` | 396-416 | Subject to cooldowns |
| Work Item Deduplication | `src/agents/orchestrator/orchestrator.ts` | 278-290 | Path/commit based only |
| Duplicate Handler | `src/agents/consolidation/handlers/duplicate-handler.ts` | 30-186 | LLM-based merge decisions |
| Content Validation | `src/utils/content-validation.ts` | 168-191 | Length, templates, instructions only |

---

## References

- `docs/wiki-reviews/OBSERVED_ISSUES.md` - Detailed issue list with code locations
- `docs/OBSERVED_ISSUES_LIST.md` - Earlier test findings
- `src/agents/orchestrator/strategies.ts` - Strategy execution order
- `src/commands/update-wiki-page.ts` - Page creation/update handling
