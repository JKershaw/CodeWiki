# Wiki Review: First 100 Iterations (Llama 4 Maverick)

**Date:** 2025-12-10
**Model:** meta-llama/llama-4-maverick
**Iterations:** 100
**Result:** 38 pages created, 9 pages updated, $0.16 cost

## Summary

After 100 iterations, the wiki has significant structural and content quality issues. Most pages are orphaned (no links), and the LLM frequently produces malformed or incoherent output that fails to parse.

## Key Metrics

- **Pages created:** 38
- **Pages updated:** 9
- **Commits processed:** 10/324 (3.1%)
- **Average confidence:** 80.9%
- **Total cost:** $0.1608
- **Orphaned pages:** 32+ (84% of pages!)

## Critical Issues Observed

### 1. Massive Link/Navigation Problems

**32 out of 38 pages are orphaned** - they have no links to or from other pages. This makes the wiki nearly unusable for navigation. Examples:
- `architecture/codewiki-architecture` - no links to it!
- `guides/testing` - completely disconnected
- All commit pages (`commits/*`) - orphaned

Only the `overview` page has outbound links, but even those point to pages that don't link back properly.

### 2. LLM Output Format Failures

The Llama 4 model frequently fails to follow the expected structured output format. From the logs:

```
[codebase-explorer] Failed to parse SUMMARY
[codebase-explorer] Failed to parse FINDINGS
[codebase-explorer] Failed to parse WIKI_PAGES
[code-change] Failed to parse PAGE_TITLE
[writer] Parse failed: Required sections missing: CONTENT
```

Many agent runs produce garbled/incoherent output:
- `"SUMERMSpace, contentTypeErrorMessage: () => { // added..."` - complete nonsense
- `"**Street**, an [user interface](https://roadmap.master.consabetes orgán..."` - hallucinated garbage
- `"PAGE = new 0 +'' //Dumb2DTRMism..."` - incomprehensible

### 3. Broken/Invalid Links

The `guides/getting-started` page contains external URLs that don't exist:
```markdown
For more information on the project's architecture, see [Architecture Overview](https://wiki.com/project/architecture) and [Configuration](https://wiki.com/project/config).
```

These should be internal wiki links, not `https://wiki.com/...` URLs.

### 4. Factually Incorrect Content

**Testing Guide is completely wrong:**
- Claims "This project uses Vitest as its testing framework"
- Reality: The project uses Node's built-in test runner (`node --import tsx --test`)
- This is a critical hallucination that would mislead developers

**Getting Started has wrong Node version:**
- Claims `"engines": { "node": ">=16.0.0" }`
- Reality: `"engines": { "node": "24.x" }`

### 5. Empty/Stub Pages

Several commit pages have no meaningful content:
- `commits/bdfc49f0` - empty findings section
- `commits/be555de0` - just lists files, no analysis
- `commits/ae6153cd` - minimal content

### 6. Duplicate/Redundant Pages

Multiple pages cover the same topic:
- `cli/commands/ask-command` AND `cli/commands/asking-questions`
- `cli/commands/process-command` AND `cli/commands/repository-processing`

### 7. Terminology Inconsistencies

Detected by consistency agent:
- "command handler" vs "command handling" vs "command processor"
- "code duplication" vs "duplicate content" vs "redundant code"
- "LLM" vs "Large Language Model"

### 8. Category Mismatches

Content placed in wrong categories:
- `commits/b05a27b6` contains architecture content, should be in `architecture/`
- `domain/agent-run` contains architecture content
- `patterns/factory-pattern` has wrong categorization

## Technical Issues Observed

### API/Rate Limiting
- Multiple 503 errors with retry backoff (up to 4 retries)
- Rate limiting handled correctly, but slows processing

### Directory Exploration Failures
- LLM tries to explore non-existent directories: `src/orchestrator`, `src/agents/orchestrator`
- Tries to list files as directories: `ENOTDIR` errors
- Invalid path handling: `scripts` directory rejected

### Tool Call Failures
- Writer agent parse failures with garbled output
- Codebase explorer context too large (80k-100k characters) triggering tool-based approach
- Multiple agents don't report metrics properly

## Findings Status

All 37 findings are "open" - none have been addressed:
- 32 orphaned page findings
- 3 terminology inconsistencies
- 2 category mismatches

## Recommendations

1. **Link Agent needs major work** - it's creating pages but not linking them
2. **LLM output parsing** - needs more robust fallback when format isn't followed
3. **Content validation** - should verify claims against actual code
4. **Deduplication** - similarity detection should prevent redundant pages
5. **Model selection** - Llama 4 Maverick may not be well-suited for structured output tasks
