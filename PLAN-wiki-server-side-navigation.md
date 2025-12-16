# Plan: Simplify Wiki Navigation with Server-Side Routing

## Goal
Replace the SPA-style client-side wiki navigation with server-side routing, making it consistent with the rest of the site.

## Current State

**Route**: `/wiki/:repoId` (single route for all wiki pages)

**Flow**:
1. Server renders `wiki.ejs` with only `repoId`
2. Client JavaScript (`wiki.js`) fetches:
   - Repository metadata
   - Wiki list
   - Wiki tree structure
3. Clicking a page calls `loadWikiPage()` which fetches via API and renders client-side
4. Tree expansion state tracked in client-side `expandedTreeNodes` Set

**Files involved**:
- `src/web/routes/pages.ts` - Single route
- `src/web/views/pages/wiki.ejs` - Minimal template
- `src/web/public/modules/wiki.js` - ~600 lines of client-side logic

## Target State

**Routes**:
- `/wiki/:repoId` - Wiki view with no page selected
- `/wiki/:repoId/:path(*)` - Wiki view with specific page

**Flow**:
1. Server fetches all data and renders complete page
2. Tree links are regular `<a href="/wiki/...">` tags
3. Clicking a link = normal navigation (full page load)
4. Tree expand/collapse is client-side UI only

## Implementation Plan

### Step 1: Add Server-Side Markdown Rendering

Add `marked` and `sanitize-html` packages for server-side markdown conversion.

```bash
npm install marked sanitize-html
npm install -D @types/sanitize-html
```

Create utility `src/web/utils/markdown.ts`:
```typescript
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export function markdownToHtml(md: string): string {
  const rawHtml = marked.parse(md, { gfm: true });
  return sanitizeHtml(rawHtml, { /* options */ });
}
```

### Step 2: Update Page Routes

Modify `src/web/routes/pages.ts`:

```typescript
// Wiki view - with optional page path
router.get('/wiki/:repoId/:path(*)?', async (req, res) => {
  const { repoId, path } = req.params;
  const wikiId = req.query.wikiId as string | undefined;

  // Fetch all needed data server-side
  const repo = await getRepository(repoId);
  const wikis = await getWikis(repoId);
  const currentWiki = wikiId ? wikis.find(w => w.id === wikiId) : wikis.find(w => w.isActive) || wikis[0];
  const tree = await getWikiTree(currentWiki.id);
  const page = path ? await getWikiPage(currentWiki.id, path) : null;

  res.render('pages/wiki', {
    repoId,
    repo,
    wikis,
    currentWiki,
    tree,
    page,
    currentPath: path || null,
  });
});
```

### Step 3: Update Wiki Template

Rewrite `src/web/views/pages/wiki.ejs` to render server-side:

**Key changes**:
1. Tree rendered with `<a href="/wiki/<%= repoId %>/<%= node.path %>">` links
2. Wiki selector as `<select onchange="...">` that navigates
3. Page content rendered server-side using `markdownToHtml()`
4. Metadata panel rendered server-side
5. Pass `currentPath` to template for highlighting active node

**Template structure**:
```ejs
<aside id="wiki-sidebar">
  <h3>Pages</h3>
  <div id="wiki-categories">
    <% if (tree.length === 0) { %>
      <p class="placeholder">No pages yet</p>
    <% } else { %>
      <div class="wiki-tree">
        <%- include('../partials/wiki-tree-node', { nodes: tree, repoId, wikiId: currentWiki?.id, currentPath }) %>
      </div>
    <% } %>
  </div>
</aside>

<article id="wiki-content">
  <% if (page) { %>
    <div class="wiki-body"><%- pageHtml %></div>
    <div class="wiki-meta">
      <%- include('../partials/wiki-metadata', { page }) %>
    </div>
  <% } else { %>
    <p class="placeholder">Select a page from the sidebar</p>
  <% } %>
</article>
```

### Step 4: Create Tree Node Partial

New file `src/web/views/partials/wiki-tree-node.ejs`:

Recursive template that renders tree nodes with proper links and data attributes for client-side expand/collapse.

### Step 5: Create Metadata Partial

New file `src/web/views/partials/wiki-metadata.ejs`:

Move the metadata panel rendering from JavaScript to EJS template.

### Step 6: Simplify wiki.js

Reduce `src/web/public/modules/wiki.js` from ~600 lines to ~100 lines:

**Keep**:
- `expandedTreeNodes` Set
- `toggleTreeNode()` - expand/collapse tree nodes
- `expandParentNodes()` - expand ancestors of current page
- `initWikiListeners()` - wire up event handlers

**Remove**:
- `initWikiPage()` - no longer needed
- `loadWikiSelector()` - server-rendered
- `loadWikiPages()` - server-rendered
- `loadWikiPage()` - server-rendered
- `renderTreeNode()` - server-rendered
- `renderMetadataPanel()` - server-rendered
- All `render*List()` helpers - server-rendered
- Wiki deletion logic - move to separate module or keep inline

**Add**:
- On page load: call `expandParentNodes(currentPath)` to expand tree to current page
- Wiki selector change handler: navigate to new URL

### Step 7: Update E2E Tests

Update `tests/e2e/wiki.spec.ts`:
- Tests should still pass since they test DOM elements, not implementation
- May need to update URL expectations (now `/wiki/repo/path` instead of `/wiki/repo?page=path`)

## Files Changed Summary

| File | Change |
|------|--------|
| `package.json` | Add `marked`, `sanitize-html` dependencies |
| `src/web/utils/markdown.ts` | New - server-side markdown utility |
| `src/web/routes/pages.ts` | Update route to fetch data and pass to template |
| `src/web/views/pages/wiki.ejs` | Rewrite to render content server-side |
| `src/web/views/partials/wiki-tree-node.ejs` | New - recursive tree node template |
| `src/web/views/partials/wiki-metadata.ejs` | New - metadata panel template |
| `src/web/public/modules/wiki.js` | Simplify dramatically (~600 → ~100 lines) |
| `tests/e2e/wiki.spec.ts` | Update URL patterns if needed |

## Benefits

1. **Consistency** - Matches navigation pattern of rest of site
2. **Simpler JavaScript** - Remove most of wiki.js
3. **Real URLs** - Every page has a shareable/bookmarkable URL
4. **Browser navigation** - Back/forward work naturally
5. **SEO** - Pages are server-rendered (if that matters)
6. **Less client-side state** - Tree expansion is the only client state

## Tradeoffs

1. **Full page reloads** - Slightly slower navigation between pages
2. **Tree reloads** - Sidebar reloads on each navigation
3. **Expansion state** - Need to persist or auto-expand on each load

## Open Questions

1. **Wiki selector behavior**: Should it be a `<select>` that triggers navigation, or convert to links?
   - Recommendation: Keep as `<select>` with `onchange` that does `window.location = ...`

2. **Tree expansion persistence**: Should we persist expansion state?
   - Recommendation: No - just auto-expand ancestors of current page. Simpler.

3. **Delete wiki button**: Keep the modal/confirmation flow as-is (client-side)?
   - Recommendation: Yes - this is a destructive action, modal UX is appropriate

## Estimated Scope

- ~150 lines new (templates, markdown utility)
- ~500 lines removed (client-side rendering logic)
- Net reduction of ~350 lines
