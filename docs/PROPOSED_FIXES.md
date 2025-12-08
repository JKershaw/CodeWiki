# Proposed Fixes for Wiki Generation Issues

**Date:** 2025-12-08
**Based on:** 50-iteration test run and codebase analysis

This document provides specific, targeted fixes for each identified bug with exact file locations and code changes.

---

## FIX-001: Overview Agent Broken Links (.md Extension)

**Bug:** Links in overview pages include `.md` extension but wiki paths don't have extensions
**File:** `src/agents/synthesis/overview-agent.ts`
**Line:** 353

### Current Code
```typescript
return `- [${p.title}](${p.path}.md)${desc ? ` - ${desc.description}` : ''}`;
```

### Fixed Code
```typescript
return `- [${p.title}](${p.path})${desc ? ` - ${desc.description}` : ''}`;
```

### Explanation
Simply remove the `.md` extension. Wiki paths are stored without extensions (e.g., `agents/orchestrator`), so links should match.

---

## FIX-002: Add Deduplication Check Before Page Creation

**Bug:** Multiple pages can be created for the same concept (e.g., 3 LLM Service pages)
**File:** `src/commands/update-wiki-page.ts`
**Location:** Create operation (lines 42-85)

### Current Code (simplified)
```typescript
if (update.type === 'create') {
  if (existing) {
    return failure(`Page already exists at path: ${update.path}`);
  }
  // Creates page without checking for similar content
}
```

### Proposed Fix
Add a similarity check before creation:

```typescript
// Add new helper function
export function findSimilarPages(
  path: string,
  title: string,
  existingPages: WikiPage[]
): WikiPage[] {
  const normalizedPath = path.toLowerCase().replace(/[-_]/g, '');
  const normalizedTitle = title.toLowerCase().replace(/[-_\s]/g, '');

  return existingPages.filter(p => {
    const pPath = p.path.toLowerCase().replace(/[-_]/g, '');
    const pTitle = p.title.toLowerCase().replace(/[-_\s]/g, '');

    // Check for path similarity (same final segment)
    const pathSimilar = pPath.split('/').pop() === normalizedPath.split('/').pop();

    // Check for title similarity
    const titleSimilar = pTitle.includes(normalizedTitle) || normalizedTitle.includes(pTitle);

    return pathSimilar || titleSimilar;
  });
}

// In handleUpdateWikiPage, before create:
if (update.type === 'create') {
  if (existing) {
    return failure(`Page already exists at path: ${update.path}`);
  }

  // NEW: Check for similar pages
  const allPages = await repos.wikiPages.findByWiki(wikiId);
  const similar = findSimilarPages(update.path, update.title ?? '', allPages);
  if (similar.length > 0) {
    console.warn(`[wiki] Similar page exists: ${similar[0].path} (${similar[0].title})`);
    // Option 1: Skip creation and return warning
    // Option 2: Merge into existing page
    // Option 3: Create with qualified path
  }
}
```

### Alternative: Add check in Orchestrator
A less invasive fix is to add deduplication in the orchestrator when generating work items for codebase-explorer:

**File:** `src/agents/orchestrator/strategies.ts`

```typescript
// Before creating codebase-explorer work item, check if topic is covered
const existingPaths = wikiPages.map(p => p.path);
const existingTitles = wikiPages.map(p => p.title.toLowerCase());

// Skip if similar path exists
if (existingPaths.some(ep => ep.includes(dir.path.split('/').pop()!))) {
  continue;
}
```

---

## FIX-003: Improve Commit Page Title Generation

**Bug:** Merge commit messages become page titles (e.g., "Merge pull request #238...")
**File:** `src/agents/analysis/code-change-agent.ts`
**Lines:** 375-381

### Current Code
```typescript
function extractTitleFromMessage(message: string): string {
  const firstLine = message.split('\n')[0] ?? message;
  // Remove common prefixes like "feat:", "fix:", etc.
  const cleaned = firstLine.replace(/^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)(\([^)]+\))?:\s*/i, '');
  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
```

### Fixed Code
```typescript
function extractTitleFromMessage(message: string): string {
  const firstLine = message.split('\n')[0] ?? message;

  // Handle merge commits - extract the actual content
  if (firstLine.startsWith('Merge pull request')) {
    // Try to find a meaningful title in the PR branch name or body
    // e.g., "Merge pull request #238 from user/add-feature" -> "Add Feature"
    const branchMatch = firstLine.match(/from\s+\S+\/(.+)$/);
    if (branchMatch) {
      const branchName = branchMatch[1]!;
      // Convert branch-name-style to Title Case
      return branchName
        .replace(/^(claude|feature|fix|bugfix|hotfix)[/-]/i, '')
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
    // Fallback for merge commits without parseable branch
    return 'Merged Changes';
  }

  // Handle "Merge branch 'x' into 'y'" format
  if (firstLine.startsWith('Merge branch')) {
    const branchMatch = firstLine.match(/Merge branch '([^']+)'/);
    if (branchMatch) {
      return branchMatch[1]!
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
    return 'Merged Changes';
  }

  // Remove common prefixes like "feat:", "fix:", etc.
  const cleaned = firstLine.replace(/^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)(\([^)]+\))?:\s*/i, '');

  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
```

### Additional Fix: Enforce LLM Title Generation
The code-change agent's prompt already asks for `PAGE_TITLE:`, but sometimes the LLM doesn't provide it. Add emphasis:

**File:** `src/agents/analysis/code-change-agent.ts`
**Line:** 156-157 (in SYSTEM_PROMPT)

```typescript
PAGE_TITLE:
[REQUIRED - You MUST provide a descriptive title. Use something like "Multi-Agent Processing Pipeline" or "CQRS Architecture Implementation". NEVER use commit hashes, PR numbers, or branch names as titles.]
```

---

## FIX-004: Increase Link Agent Scheduling Frequency

**Bug:** Link agent runs only once, leaving 77% of pages without Related Pages
**File:** `src/agents/orchestrator/strategies.ts`
**Lines:** 366-381

### Current Code
```typescript
if (pagesWithoutLinks.length > 0) {
  const linkKey = 'link:wiki';
  if (!ctx.existingWorkKeys.has(linkKey)) {
    ctx.existingWorkKeys.add(linkKey);
    workItems.push(createWorkItem({
      id: uuid(),
      repoId: ctx.repoId,
      agentType: 'link',
    }));
  }
}
```

### Fixed Code
```typescript
// Link agent should run more frequently based on unlinked page ratio
const totalPages = wikiPages.length;
const pagesWithoutLinks = wikiPages.filter(p => p.links.length === 0);
const unlinkedRatio = totalPages > 0 ? pagesWithoutLinks.length / totalPages : 0;

// Schedule link agent if:
// 1. More than 30% of pages have no links, OR
// 2. More than 5 pages have no links (absolute threshold)
const needsLinking = unlinkedRatio > 0.3 || pagesWithoutLinks.length > 5;

if (needsLinking) {
  // Check cooldown - don't run more than once per 5 iterations
  const recentLinkRuns = recentRuns
    .filter(r => r.agentType === 'link' && r.status === 'completed')
    .slice(0, 1);

  const hasRecentRun = recentLinkRuns.length > 0;
  const linkKey = 'link:wiki';

  // Allow re-scheduling if no recent run OR if unlinked ratio is very high
  if (!ctx.existingWorkKeys.has(linkKey) && (!hasRecentRun || unlinkedRatio > 0.5)) {
    ctx.existingWorkKeys.add(linkKey);
    workItems.push(createWorkItem({
      id: uuid(),
      repoId: ctx.repoId,
      agentType: 'link',
    }));
  }
}
```

### Alternative: Process Pages in Batches
Another approach is to make the link agent process a subset of pages each run:

**File:** `src/agents/meta/link-agent.ts`

```typescript
// In runOnWiki method, limit pages per run:
const MAX_PAGES_PER_RUN = 10;
const pagesToAnalyze = pages
  .filter(p => p.links.length === 0)
  .slice(0, MAX_PAGES_PER_RUN);  // Process in batches

// This allows link agent to run multiple times, each processing a batch
```

---

## FIX-005: Normalize Title Capitalization

**Bug:** Inconsistent title casing ("test driven development" vs "LLM Service Overview")
**File:** `src/commands/update-wiki-page.ts`
**Location:** After title extraction

### Proposed Fix
Add a title normalization function:

```typescript
/**
 * Normalize title to Title Case, preserving acronyms.
 */
export function normalizeTitle(title: string): string {
  // Common acronyms to preserve
  const acronyms = ['API', 'LLM', 'CLI', 'TDD', 'CQRS', 'MCP', 'OAuth', 'JWT', 'URL', 'HTTP'];

  // Split and capitalize each word
  return title
    .split(' ')
    .map(word => {
      const upper = word.toUpperCase();
      // Preserve known acronyms
      if (acronyms.includes(upper)) {
        return upper;
      }
      // Title case for regular words
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

// Use in extractTitleWithFallback:
export function extractTitleWithFallback(content: string, path: string): string {
  const contentTitle = extractTitle(content);
  if (contentTitle !== 'Untitled') {
    return normalizeTitle(contentTitle);  // Normalize here
  }
  return normalizeTitle(extractTitleFromPath(path));  // And here
}
```

---

## FIX-006: Handle Duplicate Page Titles

**Bug:** Two pages titled "Auth" at different paths
**File:** `src/commands/update-wiki-page.ts`

### Proposed Fix
When title already exists, qualify with path:

```typescript
// Before saving, check if title exists elsewhere
const existingWithTitle = await repos.wikiPages.findByTitle(wikiId, page.title);
if (existingWithTitle && existingWithTitle.path !== page.path) {
  // Qualify title with parent path
  const parentPath = page.path.split('/').slice(-2, -1)[0];
  if (parentPath) {
    page.title = `${page.title} (${parentPath})`;
  }
}
```

This would result in:
- `web/public/modules/auth` → "Auth (modules)"
- `web/routes/auth` → "Auth (routes)"

---

## FIX-007: Improve API Retry Logic

**Bug:** 24% failure rate due to 503 errors with insufficient retries
**File:** `src/services/llm/openrouter-llm-service.ts`

### Current Behavior
- 3 retries with 1s, 2s, 3s delays

### Proposed Fix
```typescript
// Increase retries and use exponential backoff
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    return await this.makeRequest(options);
  } catch (error) {
    if (attempt === MAX_RETRIES) throw error;

    const isRetryable = error.status === 503 || error.status === 429 || error.code === 'ECONNRESET';
    if (!isRetryable) throw error;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
    console.log(`[LLM] Retry ${attempt}/${MAX_RETRIES} after ${error.status} error, waiting ${delay}ms`);
    await sleep(delay);
  }
}
```

---

## Implementation Priority

| Priority | Fix | Effort | Impact |
|----------|-----|--------|--------|
| 1 | FIX-001 (overview .md links) | Low | Critical - immediate broken links |
| 2 | FIX-003 (commit titles) | Low | High - visible UX issue |
| 3 | FIX-004 (link agent scheduling) | Medium | High - 77% pages unlinked |
| 4 | FIX-002 (deduplication) | Medium | Critical - prevents fragmentation |
| 5 | FIX-005 (title normalization) | Low | Low - cosmetic |
| 6 | FIX-006 (duplicate titles) | Low | Medium - navigation clarity |
| 7 | FIX-007 (retry logic) | Low | Medium - reliability |

---

## Testing Recommendations

After implementing fixes:

1. **Unit Test for FIX-001:**
```typescript
test('overview agent generates links without .md extension', async () => {
  const update = agent.generateUpdate('agents', overview, pages);
  expect(update.content).not.toContain('.md)');
  expect(update.content).toContain('](agents/orchestrator)');
});
```

2. **Integration Test for FIX-004:**
```typescript
test('link agent runs multiple times when pages are unlinked', async () => {
  // Create 10 pages without links
  // Run 5 iterations
  // Verify link agent ran at least twice
});
```

3. **E2E Test:**
Run 50 iterations again after fixes and verify:
- No broken links in wiki
- No duplicate topic pages
- > 50% of pages have Related Pages
- All commit pages have readable titles
