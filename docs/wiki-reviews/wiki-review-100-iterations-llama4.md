# Wiki Review - After 100 Iterations (Llama 4 Maverick)

## Overview

This document captures findings from running the CodeWiki system for 100 total iterations (50+50) against its own repository using the `meta-llama/llama-4-maverick` model via OpenRouter.

## Summary Statistics

| Metric | After 50 | After 100 | Change |
|--------|----------|-----------|--------|
| Total Pages | 12 | 43 | +31 |
| Commits Processed | 10/316 (3.2%) | 12/316 (3.8%) | +2 |
| Average Confidence | 0.50 | 0.50 | No change |
| Pages with Links | 0 (0%) | 0 (0%) | No change |
| Successful Iterations | 24/50 | 48/50 | Much better |
| Total Cost | $0.0505 | $0.0519 | Similar |

## Pages by Category

| Category | Count | Notes |
|----------|-------|-------|
| commits | 12 | Commit documentation |
| utilities | 11 | Mostly node_modules content |
| dependencies | 8 | All node_modules content |
| guides | 5 | Actual useful content |
| eslint | 2 | node_modules content |
| architecture | 2 | Useful overview content |
| overview | 1 | Project overview |
| octokit | 1 | node_modules content |
| libraries | 1 | node_modules content |

**Approximately 23 out of 43 pages (53%) are about node_modules dependencies, not source code.**

## Critical Issues Found

### 1. GARBLED/CORRUPTED CONTENT (CRITICAL)

The page `commits/3dd4eb0b` contains 8,411 characters of complete gibberish:
```
exampled branch:example:problem-pattern": {
      },
+...
     *environmentCriterion"param**
 linkedin magicensThreshold block=d conting ParameterTypes
  schema:statusMessage
}
```

This is not valid documentation - the LLM produced nonsense that was saved to the wiki.

### 2. FACTUALLY INCORRECT INFORMATION

The `guides/getting-started` page states:
> "Node.js version 16 or higher (as specified in `package.json` under `engines`)"

But package.json actually says:
```json
"engines": { "node": "24.x" }
```

The wiki is providing **wrong information** that could mislead developers.

### 3. BROKEN EXTERNAL LINKS

The getting-started guide contains:
```
For more information on configuration options, see the [Configuration Wiki Page](https://github.com/wiki/configuration).
```

This URL `https://github.com/wiki/configuration` does not exist.

### 4. WRONG PROJECT STRUCTURE

The getting-started guide shows this structure:
```
src/
  commands/
  config/
  services/
  utils/
```

But the actual structure includes:
```
src/
  agents/
  repositories/
  executor/
  domain/
  web/
  cli/
```

The documentation doesn't reflect the actual codebase.

### 5. ZERO INTER-PAGE LINKS (UNCHANGED)

**100% of 43 pages have zero links and zero backlinks.** The wiki is a collection of disconnected islands with no cross-referencing.

### 6. STATIC CONFIDENCE SCORES

All 43 pages have exactly `confidence: 0.5` - the default value. No actual confidence assessment is happening.

### 7. MASSIVE ORCHESTRATOR WASTE

The orchestrator repeatedly suggests invalid node_modules paths:
```
Invalid path for codebase-explorer: node_modules/jsdom/lib/jsdom/living
Invalid path for codebase-explorer: node_modules/playwright-core/lib/server
Invalid path for codebase-explorer: node_modules/mongodb/lib/cmap
Invalid path for codebase-explorer: node_modules/eslint/lib/rules
Invalid path for codebase-explorer: node_modules/zod/src/v4
```

These are caught and rejected, but the orchestrator shouldn't be suggesting them in the first place.

### 8. INVALID AGENT TYPE ERRORS

The LLM sometimes outputs prose as agent types:
```
Invalid agent type: This plan adheres to the budget rules for a 15+ page wiki
Invalid agent type: This distribution follows the budget guidelines for a 15+ page wiki
```

### 9. WRITER AGENT $0.0000 COST

The writer agent consistently reports `$0.0000` cost and `0ms` duration:
```
✓ writer completed (0ms, $0.0000)
✓ writer completed (1ms, $0.0000)
```

This suggests the writer isn't actually calling the LLM, just doing a pass-through.

### 10. MINIMAL COMMIT PAGES

Some commit pages have almost no content:
- `commits/f1588470`: 242 characters
- `commits/5d848bd3`: 213 characters
- `commits/f3d4611d`: 136 characters

Just a title and file list with no actual documentation.

## Content Quality Assessment

### Useful Pages (approximately 8)
- `overview` - Decent project overview
- `architecture/overview` - Good architecture description
- `guides/getting-started` - Would be useful if accurate
- `guides/testing` - Testing guide
- `guides/extension-patterns` - Extension patterns
- `guides/overview` - Development guides overview
- Some commit pages with actual content

### Problematic Pages (approximately 35)
- 23+ pages about node_modules dependencies
- 1 page with corrupted gibberish content
- Several pages with minimal/stub content
- Pages with factually incorrect information

## Comparison: Second 50 vs First 50 Iterations

| Aspect | First 50 | Second 50 |
|--------|----------|-----------|
| Success Rate | 48% (24/50) | 96% (48/50) |
| API Errors | Many 503s | Few |
| Pages Created | 12 | 22 |
| node_modules pages | 3 | 20+ more |
| Content quality | Mixed | Still mixed, plus garbled page |

The second batch had better success rate but produced mostly node_modules documentation.

## Root Cause Analysis

1. **No cwignore enforcement** - The system should exclude node_modules from the directory tree given to the orchestrator

2. **No content validation** - The garbled page was accepted without any quality check

3. **No fact verification** - Information like Node version isn't verified against source files

4. **Link agent not working** - Despite pages being created, no links are established

5. **Orchestrator prompt issues** - The LLM keeps suggesting node_modules paths despite instructions

## Recommendations

1. **Add content validation** - Reject pages with garbled/nonsense content
2. **Filter directory tree** - Remove node_modules from coverage tree before orchestration
3. **Verify facts against source** - Check claims like version numbers against actual files
4. **Fix link generation** - This is critical for wiki usefulness
5. **Add minimum content threshold** - Don't accept stub pages under 500 characters
