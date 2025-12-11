# Issue: Overview Agent Never Updates Existing Pages

**Priority:** P0 - Critical
**Severity:** CRITICAL
**Status:** FIXED
**Detected:** 2025-12-09 (qwen testing), confirmed 2025-12-11 (llama testing)

---

## Summary

The overview agent only creates new overview pages and never updates existing ones. Once an overview is created, it becomes stale as new pages are added to that category.

---

## Root Cause

**Location:** `src/agents/synthesis/overview-agent.ts`

### Problem 1: Skip If Overview Exists (lines 164-187)

```typescript
private findCategoriesNeedingOverview(
  categories: Map<string, WikiPage[]>,
  _allPages: WikiPage[]
): Array<[string, WikiPage[]]> {
  const needsOverview: Array<[string, WikiPage[]]> = [];

  for (const [category, pages] of categories) {
    if (skipCategories.includes(category)) continue;
    if (pages.length < this.MIN_PAGES_FOR_OVERVIEW) continue;

    // Check if overview already exists
    const hasOverview = pages.some(p =>
      p.path === `${category}/overview` ||
      p.path === `${category}/index`
    );

    if (!hasOverview) {
      needsOverview.push([category, pages]);
    }
  }
  return needsOverview;
}
```

Categories with existing overviews are completely skipped.

### Problem 2: Create-Only Type (line 370)

```typescript
return {
  type: 'create',  // <-- HARDCODED, never 'update'
  path: `${category}/overview`,
  title,
  content,
  sourceCommitId: '',
  agentRunId: '',
  confidenceDelta: 0.5,
};
```

The agent only supports `type: 'create'`, not `type: 'update'`.

---

## Impact

1. **Stale navigation:** Overview pages list only pages that existed at creation time
2. **Missing pages:** New pages added to a category don't appear in its overview
3. **Outdated descriptions:** Category descriptions can't be improved
4. **Example:** If `architecture/overview` was created with 3 pages, and 10 more architecture pages are added later, the overview still only shows 3 pages

---

## Proposed Fix

1. **Check if overview needs refresh:**
   ```typescript
   private categoriesNeedingRefresh(
     categories: Map<string, WikiPage[]>,
     allPages: WikiPage[]
   ): Array<[string, WikiPage[], 'create' | 'update']> {
     const result: Array<[string, WikiPage[], 'create' | 'update']> = [];

     for (const [category, pages] of categories) {
       const overview = pages.find(p =>
         p.path === `${category}/overview` || p.path === `${category}/index`
       );

       if (!overview) {
         result.push([category, pages, 'create']);
       } else {
         // Check if new pages exist that aren't in the overview
         const listedPages = this.extractListedPages(overview.content);
         const unlisted = pages.filter(p => !listedPages.includes(p.path));
         if (unlisted.length > 0) {
           result.push([category, pages, 'update']);
         }
       }
     }
     return result;
   }
   ```

2. **Support update type:**
   ```typescript
   return {
     type: operationType,  // 'create' or 'update'
     path: `${category}/overview`,
     title,
     content,
     ...
   };
   ```

3. **Merge existing content with updates:**
   ```typescript
   if (operationType === 'update') {
     const existingOverview = await this.getExistingOverview(category);
     content = this.mergeOverviewContent(existingOverview.content, newContent);
   }
   ```

4. **Add staleness detection:**
   ```typescript
   function isOverviewStale(overview: WikiPage, categoryPages: WikiPage[]): boolean {
     const listedCount = extractListedPages(overview.content).length;
     const actualCount = categoryPages.filter(p => !p.path.endsWith('/overview')).length;
     return actualCount > listedCount * 1.2; // 20% more pages than listed
   }
   ```

---

## Acceptance Criteria

- [ ] Overview agent can update existing overview pages
- [ ] New pages in a category trigger overview refresh
- [ ] Existing overview content is preserved/merged
- [ ] Overview pages reflect current category contents

---

## Related Issues

- Orphaned pages / weak linking (#004)
- Quality agent doesn't auto-fix (#006)
