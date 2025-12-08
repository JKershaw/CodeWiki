# Agent System Analysis Report

**Date:** 2025-12-08
**Purpose:** Identify complexity reduction opportunities in the CodeWiki agent system

---

## Executive Summary

CodeWiki has **28 agents** organized across 6 categories. While the core architecture is sound (discriminated unions, strategy pattern, CQRS), the system has accumulated significant complexity through:

1. **Response parsing fragmentation** - Each agent reimplements regex-based parsing
2. **Repository access explosion** - 5 different ways to access repository data
3. **System prompt duplication** - ~70% similar content across prompts
4. **Backwards compatibility debt** - Deprecated methods and dual patterns coexist

**Top recommendation:** Consolidate LLM response parsing into a shared utility. This single change would eliminate ~500+ lines of duplicated code across agents.

---

## Agent Inventory

### By Category

| Category | Count | Purpose |
|----------|-------|---------|
| **Analysis** | 7 | Examine commits (code changes, security, patterns, etc.) |
| **Meta** | 7 | Improve wiki itself (links, quality, consistency) |
| **Synthesis** | 9 | Create higher-order content (guides, overviews) |
| **Consolidation** | 1 + 7 handlers | Self-healing maintenance |
| **Specialized** | 4 | External interfaces (research, specs, grading) |
| **Orchestrator** | 1 | Decision-making and coordination |

### Agent Complexity Distribution

```
HIGH COMPLEXITY (300+ lines, complex parsing):
├── TechnicalDebtAgent (305+ lines of parsing alone)
├── PatternAgent (5 custom parsers)
├── WikiEditorAgent (555-line system prompt)
├── SelfImprovementAgent (2000+ line prompt, 24 tools)
└── DuplicateHandler, InaccuracyHandler

MEDIUM COMPLEXITY:
├── CodeChangeAgent, SecurityAgent
├── ConsistencyAgent, SourceVerificationAgent
├── WriterAgent, OverviewAgent
├── ContradictionHandler, TerminologyHandler
└── ResearchAgent, GraderAgent

LOW COMPLEXITY:
├── NarrativeAgent, DependencyAgent
├── StructureAgent, QualityAgent, CategoryAgent
├── BootstrapAgent, WikiIndexAgent, TOCAgent
├── BrokenLinkHandler, OrphanedPageHandler
└── SpecAgent
```

---

## Critical Complexity Issues

### 1. Response Parsing Fragmentation (HIGHEST IMPACT)

**Problem:** Every LLM-using agent reimplements regex-based response parsing with slight variations.

**Evidence:**
- TechnicalDebtAgent: 305+ lines, 6 helper functions, 5 fallback regex patterns per section
- PatternAgent: 5 different specialized parsers
- OverviewAgent: Custom regex extraction for 6 sections
- All consolidation handlers: Similar `response.match(/FIELD:\s*(.+)/i)` patterns

**Current pattern (repeated 15+ times):**
```typescript
const summaryMatch = response.match(/SUMMARY:\s*(.+?)(?=FINDINGS:|$)/is);
const findingsMatch = response.match(/FINDINGS:\s*([\s\S]*?)(?=WIKI_UPDATES:|$)/i);
// ... more regex for each field
```

**Impact:** ~800+ lines of duplicated, fragile parsing code across agents.

**Recommendation:** Create `StructuredResponseParser` utility:
```typescript
// Proposed: 3 lines replaces 30+ lines per agent
const parser = new StructuredResponseParser(response);
const summary = parser.extractField('SUMMARY');
const findings = parser.extractList('FINDINGS', findingPattern);
```

---

### 2. Repository Access Abstraction Explosion

**Problem:** AgentContext provides 5 different ways to access repository data:
- `git` (GitService) - local only, deprecated
- `repoService` (RepositoryService) - GitHub + local, preferred
- `repos` (Repositories) - data access layer
- `repo` (Repo entity) - metadata
- `context.git.getRepoPath()` - filesystem path

**Impact:**
- agent-helpers.ts has 100+ lines of conditional branches
- Agents must check which access method is available
- Inconsistent behavior between local and GitHub repos

**Recommendation:**
- Remove `git` from AgentContext
- Make `repoService` the single source of truth
- Eliminate conditional branches in agents

---

### 3. System Prompt Duplication

**Problem:** ~70% of system prompt content is repeated across agents.

**Common sections (repeated in every agent):**
- Tool descriptions and usage instructions
- Verification/workflow guidance
- Confidence scoring rules
- Output format requirements (partially)

**Evidence:**
- 7 analysis agents: ~300-800 lines each, ~70% overlap
- 7 meta agents: ~15-555 lines each, significant overlap
- WikiEditorAgent alone: 555 lines (could be ~150 with templates)

**Recommendation:** Create prompt template system:
```typescript
const prompt = PromptBuilder.create()
  .withRole('Security Analyst')
  .withToolInstructions()  // shared
  .withVerificationWorkflow()  // shared
  .withOutputFormat(securityOutputFormat)  // unique
  .withConfidenceGuidance()  // shared
  .build();
```

---

### 4. Backwards Compatibility Debt

**Problem:** Dual patterns coexist for backwards compatibility:

**Agent dispatch:**
- New: `canHandle(target: WorkTarget)` + `run(target, context)`
- Deprecated: `runOnCommit()`, `runOnWiki()`, `runOnPath()`

**Work items:**
- New: `WorkTarget` discriminated union
- Deprecated: `targetCommitId`, `targetPath` fields + conversion functions

**Impact:** Every agent implements both patterns. Conversion functions add cognitive load.

**Recommendation:** Complete migration to new pattern, remove deprecated methods.

---

### 5. Keyword Extraction Duplication

**Problem:** ResearchAgent and SpecAgent both implement nearly identical keyword extraction.

```typescript
// ResearchAgent
private extractKeywords(text: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', ...]);
  // ... 30+ lines
}

// SpecAgent
private extractKeywords(task: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', 'add', 'create', ...]);
  // ... 30+ lines (slightly different stop words)
}
```

**Recommendation:** Extract to shared utility:
```typescript
// src/services/nlp/keyword-extractor.ts
export function extractKeywords(text: string, options?: {
  includeActionVerbs?: boolean
}): string[]
```

---

### 6. Tool Executor Creation Duplication

**Problem:** Tool executor setup is repeated in every agent:
```typescript
const toolExecutor = createCodebaseToolExecutor(context);
const completion = await context.llm.completeWithTools({
  system: SYSTEM_PROMPT,
  messages: [{ role: 'user', content: prompt }],
  tools: toolExecutor?.tools.map(t => ({...})) ?? [],
  executeTools: toolExecutor?.executeTools ?? async () => [],
  maxToolRounds: N,
  maxTokens: M,
});
```

This 8-line pattern appears in 15+ agents.

**Recommendation:** Create helper:
```typescript
const completion = await executeAgentWithTools(context, {
  system: SYSTEM_PROMPT,
  prompt,
  maxToolRounds: 5,
  maxTokens: 3000,
});
```

---

### 7. Orchestrator Dual Code Paths

**Problem:** Orchestrator has two completely separate decision paths:
- `generateWithLLM()` - 180 lines, with internal fallback
- `generateDeterministic()` - 30 lines

Plus fallback logic within LLM mode (lines 306-322).

**Impact:**
- Testing requires covering both paths
- Complex nested conditionals
- Hard to reason about behavior

**Recommendation:** Single unified path where LLM is an optional enhancement, not a mode switch.

---

### 8. Handler Strategy Pattern Overhead

**Problem:** 7 consolidation handlers, but 3 are trivial (BrokenLink, Orphaned, CategoryMismatch) and don't benefit from the Strategy pattern.

**Evidence:**
- BrokenLinkHandler: 126 lines, no LLM, simple string replacement
- CategoryMismatchHandler: 32 lines, no action, reporting only
- OrphanedPageHandler: 81 lines, no LLM, link injection

**Contrast with complex handlers:**
- DuplicateHandler: 206 lines, LLM decisions, merge logic
- InaccuracyHandler: 187 lines, LLM + source code verification

**Recommendation:**
- Merge BrokenLink + Orphaned into single `LinkHandler`
- Keep Strategy pattern for LLM-based handlers
- Consider simpler dispatch for non-LLM handlers

---

### 9. Hardcoded Configuration

**Problem:** Magic numbers scattered across agents:

| Agent | Hardcoded Values |
|-------|-----------------|
| StructureAgent | MAX_PAGE_LENGTH=5000, MAX_CATEGORY_PAGES=20 |
| ConsistencyAgent | SIMILARITY_THRESHOLD=0.6, MAX_PAGES=20 |
| CategoryAgent | Temperature=0.4 |
| SourceVerificationAgent | MAX_PAGES_PER_RUN=5, MAX_CLAIMS_PER_PAGE=5 |
| Various | Confidence thresholds (0.5, 0.7, 0.8) |

**Recommendation:** Extract to configuration file or AgentContext options.

---

### 10. Inconsistent Confidence Scoring

**Problem:** Each agent calculates confidence differently:

| Agent | Confidence Source |
|-------|------------------|
| BootstrapAgent | 0.5-0.6 based on README existence |
| OverviewAgent | 0.7 default, parsed from response |
| ProjectOverviewAgent | 0.8 hardcoded |
| WikiIndexAgent | 0.9 hardcoded |
| ResearchAgent | 40% source + 60% LLM |
| Various | Different formulas |

**Recommendation:** Define standard confidence calculation or document why they differ.

---

## Recommended Refactoring Roadmap

### Phase 1: Quick Wins (1-2 days each)

| Task | Impact | Risk | Lines Removed |
|------|--------|------|---------------|
| Create `StructuredResponseParser` | HIGH | LOW | ~500 |
| Extract keyword extraction utility | MEDIUM | LOW | ~60 |
| Create `executeAgentWithTools` helper | MEDIUM | LOW | ~120 |
| Remove unused code (ProjectOverviewAgent.parseResponse) | LOW | LOW | ~80 |

### Phase 2: Medium Effort (3-5 days each)

| Task | Impact | Risk | Lines Removed |
|------|--------|------|---------------|
| Create prompt template system | HIGH | MEDIUM | ~1000 |
| Unify repository access (remove `git`) | HIGH | MEDIUM | ~150 |
| Merge BrokenLink + OrphanedPage handlers | LOW | LOW | ~80 |
| Extract configuration to central file | MEDIUM | LOW | ~50 |

### Phase 3: Major Refactoring (1-2 weeks)

| Task | Impact | Risk |
|------|--------|------|
| Complete migration from deprecated Agent methods | HIGH | HIGH |
| Consolidate orchestrator LLM/deterministic paths | MEDIUM | MEDIUM |
| Create LLMHandler base class for consolidation handlers | MEDIUM | MEDIUM |
| Standardize confidence scoring | LOW | LOW |

---

## Metrics Summary

### Current State

| Metric | Value |
|--------|-------|
| Total agents | 28 |
| Total lines (agents/) | ~15,000 |
| Duplicated parsing code | ~800 lines |
| System prompt overlap | ~70% |
| Repository access methods | 5 |
| Deprecated methods still in use | 7 |

### Target State (After Phase 1-2)

| Metric | Current | Target | Reduction |
|--------|---------|--------|-----------|
| Parsing code | ~800 | ~200 | 75% |
| Tool executor boilerplate | ~120 | ~15 | 87% |
| Repository access methods | 5 | 1 | 80% |
| Agent method interfaces | 7 | 4 | 43% |

---

## Conclusion

The CodeWiki agent system is **architecturally sound** but has accumulated **significant technical debt** through:

1. **Copy-paste code patterns** (parsing, tool setup, keyword extraction)
2. **Too many choices** for the same operation (repository access)
3. **Backwards compatibility layers** that should be removed
4. **Missing abstractions** (prompt templates, response parsing)

The recommended Phase 1 changes (parser utility, helper functions) would eliminate ~700+ lines of code with minimal risk. Phase 2 changes (prompt templates, unified repository access) would further reduce complexity and improve maintainability.

**Priority recommendation:** Start with `StructuredResponseParser` - it touches the most code and has the highest impact-to-risk ratio.

---

## Appendix: Agent Reference

### Analysis Agents (src/agents/analysis/)

| Agent | Input | Output | Tools | Complexity |
|-------|-------|--------|-------|------------|
| CodeChangeAgent | Commit | WikiPageUpdate[] | read_file, search_files, list_directory | Medium |
| NarrativeAgent | Commit | WikiPageUpdate[] | Same | Low |
| SecurityAgent | Commit | WikiPageUpdate[] | Same | Low |
| TechnicalDebtAgent | Commit | WikiPageUpdate[] | Same | HIGH |
| PatternAgent | Commit | WikiPageUpdate[] | Same | HIGH |
| DependencyAgent | Commit | WikiPageUpdate[] | Same | Medium |
| CodebaseExplorerAgent | Path | WikiPageUpdate[] | Same | Medium |

### Meta Agents (src/agents/meta/)

| Agent | Input | Output | Tools | Complexity |
|-------|-------|--------|-------|------------|
| WikiEditorAgent | Wiki | WikiPageUpdate[] | None | HIGH |
| LinkAgent | Wiki | WikiPageUpdate[] | None | Low |
| StructureAgent | Wiki | Findings only | None | Low |
| QualityAgent | Wiki | Findings only | None | Low |
| ConsistencyAgent | Wiki | Findings + repo save | None | Medium |
| SourceVerificationAgent | Wiki | Findings + repo save | read_file | Medium |
| CategoryAgent | Wiki | WikiPageUpdate[] | None | Medium |

### Synthesis Agents (src/agents/synthesis/)

| Agent | Input | Output | Tools | Uses LLM |
|-------|-------|--------|-------|----------|
| BootstrapAgent | Wiki | WikiPageUpdate[] | 3 | Yes |
| OverviewAgent | Wiki | WikiPageUpdate[] | 3 | Yes |
| WriterAgent | Wiki | WikiPageUpdate[] | 3 | Yes |
| ProjectOverviewAgent | Wiki | WikiPageUpdate[] | 3 | Yes |
| GettingStartedAgent | Wiki | WikiPageUpdate[] | 3 | Yes |
| TestingGuideAgent | Wiki | WikiPageUpdate[] | 3 | Yes |
| ExtensionGuideAgent | Wiki | WikiPageUpdate[] | 3 | Yes |
| WikiIndexAgent | Wiki | WikiPageUpdate[] | 0 | **No** |
| TableOfContentsAgent | Wiki | WikiPageUpdate[] | 0 | **No** |

### Consolidation Handlers (src/agents/consolidation/handlers/)

| Handler | Finding Types | Uses LLM | Complexity |
|---------|--------------|----------|------------|
| BrokenLinkHandler | broken_link | No | Low |
| OrphanedPageHandler | orphaned_page | No | Low |
| CategoryMismatchHandler | category_mismatch | No | Minimal |
| DuplicateHandler | duplicate_title, similar_content | Yes | HIGH |
| ContradictionHandler | contradiction | Yes | Medium |
| TerminologyHandler | terminology | Yes | Medium |
| InaccuracyHandler | inaccurate | Yes | HIGH |

### Specialized Agents

| Agent | Location | Input | Output | Tools |
|-------|----------|-------|--------|-------|
| ResearchAgent | src/agents/research/ | question | ResearchResult | 4 wiki tools |
| SpecAgent | src/agents/spec/ | task | SpecResult | None |
| SelfImprovementAgent | src/analysis/ | benchmark IDs | Report | 24 tools |
| GraderAgent | src/benchmark/ | answer | GradeResult | 3 code tools |
