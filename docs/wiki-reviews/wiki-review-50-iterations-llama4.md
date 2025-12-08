# Wiki Review - After 50 Iterations (Llama 4 Maverick)

## Overview

This document captures findings from running the CodeWiki system for 50 iterations against its own repository using the `meta-llama/llama-4-maverick` model via OpenRouter.

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total Pages Created | 12 |
| Iterations Attempted | 50 |
| Successful Iterations | 24 |
| Failed Iterations | 26 |
| Total Cost | $0.0505 |
| Commits Processed | 10/316 (3.2%) |
| Average Confidence | 0.50 (50%) |
| Pages with Links | 0 (0%) |
| Pages with Backlinks | 0 (0%) |

## Agent Success Rates

| Agent Type | Notes |
|------------|-------|
| bootstrap | Completed successfully |
| codebase-explorer | Multiple 503 errors from OpenRouter |
| code-change | Many "0 tool call" failures |
| wiki-editor | Always reports $0.0000 cost (suspicious) |
| getting-started | "Tool requirements but didn't report metrics" warning |
| project-overview | "Tool requirements but didn't report metrics" warning |

## Critical Issues Found

### 1. No Inter-Page Links
- **100% of pages have empty `links` and `backlinks` arrays**
- Wiki pages are completely disconnected islands
- No cross-referencing between related concepts
- Navigation is impossible without links

### 2. node_modules Being Documented
Pages created about node_modules packages:
- `dependencies/acemir` - "@acemir module documentation"
- `utilities/humanwhocodes-utility` - "@humanwhocodes utility"
- `utilities/asamuzakjp-documentation-challenges` - About challenges documenting a package

This is completely irrelevant content. The codebase-explorer is exploring node_modules instead of src/.

### 3. Invalid Path Warnings
The orchestrator keeps suggesting invalid paths:
```
Invalid path for codebase-explorer: node_modules/jsdom/lib/jsdom/living (must start with src/ or lib/)
Invalid path for codebase-explorer: node_modules/eslint/lib/rules (must start with src/ or lib/)
Invalid path for codebase-explorer: node_modules/playwright-core/lib/server (must start with src/ or lib/)
```

The validation catches these AFTER the orchestrator suggests them, wasting iterations.

### 4. OpenRouter 503 Errors
Multiple agent failures due to upstream provider errors:
```
OpenRouter API error (503): upstream connect error or disconnect/reset before headers
```
This caused 26 out of 50 iterations to fail (52% failure rate).

### 5. code-change Agent Tool Enforcement Failures
Multiple errors:
```
ToolEnforcementError: Agent 'code-change' made 0 tool call(s), but 1 required
```
The Llama 4 model is not properly using the tools provided.

### 6. Default Confidence Scores
All 12 pages have exactly `"confidence": 0.5` - this appears to be a default value rather than actual confidence assessment.

### 7. Near-Duplicate Pages
Two nearly identical pages about CLAUDE.md updates:
- `commits/7e9f8a8c` - "CodeWiki Development Guide"
- `commits/538b4701` - "CodeWiki Project Setup and Development Guide"

Both cover the same topic with similar content but are separate pages.

### 8. Empty/Minimal Content Pages
Some pages have almost no useful content:
- `commits/f1588470` - Just a title and file list
- `commits/be646d70` - Just a title and file list

### 9. Pages About "Challenges"
The page `utilities/asamuzakjp-documentation-challenges` is about how the agent COULDN'T document something. This is meta-content that shouldn't exist in the wiki.

### 10. No Categories or Structure
- No category field visible in pages
- Pages are in flat paths like `commits/` or `utilities/`
- No table of contents or index page created

## Page Content Assessment

### Pages Created

1. **overview** - Decent project overview with structure, commands, key files
2. **dependencies/acemir** - Irrelevant node_modules content
3. **utilities/humanwhocodes-utility** - Irrelevant node_modules content
4. **utilities/asamuzakjp-documentation-challenges** - Meta-content about documentation failure
5. **commits/f1588470** - Minimal commit page
6. **commits/c8d189c5** - Discusses wiki system issues (self-referential)
7. **commits/1c91aed3** - Similar to above, near-duplicate
8. **commits/5539a2c1** - Orchestrator iteration awareness
9. **commits/be646d70** - Minimal commit page
10. **commits/7f0b2271** - Orchestrator context gathering
11. **commits/7e9f8a8c** - CodeWiki Development Guide
12. **commits/538b4701** - Near-duplicate of above

### Quality Assessment

- **Useful Pages**: ~3 (overview, and 2-3 commit pages)
- **Irrelevant Pages**: 3 (node_modules documentation)
- **Minimal/Empty Pages**: 2
- **Near-Duplicates**: 2
- **Meta-Content**: 1

Only ~25% of generated content is potentially useful.

## Log Observations

1. `[ModelCache] Error fetching models: fetch failed` - Model cache issues
2. `⚠️  Agent 'bootstrap' has tool requirements but didn't report metrics` - Metric tracking issues
3. Async queue refill mechanism working but requesting too many items (50) at once
4. LLM orchestrator making budget-based decisions but execution failing

## Comparison with Previous Reviews (qwen/qwen-turbo)

| Issue | qwen/qwen-turbo (200 iter) | llama-4-maverick (50 iter) |
|-------|---------------------------|---------------------------|
| Untitled pages | 82% | 0% (all have titles) |
| No links | 100% | 100% |
| No categories | 100% | 100% |
| Tool enforcement failures | Yes | Yes |
| node_modules content | Yes | Yes |
| Invalid path warnings | Yes | Yes |

The Llama 4 model generates better titles but still has the same fundamental linking and categorization problems.

## Recommendations

1. **Fix codebase-explorer path filtering** - Don't even suggest node_modules paths to the orchestrator
2. **Fix link generation** - This is the most critical missing feature
3. **Implement confidence scoring** - Currently always 0.5
4. **Add deduplication** - Detect and merge near-duplicate pages
5. **Improve error handling for API failures** - 503 errors waste iterations
6. **Don't create "challenge" pages** - If documentation fails, don't create a page about the failure
