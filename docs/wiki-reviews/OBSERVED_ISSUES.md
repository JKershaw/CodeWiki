# Observed Wiki System Issues

**Date:** 2025-12-08
**Test Configuration:**
- Model: `meta-llama/llama-4-maverick` via OpenRouter
- Total Iterations: 100 (two batches of 50)
- Repository: CodeWiki itself (320 commits)

---

## Summary

After running 100 wiki generation iterations, 24 wiki pages were created. The system shows promise in structure and navigation but has significant issues with factual accuracy, link tracking, and content depth for commit analysis.

---

## Critical Issues

### 1. Hallucinated Technology Stack
**Severity:** CRITICAL
**Status:** Persists through updates

The `services/repository-service` wiki page incorrectly claims the project uses NestJS:

```markdown
### Overview
The `RepositoryService` is a NestJS service likely responsible for handling data access...

### Implementation
Although the exact implementation is unknown, it's likely decorated with `@Injectable()`.
```

**Reality:** The actual code is plain TypeScript interfaces with no NestJS dependencies:

```typescript
// Actual src/services/repository/repository-service.ts
export interface RepositoryService {
  loadCommits(repo: Repo, options?: CommitListOptions): Promise<Commit[]>;
  // ... plain TypeScript interface
}
```

**Root Cause:** The codebase-explorer agent appears to guess at implementation patterns rather than reading actual source files. The hallucination survived a page update (ToC was added, confidence increased), indicating no accuracy verification occurs during updates.

**Impact:** Users following this documentation would be misled about the technology stack.

---

### 2. Link/Backlink Tracking Completely Non-Functional
**Severity:** CRITICAL
**Status:** Broken across all pages

All 24 wiki pages have empty link arrays:
```json
{
  "links": [],
  "backlinks": []
}
```

Despite:
- Wiki Index page containing 18+ markdown links to other pages
- Multiple pages referencing each other (e.g., Executor Overview links to Executor Implementation)
- Link agent being scheduled and executed

**Evidence:**
- The `link` agent failed with 503 errors in batch 1
- Even successfully created pages have no links extracted
- The data model supports links but nothing populates it

**Impact:** Cross-page navigation relies solely on users finding links in text. No structured navigation graph exists.

---

### 3. Agent Tool Enforcement Failures
**Severity:** HIGH
**Status:** Recurring

Multiple agents failed with "Agent made 0 tool call(s), but 1 required":
- `code-change` agent: 6+ failures
- `technical-debt` agent: 1 failure
- `pattern` agent: 1 failure

**Root Cause:** The model (llama-4-maverick) doesn't consistently follow tool-use requirements in prompts.

**Impact:** Work items fail and don't contribute to wiki, wasting iterations.

---

### 4. Silent Agent Completions (No Work Done)
**Severity:** HIGH
**Status:** Recurring

Several agents report completion with 0ms and $0.0000 cost:
- `getting-started` agent
- `project-overview` agent
- `writer` agent
- `dependency` agent

**Evidence:**
```
✓ getting-started completed (0ms, $0.0000)
✓ dependency completed (0ms, $0.0000)
```

**Root Cause:** These agents appear to early-exit before doing meaningful work, possibly due to missing prerequisites or edge cases not handled.

**Impact:** Important synthesis content (getting started guides, dependency docs) never gets created.

---

## High-Priority Issues

### 5. Shallow Commit Page Content
**Severity:** HIGH
**Status:** Consistent pattern

Commit-based pages contain minimal analysis:

```markdown
# Merge pull request #228 from JKershaw/claude/...



## Source
- **Commit:** fb4b2fb2
- **Files:** `test.ts`, `service.ts`
```

The content between title and Source sections is empty. No explanation of what the commit does, why changes were made, or how it fits into the codebase evolution.

**Compare to exploration pages** which have decent content structure:
- Overview sections
- Key components
- Usage examples
- Configuration options

---

### 6. Speculative/Fabricated Code Examples
**Severity:** HIGH
**Status:** Persists through updates

The `analysis/self-improvement-agent` page shows fabricated example code:

```typescript
// Example usage from tests
const agent = new SelfImprovementAgent();
const improvementSuggestions = agent.analyze(codeToAnalyze);
```

**Reality:** Actual constructor requires 4 parameters:
```typescript
constructor(
  private readonly repos: Repositories,
  private readonly llm: LLMService,
  private readonly git?: GitService,
  private readonly repoServiceFactory?: RepositoryServiceFactory
)
```

The wiki presents code that would not compile.

---

### 7. High API Failure Rate
**Severity:** HIGH
**Status:** Environmental

- Batch 1: 28% failure rate (14/50)
- Batch 2: 76% failure rate (38/50)

Primary error: OpenRouter 503 with TLS certificate verification failures.

**Impact:** Iteration efficiency dramatically reduced. 50 "iterations" may only produce 12 successful work items.

---

## Medium-Priority Issues

### 8. Pattern Agent Parsing Failures
**Severity:** MEDIUM
**Status:** Recurring

Pattern agent finds patterns but fails to parse them:
```
[pattern] Found PATTERNS_FOUND section with 2 lines but parsed 0 items
[pattern] Found WIKI_UPDATES section with 1 lines but parsed 0 items
```

**Root Cause:** Output format mismatch between what the model produces and what the parser expects.

---

### 9. No Accuracy Verification During Updates
**Severity:** MEDIUM
**Status:** Architectural

When pages are updated:
- Table of Contents is added
- Confidence score increases slightly (50% → 55%)
- Factual errors are NOT corrected

The system adds structure but doesn't verify content accuracy against source code.

---

### 10. Low Commit Processing Rate
**Severity:** MEDIUM
**Status:** Expected given agent failures

After 100 iterations:
- ~10 commits processed out of 320 (3%)
- Most commit-related agents failed

At current rate, full commit coverage would require ~3000+ iterations.

---

### 11. Inconsistent Page Path Conventions
**Severity:** LOW
**Status:** Cosmetic

Pages use inconsistent path structures:
- `overview` (root level)
- `commits/fb4b2fb2` (category/identifier)
- `architecture/cqrs-queries` (category/topic)
- `navigation/wiki-index` (functional/page)

No clear hierarchy or naming convention is enforced.

---

## What Works Well

1. **Wiki Index Navigation** - Successfully created after batch 2, provides good overview
2. **Table of Contents Generation** - Pages updated with useful ToC sections
3. **Exploration Page Structure** - Reasonable content organization
4. **Agent Categories** - Good separation of concerns (analysis, meta, synthesis)
5. **CQRS/Command Pattern Documentation** - Accurately describes architectural patterns
6. **Retry Logic** - System appropriately retries failed API calls
7. **Cost Tracking** - Accurate cost reporting per iteration

---

## Recommendations

### Immediate Fixes

1. **Add source file verification** - Before generating content about a file, require reading it
2. **Fix link extraction** - Links in markdown content should populate the `links` array
3. **Improve tool enforcement prompts** - Make tool requirements clearer for less capable models
4. **Handle agent early-exit** - Log why agents complete without work

### Architecture Improvements

1. **Content validation pass** - After generating content, verify claims against source
2. **Link agent should run more frequently** - Currently seems to rarely succeed
3. **Commit analysis depth** - Require minimum content for commit pages

### Model Considerations

1. **Test with different models** - llama-4-maverick has high tool enforcement failure rate
2. **Consider model-specific prompts** - Some models need more explicit tool instructions
3. **Add fallback for synthesis agents** - getting-started should not silently fail

---

## Test Artifacts

- `docs/wiki-reviews/review-batch-1-50-iterations.md` - First batch analysis
- `docs/wiki-reviews/review-batch-2-100-iterations.md` - Second batch analysis
- `.codewiki-data/wiki-pages.json` - Generated wiki content
- `.codewiki-data/agent-runs.json` - Agent execution history
