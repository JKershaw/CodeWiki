# Comprehensive Issues List: CodeWiki with Llama 4 Maverick

**Date:** 2025-12-10
**Total Iterations:** 200
**Model:** meta-llama/llama-4-maverick
**Total Cost:** $0.33

This document consolidates all observed issues from running CodeWiki for 200 iterations against its own repository.

---

## Critical Issues (Must Fix)

### 1. Link Agent Produces Zero Links

**Severity:** CRITICAL
**Impact:** Wiki is completely unusable for navigation

After 200 iterations and 55 pages, there is not a single link between any pages. Every page has:
```json
"links": [],
"backlinks": []
```

**Root Cause Analysis:**
- Link agent runs successfully (no errors in logs)
- Agent completes but doesn't identify/create any connections
- Likely prompt engineering issue - LLM not understanding the linking task
- OR parse failure - links are identified but not extracted from output

**Code Location:** `src/agents/link-agent.ts`

---

### 2. LLM Meta-Content Leaking Into Wiki Pages

**Severity:** CRITICAL
**Impact:** Wiki content is polluted with processing artifacts

LLM "thinking" steps and decision markers appear in final content:

```markdown
## Step 1: Understand the Context
## Step 2: Analyze the Content
## Step 3: Decision
DECISION: MERGE
REASONING: The content is relevant...
```

**Affected Pages:**
- patterns/factory-pattern
- conventions/coding-standards
- Others likely affected

**Root Cause Analysis:**
- Writer agent or wiki-editor agent not stripping processing markers
- Structured output parsing failing to extract only CONTENT section
- LLM including reasoning in its "final" output

**Code Locations:**
- `src/agents/writer-agent.ts`
- `src/agents/wiki-editor-agent.ts`
- `src/services/llm-service.ts` (output parsing)

---

### 3. Factually Incorrect Content (Hallucinations)

**Severity:** CRITICAL
**Impact:** Developers will be misled by incorrect documentation

**Testing Guide claims:**
| Claim | Reality |
|-------|---------|
| "Uses Vitest" | Uses Node's built-in test runner |
| `npm run test:watch` exists | Command doesn't exist in package.json |
| Tests alongside source with `.test.ts` | Tests in separate `tests/` directory |

**Getting Started claims:**
| Claim | Reality |
|-------|---------|
| Node >= 16.0.0 | Node 24.x required |

**Root Cause Analysis:**
- LLM generating content without reading actual files
- Codebase explorer not providing accurate package.json data
- No validation step to verify claims against code

---

### 4. Commit Processing Stalled at 3.1%

**Severity:** HIGH
**Impact:** 97% of project history ignored

After 200 iterations, only 10 of 324 commits processed. System is:
- Re-analyzing same commits
- Generating findings but not advancing
- Work queue not properly prioritizing unprocessed commits

**Root Cause Analysis:**
- Work queue logic may be prioritizing existing page updates over new commits
- Orchestrator selection favoring consistency/quality over exploration
- Possible cycle detection issue

**Code Location:** `src/domain/work-queue.ts`, `src/orchestrator/`

---

## Severe Issues (High Priority)

### 5. Output Format Parsing Failures

**Severity:** HIGH
**Impact:** Many agent runs produce unusable output

Frequent parse failures observed:
```
[codebase-explorer] Failed to parse SUMMARY
[codebase-explorer] Failed to parse FINDINGS
[codebase-explorer] Failed to parse WIKI_PAGES
[code-change] Failed to parse PAGE_TITLE
[writer] Parse failed: Required sections missing: CONTENT
```

**Root Cause Analysis:**
- Llama 4 Maverick struggles with structured output format
- Prompts may be too complex or format instructions unclear
- No fallback content generation when parsing fails

---

### 6. Garbled/Incoherent LLM Output

**Severity:** HIGH
**Impact:** Wasted iterations and costs

Examples of nonsense output:
- `"SUMERMSpace, contentTypeErrorMessage: () => { // added..."`
- `"**Street**, an [user interface](https://roadmap.master.consabetes orgán..."`
- `"PAGE = new 0 +'' //Dumb2DTRMism..."`

**Root Cause Analysis:**
- Llama 4 Maverick appears unstable for this task type
- Possible tokenization/encoding issues
- Model may not be well-suited for structured technical writing

---

### 7. External URL Hallucination

**Severity:** HIGH
**Impact:** Broken links, user confusion

Getting Started page contains fabricated URLs:
```markdown
[Architecture Overview](https://wiki.com/project/architecture)
[Configuration](https://wiki.com/project/config)
```

These should be internal wiki links, not external URLs.

**Root Cause Analysis:**
- LLM defaulting to generic URL patterns
- Prompt not clearly specifying internal wiki link format
- No URL validation to catch external domains

---

### 8. Highly Similar Pattern Pages (Near-Duplicates)

**Severity:** MEDIUM-HIGH
**Impact:** Content bloat, wasted pages

Similarity detection found:
| Pages | Similarity |
|-------|------------|
| CQRS Pattern & Strategy Pattern | 91% |
| Factory Pattern & Strategy Pattern | 89% |
| Repository Pattern & Strategy Pattern | 89% |
| Factory Pattern & Repository Pattern | 86% |
| CQRS Pattern & Factory Pattern | 84% |

All pattern pages contain near-identical boilerplate with only pattern names changed.

**Root Cause Analysis:**
- Pattern agent using template-based generation
- Not actually analyzing how patterns are used in code
- Generic descriptions rather than codebase-specific examples

---

## Medium Issues

### 9. Orphaned Pages (100% of Wiki)

**Severity:** MEDIUM
**Impact:** Navigation impossible without links

All 55 pages are orphaned - no inbound or outbound links.

(This is a symptom of Issue #1 - Link Agent failure)

---

### 10. Category Mismatches

**Severity:** MEDIUM
**Impact:** Pages in wrong categories confuse structure

10 findings of content in wrong categories:
- `commits/b05a27b6` contains architecture content
- `commits/7c3b28b7` contains architecture content (Link Agent Deep Dive)
- `domain/agent-run` contains architecture content
- `patterns/*` pages contain architecture content
- `cli/commands/help-command` contains architecture content

**Root Cause Analysis:**
- Category selection logic not considering content type
- Commit pages used for architecture documentation
- No enforcement of category semantics

---

### 11. Terminology Inconsistencies

**Severity:** MEDIUM
**Impact:** Inconsistent language across wiki

3 terminology issues detected:
1. "command handler" vs "command handling" vs "command processor"
2. "code duplication" vs "duplicate content" vs "redundant code"
3. "LLM" vs "Large Language Model"

**Root Cause Analysis:**
- No glossary or terminology guide
- Consistency agent detects but doesn't fix
- Different agents using different terms

---

### 12. Duplicate/Redundant Pages

**Severity:** MEDIUM
**Impact:** Same content in multiple places

- `cli/commands/ask-command` AND `cli/commands/asking-questions`
- `cli/commands/process-command` AND `cli/commands/repository-processing`
- `commands/repository-management` overlaps with CLI pages

**Root Cause Analysis:**
- Similarity detection threshold may be too high (0.6)
- Different agents creating pages for same concepts
- Title-based duplicate check insufficient

---

### 13. Empty/Stub Commit Pages

**Severity:** MEDIUM
**Impact:** Pages exist but provide no value

Several commit pages have minimal content:
- `commits/bdfc49f0` - empty findings section
- `commits/be555de0` - just lists files, no analysis
- `commits/ae6153cd` - minimal content

**Root Cause Analysis:**
- Code-change agent not generating substantial analysis
- Small commits may not have enough to analyze
- No minimum content threshold enforcement

---

## Low Issues

### 14. Non-existent Directory Exploration

**Severity:** LOW
**Impact:** Wasted exploration attempts

LLM tries to explore directories that don't exist:
- `src/orchestrator` (doesn't exist as a directory)
- `src/agents/orchestrator`
- `scripts` directory

**Root Cause Analysis:**
- LLM guessing directory structure
- Codebase context not complete
- No directory existence validation before exploration

---

### 15. Formatting Inconsistencies

**Severity:** LOW
**Impact:** Visual inconsistency

Different pages use different formatting styles:
- Some use tables, others don't
- Header hierarchy varies
- Code block usage inconsistent

---

### 16. Duplicate Headers in Content

**Severity:** LOW
**Impact:** Poor readability

Some pages have duplicate section headers:
```markdown
### 2025-12-09 (ee95dc4)

### 2025-12-09 (ee95dc4)
```

**Root Cause Analysis:**
- History section appending without deduplication
- Merge operations not checking for existing headers

---

## Technical/Operational Issues

### 17. Rate Limiting (Expected Behavior)

**Impact:** Slows processing but handles correctly

503 errors occur periodically with proper retry backoff. This is normal API behavior, not a bug.

---

### 18. Large Context Handling

**Impact:** Triggers alternative approaches

When codebase context exceeds ~80k characters, system switches to tool-based exploration. This works but is less efficient.

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Critical Issues | 4 |
| Severe Issues | 4 |
| Medium Issues | 5 |
| Low Issues | 3 |
| Technical Notes | 2 |
| **Total Issues** | **18** |

## Priority Recommendations

### Immediate (Blocking)
1. Fix link agent to produce actual links
2. Add output sanitization to strip meta-content
3. Validate facts against actual code files

### Short-term
4. Investigate commit processing stagnation
5. Improve output format compliance
6. Consider different model for structured tasks

### Medium-term
7. Add content deduplication
8. Enforce category semantics
9. Create terminology guide

### Long-term
10. Implement automated content validation
11. Add link validation
12. Create quality scoring system
