# Issue: Orphaned Pages / Weak Linking (88% Unconnected)

**Priority:** P0 - Critical
**Severity:** CRITICAL
**Status:** Open
**Detected:** 2025-12-09 (qwen testing), confirmed 2025-12-11 (llama testing)

---

## Summary

88% of wiki pages have no links to or from other pages, making the wiki unnavigable. The link agent runs infrequently and uses a "skip if exists" pattern that prevents re-linking.

---

## Metrics

- **Pages with outgoing links:** 1 (agents/overview only)
- **Pages with backlinks:** 6
- **Completely isolated pages:** 45 of 51 (88%)

---

## Root Cause

**Location:** `src/agents/meta/link-agent.ts`

### Problem 1: Single-Pass Lock Pattern (lines 63-72)

```typescript
const pagesToAnalyze = pages.filter(p => {
  if (p.links.length === 0) return true;
  // Only re-analyze if updated before newest page creation
  const pageUpdatedAt = p.updatedAt.getTime();
  return pageUpdatedAt < newestPageCreation;
});
```

Once a page has even one link, it's skipped unless newer pages exist.

### Problem 2: 10-Page Limit Per Run (line 127)

```typescript
pagesToAnalyze.slice(0, 10)
```

Only 10 pages analyzed per orchestrator cycle.

### Problem 3: Early Exit (lines 74-83)

```typescript
if (pagesToAnalyze.length === 0) {
  return {
    result: createAgentResult({
      summary: 'All pages already have links analyzed',
      ...
    }),
    updates: [],
    costUsd: 0,
  };
}
```

If all pages have been touched once, the agent exits with zero updates.

### Problem 4: Aggressive Filtering (lines 247-258)

```typescript
const existingTargets = this.extractExistingLinkTargets(page.content);
const newLinks = suggestedLinks.filter(l => !existingTargets.has(l.target));
if (newLinks.length === 0) continue;
```

Filters out links that already exist, even if bidirectional linking is needed.

---

## Proposed Fix

1. **Have content agents generate related links during page creation:**
   ```typescript
   // In codebase-explorer-agent.ts, code-change-agent.ts, etc.
   const relatedPages = await findRelatedPages(newPage, existingPages);
   newPage.links = relatedPages.map(p => p.path);
   ```

2. **Increase link agent frequency in orchestrator:**
   ```typescript
   // In strategies.ts
   metaAgentsStrategy.priority = 'high';
   metaAgentsStrategy.minRunsPerCycle = 2;
   ```

3. **Add batch linking capability:**
   ```typescript
   // Analyze all pages, not just 10
   const pagesToAnalyze = pages.filter(p => this.needsLinking(p));
   // Process in batches of 20
   for (const batch of chunk(pagesToAnalyze, 20)) {
     await this.analyzeBatch(batch);
   }
   ```

4. **Implement automatic link discovery:**
   ```typescript
   async function discoverLinks(page: WikiPage, allPages: WikiPage[]): Promise<string[]> {
     const links: string[] = [];
     for (const other of allPages) {
       if (other.path === page.path) continue;
       const similarity = calculateSimilarity(page.content, other.content);
       if (similarity > 0.3) {
         links.push(other.path);
       }
     }
     return links;
   }
   ```

5. **Remove "skip if exists" for Related Pages section:**
   ```typescript
   // Instead of skipping, merge new links with existing
   const existingSection = extractRelatedPagesSection(page.content);
   const mergedLinks = [...new Set([...existingSection.links, ...newLinks])];
   ```

---

## Acceptance Criteria

- [ ] Link agent processes all pages, not just 10
- [ ] Pages can receive new links even after initial linking
- [ ] Content agents create initial links during page creation
- [ ] Orphaned page percentage drops below 20%

---

## Related Issues

- Overview agent never updates (#005)
- Quality agent doesn't auto-fix (#006)
