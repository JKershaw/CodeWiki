# Proposed Fixes for Wiki Generation Issues

**Date:** 2025-12-08
**Based on:** 50-iteration test run and codebase analysis
**Last Updated:** 2025-12-08

This document provides specific, targeted fixes for each identified bug with exact file locations and code changes.

---

## FIX-001: Overview Agent Broken Links (.md Extension) ✅ IMPLEMENTED

**Bug:** Links in overview pages include `.md` extension but wiki paths don't have extensions
**File:** `src/agents/synthesis/overview-agent.ts`
**Line:** 353
**Status:** ✅ **FIXED** in commit `cc8ee87`

### Original Code
```typescript
return `- [${p.title}](${p.path}.md)${desc ? ` - ${desc.description}` : ''}`;
```

### Fixed Code
```typescript
return `- [${p.title}](${p.path})${desc ? ` - ${desc.description}` : ''}`;
```

### Test Added
`tests/integration/synthesis-agents.test.ts` - "generates links without .md extension"

### Explanation
Simply removed the `.md` extension. Wiki paths are stored without extensions (e.g., `agents/orchestrator`), so links should match.

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

## FIX-003: Improve Commit Page Title Generation ✅ IMPLEMENTED

**Bug:** Merge commit messages become page titles (e.g., "Merge pull request #238...")
**File:** `src/agents/analysis/code-change-agent.ts`
**Lines:** 376-413
**Status:** ✅ **FIXED** in commit `cc8ee87`

### Original Code
```typescript
function extractTitleFromMessage(message: string): string {
  const firstLine = message.split('\n')[0] ?? message;
  // Remove common prefixes like "feat:", "fix:", etc.
  const cleaned = firstLine.replace(/^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)(\([^)]+\))?:\s*/i, '');
  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
```

### Fixed Code (Implemented)
```typescript
export function extractTitleFromMessage(message: string): string {
  const firstLine = message.split('\n')[0] ?? message;

  // Handle "Merge pull request #X from user/branch-name" format
  if (firstLine.startsWith('Merge pull request')) {
    const branchMatch = firstLine.match(/from\s+\S+\/(.+)$/);
    if (branchMatch) {
      const branchName = branchMatch[1]!;
      // Remove common prefixes like "claude/", "feature/", "fix/"
      const cleanedBranch = branchName.replace(/^(claude|feature|fix|bugfix|hotfix|release)[/-]/i, '');
      // Remove trailing session IDs (like -01abc123xyz)
      const withoutSessionId = cleanedBranch.replace(/-[0-9a-zA-Z]{20,}$/, '');
      // Convert branch-name-style to Title Case
      return withoutSessionId
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    }
    return 'Merged Changes';
  }

  // Handle "Merge branch 'x' into 'y'" format
  if (firstLine.startsWith('Merge branch')) {
    const branchMatch = firstLine.match(/Merge branch '([^']+)'/);
    if (branchMatch) {
      return branchMatch[1]!
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
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

### Test Added
`tests/unit/commit-title-extraction.test.ts` with 14 test cases covering:
- Merge pull request commits
- Merge branch commits
- Conventional commits (feat:, fix:, etc.)
- Regular commits

### Notes
- Function is now exported for testability
- Also removes session IDs from branch names (e.g., `-01abc123xyz`)

---

## FIX-004: Increase Link Agent Scheduling Frequency ✅ IMPLEMENTED

**Bug:** Link agent runs only once, leaving 77% of pages without Related Pages
**Files:**
- `src/agents/orchestrator/strategies.ts` (lines 365-402)
- `src/agents/orchestrator/prompts.ts` (lines 38, 95, 134)
**Status:** ✅ **FIXED** in commit `cc8ee87`

### Original Code (strategies.ts)
```typescript
if (pagesWithoutLinks.length > 0) {
  const linkKey = 'link:wiki';
  if (!ctx.existingWorkKeys.has(linkKey)) {
    ctx.existingWorkKeys.add(linkKey);
    workItems.push(createWorkItem({...}));
  }
}
```

### Fixed Code (Implemented - strategies.ts)
```typescript
// Check for pages without links (need link agent)
// Link agent scheduling is more aggressive than other meta agents because
// cross-references are critical for wiki navigation
if (workItems.length < remainingSlots) {
  const pagesWithoutLinks = wikiPages.filter(p => p.links.length === 0);
  const totalPages = wikiPages.length;
  const unlinkedRatio = totalPages > 0 ? pagesWithoutLinks.length / totalPages : 0;

  // Schedule link agent if:
  // 1. More than 30% of pages have no links, OR
  // 2. More than 5 pages have no links (absolute threshold for small wikis)
  const needsLinking = unlinkedRatio > 0.3 || pagesWithoutLinks.length > 5;

  if (needsLinking) {
    const linkKey = 'link:wiki';

    // Check for recent link runs (cooldown)
    const recentLinkRuns = recentRuns
      .filter(r => r.agentType === 'link' && r.status === 'completed')
      .slice(0, 1);
    const hasRecentRun = recentLinkRuns.length > 0;

    // Override cooldown if unlinked ratio is very high (> 50%)
    // This ensures link agent runs frequently when wiki is poorly linked
    const shouldOverrideCooldown = unlinkedRatio > 0.5;

    if (!ctx.existingWorkKeys.has(linkKey) && (!hasRecentRun || shouldOverrideCooldown)) {
      ctx.existingWorkKeys.add(linkKey);
      workItems.push(createWorkItem({...}));
    }
  }
}
```

### LLM Orchestrator Prompt Updates (prompts.ts)

1. **Agent description** (line 38):
```
- link: Adds cross-references between pages. CRITICAL for navigation - run when >30% pages lack links.
```

2. **Added example** (line 95):
```
link,,45% of pages have no cross-references
```

3. **Dynamic warning** (line 134):
```typescript
- Pages without links: ${ctx.pagesWithoutLinks}${
  (ratio > 0.3) ? ' - CRITICAL: >30% pages unlinked, run link agent!' : ' (link agent improves discoverability)'
}
```

### Test Added
`tests/unit/link-agent-scheduling.test.ts` with 4 test cases:
- Schedules link agent when pages have no links
- Does not schedule when all pages have links
- Respects recent run cooldown
- Reschedules when high percentage of pages are unlinked

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

| Priority | Fix | Effort | Impact | Status |
|----------|-----|--------|--------|--------|
| 1 | FIX-001 (overview .md links) | Low | Critical | ✅ DONE |
| 2 | FIX-003 (commit titles) | Low | High | ✅ DONE |
| 3 | FIX-004 (link agent scheduling) | Medium | High | ✅ DONE |
| 4 | FIX-002 (deduplication) | Medium | Critical | ⏳ TODO |
| 5 | FIX-005 (title normalization) | Low | Low | ⏳ TODO |
| 6 | FIX-006 (duplicate titles) | Low | Medium | ⏳ TODO |
| 7 | FIX-007 (retry logic) | Low | Medium | ⏳ TODO |

---

## Tests Added

| Fix | Test File | Test Cases |
|-----|-----------|------------|
| FIX-001 | `tests/integration/synthesis-agents.test.ts` | 1 |
| FIX-003 | `tests/unit/commit-title-extraction.test.ts` | 14 |
| FIX-004 | `tests/unit/link-agent-scheduling.test.ts` | 4 |
| **Total** | **3 files** | **19 tests** |

---

## Verification Recommendations

After implementing remaining fixes, run:

1. **All tests:**
```bash
npm run lint && npm run typecheck && npm run test
```

2. **E2E Test (50 iterations):**
```bash
npx tsx src/cli.ts process . 50
```

Then verify:
- ✅ No broken links in wiki (FIX-001 verified)
- ⏳ No duplicate topic pages (FIX-002 pending)
- ✅ > 50% of pages have Related Pages (FIX-004 should help)
- ✅ All commit pages have readable titles (FIX-003 verified)
