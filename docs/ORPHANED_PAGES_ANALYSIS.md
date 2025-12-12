# Orphaned Pages Analysis

This document analyzes why wiki pages become orphaned in CodeWiki, identifying root causes and recommended fixes.

## Executive Summary

Orphaned pages occur due to a fundamental disconnect between **content-based links** (markdown links in page text) and **graph-based links** (`page.links` array in the database). Most agents create markdown links but don't update the graph, causing the system to report pages as orphaned even when they appear connected to users.

---

## Issue #1: Synthesis Agents Don't Populate the `links` Array

**Severity:** Critical
**Files Affected:**
- `src/agents/synthesis/overview-agent.ts`
- `src/agents/synthesis/wiki-index-agent.ts`
- `src/agents/synthesis/project-overview-agent.ts`
- `src/agents/synthesis/getting-started-agent.ts`

### Problem

The `OverviewAgent`, `WikiIndexAgent`, `ProjectOverviewAgent`, `GettingStartedAgent`, and other synthesis agents generate markdown content with links, but they **never populate the `links` field** in their `WikiPageUpdate`.

### Evidence

`src/agents/synthesis/overview-agent.ts:413-421` - Update has no `links:` field:
```typescript
return {
  type: operationType,
  path: `${category}/overview`,
  title,
  content,
  sourceCommitId: '',
  agentRunId: '',
  confidenceDelta: operationType === 'update' ? 0.1 : 0.5,
  // NO links: field!
};
```

Only `src/agents/meta/link-agent.ts:292` explicitly sets `links:` in WikiPageUpdate.

### Impact

```
Overview page content: "- [Auth Module](architecture/auth) - Handles auth..."
Overview page.links: []  ← EMPTY!
```

The graph structure used for orphan detection (`consistency-agent.ts:321-332`) only reads from `page.links`, not from parsed content. So even though overview pages have dozens of markdown links, the system thinks they have **zero outgoing links**.

### Recommended Fix

Extract markdown links from generated content and populate the `links` field:
```typescript
const links = extractLinksFromContent(content);
return {
  type: operationType,
  path: `${category}/overview`,
  content,
  links, // Add this!
  ...
};
```

---

## Issue #2: One-Way Links Without Backlink Tracking

**Severity:** Critical
**Files Affected:**
- `src/agents/synthesis/overview-agent.ts`
- `src/agents/synthesis/wiki-index-agent.ts`
- `src/commands/update-wiki-page.ts`

### Problem

When synthesis agents create overview pages that link to category pages, they:
1. Don't populate their own `links` array
2. Don't trigger backlink creation on the target pages

### Evidence

`src/commands/update-wiki-page.ts:91-97` shows backlinks are only created when `update.links` is populated:
```typescript
if (update.links && update.links.length > 0) {
  await repos.wikiPages.updateLinks(page.id, update.links);
  await updateBacklinks(repos, wikiId, page.path, [], update.links);
}
```

### Impact

A page linked from an overview doesn't know it has an incoming link, so it's detected as orphaned when checking:
```typescript
(incomingLinks.get(page.path)?.size ?? 0) > 0
```

### Recommended Fix

This is automatically fixed by Issue #1 - once synthesis agents populate `links`, the command handler will create backlinks.

---

## Issue #3: LinkAgent Scheduling is Too Conservative

**Severity:** High
**Files Affected:**
- `src/agents/orchestrator/strategies.ts`

### Problem

From `src/agents/orchestrator/strategies.ts:308-343`:
- LinkAgent only runs when **>30% of pages have no links** OR **>5 pages unlinked**
- Has a **20-completed-run cooldown** between executions
- Only processes **20 pages per run**

### Impact

In a rapidly growing wiki (e.g., 50+ pages created during initial processing), the LinkAgent can't keep up:
- Creates ~40-60 links per run (20 pages × 2-3 links)
- But if 10 pages are created per iteration, it falls behind
- The cooldown prevents catching up

### Recommended Fix

1. Lower the unlinked threshold from 30% to 15%
2. Reduce cooldown from 20 runs to 10 runs
3. Increase batch size from 20 to 40 pages

```typescript
// Current
const needsLinking = unlinkedRatio > 0.3 || pagesWithoutLinks.length > 5;

// Proposed
const needsLinking = unlinkedRatio > 0.15 || pagesWithoutLinks.length > 3;
```

---

## Issue #4: LinkAgent Re-Analysis Condition is Flawed

**Severity:** Medium
**Files Affected:**
- `src/agents/meta/link-agent.ts`

### Problem

From `src/agents/meta/link-agent.ts:63-72`:
```typescript
const pagesToAnalyze = pages.filter(p => {
  if (p.links.length === 0) return true;
  const pageUpdatedAt = p.updatedAt.getTime();
  return pageUpdatedAt < newestPageCreation;
});
```

### Flaws

1. Pages with just 1 link won't be re-analyzed unless updated before newest page
2. If a page has links but was updated AFTER the newest page creation, it's skipped
3. Doesn't consider whether the page has links to ALL relevant pages

### Impact

A page with 1 outdated link that was recently touched won't get additional links to newly created related pages.

### Recommended Fix

Consider link density, not just presence:
```typescript
const pagesToAnalyze = pages.filter(p => {
  // Always analyze pages with very few links
  if (p.links.length < 2) return true;

  // Re-analyze if many new pages have been created since last update
  const newPagesSinceUpdate = pages.filter(
    other => other.createdAt.getTime() > p.updatedAt.getTime()
  ).length;

  return newPagesSinceUpdate > 3;
});
```

---

## Issue #5: OrphanedPageHandler Has Limited Scope

**Severity:** Medium
**Files Affected:**
- `src/agents/consolidation/handlers/orphaned-page-handler.ts`

### Problem

The handler only:
1. Adds orphaned pages to their category overview
2. Uses `## Related` section (vs LinkAgent's `## Related Pages`)
3. Only creates link from overview→orphan, not orphan→overview

### Evidence

From `src/agents/consolidation/handlers/orphaned-page-handler.ts:25-45`:
```typescript
for (const orphan of orphanedPages) {
  const category = orphan.path.split('/')[0] ?? '';
  const overviewPage = allPages.find(p =>
    p.path === `${category}/overview` || p.path === `${category}/index`
  );

  if (overviewPage && !overviewPage.content.includes(`](${orphan.path}`)) {
    // Only links FROM overview TO orphan
    const linkedContent = this.addLinkToPage(overviewPage.content, orphan);
    updates.push({...});
  }
}
```

### Impact

- If no overview exists for the category, orphan stays orphaned
- The section name mismatch (`## Related` vs `## Related Pages`) causes duplicate sections
- Still doesn't create bidirectional links

### Recommended Fix

1. Standardize on `## Related Pages` section name
2. Also update the orphan page to link back to overview
3. Consider linking to wiki-index if no category overview exists

---

## Issue #6: Bootstrap/Exploration Agents Create Isolated Pages

**Severity:** Medium
**Files Affected:**
- `src/agents/synthesis/bootstrap-agent.ts`
- `src/agents/analysis/codebase-explorer-agent.ts`

### Problem

The `BootstrapAgent` and `CodebaseExplorerAgent` create pages but don't establish any cross-references. They rely entirely on LinkAgent running later.

### Impact

During the "exploration phase," the wiki accumulates many unlinked pages. The LinkAgent may not run frequently enough to connect them before the consistency check finds orphans.

### Recommended Fix

Have exploration agents add basic links:
- Link new pages to their category overview (if exists)
- Link related pages discovered during exploration (e.g., files in same directory)

---

## Issue #7: Graph vs Content Disconnect

**Severity:** High
**Files Affected:**
- `src/domain/wiki-page.ts`
- `src/agents/meta/consistency-agent.ts`
- All content-generating agents

### Problem

Two parallel systems track links:
1. **Content-based**: Markdown links in page content (what users see)
2. **Graph-based**: `page.links` array (what system tracks)

Nothing synchronizes these. A page can have 10 markdown links in content but `links: []` in the database.

### Evidence

Orphan detection at `consistency-agent.ts:321-332` uses only `page.links`:
```typescript
for (const page of pages) {
  outgoingLinks.set(page.path, new Set(page.links));
  for (const link of page.links) {
    // ...
  }
}
```

### Impact

- Orphan detection uses graph data (`page.links`)
- But most agents write markdown links without updating the graph
- The wiki looks connected to users but is "orphaned" to the system

### Recommended Fix

Create a utility to extract and sync links:
```typescript
// In src/utils/link-extraction.ts
export function extractLinksFromContent(content: string): string[] {
  const links: string[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const path = match[2]!.replace(/\.md$/, '').replace(/^\//, '');
    links.push(path);
  }
  return [...new Set(links)];
}
```

Then use this in all agents that generate content with links.

---

## Issue #8: Overview Staleness Check Doesn't Update Links Array

**Severity:** Low
**Files Affected:**
- `src/agents/synthesis/overview-agent.ts`

### Problem

From `src/agents/synthesis/overview-agent.ts:188-200`:

When the OverviewAgent detects a stale overview (missing pages), it regenerates the content but still doesn't populate the `links` array.

### Impact

Even regenerated overviews with fresh markdown links have empty `links` arrays.

### Recommended Fix

This is automatically fixed by Issue #1.

---

## Issue #9: Cooldown Bypasses Aren't Aggressive Enough

**Severity:** Low
**Files Affected:**
- `src/agents/orchestrator/strategies.ts`

### Problem

From `src/agents/orchestrator/strategies.ts:327-329`:
```typescript
// Override cooldown if unlinked ratio is very high (> 50%)
const shouldOverrideCooldown = unlinkedRatio > 0.5;
```

The 50% threshold is too high. A wiki with 30 pages and 12 orphans (40%) won't trigger the override.

### Impact

Wikis with significant orphan problems (but under 50%) don't get accelerated linking.

### Recommended Fix

Lower the override threshold:
```typescript
// Override cooldown if unlinked ratio is significant (> 30%)
const shouldOverrideCooldown = unlinkedRatio > 0.3;
```

---

## Appendix: Link Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  Page Creation (Bootstrap, Explorer, Commit Analysis)            │
│                                                                  │
│  Creates: pages with content                                     │
│  Doesn't create: links                                           │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  Synthesis (Overview, WikiIndex, GettingStarted, etc.)           │
│                                                                  │
│  Creates: markdown links IN content                              │
│  Doesn't update: page.links array (graph tracking)               │
│  Doesn't create: backlinks on target pages                       │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  LinkAgent (runs with cooldown, limited batch size)              │
│                                                                  │
│  Creates: links array AND backlinks                              │
│  But: only runs when >30% orphaned                               │
│  And: has 20-run cooldown                                        │
│  And: only processes 20 pages per run                            │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│  Consistency Check (uses page.links for orphan detection)        │
│                                                                  │
│  Sees: pages with markdown links but empty links[]               │
│  Reports: "orphaned" even though content has links               │
└──────────────────────────────────────────────────────────────────┘
```
