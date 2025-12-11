# Consolidated Wiki Issues Report

**Date:** 2025-12-11
**Test Methodology:** 200 iterations (2x100) against CodeWiki repository
**Model:** meta-llama/llama-4-maverick via OpenRouter
**Total Cost:** $0.4047

## Executive Summary

After extensive testing of the wiki generation system, I've identified **10 critical issues** that are holding the wiki back from being a useful, navigable knowledge base. The most severe problems are:

1. **Broken Finding Resolution Pipeline** - Issues detected but never fixed
2. **Massive Orphan Page Problem** - 78% of pages unreachable via links
3. **Commit Processing Completely Stalled** - Only 3.1% coverage after 200 iterations
4. **Content Quality Failures** - Garbled content saved to wiki pages

---

## Issue #1: Broken Finding Resolution Pipeline (CRITICAL)

### Symptoms
- 85 findings detected across 200 iterations
- **ALL 85 findings remain in "open" status**
- Findings include: orphaned_page (69), category_mismatch (11), terminology (3), low_quality (2)

### Impact
The system can detect problems but cannot fix them. This creates a paradox where:
- The consistency agent keeps creating findings
- The consolidation agent never processes them
- The problem list grows indefinitely

### Root Cause Hypothesis
The orchestrator may not be scheduling consolidation work, or the consolidation agent may be failing silently when processing findings.

### Evidence
```
Total findings: 85
By status: { "open": 85 }  // ALL open, none addressed
```

### Suggested Fix
1. Debug why consolidation agent doesn't run or complete
2. Add metrics for finding resolution rate
3. Force consolidation work when finding count exceeds threshold

---

## Issue #2: Orphan Page Problem (CRITICAL)

### Symptoms
- After 100 iterations: 51/55 pages orphaned (93%)
- After 200 iterations: 56/72 pages orphaned (78%)
- Only 16 pages have any links whatsoever

### Impact
The wiki is not navigable. Users landing on the overview can only reach 3 pages. The remaining 56 pages are islands that can only be found through search.

### Root Cause Hypothesis
1. Link agent processes too few pages per run
2. Link agent doesn't revisit pages to add links to newly created pages
3. Orchestrator doesn't prioritize linking when orphan rate is high

### Evidence
```
Pages with outgoing links: 16
Pages with incoming links: 16
Total pages: 72
Orphan rate: 78%
```

### Suggested Fix
1. Run link agent more frequently
2. Increase batch size from 20
3. Add "link new pages" work item whenever page is created
4. Orchestrator should prioritize linking when orphan_page findings exceed threshold

---

## Issue #3: Commit Processing Stalled (HIGH)

### Symptoms
- After 100 iterations: 10/318 commits (3.1%)
- After 200 iterations: 10/318 commits (3.1%) - **NO CHANGE**

### Impact
The "living wiki" premise relies on commit history analysis to understand why code evolved. Without commit processing, the wiki lacks historical context and decision rationale.

### Root Cause Hypothesis
The orchestrator strongly favors codebase-explorer and synthesis agents over code-change (commit) agents. Commit work is consistently deprioritized.

### Evidence
Orchestrator reasoning shows emphasis on exploration and synthesis:
```
"We'll start by running the wiki-editor agent to address pending edits,
then focus on improving existing content"
```
No mention of commit processing despite 97% unprocessed commits.

### Suggested Fix
1. Add minimum commit processing quota per orchestrator run
2. Lower priority of exploration when commit coverage < 50%
3. Schedule commit analysis work proactively

---

## Issue #4: Severe Content Quality Failures (CRITICAL)

### Symptoms
The `commits/a5ed5238` page contains completely garbled content:
```
`}-draft``-preload":`3\x0c`[`\xAc/i`]``
1-\xf34=\|`371-*-WeOneSTopic" - xen, notSrc-backend
```

### Impact
- Unprofessional wiki appearance
- Page is completely unusable
- Damages trust in all wiki content

### Root Cause Hypothesis
1. LLM produced malformed output
2. Response parsing failed completely
3. Content validation didn't catch the garbage
4. Page was saved despite being invalid

### Evidence
```
[narrative] Using default confidence 0.5  // Parsing failed
[security] Using default confidence 0.5   // Parsing failed
```
Default confidence used indicates complete parse failure, yet content was still saved.

### Suggested Fix
1. Add content validation that rejects non-sensical text
2. Check for minimum percentage of valid words
3. Require successful parsing of at least some sections before saving
4. Add "garbled content" detection heuristics

---

## Issue #5: Response Parsing Failures (HIGH)

### Symptoms
Multiple agents report complete parsing failures:
```
[pattern] Parse stats: 0 ok, 8 failed
[codebase-explorer] Failed to parse SUMMARY
[codebase-explorer] Failed to parse FINDINGS
[codebase-explorer] Failed to parse WIKI_PAGES
[narrative] Failed to parse SUMMARY
[narrative] Failed to parse NARRATIVE_TYPE
[security] Failed to parse SECURITY_RELEVANCE
```

### Impact
- Lost content and findings
- Default confidence scores applied
- Incomplete or empty wiki pages

### Root Cause Hypothesis
The llama-4-maverick model does not follow the expected structured output format. The prompts may be designed for different models (like Claude or GPT) that are better at following strict formats.

### Evidence
When parsing fails, the preview shows the LLM returned unstructured or differently-formatted content:
```
responsePreview: '## Summary\nThe `src/domain` directory contains...'
```
Expected format uses `SUMMARY:` label, but LLM used markdown header.

### Suggested Fix
1. Add fallback parsing for markdown-style sections
2. Test prompts with llama-4-maverick specifically
3. Consider prompt engineering for llama model family
4. Add model-specific prompt variations

---

## Issue #6: Link Agent Limited Effectiveness (MEDIUM)

### Symptoms
- Link agent runs regularly in iterations
- Only produces links for 16/72 pages
- Many link agent runs complete with 0 links added

### Impact
Wiki remains fragmented despite link agent running.

### Root Cause Hypothesis
1. Batch size of 20 pages means most pages never get analyzed together
2. Link agent may skip pages it has already processed
3. LLM may not be identifying relationships effectively

### Evidence
From iteration logs:
```
✓ link completed (35661ms, $0.0020)
...
✓ link completed (27484ms, $0.0017)
```
Link agent runs but orphan count stays high.

### Suggested Fix
1. Track which pages have been analyzed for links
2. Ensure new pages are prioritized for link analysis
3. Consider bidirectional link analysis (if A links to B, B should link to A)
4. Increase comprehensiveness of link suggestions

---

## Issue #7: Edit Request Backlog (MEDIUM)

### Symptoms
- 137 total edit requests
- 29 remain pending
- Requests accumulate faster than processed

### Impact
Content updates and improvements are delayed or never applied.

### Root Cause Hypothesis
Wiki-editor agent runs but doesn't process all pending requests. May be capacity limited or timing out.

### Evidence
```
📝 Found 28 pending edit requests, processing first...
✓ wiki-editor completed (20ms, $0.0000)
📝 Found 18 pending edit requests, processing first...
```
Each wiki-editor run reduces pending count but new requests are added faster.

### Suggested Fix
1. Increase wiki-editor throughput
2. Process all pending requests before generating new ones
3. Deduplicate similar edit requests

---

## Issue #8: LLM Artifacts in Content (MEDIUM)

### Symptoms
Some pages contain:
- `DECISION: MERGE`
- `Step 1:`, `Step 2:` etc.
- `Let me analyze...`

### Impact
Unprofessional appearance, internal reasoning exposed to users.

### Evidence
```
Pages with potential LLM artifacts: 2
  - wiki-reviews/observed-issues
  - commits/a5ed5238
```

### Suggested Fix
1. Add post-processing to strip common LLM reasoning patterns
2. Validate content doesn't contain known artifact patterns
3. Use `<wiki_content>` delimiters consistently

---

## Issue #9: Invalid Path Handling (LOW)

### Symptoms
```
[codebase-explorer] Failed to list directory src/agents/synthesis/bootstrap-agent.ts:
Error: ENOTDIR: not a directory
```

### Impact
Agent crashes or produces empty results when given file path instead of directory.

### Root Cause
LLM suggests exploring a file path as if it were a directory.

### Suggested Fix
1. Validate paths before attempting directory operations
2. Handle ENOTDIR gracefully by reading the file instead

---

## Issue #10: Model Compatibility Issues (SYSTEMIC)

### Symptoms
- High parse failure rate across all agents
- Unexpected output formats
- Garbled content generation

### Impact
The entire wiki quality depends on model compatibility. Using a model that doesn't follow expected formats degrades all output.

### Root Cause
llama-4-maverick may not be well-suited for the structured output formats expected by CodeWiki agents. The prompts may need adjustment for this model family.

### Evidence
Multiple agents fail to parse all sections, falling back to defaults. This is consistent across different agent types, suggesting model-level rather than prompt-level issues.

### Suggested Fix
1. Test prompts with multiple models
2. Create model-specific prompt variations
3. Add structured output validation
4. Consider model allowlist/recommendation

---

## Priority Matrix

| Issue | Severity | Effort to Fix | Priority |
|-------|----------|---------------|----------|
| #1 Broken Finding Resolution | Critical | Medium | P0 |
| #4 Content Quality Failures | Critical | Medium | P0 |
| #2 Orphan Page Problem | Critical | Low | P1 |
| #3 Commit Processing Stalled | High | Low | P1 |
| #5 Response Parsing Failures | High | Medium | P1 |
| #6 Link Agent Effectiveness | Medium | Medium | P2 |
| #7 Edit Request Backlog | Medium | Low | P2 |
| #8 LLM Artifacts | Medium | Low | P2 |
| #10 Model Compatibility | Systemic | High | P2 |
| #9 Invalid Path Handling | Low | Low | P3 |

---

## Recommended Immediate Actions

1. **Debug consolidation agent** - Why are 85 findings sitting open?
2. **Add content validation** - Reject garbled/nonsensical content
3. **Force commit processing** - Add minimum quota per orchestrator run
4. **Improve link agent coverage** - Prioritize linking when orphan rate high
5. **Test model compatibility** - Verify prompts work with llama-4-maverick

---

## Metrics to Track

1. **Finding Resolution Rate** - % of findings addressed per 100 iterations
2. **Orphan Rate** - % of pages with no links
3. **Commit Coverage** - % of commits processed
4. **Parse Success Rate** - % of agent runs with successful parsing
5. **Content Quality Score** - % of pages passing validation
