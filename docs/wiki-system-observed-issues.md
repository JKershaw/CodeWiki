# CodeWiki System - Observed Issues Report

**Date:** 2025-12-08
**Analysis Method:** 100 iterations of wiki generation against self (CodeWiki repo)
**Model Used:** google/gemini-2.5-flash via OpenRouter

---

## Issue Summary Table

| ID | Issue | Severity | Category | Impact |
|----|-------|----------|----------|--------|
| W-001 | Page titles always "Untitled" | Critical | Data | Navigation broken, search useless |
| W-002 | Markdown links not tracked in links array | High | Data | Link analysis fails |
| W-003 | 20% of pages are orphans | High | Navigation | Pages unreachable |
| W-004 | codebase-explorer 71% failure rate | High | Agent | Content gaps |
| W-005 | 0.4% commit coverage | High | Content | Missing history |
| W-006 | Inconsistent link formats | Medium | Content | Potential broken links |
| W-007 | Commit pages low quality | Medium | Content | Minimal documentation |
| W-008 | Confidence scores not meaningful | Low | Data | Misleading metrics |
| W-009 | No wiki index/TOC | Low | Navigation | No entry point |

---

## Detailed Issue Descriptions

### W-001: Page Titles Not Set

**Severity:** Critical

**Description:**
66% of wiki pages (35 of 53) have the title field set to "Untitled" despite having proper H1 headers in their markdown content.

**Evidence:**
```json
{
  "path": "overview",
  "title": "Untitled",
  "content": "**# CodeWiki - Overview**\n\n..."
}
```

**Root Cause Analysis:**
The title extraction logic appears to not be running or is failing silently. The content clearly contains H1 headers that should be extracted.

**Impact:**
- Wiki index/navigation would show "Untitled" for most entries
- Search results would be unhelpful
- User experience significantly degraded

**Suggested Fix:**
1. Verify title extraction runs on page creation/update
2. Add regex to extract first H1: `/^#\s+(.+)$/m`
3. Log warnings when title extraction fails

---

### W-002: Markdown Links Not Tracked

**Severity:** High

**Description:**
When wiki pages contain markdown links in their content, these links are not being parsed and added to the page's `links` array. This breaks link analysis.

**Evidence:**
```json
{
  "path": "guides/overview",
  "content": "...[Getting Started](guides/getting-started.md)...",
  "links": []
}
```

**Root Cause Analysis:**
The link extraction logic either:
1. Only runs when links are explicitly added via the writer agent
2. Doesn't parse markdown link syntax `[text](url)`
3. Is filtering out links with `.md` extension

**Impact:**
- Broken link detection fails (system doesn't know about these links)
- Link graph analysis incomplete
- Related pages suggestions less accurate

**Suggested Fix:**
1. Add post-processing to extract markdown links from content
2. Normalize link paths (remove .md extensions)
3. Run on every page save, not just agent-initiated updates

---

### W-003: Orphan Pages Accumulate

**Severity:** High

**Description:**
11 pages (21%) have no backlinks, making them unreachable through normal wiki navigation.

**Orphan Pages:**
1. `commits/e51de5c0`
2. `architecture/query-design`
3. `web/overview`
4. `web/server-configuration`
5. `web/routes`
6. `web/available-models`
7. `agents/consolidation/finding-handlers-overview`
8. `agents/consolidation/handlers/broken-link-handler`
9. `services/llm/analysis-tools/wiki-history-and-provenance`
10. `guides/overview`
11. `repositories/mongodb-implementations`

**Root Cause Analysis:**
- New pages created without establishing links from existing pages
- Link agent may not run frequently enough
- Category overview pages not automatically linked from parent

**Impact:**
- Content exists but users can't find it
- Wiki appears incomplete even when content exists
- Navigation frustrating

**Suggested Fix:**
1. When creating pages, automatically add backlinks from category index
2. Add orphan detection to link agent
3. Generate category index pages that list all pages in category

---

### W-004: codebase-explorer Agent High Failure Rate

**Severity:** High

**Description:**
The codebase-explorer agent fails 71% of the time (51 failures out of 72 runs). Most failures are tool enforcement errors.

**Failure Breakdown:**
| Error Type | Count |
|------------|-------|
| Made 0 tool calls, 2 required | 28 |
| Missing required tool: list_directory | 7 |
| Made 1 tool call, 2 required | 4 |
| API 503 errors | 12 |

**Root Cause Analysis:**
The google/gemini-2.5-flash model frequently:
1. Responds without using any tools (despite clear instructions)
2. Skips the list_directory tool and only uses read_file
3. Generates content from training data instead of reading files

**Impact:**
- Large portions of codebase not documented
- Wiki growth stalls
- Resources wasted on failed attempts

**Suggested Fix:**
1. Test with models better at tool-calling (Claude, GPT-4)
2. Add few-shot examples in the system prompt
3. Consider retrying with different prompt on tool enforcement failure
4. Reduce minimum tool call requirement for certain paths

---

### W-005: Extremely Low Commit Coverage

**Severity:** High

**Description:**
Only 1 out of 265 commits (0.4%) has been processed into a wiki page. The wiki lacks historical context.

**Evidence:**
```
Commits: 0/265 processed (0.0%)
Wiki pages: 53
Pending work: 24
```

**Root Cause Analysis:**
- Orchestrator prioritized codebase-explorer over code-change agents
- code-change agent had 83% failure rate (5/6 failed)
- System favored wiki-level agents over commit-level agents

**Impact:**
- No documentation of code evolution
- No understanding of why changes were made
- Wiki is "point-in-time" snapshot, not "living history"

**Suggested Fix:**
1. Balance orchestrator to include more commit analysis
2. Improve code-change agent reliability
3. Consider running commit analysis as separate pipeline

---

### W-006: Inconsistent Link Formats

**Severity:** Medium

**Description:**
Pages use different link formats, sometimes within the same page.

**Examples:**
```markdown
[Getting Started](guides/getting-started.md)    // with .md
[guides/getting-started](guides/getting-started) // without .md
```

**Root Cause Analysis:**
- Different agents use different link formats
- No normalization on page content
- LLM generating arbitrary formats

**Impact:**
- Some links may break depending on rendering
- Inconsistent user experience
- Harder to detect broken links

**Suggested Fix:**
1. Normalize all links on page save (strip .md)
2. Add link format guidelines to agent prompts
3. Post-process content to standardize links

---

### W-007: Commit Page Content Quality

**Severity:** Medium

**Description:**
The one commit page generated has minimal content - just title and file list, no analysis.

**Content:**
```markdown
# Merge pull request #232...

## Source
- **Commit:** e51de5c0
- **Files:** `tests/e2e/repositories.spec.ts`, `src/web/public/modules/repos.js`
```

**Expected:**
- What the commit changes
- Why the change was made
- Impact on the system
- Related components

**Root Cause Analysis:**
- code-change agent may have failed before completing analysis
- Partial content saved despite incomplete analysis
- Insufficient prompt guidance for rich commit documentation

**Impact:**
- Commit history not useful for understanding codebase
- Misses opportunity to capture institutional knowledge

---

### W-008: Confidence Scores Not Meaningful

**Severity:** Low

**Description:**
All 53 pages have confidence scores between 0.50 and 0.55, a range of only 0.05. This doesn't differentiate page quality.

**Statistics:**
- Min: 0.50
- Max: 0.55
- Average: 0.54
- Standard deviation: ~0.02

**Root Cause Analysis:**
- Confidence calculation may use fixed formula
- No adjustment based on source verification
- No differentiation between exploration depth levels

**Impact:**
- Confidence score provides no useful signal
- Can't prioritize pages for review
- Quality filtering impossible

---

### W-009: No Wiki Index or Table of Contents

**Severity:** Low

**Description:**
There is no root index page or auto-generated table of contents. Users must know page paths to navigate.

**Impact:**
- No entry point for users
- Discovery of content difficult
- Wiki feels incomplete

**Suggested Fix:**
1. Auto-generate index page listing all categories
2. Generate category index pages
3. Add TOC agent that maintains navigation structure

---

## Systemic Observations

### Agent Reliability Varies Significantly

| Agent | Success Rate | Notes |
|-------|-------------|-------|
| writer | 100% | Most reliable |
| link | 100% | Reliable |
| bootstrap | 100% | Runs once |
| overview | 100% | Reliable |
| getting-started | 100% | Reliable |
| testing-guide | 100% | Reliable |
| quality | 50% | API errors |
| extension-guide | 50% | API errors |
| code-change | 17% | Mostly tool errors |
| codebase-explorer | 29% | Tool enforcement issues |

### Tool Enforcement is Too Strict for Some Models

The google/gemini-2.5-flash model struggles with tool-calling requirements. The tool enforcement system rejects responses even when partial progress was made, leading to:
- 38 tool enforcement rejections
- Complete loss of any work done in that request
- No partial saves of useful content

### API Connectivity Critical

17 failures were due to OpenRouter API 503 errors. The system's retry logic (3 attempts) was insufficient for the level of instability encountered.

---

## Recommendations Summary

### Priority 1 (Critical)
1. Fix title extraction from H1 headers
2. Fix markdown link parsing into links array
3. Test with more reliable tool-calling model

### Priority 2 (High)
1. Add orphan page detection and linking
2. Improve code-change and codebase-explorer reliability
3. Balance orchestrator for commit coverage

### Priority 3 (Medium)
1. Normalize link formats
2. Enhance commit page content quality
3. Refine confidence scoring

### Priority 4 (Low)
1. Auto-generate wiki index pages
2. Add more granular tool enforcement (allow partial success)
3. Improve retry logic for API errors
