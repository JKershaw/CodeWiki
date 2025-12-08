# Observed Issues - CodeWiki Self-Generation Test

**Test Date:** 2025-12-08
**Test Parameters:** 50 iterations on CodeWiki repository
**Model:** openai/gpt-4o-mini

---

## ✅ Fixed Issues

### BUG-001: Overview Agent Generates Broken Links ✅ FIXED
**Severity:** Critical
**Component:** `src/agents/synthesis/overview-agent.ts`
**Symptom:** Links in generated overview pages include `.md` extension
**Fix Applied:** Removed `.md` extension from link generation at line 353
**Test Added:** `tests/integration/synthesis-agents.test.ts` - "generates links without .md extension"
**Commit:** `cc8ee87`

---

### BUG-003: Commit Pages Use Raw Commit Message as Title ✅ FIXED
**Severity:** High
**Component:** `src/agents/analysis/code-change-agent.ts`
**Symptom:** Page titles like "Merge pull request #238 from JKershaw/claude/add-openrouter-env-config-011cd1QjbHK9gPkqNhQLhb2B"
**Fix Applied:** Updated `extractTitleFromMessage()` function (lines 376-413) to:
- Handle "Merge pull request #X from user/branch" format
- Handle "Merge branch 'x' into 'y'" format
- Remove common prefixes (claude/, feature/, fix/)
- Remove session IDs from branch names
- Convert to Title Case
**Test Added:** `tests/unit/commit-title-extraction.test.ts` with 14 test cases
**Commit:** `cc8ee87`

---

### BUG-004: Link Agent Severely Under-Scheduled ✅ FIXED
**Severity:** High
**Component:** `src/agents/orchestrator/strategies.ts` and `src/agents/orchestrator/prompts.ts`
**Symptom:** 77% of pages (55/71) have no Related Pages section
**Fix Applied:**
1. **Deterministic Strategy** (strategies.ts lines 365-402):
   - Uses ratio-based scheduling (>30% unlinked OR >5 pages)
   - Added cooldown check with override for high unlinked ratio (>50%)
2. **LLM Orchestrator Prompt** (prompts.ts):
   - Marked link agent as "CRITICAL for navigation"
   - Added example showing link agent usage
   - Added CRITICAL warning when >30% pages unlinked
**Test Added:** `tests/unit/link-agent-scheduling.test.ts` with 4 test cases
**Commit:** `cc8ee87`

---

## Remaining Issues

### BUG-002: No Deduplication Check for Similar Content
**Severity:** Critical
**Status:** NOT FIXED
**Component:** Page creation pipeline / orchestrator
**Symptom:** Multiple pages created for same topic
**Example:** LLM Service has 3 separate pages:
- `services/llm`
- `services/llm-service`
- `components/llm-service`
**Impact:** Content fragmentation, user confusion, wasted resources
**Fix:** Before creating page, check for existing pages with similar path/title/content

---

### BUG-005: Duplicate Page Titles Allowed
**Severity:** Medium
**Component:** Page creation validation
**Symptom:** Two pages titled "Auth" exist at different paths
**Impact:** Ambiguous navigation
**Fix:** Enforce unique titles or auto-qualify with path prefix

---

### BUG-006: Inconsistent Title Capitalization
**Severity:** Low
**Component:** Title generation across agents
**Symptom:** Mix of "test driven development (tdd) guidelines" vs "LLM Service Overview"
**Impact:** Unprofessional appearance
**Fix:** Normalize titles to Title Case before saving

---

### BUG-007: Link Text Doesn't Match Page Title
**Severity:** Low
**Component:** Link agent
**Symptom:** `[Orchestrator for Code Documentation](agents/orchestrator)` links to page titled "Orchestrator"
**Impact:** User expects different content than actual page
**Fix:** Use actual page title as link text, or fetch title when generating links

---

### BUG-008: Insufficient API Retry Logic
**Severity:** Medium
**Component:** `src/services/llm/openrouter-llm-service.ts`
**Symptom:** 24% failure rate (12/50 iterations) due to 503 errors
**Evidence:**
```
[LLM] Request failed after 3 attempt(s): OpenRouter API error (503): upstream connect error...
```
**Impact:** Wasted iterations, incomplete wiki generation
**Fix:** Implement longer exponential backoff (4+ retries), consider alternative provider fallback

---

### BUG-009: Writer Agent Not Executing
**Severity:** Medium
**Component:** `src/agents/synthesis/writer-agent.ts`
**Symptom:** Writer agent shows cost $0.0000 - appears to skip execution
**Evidence:**
```json
{"agentType": "writer", "total": 1, "completed": 1, "totalCost": 0}
```
**Impact:** Raw analysis pages not refined into polished articles
**Fix:** Investigate why writer agent returns immediately without LLM calls

---

### BUG-010: Codebase Explorer Path Verification Warnings
**Severity:** Low
**Component:** `src/agents/analysis/codebase-explorer-agent.ts`
**Symptom:** "Removing unverified path from finding" messages appear frequently
**Example:**
```
[codebase-explorer] Removing unverified path from finding: Related paths: `src/services/llm/index.ts`
```
**Impact:** Content references stripped, potentially valuable context lost
**Fix:** Review path verification logic - may be too strict

---

## Systemic Issues

### DESIGN-001: Orchestrator Over-Reliance on Exploration
**Observation:** 64% of iterations were codebase-explorer
**Impact:** Wiki has good breadth but poor depth, linking, and synthesis
**Recommendation:** Rebalance agent selection to include more synthesis and meta agents

### DESIGN-002: No Content Similarity Detection
**Observation:** System creates new pages without checking for conceptual overlap
**Impact:** Fragmented knowledge base
**Recommendation:** Implement semantic similarity check before page creation

### DESIGN-003: Missing Page Quality Threshold
**Observation:** Pages with only 10 lines of content are accepted
**Impact:** Shallow, low-value pages clutter the wiki
**Recommendation:** Set minimum content length or trigger deepening passes

---

## Test Environment Issues

### ENV-001: OpenRouter TLS/Certificate Errors
**Symptom:**
```
TLS_error:|268435581:SSL routines:OPENSSL_internal:CERTIFICATE_VERIFY_FAILED
```
**Frequency:** 12 occurrences causing full iteration failures
**Note:** May be transient network issue rather than CodeWiki bug

### ENV-002: Model Cache Fetch Error
**Symptom:**
```
[ModelCache] Error fetching models: fetch failed
```
**Impact:** Model pricing may use fallback values
**Note:** Non-blocking, system continues with cached/default values

---

## Priority Order for Remaining Fixes

| Priority | Issue | Status | Notes |
|----------|-------|--------|-------|
| ~~1~~ | ~~BUG-001~~ | ✅ FIXED | Broken links fixed |
| 1 | BUG-002 | NOT FIXED | Duplicate content prevention |
| ~~2~~ | ~~BUG-004~~ | ✅ FIXED | Link agent scheduling improved |
| ~~3~~ | ~~BUG-003~~ | ✅ FIXED | Commit titles improved |
| 2 | BUG-008 | NOT FIXED | API retry logic |
| 3 | BUG-009 | NOT FIXED | Writer agent investigation |
| 4 | DESIGN-001 | PARTIALLY FIXED | LLM prompt updated for balance |
| 5 | BUG-005 | NOT FIXED | Duplicate titles |
| 6 | BUG-006 | NOT FIXED | Title capitalization |
| 7 | BUG-007 | NOT FIXED | Link text mismatch |

## Summary

- **Fixed:** 3 issues (BUG-001, BUG-003, BUG-004)
- **Remaining:** 7 issues + 3 systemic issues
- **Tests Added:** 19 new test cases across 3 test files
