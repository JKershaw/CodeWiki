# Observed Issues Holding the Wiki Back

**Latest Analysis:** 2025-12-11 (meta-llama/llama-4-maverick)
**Previous Analysis:** 2025-12-09 (qwen/qwen-turbo)

This document combines findings from multiple testing sessions to identify systematic issues preventing effective wiki growth.

---

## Latest Test Results (llama-4-maverick)

**Date:** 2025-12-11
**Model:** meta-llama/llama-4-maverick
**Iterations:** 200 (2 batches of 100)
**Wiki Pages:** 51
**Commits Processed:** 10/311 (3.2%)
**Total Cost:** ~$0.32

---

## NEW Critical Issues (llama-4-maverick)

### NEW: LLM Reasoning/Tool Calls Leaking into Wiki Content

**Severity:** CRITICAL
**Affected Components:** Synthesis agents, Pattern agent
**Affected Pages:** 6+ pages confirmed

**Problem:** LLM "thinking out loud" text and raw tool invocation JSON appear in wiki page content:
- Internal reasoning ("I will read...", "Let's examine...")
- Raw JSON tool calls: `{"name": "search_files", "parameters": {...}}`
- Planning statements ("However, considering the context...")

**Examples:**
```
guides/testing:
"The test directory structure is now clear. I will read sample test files..."

patterns/add:
"{"name": "search_files", "parameters": {"pattern": "**/*.ts"}}"
```

**Root Cause:** Response parsing in synthesis agents does not strip LLM internal reasoning.

**Fix Required:**
1. Add post-processing to strip common LLM reasoning patterns
2. Use structured output format with clear delimiters
3. Add regex filters for tool invocation JSON

---

### NEW: Hallucinated/Fabricated Pattern Pages

**Severity:** CRITICAL
**Affected Components:** Pattern agent
**Affected Pages:** patterns/add, patterns/avoid, patterns/sum, patterns/single-type-other-version-1

**Problem:** Pattern agent creates pages describing "patterns" that don't exist:
- patterns/add references non-existent "global._register()"
- patterns/avoid describes a "PAGRAM mixture" (not in codebase)
- High confidence (0.9) despite questionable accuracy

**Fix Required:**
1. Require verified file paths before creating pattern pages
2. Add code existence verification
3. Lower confidence for unverified patterns

---

### NEW: Response Parsing Failures Creating Malformed Content

**Severity:** CRITICAL
**Affected Components:** code-change agent, response-parser.ts

**Problem:** llama model doesn't follow expected structured output formats:
- Empty sections (SUMMARY, FINDINGS missing)
- Regex patterns leaking into content
- Default/fallback values used

**Example (commits/9f3a6737):**
```markdown
# Setup Openrouter Audit

\s*([\\s\\S]*?)(?=

## Source
```

**Log Evidence:**
```
[code-change] Failed to parse PAGE_TITLE
[code-change] Failed to parse SUMMARY
[pattern] Parse stats: 1 ok, 7 failed
```

**Fix Required:** Implement flexible section parsing with multiple fallback patterns

---

## Previous Analysis (qwen/qwen-turbo)

The following issues were identified in testing with qwen/qwen-turbo and remain relevant:

---

## Critical Issues (Blocking Wiki Usefulness)

### 1. Link Agent Creates Wrong Link Format

**Severity:** CRITICAL
**Location:** `src/agents/meta/link-agent.ts:237-241`

**Problem:** The link agent creates markdown links `[Title](path)` instead of wiki-style links `[[path]]`.

**Current Code:**
```typescript
const relatedSection = `\n\n## Related Pages\n\n${newLinks.map(l => {
  const targetPage = pageMap.get(l.target);
  const targetTitle = targetPage?.title ?? l.target;
  return `- [${targetTitle}](${l.target}) - ${l.reason}`;  // WRONG FORMAT
}).join('\n')}`;
```

**Impact:**
- Zero wiki-style links across all 145 pages
- Wiki rendering systems expecting `[[links]]` won't create clickable navigation
- Pages are completely disconnected

**Evidence:**
```
Total wiki-style links: 0
Total markdown links: 78
```

**Fix Required:** Change link format to `[[${l.target}]]` or `[[${l.target}|${targetTitle}]]`

---

### 2. Link Agent Skips Already-Linked Pages

**Severity:** CRITICAL
**Location:** `src/agents/meta/link-agent.ts:243-246`

**Problem:** Once a page has a "Related Pages" section, the link agent skips it forever:

```typescript
if (page.content.includes('## Related Pages')) {
  continue;  // Never processes this page again
}
```

**Impact:**
- Pages created early never get links to newer pages
- Link coverage frozen at first-pass state
- As wiki grows, older pages become increasingly isolated
- Only 4/145 pages have Related Pages sections after 200 iterations

**Fix Required:**
- Merge with existing Related Pages sections instead of skipping
- Re-analyze pages when significant new content is added
- Track "last linked at" timestamp to enable re-processing

---

### 3. Overview Agent Never Updates Existing Pages

**Severity:** CRITICAL
**Location:** `src/agents/synthesis/overview-agent.ts:164-192, 345`

**Problem:** Two compounding issues:

1. **Skips categories with existing overviews:**
```typescript
if (!hasOverview) {
  needsOverview.push([category, pages]);  // Only processes missing overviews
}
```

2. **Always uses 'create' type (would fail on existing pages anyway):**
```typescript
return {
  type: 'create',  // Never 'update'
  path: `${category}/overview`,
  ...
};
```

**Impact:**
- The main overview page still shows: "a web application for managing tasks and projects"
- Factually incorrect content persists indefinitely
- No self-correction mechanism exists
- Overview unchanged after 200 iterations despite overview agent running 6+ times

**Fix Required:**
- Check existing overview content quality before skipping
- Use `type: 'update'` for existing pages that need correction
- Pattern after wiki-index-agent which handles this correctly

---

### 4. Commit Processing Stalled at 3.2%

**Severity:** HIGH
**Location:** `src/agents/orchestrator/orchestrator.ts` (work prioritization)

**Problem:** After 200 iterations, only 10/315 commits (3.2%) have been processed. The orchestrator consistently prioritizes codebase-explorer over commit analysis.

**Evidence from logs:**
- Agent distribution: codebase-explorer: ~190, code-change: ~30
- Orchestrator messages mention "prioritize exploration" repeatedly
- Commit coverage hasn't changed between iteration 100 and 200

**Impact:**
- Wiki lacks historical context for how code evolved
- "Why did we do X?" questions can't be answered
- Defeats the core value proposition of CodeWiki

**Fix Required:**
- Rebalance orchestrator priorities
- Ensure minimum commit processing per cycle
- Consider commit age/importance weighting

---

### 5. Quality Agent Doesn't Auto-Fix Issues

**Severity:** HIGH
**Location:** `src/agents/meta/quality-agent.ts:320-327`

**Problem:** The quality agent can detect issues but returns empty updates:

```typescript
private generateUpdates(
  _pages: WikiPage[],
  _analysis: QualityAnalysis
): WikiPageUpdate[] {
  // Quality agent reports issues but doesn't auto-fix
  return [];  // Always empty
}
```

**Impact:**
- Inaccurate content persists (e.g., "Project Name" in overview)
- Shallow pages not expanded
- No self-improvement loop

**Fix Required:**
- Generate improvement updates for low-quality pages
- Integration with other agents to fix detected issues
- Confidence-boosting updates for verified content

---

## High Priority Issues

### 6. Edit Requests Accumulate Without Processing

**Severity:** HIGH
**Location:** `src/executor/executor.ts` (edit queue handling)

**Problem:** Edit requests generated by code-change agent accumulate in pending state. After first 100 iterations, 28 were pending. wiki-editor eventually ran but 22 still remain.

**Pattern observed:**
```
📝 Queued 2 edit request(s) for wiki-editor
(repeated many times, wiki-editor runs infrequently)
```

**Impact:**
- Generated content never reaches the wiki
- Architecture documentation pages requested but not created
- Wasted LLM calls for content that never gets used

**Fix Required:**
- Process edit queue more frequently
- Higher priority for wiki-editor when queue exceeds threshold
- Consider inline edit application vs batching

---

### 7. Topic Fragmentation Without Consolidation

**Severity:** HIGH
**Location:** `src/agents/consolidation/` (consolidation agent behavior)

**Problem:** The same topics are documented across many pages without consolidation:
- 6 pages about "bootstrap"
- 14 pages about "link agent"
- Duplicate: "Wiki Page Confidence Management" in 2 different paths

**Impact:**
- Information scattered, hard to find authoritative source
- Users must read multiple pages for complete picture
- Contradictions possible between fragmented content

**Fix Required:**
- Consolidation agent should merge related content
- Canonical page designation for each topic
- Redirect/link from fragment pages to canonical

---

### 8. Template/Placeholder Leakage

**Problem:** Raw LLM template text appears in published wiki pages, and factual inaccuracies persist.

**Evidence:**
- `overview` describes wrong project ("web application for managing tasks")
- `guides/getting-started` references non-existent files (logger.ts, validation.ts)
- Some pages contain template patterns like `[Descriptive title]`

**Root Cause:**
- Response parsing doesn't validate output quality
- No fact-checking against actual source files
- Getting Started agent appears to use generic templates

**Impact:** Developers following the wiki will encounter errors and lose trust.

---

## Medium Priority Issues

### 9. Missing Navigation Aids

**Severity:** MEDIUM

**Problem:** No navigation infrastructure exists:
- 0 pages with breadcrumbs
- 0 pages with "See Also" sections
- No category index pages
- No site map

**Impact:**
- Users can't browse hierarchically
- No way to discover related content
- Lost in wiki without search

**Fix Required:**
- Generate category index pages
- Add breadcrumb component to page template
- Auto-generate "See Also" from semantic similarity

---

### 10. Technical Pages Lack Code Examples

**Severity:** MEDIUM
**Location:** Various agent pages

**Problem:** 10 technical pages about agents, commands, etc. have no code examples.

**Evidence:**
```
Technical pages without code: 10
Example pages missing code: agents/orchestrator, agents/consistency-agent
```

**Impact:**
- Hard to understand usage
- Developers need to reference source anyway
- Documentation incomplete

**Fix Required:**
- Extract key code snippets during analysis
- Include usage examples in agent documentation
- Template requirement for technical pages

---

### 11. Short/Shallow Content

**Severity:** MEDIUM

**Problem:** 9 pages have fewer than 1000 characters. Many pages have surface-level descriptions without depth.

**Evidence:**
```
Pages under 1000 chars: 9
Examples: agents/research-agent (831), agents/consistency-agent (854)
```

**Impact:**
- Not useful for understanding components
- Questions remain unanswered
- Feels like stub content

**Fix Required:**
- Minimum content length enforcement
- Quality threshold for page acceptance
- Expansion pass for shallow pages

---

### 12. Codebase Explorer Path Errors

**Severity:** MEDIUM
**Location:** `src/agents/analysis/codebase-explorer-agent.ts`

**Problem:** Many "Failed to list directory" and "Invalid path" errors in logs:
- Trying to explore files as directories (ENOTDIR)
- Trying to explore paths outside src/
- Non-existent directories being requested

**Evidence from logs:**
```
[codebase-explorer] Failed to list directory src/executor/executor.ts: ENOTDIR
Invalid path for codebase-explorer: scripts (must start with src/ or lib/)
[codebase-explorer] Failed to list directory src/parsing: ENOENT
```

**Impact:**
- Wasted iterations on invalid work
- Explorer behavior unpredictable
- Some code areas never documented

**Fix Required:**
- Better path validation before claiming work
- Handle file vs directory properly
- Update path patterns for actual project structure

---

## Low Priority Issues

### 13. Generic Project Names in Content

**Severity:** LOW
**Location:** `overview` page, `architecture/overview`

**Problem:** Some pages contain "Project Name" instead of "CodeWiki"

**Impact:** Looks unprofessional, suggests template not filled in

---

### 14. Inconsistent .md Extensions in Links

**Severity:** LOW
**Location:** `architecture/overview`, `wiki-quality/agent-cooldowns`

**Problem:** Some internal links include `.md` extension while most don't

**Evidence:**
```
Links with .md extension:
  architecture/overview -> overview.md
  architecture/overview -> agents/orchestrator.md
  wiki-quality/agent-cooldowns -> wiki-quality/duplicate-prevention.md
```

**Impact:** Inconsistent linking conventions

---

## Summary: Root Causes

The issues above stem from several architectural patterns:

| Root Cause | Affected Issues | Pattern |
|------------|-----------------|---------|
| **Create-Only Design** | #3, #5 | Agents create but don't update/improve |
| **Skip-If-Exists Pattern** | #2, #3 | Skipping instead of merging causes stale content |
| **Wrong Link Format** | #1 | Markdown links instead of wiki links |
| **Weak Prioritization** | #4, #6 | Exploration prioritized over commits/quality |
| **No Quality Feedback Loop** | #5, #8 | Detection without correction |
| **Batch Processing** | #6 | Edit requests accumulate vs inline |

---

## Recommended Priority Order

### P0 (Critical - Fix First):
1. **Fix link format** in link-agent.ts (blocks navigation entirely)
2. **Enable page updates** in overview-agent.ts (blocks improvement)
3. **Enable Related Pages merging** in link-agent.ts (allows expansion)

### P1 (High - Fix Soon):
4. **Rebalance orchestrator priorities** (stalled commit processing)
5. **Process edit queue inline** (wasted generation)
6. **Implement quality auto-fix** (enable self-improvement)

### P2 (Medium - Fix Later):
7. **Add navigation aids** (category indexes, breadcrumbs)
8. **Implement content consolidation** (reduce fragmentation)
9. **Expand shallow content** (completeness)

---

## Test Methodology

### qwen/qwen-turbo (2025-12-09):
1. Set up fresh .env with OpenRouter API key
2. Ran `npm run cli process . 100` (first run)
3. Analyzed wiki-pages.json for metrics
4. Ran `npm run cli process . 100` (second run)
5. Compared metrics before/after
6. Used Task agent to explore link-agent.ts and overview-agent.ts implementation
7. Identified code-level root causes for persistent issues

Analysis scripts: `analyze-links.cjs` in project root.

### meta-llama/llama-4-maverick (2025-12-11):
1. Fresh .env with meta-llama/llama-4-maverick model
2. Ran `npx tsx src/cli.ts process . 100` (first batch)
3. Reviewed wiki-pages.json and findings.json
4. Documented findings in review-100-iterations.md
5. Ran `npx tsx src/cli.ts process . 100` (second batch)
6. Compared wiki growth and content quality
7. Documented findings in review-200-iterations.md
8. Consolidated all findings in this document

---

## Master Priority List (All Findings Combined)

### P0 - Critical (Must Fix First)
| # | Issue | Root Cause | Impact |
|---|-------|------------|--------|
| 1 | LLM reasoning leaking into content | Response parsing doesn't strip reasoning | Unreadable wiki pages |
| 2 | Wrong link format (markdown vs wiki) | link-agent.ts:237-241 | Zero navigation |
| 3 | Response parsing failures | Model output variations | Empty/malformed pages |
| 4 | Orphaned pages (88% unconnected) | Link agent runs infrequently | No discoverability |
| 5 | Overview agent never updates | overview-agent.ts:164-192 | Stale content persists |

### P1 - High (Fix Soon)
| # | Issue | Root Cause | Impact |
|---|-------|------------|--------|
| 6 | Hallucinated pattern pages | Pattern agent lacks verification | False information |
| 7 | Commit processing stalled (3.2%) | Orchestrator priorities | Missing history |
| 8 | Quality agent doesn't auto-fix | generateUpdates returns [] | No self-improvement |
| 9 | Edit requests accumulate | Batch processing delays | Wasted generation |
| 10 | Link agent skips existing pages | Skip-if-exists pattern | Pages stay isolated |

### P2 - Medium (Fix Later)
| # | Issue | Root Cause | Impact |
|---|-------|------------|--------|
| 11 | Topic fragmentation | No consolidation | Scattered information |
| 12 | Missing navigation aids | Not implemented | Poor browsability |
| 13 | Shallow content | No minimum requirements | Incomplete docs |
| 14 | Path validation errors | Explorer behavior | Wasted iterations |
| 15 | Inconsistent terminology | No standardization | Confusing readers |

---

## Cross-Model Observations

Issues that appeared in **both** qwen/qwen-turbo and llama-4-maverick testing:
- Orphaned pages / weak linking
- Commit processing stalled at ~3%
- Overview pages not updating
- Quality agent not auto-fixing

Issues **specific to llama-4-maverick**:
- LLM reasoning/tool JSON in content
- Higher rate of response parsing failures
- Hallucinated pattern pages

Issues **specific to qwen/qwen-turbo**:
- Wrong link format (markdown vs wiki-style)
- Template text appearing in content

This suggests the core orchestrator and agent design issues are model-independent, while content quality issues vary by model.
