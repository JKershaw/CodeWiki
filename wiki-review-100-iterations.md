# Wiki Review - After 100 Iterations

## Overview

This document captures findings from running the CodeWiki system for 100 iterations against its own repository using the `qwen/qwen-turbo` model.

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total Pages Created | 74 |
| Pages with Titles | 20 (27.0%) |
| Untitled Pages | 54 (73.0%) |
| Categorized Pages | 0 (0.0%) |
| Pages with Links | 0 (0.0%) |
| Average Content Length | 1,859 characters |
| Average Confidence | 0.51 |

## Agent Success Rates

| Agent Type | Success Rate | Notes |
|------------|-------------|-------|
| bootstrap | 100% (1/1) | |
| codebase-explorer | 100% (35/35) | |
| code-change | 36% (10/28) | **Critical failure rate** |
| wiki-editor | 100% (7/7) | |
| link | 100% (6/6) | But produced 0 actual links |
| writer | 100% (12/12) | |
| overview | 100% (4/4) | |
| Others | 100% | |

## Critical Issues Found

### 1. Massive Title Problem
- **73% of pages are "Untitled"**
- The qwen model is not properly generating page titles
- Many pages have content but no structured metadata

### 2. Zero Page Categorization
- **100% of pages are uncategorized**
- No hierarchical organization
- Navigation would be impossible without categories

### 3. No Inter-Page Links
- **0% of pages have links to other pages**
- The link agent runs successfully but produces no output
- Wiki is completely disconnected - islands of content

### 4. Missing Slugs
- Page slugs are `None` instead of URL-friendly identifiers
- Would break any URL-based navigation system

### 5. code-change Agent Failures
- 18 failures out of 28 attempts (64% failure rate)
- Error: "Agent 'code-change' made 0 tool call(s), but 1 required"
- The qwen model is not properly invoking tools when required
- This appears to be a model compatibility issue

### 6. Irrelevant Content Generation
- System is exploring `node_modules/` directories
- Creates pages about third-party packages (e.g., `@acemir`, `acorn-jsx`)
- Should be excluded from wiki generation

### 7. Path Resolution Issues in Orchestrator
Numerous errors like:
- "Path not found in coverage tree for codebase-explorer: src/agents"
- "Invalid path for codebase-explorer: tests/unit (must start with src/ or lib/)"
- "Invalid path for codebase-explorer: node_modules/..."

The orchestrator is suggesting paths that don't exist or shouldn't be explored.

### 8. Analysis Agent Configuration Issues
Multiple errors:
- "Analysis agent narrative missing targetCommitId"
- "Analysis agent security missing targetCommitId"
- "Meta/synthesis agent overview should not have target (ignoring)"

Agents are being configured incorrectly by the orchestrator.

### 9. Low Confidence Scores
- Average confidence is only 0.51 (51%)
- Indicates uncertain quality of generated content

## Content Quality Assessment

### Good Aspects
- Pages that have content are reasonably well-structured
- Content length is adequate (avg ~1,800 chars)
- Main overview page has decent structure explaining project

### Poor Aspects
- Many pages about irrelevant node_modules packages
- No code examples in most pages
- No cross-references between related concepts
- Commit message titles used as page titles inappropriately

## Log Warnings Observed

1. `[ModelCache] Error fetching models: fetch failed` - Model discovery failing
2. Many "Path not found in coverage tree" warnings
3. Rate limiting encountered (though less with qwen model)
4. "Agent has tool requirements but didn't report metrics" for several agents

## Recommendations After First 100 Iterations

1. **Fix title generation** - Ensure all pages have proper titles
2. **Add .cwignore for node_modules** - Should already be excluded
3. **Fix link agent** - Currently produces no output despite "succeeding"
4. **Fix category assignment** - No pages are categorized
5. **Fix slug generation** - All slugs are None
6. **Improve orchestrator path validation** - Don't suggest invalid paths
7. **Fix analysis agent configuration** - Missing targetCommitId issues
8. **Consider model compatibility** - qwen/qwen-turbo may not handle tools well
