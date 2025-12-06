# Agent Tool Use Audit Report

**Date:** 2025-12-06
**Scope:** Tool definitions, agent implementations, prompts, and test coverage

---

## Executive Summary

This audit examined how agents use tools in the CodeWiki system. Key findings include:

- **3 major code duplications** between tool systems
- **Inconsistent tool usage patterns** across agents
- **Multiple incompatible type definitions** for tools
- **Test coverage gaps** for tool execution in agents

---

## 1. Tool Definition Duplications (Critical)

### 1.1 Codebase Tools vs Analysis Source Tools

**Files:**
- `src/services/llm/codebase-tools.ts`
- `src/services/llm/analysis-tools/source-tools.ts`

| Duplicate Function | codebase-tools | source-tools |
|-------------------|----------------|--------------|
| Path validation | `validatePath()` | `validateSourcePath()` |
| Read file | `readFileTool` | `readSourceFileTool` |
| Search files | `searchFilesTool` | `searchSourceFilesTool` |
| List directory | `listDirectoryTool` | `listSourceDirectoryTool` |

**Differences:**
- Analysis tools add GitHub API fallback
- Analysis tools format output with markdown headers
- Analysis tools have `maxResults = 50` limit; codebase tools have no limit
- Analysis tools have more detailed error messages (ENOENT, EACCES)

**Recommendation:** Extract shared core functionality into a base module with configurable options for output format and GitHub fallback.

### 1.2 Wiki Tools vs Wiki Page Tools

**Files:**
- `src/services/llm/wiki-tools.ts`
- `src/services/llm/analysis-tools/wiki-page-tools.ts`

| Duplicate Function | wiki-tools | wiki-page-tools |
|-------------------|------------|-----------------|
| Read page | `readPageTool` | `getPageContentTool` |
| List pages | `listPagesTool` | `listWikiPagesTool` |

Both implement nearly identical logic for reading and listing wiki pages.

### 1.3 Agent Helpers Third Copy

**File:** `src/agents/agent-helpers.ts`

The `createApiCodebaseTools()` function creates a **third** copy of `read_file`, `list_directory`, and `search_files` tools inline for GitHub repos.

Also duplicates glob matching with `filterByGlob()` when `minimatch` is already available.

---

## 2. Inconsistent Type Definitions

### 2.1 Three Different Tool Definition Types

| Type | File | Properties |
|------|------|------------|
| `ToolDefinition` | `tools.ts` | `name`, `description`, `inputSchema`, `execute` |
| `WikiToolDefinition` | `wiki-tools.ts` | Same + `enum` in schema |
| `AnalysisToolDefinition` | `analysis-tools/types.ts` | Same structure |

**Recommendation:** Unify into a single `ToolDefinition` interface.

### 2.2 Three Different Context Types

| Context Type | Properties |
|--------------|------------|
| `ToolContext` | `repoPath`, `maxFileSize` |
| `WikiToolContext` | `pages`, `maxContentLength` |
| `AnalysisToolContext` | `repos`, `repoId`, `wikiId`, `repoPath`, `repoService`, `repo`, `benchmarkRuns`, `qualityBenchmarkRuns`, `wikiPages` |

---

## 3. Inconsistent Agent Tool Usage

### 3.1 Tool Use vs No Tool Use

| Agent | Uses Tools | Method |
|-------|-----------|--------|
| `code-change` | Yes | `completeWithTools()` with `read_file`, `search_files`, `list_directory` |
| `security` | **No** | `complete()` only - cannot explore codebase |
| `pattern` | **No** | `complete()` only |
| `technical-debt` | **No** | `complete()` only |
| `narrative` | **No** | `complete()` only |
| `dependency` | **No** | `complete()` only |

**Issue:** Security agent cannot read full file contents or search for related files, limiting its analysis capability.

**Recommendation:** Add tool support to security, pattern, and technical-debt agents to improve analysis depth.

### 3.2 Inconsistent Response Formats

Each agent uses a different response format schema:

**CodeChangeAgent:**
```
PAGE_TITLE:
SUMMARY:
FINDINGS:
WIKI_UPDATES: (block format with === markers)
CONFIDENCE:
```

**SecurityAgent:**
```
SUMMARY:
SECURITY_RELEVANCE:
FINDINGS:
VULNERABILITIES:
RECOMMENDATIONS:
WIKI_UPDATES: (legacy bullet format)
CONFIDENCE:
```

**PatternAgent:**
```
SUMMARY:
PATTERNS_FOUND:
KEY_FILES:
CODE_SNIPPETS:
IMPLEMENTATION_EXPLANATION:
TRADE_OFFS:
CONVENTIONS:
ANTI_PATTERNS:
WIKI_UPDATES:
CONFIDENCE:
```

### 3.3 Wiki Update Format Inconsistency

**New block format** (CodeChangeAgent):
```
=== [path] [action] ===
[full content]
=== END ===
```

**Legacy bullet format** (other agents):
```
- [path] [action] [description only]
```

The legacy format only captures a description, not full content.

---

## 4. Response Parsing Duplication

### 4.1 Duplicated Parsing Logic

All agents implement similar regex-based parsing:
- Parse `SUMMARY:` section
- Parse `FINDINGS:` lines
- Parse `WIKI_UPDATES:` lines
- Parse `CONFIDENCE:` value

**Files with duplicated parsing:**
- `code-change-agent.ts:191-271`
- `security-agent.ts:130-210`
- `pattern-agent.ts:150-318`
- `orchestrator/prompts.ts:189-296`

**Recommendation:** Create a shared parsing utility with configurable sections.

---

## 5. Configuration Inconsistencies

### 5.1 File Size Limits

| Location | Limit |
|----------|-------|
| `codebase-tools.ts` | 100KB (`DEFAULT_MAX_FILE_SIZE`) |
| `source-tools.ts` | 100KB |
| `agent-helpers.ts` (local) | 50KB |
| `agent-helpers.ts` (API) | 100KB |

### 5.2 Diff Truncation Limits

| Agent | Diff Limit |
|-------|------------|
| `code-change` | 10,000 chars |
| `security` | 12,000 chars |
| `pattern` | 10,000 chars |

### 5.3 Token Limits

| Agent | Max Tokens | Temperature |
|-------|------------|-------------|
| `code-change` | 3,000 | 0.3 |
| `security` | 2,000 | 0.2 |
| `pattern` | 3,500 | 0.3 |

---

## 6. Test Coverage Gaps

### 6.1 Well-Tested Areas

- Agent registry and discovery (22+ agent types)
- Agent polymorphism (canHandle, type routing)
- Agent helper functions (getCommitDiff, createCodebaseToolExecutor)
- Response parsing for pattern-agent
- Orchestrator response parsing
- Wiki tools (search, read, list, related)
- Analysis tools (20+ tools)

### 6.2 Missing Test Coverage

| Gap | Impact |
|-----|--------|
| Codebase tools unit tests | Core functionality untested |
| Agent-tool integration | No tests for agents actually calling tools |
| Tool execution within agent loops | No end-to-end tool use testing |
| Tool error handling | Most tests only cover happy paths |
| LLM service with actual tools | Only mock tests exist |
| SecurityAgent, PatternAgent run() | No integration tests |

### 6.3 Test Files Analysis

**Existing tool tests:**
- `tests/unit/wiki-tools.test.ts` - 4 wiki tools tested
- `tests/unit/analysis-tools.test.ts` - 20+ analysis tools tested
- `tests/unit/openrouter-tool-parsing.test.ts` - tool call parsing

**Missing tests:**
- `codebase-tools.test.ts` - NO DEDICATED TEST FILE
- Agent tool integration tests
- Tool error recovery tests

---

## 7. Error Handling Inconsistencies

### 7.1 Error Return Patterns

**Codebase tools:**
```typescript
return `Error reading "${path}": ${error.message}`;
```

**Analysis source tools:**
```typescript
// More detailed
if (error.message.includes('ENOENT')) {
  return `Error: File "${path}" not found in repository`;
}
if (error.message.includes('EACCES')) {
  return `Error: Permission denied reading "${path}"`;
}
return `Error reading "${path}": ${error.message}`;
```

### 7.2 Missing Error Handling

- No timeout handling for tool execution
- No retry logic for transient failures
- No circuit breaker for repeated failures

---

## 8. Recommendations

### High Priority

1. **Consolidate tool definitions** - Create a base tool system that codebase-tools and analysis-tools extend

2. **Add tool support to more agents** - Security, pattern, and technical-debt agents would benefit from codebase exploration

3. **Unify type definitions** - Single `ToolDefinition` and `ToolContext` interfaces

4. **Add codebase-tools unit tests** - Critical gap in coverage

### Medium Priority

5. **Standardize response format** - Create a shared response schema for agents

6. **Extract response parsing** - Shared utility for SUMMARY/FINDINGS/WIKI_UPDATES parsing

7. **Standardize configuration** - Centralize file size limits, token limits, etc.

8. **Add tool integration tests** - Tests that verify agents use tools correctly

### Low Priority

9. **Standardize error messages** - Consistent format across all tools

10. **Add tool metrics** - Track tool usage patterns for optimization

---

## 9. File Reference

### Tool Definitions
- `src/services/llm/tools.ts` - Base tool interfaces
- `src/services/llm/codebase-tools.ts` - Filesystem tools
- `src/services/llm/wiki-tools.ts` - Wiki research tools
- `src/services/llm/analysis-tools/` - Analysis tools (6 subcategories)

### Agent Implementations
- `src/agents/base-agent.ts` - Agent interface
- `src/agents/agent-helpers.ts` - Unified tool executor
- `src/agents/analysis/` - 7 analysis agents
- `src/agents/meta/` - 5 meta agents
- `src/agents/synthesis/` - 9 synthesis agents

### Tests
- `tests/unit/agent-helpers.test.ts` - Tool executor tests
- `tests/unit/wiki-tools.test.ts` - Wiki tool tests
- `tests/unit/analysis-tools.test.ts` - Analysis tool tests
