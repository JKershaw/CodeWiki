# Wiki Review: After 100 Iterations

**Date:** 2025-12-11
**Model:** meta-llama/llama-4-maverick
**Iterations:** 100
**Wiki Pages Created:** 31
**Wiki Pages Updated:** 3
**Commits Processed:** 10/311 (3.2%)
**Average Confidence:** 80.6%
**Total Cost:** $0.1618

## Executive Summary

The wiki generated after 100 iterations provides a reasonable structural overview of the CodeWiki project, but suffers from significant issues with navigation, content quality, and LLM output parsing. The most critical issues are orphaned pages (most pages have no links), LLM reasoning leaking into page content, and poor commit page quality.

---

## Issue Categories

### 1. Orphaned Pages (Critical)

**Finding Count:** 19+ orphaned page findings detected by consistency agent

The majority of wiki pages have no links to or from other pages, making navigation extremely difficult. Pages exist as isolated islands of information.

**Affected Pages:**
- commands/wiki-commands
- cli/commands
- cli/utils
- analysis/self-improvement-analysis
- auto-benchmark/auto-benchmark-runner
- agents/code-change-agent
- agents/meta-agents
- agents/synthesis-agents
- agents/consolidation
- agents/orchestrator
- domain/user-model
- domain/wiki-page-model
- agents/agent-registry
- guides/getting-started
- guides/testing
- guides/extension-patterns
- executor/tool-enforcement-details
- domain/models
- All commit pages

**Root Cause:** The LinkAgent appears to run infrequently and only added links to 1 page (agents/overview). The system creates pages but doesn't systematically interlink them.

---

### 2. LLM Reasoning Leaking Into Content (High)

Several pages contain LLM tool invocation text that leaked into the actual wiki content:

**guides/testing:**
```
The test directory structure is now clear. I will read sample test files from the unit, integration, and e2e directories to understand the testing patterns and conventions used.{"name": "search_files", "parameters": {"pattern": "tests/**/*.test.ts"}}
Here is the testing guide:
```

**guides/extension-patterns:**
```
The `analysis` directory contains several agent implementations. Let's examine one of these files, such as `code-change-agent.ts`, to understand the implementation.

I'll read the contents of `src/agents/analysis/code-change-agent.ts`.{"name": "read_file", "parameters": {"path": "src/agents/analysis/code-change-agent.ts"}}
However, considering the context, I will proceed with writing the guide.
```

**Root Cause:** The synthesis agents (testing-guide, extension-guide) are not properly extracting content from the LLM response - they're including the LLM's "thinking out loud" text. The response parser may not be correctly stripping this internal reasoning.

---

### 3. Poor Commit Page Quality (High)

Commit pages are often empty, truncated, or malformed:

**commits/c17900b6** - Empty description:
```markdown
# Simplify high-complexity agent prompts for better LLM reliability

## Source
- **Commit:** c17900b6
- **Files:** [list of files]
```

**commits/9f3a6737** - Truncated/garbled content:
```markdown
content") and markdown heading format (e.g., "## SUMMARY")
* **Content validation**: Supports minimum length requirements...
```

**Root Cause:** The code-change agent frequently fails to parse the expected sections (PAGE_TITLE, SUMMARY, FINDINGS, WIKI_UPDATES). Logs show many parsing failures like:
- `[code-change] Failed to parse PAGE_TITLE`
- `[code-change] Failed to parse SUMMARY`
- `[code-change] Using default confidence 0.5`

---

### 4. Response Parsing Failures (High)

Extensive stderr logs show systematic parsing failures across multiple agents:

- `[codebase-explorer] Failed to parse SUMMARY`
- `[codebase-explorer] Failed to parse FINDINGS`
- `[codebase-explorer] Failed to parse WIKI_PAGES`
- `[overview] Failed to parse TITLE`
- `[overview] Failed to parse INTRODUCTION`
- `[security] Failed to parse SUMMARY`
- `[pattern] Parse stats: 1 ok, 7 failed`

The llama-4-maverick model frequently doesn't follow the expected structured output format, causing defaults to be used and content to be lost.

---

### 5. Inconsistent Terminology (Medium)

**Detected Issues:**
- Agent types: "agent / analysis agent / meta agent / synthesis agent / consolidation agent"
- Content types: "wiki / documentation / content"

The wiki uses multiple terms interchangeably, which could confuse readers.

---

### 6. Overlapping/Duplicate Content (Medium)

**Detected Issues:**
- commands/overview and commands/wiki-commands have overlapping content
- agents/consolidation and analysis/self-improvement-analysis both discuss improvement concepts

---

### 7. Navigation Structure (Medium)

- No clear index page or table of contents
- guides/overview is sparse - just lists 3 pages without descriptions
- architecture/overview includes Related Documentation with `.md` suffixes that may not work as links

---

### 8. Path Verification Failures (Medium)

Many codebase-explorer findings had unverified paths removed:
```
[codebase-explorer] Removing unverified path from finding: commands/ask.ts
[codebase-explorer] Removing unverified path from finding: response-parser.ts
```

The LLM is generating file paths that don't exist or don't match the verification tools' findings.

---

### 9. Invalid Work Item Generation (Low)

The orchestrator generated invalid work items that were rejected:
- `Invalid path for codebase-explorer: src (must start with src/ or lib/)`
- `Invalid path for codebase-explorer: scripts`
- `Invalid agent type: link-agent`
- `Invalid agent type: quality-agent`
- `Invalid commit ID for code-change: 23dda568` (truncated SHA)

---

## Content Quality Assessment

### Good Quality Pages (8+ confidence)
1. **architecture/overview** - Comprehensive project overview
2. **guides/getting-started** - Reasonable getting started guide
3. **agents/overview** - Good structural overview with some links
4. **executor/executor-overview** - Detailed technical documentation

### Medium Quality Pages (0.7-0.8 confidence)
- Most codebase-explorer generated pages
- agents/* pages
- commands/* pages

### Low Quality Pages (< 0.7 confidence)
- All commit pages (0.6 confidence)
- Some truncated pages

---

## System Observations

### Processing Behavior
- 503 rate limit errors handled correctly with retry logic
- Parallel processing (max concurrency: 4) working as expected
- LLM orchestrator made intelligent prioritization decisions

### Agent Performance
- **codebase-explorer:** Generated most content but high parse failure rate
- **code-change:** Struggles with commit analysis on this model
- **synthesis agents:** Working but leaking internal reasoning
- **meta agents (quality, consistency, structure):** Detecting issues but not all get resolved
- **link agent:** Ran but only updated 1 page with links

---

## Recommendations

1. **Fix response parsing for llama models** - The current regex patterns don't match llama's output style
2. **Strip LLM reasoning from synthesis output** - Add post-processing to remove tool calls and internal thoughts
3. **Run link agent more frequently** - Current wiki has severe connectivity issues
4. **Validate commit SHAs** - Ensure full SHA is used, not truncated
5. **Add fallback content for empty sections** - When parsing fails, generate minimal stub content
6. **Create explicit index/navigation pages** - Home page with clear structure
