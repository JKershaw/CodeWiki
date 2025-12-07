# Wiki Review - After 200 Iterations

## Overview

This document captures findings from running the CodeWiki system for an additional 100 iterations (200 total) against its own repository using the `qwen/qwen-turbo` model.

## Summary Statistics Comparison

| Metric | 100 Iterations | 200 Iterations | Change |
|--------|----------------|----------------|--------|
| Total Pages | 74 | 131 | +57 (+77%) |
| Pages with Titles | 20 (27%) | 24 (18%) | **WORSE** |
| Untitled Pages | 54 (73%) | 107 (82%) | **WORSE** |
| Categorized Pages | 0 (0%) | 0 (0%) | No change |
| Pages with Links | 0 (0%) | 0 (0%) | No change |
| Avg Content Length | 1,859 | 1,800 | Slightly lower |
| Avg Confidence | 0.51 | 0.52 | Slight improvement |

## Agent Success Rates (Cumulative)

| Agent Type | Success Rate | Notes |
|------------|-------------|-------|
| code-change | 38% (20/53) | Still critically failing |
| codebase-explorer | 99% (72/73) | One failure |
| link | 94% (17/18) | One failure |
| wiki-editor | 100% (15/15) | Good |
| writer | 100% (29/29) | Good, but pages still untitled |
| Others | ~100% | |

**Total Failure Rate: 17.5%** (35 out of 200 runs)

## Key Observations

### 1. Quality Degradation Over Time
- Percentage of titled pages actually **decreased** from 27% to 18%
- This suggests the system is generating more low-quality pages over time
- The "untitled" problem is getting worse, not better

### 2. No Improvement in Core Issues
- Still 100% uncategorized
- Still 0% with inter-page links
- The link agent completes but produces nothing useful

### 3. Continued code-change Agent Failures
- 33 additional failures (62% failure rate in second batch)
- Same error: "Agent made 0 tool call(s), but 1 required"
- The qwen model consistently fails to use tools

### 4. Massive Invalid Path Warnings
The orchestrator continues suggesting invalid paths:
- `node_modules/playwright-core/lib/server`
- `node_modules/mongodb/src/operations`
- `node_modules/eslint/lib/rules`
- `node_modules/jsdom/lib/jsdom/living`
- Many paths starting with `src/` that don't exist

### 5. Analysis Agents Never Run
These agents never get proper configuration:
- narrative (missing targetCommitId)
- security (missing targetCommitId)
- technical-debt (missing targetCommitId)
- pattern (missing targetCommitId)
- dependency (missing targetCommitId)

This means the wiki never gets security analysis, pattern recognition, or technical debt tracking.

## Content Quality Deep Dive

### Sample "Untitled" Page Content
Many untitled pages contain content about:
- node_modules packages (irrelevant)
- Generic descriptions without context
- Duplicated information across pages

### Pages Created vs Useful Pages
- 131 total pages created
- Only 24 have proper titles
- Only a handful would be useful to a developer

## Conclusion

After 200 iterations:
1. **System is generating quantity, not quality**
2. **Core metadata problems (title, category, links) are not being resolved**
3. **Model compatibility is a major issue** - qwen/qwen-turbo doesn't handle tools well
4. **Orchestrator path validation needs work** - suggests many invalid paths
5. **Analysis agents are essentially non-functional** due to configuration issues
