# Wiki Quality Analysis: Why Quantity Grows But Quality Stagnates

**Date:** 2025-12-09
**LLM Model Used:** meta-llama/llama-4-maverick
**Analysis Period:** 150 iterations (3 runs of 50 each)

## Executive Summary

After running 150 wiki generation iterations and analyzing the resulting wiki and benchmarks, I identified several critical issues that explain why the wiki grows in quantity (pages) while quality benchmark scores remain stagnant or even decline.

**Key Finding:** The wiki doubled from 30 to 62 pages, but the quality score actually **decreased** from 59.57 to 58.00. The root cause is a combination of LLM response parsing failures, ineffective link generation, and missing quality feedback loops.

## Benchmark Results Summary

### Quality Benchmark Scores Over Time

| Run | Wiki Pages | Quality Score | Contextual Richness | Coherence | Completeness |
|-----|-----------|--------------|---------------------|-----------|--------------|
| 1   | 30        | 59.57        | 42.0                | 79.5      | 47.5         |
| 2   | 53        | 58.11        | 45.5                | 74.5      | 48.75        |
| 3   | 62        | 58.00        | 41.5                | 74.5      | 47.0         |

**Observation:** Quality scores are essentially flat or declining despite the wiki more than doubling in size.

### Accuracy Benchmark Results

| Run | Accurate | Partial | Inaccurate | No Answer |
|-----|----------|---------|------------|-----------|
| 1   | 6 (40%)  | 8       | 1          | 0         |
| 2   | 3 (20%)  | 11      | 0          | 1         |
| 3   | 4 (27%)  | 9       | 2          | 0         |

**Observation:** Accuracy actually **decreased** from Run 1 to Run 2/3. More pages didn't result in better answers.

---

## Root Cause Analysis

### 1. Severe Link/Navigation Problem (Critical)

**Statistics:**
- **85.5%** of wiki pages have NO links (incoming or outgoing)
- Only **4.8%** of pages have outgoing links
- Only **12.9%** of pages have backlinks
- 53 out of 62 pages are completely isolated

**Impact:** The wiki is effectively a collection of disconnected documents rather than an interconnected knowledge base. Users cannot navigate between related topics. The "Related Pages" sections shown in the benchmark are mostly empty.

**Evidence from logs:**
```
Meta/synthesis agent link should not have target (ignoring)
Meta/synthesis agent link should not have target (ignoring)
```

The LinkAgent is being triggered but appears to be failing silently, with its work being ignored.

### 2. LLM Response Parsing Failures (Critical)

**Statistics:**
- **82%** of pages (51/62) have the default confidence score of 0.5
- Only 1 page achieved 0.7 confidence, 4 pages at 0.6

**Evidence from logs:**
```
[codebase-explorer] Failed to parse SUMMARY {...}
[codebase-explorer] Failed to parse FINDINGS {...}
[codebase-explorer] Failed to parse WIKI_PAGES {...}
[codebase-explorer] Using default confidence 0.7 {...}

[pattern] Parse stats: 0 ok, 9 failed {
  failed: ['SUMMARY', 'PATTERNS_FOUND', 'KEY_FILES', ...]
}
```

**Root Cause:** The LLM model (meta-llama/llama-4-maverick) frequently returns responses that don't match the expected format. The system falls back to defaults, losing valuable quality information.

The response previews show the model sometimes:
- Returns raw tool calls instead of formatted output
- Generates markdown with incorrect structure
- Produces truncated or malformed responses

### 3. Confidence Score Calibration Failure

With 82% of pages at exactly 0.5 confidence, the system has no meaningful way to:
- Prioritize high-quality content
- Identify pages needing improvement
- Track quality over time

This explains why the quality benchmark reports: "The confidence score of 50% seems arbitrary without clear justification."

### 4. Content Quality Issues (From Benchmark Findings)

Most common issues identified by the Quality Benchmark:

1. **Unjustified confidence scores** (2+ occurrences)
   - "The confidence score of 50% seems arbitrary without clear justification"

2. **Missing "why" explanations**
   - "The page lacks explanations of why certain design choices were made"

3. **No failure mode documentation**
   - "There's no documentation on failure modes, error handling, or edge cases"

4. **Missing links/navigation**
   - "There are no links to other related pages"

5. **Incomplete content**
   - Some pages like `guides/extension-patterns` are truncated mid-sentence
   - Pages contain tool call output instead of actual documentation

### 5. No Quality Feedback Loop

New pages are added without validation:
- Pages with parsing failures still get saved
- Low-quality content doesn't trigger improvement tasks
- The wiki-editor agent processes edit requests but can't fix fundamental issues
- The Orchestrator adds more content but doesn't prioritize fixing existing problems

---

## Why Adding More Content Doesn't Improve Quality

### The Paradox Explained

1. **New pages dilute quality average:** Each new page with default 0.5 confidence and no links brings down overall scores.

2. **Link fragmentation:** With no inter-page connections, adding pages creates more isolated islands rather than enriching existing knowledge.

3. **Shallow coverage expands, deep coverage doesn't:** The system keeps exploring new areas instead of deepening existing topics.

4. **Parse failures compound:** More iterations mean more LLM calls, but the same parsing problems persist.

5. **No self-correction:** The system can't recognize and fix its own quality problems.

---

## Specific Issues Observed in Wiki Content

### Isolated Pages (Examples)
These pages have zero incoming or outgoing links:
- `analysis/prompts`
- `benchmark/overview`
- `cli/commands/overview`
- `commands/command-pattern`
- `guides/testing`

### Incomplete Pages
- `guides/extension-patterns` - Ends mid-sentence with truncated code block
- Some commit pages contain only file lists with no analysis

### Duplicate/Overlapping Content
- `cli/commands` vs `cli/commands/overview` - Similar content, no clear hierarchy
- Multiple "overview" pages across different sections

---

## Recommendations (For Future Implementation)

### High Priority

1. **Fix LLM Response Parsing**
   - Improve prompt engineering for llama-4-maverick
   - Consider switching to a model with better instruction-following
   - Add retry logic with reformatted prompts on parse failure

2. **Fix LinkAgent**
   - Investigate why link suggestions are being ignored
   - Add logging to understand link generation success/failure
   - Consider a batch link generation pass after content creation

3. **Implement Quality Gates**
   - Don't save pages with parse failures
   - Require minimum confidence threshold for new pages
   - Flag incomplete pages for review

### Medium Priority

4. **Add Quality Improvement Loop**
   - Prioritize improving low-quality existing pages over creating new ones
   - Track quality scores per page over time
   - Target pages with lowest contextual_richness and completeness_coverage

5. **Improve Benchmark Accuracy**
   - The accuracy benchmark grading is sometimes producing garbage (JSON fragments in reasoning)
   - Need to validate grader output format

### Lower Priority

6. **Content Deduplication**
   - Detect and merge overlapping pages
   - Establish clear page hierarchy

---

## Conclusion

The fundamental issue is that **quantity without quality control leads to wiki decay**. The system successfully generates new pages but:

1. Fails to parse and use quality signals from the LLM
2. Doesn't create meaningful connections between pages
3. Has no mechanism to improve existing content

Until these issues are addressed, more iterations will continue to grow page count while quality scores stagnate or decline.

---

## Appendix: Raw Data

### Test Configuration
- Iterations: 50 per run (150 total)
- Concurrency: 4 workers
- Model: meta-llama/llama-4-maverick via OpenRouter
- Total Cost: ~$0.25 across all runs

### Parse Failure Patterns (From Logs)
```
[codebase-explorer] Failed to parse SUMMARY
[codebase-explorer] Failed to parse FINDINGS
[codebase-explorer] Failed to parse WIKI_PAGES
[pattern] Parse stats: 0 ok, 9 failed
[code-change] Failed to parse PAGE_TITLE
[narrative] Failed to parse NARRATIVE_TYPE
[technical-debt] Failed to parse DEBT_TREND
[security] Failed to parse SECURITY_RELEVANCE
```

### Quality Dimension Breakdown (Run 3)
| Dimension               | Score |
|------------------------|-------|
| contextual_richness    | 41.5  |
| coherence_consistency  | 74.5  |
| completeness_coverage  | 47.0  |
| actionability          | 55.0  |
| structural_quality     | 66.5  |
| confidence_calibration | 56.5  |
| machine_readability    | 59.5  |
| information_density    | 63.5  |

**Strengths:** coherence_consistency
**Weaknesses:** contextual_richness, completeness_coverage
