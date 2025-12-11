# Issue: Link Agent Skips Pages With Existing Related Pages Section

**Priority:** P1 - High
**Severity:** HIGH
**Status:** Open
**Detected:** 2025-12-09 (qwen testing)

---

## Summary

Once a page has a "Related Pages" section, the link agent never processes it again, even when new related pages are created that should be linked.

---

## Root Cause

**Location:** `src/agents/meta/link-agent.ts:63-72`

```typescript
const pagesToAnalyze = pages.filter(p => {
  // Always analyze pages with no links
  if (p.links.length === 0) {
    return true;
  }
  // Re-analyze pages with links if they were updated before a newer page was created
  const pageUpdatedAt = p.updatedAt.getTime();
  return pageUpdatedAt < newestPageCreation;
});
```

The condition `p.links.length === 0` means pages with any links are filtered out unless they were updated before a newer page was created.

---

## Impact

1. **Pages created early never get links to newer pages**
2. **Link coverage frozen at first-pass state**
3. **As wiki grows, older pages become increasingly isolated**
4. **Only ~4 pages had Related Pages sections after 200 iterations**

---

## Example Scenario

1. Day 1: `architecture/overview` created with links to `agents/overview`
2. Day 2: `commands/overview`, `queries/overview` created
3. Day 3: Link agent runs but skips `architecture/overview` (has links)
4. Result: `architecture/overview` never links to commands or queries

---

## Proposed Fix

1. **Merge with existing Related Pages instead of skipping:**
   ```typescript
   const pagesToAnalyze = pages.filter(p => {
     // Always include pages with no links
     if (p.links.length === 0) return true;

     // Include pages that might benefit from new links
     const newerPagesExist = pages.some(other =>
       other.createdAt > p.updatedAt &&
       this.couldBeRelated(p, other)
     );

     return newerPagesExist;
   });
   ```

2. **Track "last linked at" timestamp:**
   ```typescript
   interface WikiPage {
     // ... existing fields
     lastLinkedAt?: Date;
   }

   // Re-analyze if significant new content added since last linking
   if (!p.lastLinkedAt || newPagesCreatedSince(p.lastLinkedAt) > 5) {
     return true;
   }
   ```

3. **Implement incremental link updates:**
   ```typescript
   async function updateLinks(page: WikiPage, newLinks: Link[]): Promise<WikiPageUpdate> {
     const existingLinks = extractExistingLinks(page.content);
     const mergedLinks = [...new Set([...existingLinks, ...newLinks])];

     const updatedContent = replaceRelatedPagesSection(
       page.content,
       formatRelatedPages(mergedLinks)
     );

     return {
       type: 'update',
       path: page.path,
       content: updatedContent,
     };
   }
   ```

4. **Add bidirectional linking:**
   ```typescript
   // When A links to B, also add B -> A backlink
   for (const link of newLinks) {
     const targetPage = pages.find(p => p.path === link.target);
     if (targetPage && !targetPage.links.includes(page.path)) {
       updates.push(createBacklinkUpdate(targetPage, page));
     }
   }
   ```

---

## Acceptance Criteria

- [x] Pages with existing links can receive new links
- [x] Related Pages section is merged, not replaced
- [x] Bidirectional links are created automatically
- [ ] Link coverage increases over time, not freezes (needs verification)

---

## Related Issues

- Orphaned pages / weak linking (#004)
- Overview agent never updates (#005)
