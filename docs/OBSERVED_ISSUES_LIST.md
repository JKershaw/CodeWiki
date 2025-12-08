# Observed Issues - CodeWiki Self-Generation Test

**Test Date:** 2025-12-08
**Test Parameters:** 50 iterations on CodeWiki repository
**Model:** openai/gpt-4o-mini

## Actionable Bug List

### BUG-001: Overview Agent Generates Broken Links
**Severity:** Critical
**Component:** `src/agents/synthesis/overview-agent.ts` (likely)
**Symptom:** Links in generated overview pages include `.md` extension
**Example:**
```markdown
[Orchestrator](agents/orchestrator.md)  # Should be: agents/orchestrator
```
**Impact:** All links in overview pages are broken
**Fix:** Strip `.md` extension from link paths before generating markdown

---

### BUG-002: No Deduplication Check for Similar Content
**Severity:** Critical
**Component:** Page creation pipeline / orchestrator
**Symptom:** Multiple pages created for same topic
**Example:** LLM Service has 3 separate pages:
- `services/llm`
- `services/llm-service`
- `components/llm-service`
**Impact:** Content fragmentation, user confusion, wasted resources
**Fix:** Before creating page, check for existing pages with similar path/title/content

---

### BUG-003: Commit Pages Use Raw Commit Message as Title
**Severity:** High
**Component:** `src/agents/analysis/code-change-agent.ts`
**Symptom:** Page titles like "Merge pull request #238 from JKershaw/claude/add-openrouter-env-config-011cd1QjbHK9gPkqNhQLhb2B"
**Impact:** Unreadable wiki navigation
**Fix:** Generate summarized descriptive title from commit content analysis

---

### BUG-004: Link Agent Severely Under-Scheduled
**Severity:** High
**Component:** `src/agents/orchestrator/`
**Symptom:** 77% of pages (55/71) have no Related Pages section
**Evidence:** Link agent ran only 2 times in 50 iterations
**Impact:** Poor wiki navigation, isolated content
**Fix:** Increase link agent scheduling priority in orchestrator strategies

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

## Priority Order for Fixes

1. **BUG-001** - Broken links are immediately visible to all wiki users
2. **BUG-002** - Duplicate content wastes resources and confuses users
3. **BUG-004** - Poor linking makes wiki hard to navigate
4. **BUG-003** - Bad titles are highly visible
5. **BUG-008** - High failure rate wastes time and money
6. **BUG-009** - Writer agent not working reduces content quality
7. **DESIGN-001** - Orchestrator rebalancing improves overall wiki quality
8. Remaining issues as time permits
