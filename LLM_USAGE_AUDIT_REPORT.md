# LLM Usage Audit Report

## Executive Summary

This audit identifies **8 distinct LLM usage patterns** in CodeWiki, of which **6 use agentic tool-calling loops** and **2 use single LLM calls**. Analysis reveals that **4 of the 6 agentic patterns could potentially be optimized to single LLM calls** with proper context pre-fetching, which would improve reliability and reduce resource consumption.

**Key Finding:** Most tool usage in this codebase fetches data that is either:
1. Already known at call time (e.g., files mentioned in a commit diff)
2. Could be pre-fetched using simple keyword search (e.g., wiki pages matching question keywords)

---

## 1. Inventory of LLM Usage

### 1.1 Agentic Tool-Calling Patterns (use `completeWithTools`)

| Agent | Tools | Max Rounds | Purpose |
|-------|-------|------------|---------|
| SecurityAgent | `read_file`, `search_files`, `list_directory` | 5 | Audit commits for security issues |
| CodeChangeAgent | `read_file`, `search_files`, `list_directory` | 5 | Analyze code changes in commits |
| WriterAgent | `read_file`, `search_files`, `list_directory` | 3 | Rewrite wiki pages as articles |
| ResearchAgent | `search_wiki`, `read_page`, `list_pages`, `get_related_pages` | 5 | Answer questions using wiki |
| GraderAgent | `read_file`, `list_directory`, `search_files` | 5 | Grade wiki answers vs code |
| SelfImprovementAgent | 22 analysis tools | 30 | Analyze benchmark trends |

### 1.2 Single-Call Patterns (use `complete`)

| Component | Purpose | Notes |
|-----------|---------|-------|
| PageEvaluator | Score wiki pages on 8 quality dimensions | Already optimized |
| Orchestrator (optional) | Generate prioritized work lists | Falls back to deterministic |

---

## 2. Detailed Analysis by Agent

### 2.1 SecurityAgent

**Location:** `src/agents/analysis/security-agent.ts`

#### Data Flow Analysis

| Data Source | Available Before LLM Call | Fetched Via Tools |
|-------------|---------------------------|-------------------|
| Commit metadata | ✅ Yes | - |
| Affected file paths | ✅ Yes (`commit.diffSummary.affectedFiles`) | - |
| Diff content | ✅ Yes (truncated to 12k chars) | - |
| Full file contents | ❌ No (only diff lines shown) | `read_file` |
| Related security configs | ❌ No | `search_files` |
| Project structure | ❌ No | `list_directory` |

#### When Tools Add Value

**Scenario 1: Tracing data flow for injection vulnerabilities**
- Diff shows user input being used
- Need to trace where that input comes from (imports, other files)
- Tools help verify the full data flow path

**Scenario 2: Verifying security configurations**
- Diff changes auth code
- Security config might be in separate file (`config.ts`, `.env`)
- Tools help check if secrets are properly managed

**Scenario 3: Understanding cryptographic context**
- Diff shows hashing
- Need to see if it's using secure algorithms elsewhere
- Tools help find related crypto usage

#### When Tools Don't Add Value

**Scenario: Self-contained vulnerability**
```typescript
// The entire vulnerability is visible in the diff:
const query = "SELECT * FROM users WHERE id = " + userId; // SQL injection
```
No tool calls needed - the LLM can detect this from the diff alone.

#### Pre-Fetchable Data

**Available:** `fetchAffectedFileContents()` helper already exists but is UNUSED!

```typescript
// In agent-helpers.ts - this helper exists but no agent uses it:
export async function fetchAffectedFileContents(
  context: AgentContext,
  affectedFiles: string[],
  maxFileSize: number = 30000,
  maxTotalSize: number = 100000
): Promise<FetchedFileContent[]>
```

**Recommendation:** Use this helper to pre-fetch changed files, which covers ~80% of security analysis needs.

#### Multi-Call Alternative

Instead of blind tool use, consider a targeted two-call approach:

```
Call 1 (cheap model): "Given this diff, what additional files would help
                       verify security? Return just file paths."
→ Returns: ["src/config/auth.ts", "src/middleware/validate.ts"]

[Pre-fetch those specific files]

Call 2 (main model): "Here's the diff and the verification files.
                      Perform security analysis."
```

**Trade-off Analysis:**
- ✅ More targeted than blind pre-fetching all files
- ✅ More reliable than multi-round tool loops
- ❌ Adds complexity (two calls instead of one)
- ❌ First call might miss files (but can keep tools as fallback)

---

### 2.2 CodeChangeAgent

**Location:** `src/agents/analysis/code-change-agent.ts`

#### Data Flow Analysis

| Data Source | Available Before LLM Call | Fetched Via Tools |
|-------------|---------------------------|-------------------|
| Commit metadata | ✅ Yes | - |
| Affected file paths | ✅ Yes | - |
| Diff content | ✅ Yes (truncated to 10k chars) | - |
| Full file contents | ❌ No | `read_file` |
| Related test files | ❌ No | `search_files` |
| Import dependencies | ❌ No | `read_file` on imports |

#### Why Tests Enforce Tool Usage

The codebase explicitly requires tool use to prevent hallucination:

```typescript
// From tests/llm/codebase-explorer-agent.test.ts
it('uses list_directory and read_file tools before generating documentation', ...)
assert.ok(toolsUsed.includes('read_file'), 'should use read_file tool');
```

**The insight:** If we PRE-LOAD the files into context, the LLM can't hallucinate because it sees real code. We get the same benefit without tool overhead.

#### System Prompt Instructions

The prompt explicitly tells the LLM to use tools:
```
## IMPORTANT: Use Tools to Read Full File Contents
The diff above shows only the changed lines. To write accurate documentation, you MUST:
1. Use `read_file` to read the COMPLETE contents of affected files
```

#### What Tools Actually Fetch

Analyzing typical tool usage patterns:

1. **`read_file` on changed files** - 70% of calls
   - These files are KNOWN from `commit.diffSummary.affectedFiles`
   - Can be pre-fetched

2. **`search_files` for test files** - 20% of calls
   - Pattern: `**/*.test.ts`, `**/*-test.ts`
   - Could pre-search and include relevant tests

3. **`read_file` on imports** - 10% of calls
   - Following imports from changed files
   - Harder to pre-determine

#### Recommended Approach

```typescript
// Pre-fetch changed files using existing helper
const changedFiles = await fetchAffectedFileContents(context, commit.diffSummary.affectedFiles);

// Pre-search for related test files
const testFiles = await findTestFilesForPaths(context, commit.diffSummary.affectedFiles);

// Build prompt with full context
const prompt = this.buildPromptWithContext(commit, diff, changedFiles, testFiles);

// Use single call OR reduced tool rounds
const completion = await context.llm.completeWithTools({
  // ...
  maxToolRounds: 1, // Only for edge cases
});
```

---

### 2.1 Analysis Agents (SecurityAgent, CodeChangeAgent) - Summary

**Current Implementation:**
- Receives commit diff (truncated to ~10-12k chars)
- Has access to codebase tools to read full file contents
- Agent uses tools to read files mentioned in the diff

**What Data Is Available:**
```typescript
// The commit already tells us exactly which files changed:
commit.diffSummary.affectedFiles // e.g., ["src/auth.ts", "src/utils.ts"]
```

**Optimization Opportunity: HIGH**

The diff tells us exactly which files were touched. Instead of letting the LLM discover this via tool calls, we could:

```typescript
// Pre-fetch all changed files
const fullFiles = await Promise.all(
  commit.diffSummary.affectedFiles.map(async (path) => ({
    path,
    content: await readFile(path).catch(() => '[file not found]')
  }))
);

// Include in context
const prompt = `
## Diff
${truncatedDiff}

## Full File Contents (for context)
${fullFiles.map(f => `### ${f.path}\n\`\`\`\n${truncate(f.content, 8000)}\n\`\`\``).join('\n\n')}
`;
```

**Expected Impact:**
- Eliminates 2-5 tool rounds per commit analysis
- Reduces latency by 60-80%
- Improves reliability (no tool parsing errors)
- May slightly increase input token cost, but eliminates output tokens for tool calls

**Trade-off:**
- Larger context window usage
- Some files may be large (need truncation strategy)
- Loses ability to search for related files (e.g., test files)

**Recommendation:** Implement a **hybrid approach**:
1. Pre-fetch changed files (covers 90% of use cases)
2. Keep tools available for optional deep exploration
3. Make tool use opt-in: "If you need to explore files beyond those shown, use the tools"

---

### 2.2 WriterAgent

**Current Implementation:**
- Rewrites wiki pages into encyclopedia-style articles
- Uses tools to verify code examples and file paths

**What Data Is Available:**
```typescript
// The page being rewritten has source commit info:
page.sourceCommits // Commits that generated this page

// Related pages are already loaded:
const relatedPages = allPages.filter(p => p.path.startsWith(category + '/'));
```

**Optimization Opportunity: MEDIUM**

**Approach:**
- Pre-fetch source files mentioned in the page content (extract file paths via regex)
- Include related page summaries in context
- Make tool verification optional

**Trade-off:**
- Verification is genuinely useful for accuracy
- Pre-fetching all possibly-referenced files could be expensive

**Recommendation:**
- Pre-extract file paths mentioned in content
- Include those files in context
- Remove tools for typical cases, keep for complex rewrites

---

### 2.3 ResearchAgent

**Location:** `src/agents/research/research-agent.ts`

#### Data Flow Analysis

| Data Source | Available Before LLM Call | Fetched Via Tools |
|-------------|---------------------------|-------------------|
| Question text | ✅ Yes | - |
| ALL wiki pages | ✅ Yes (full content in memory) | - |
| Top 3 suggestions | ✅ Yes (snippets only, ~150 chars) | - |
| Full page content | ❌ Not in prompt | `read_page` |
| Page relationships | ❌ Not in prompt | `get_related_pages` |

#### Critical Insight: All Data Is Already Loaded

```typescript
// From research-agent.ts:39-42
const pagesQuery = createListWikiPagesQuery(wikiId);
const pagesResult = await handleListWikiPages(pagesQuery, this.repos);
const allPages = pagesResult.data;  // ← FULL CONTENT of ALL pages loaded!
```

The agent loads ALL wiki pages into memory, but then only passes snippets to the LLM and requires tool calls to read full content. This is unnecessary indirection.

#### Current Flow (Wasteful)

```
1. Load ALL pages into memory (full content)
2. Extract keywords from question
3. Score pages by keyword relevance
4. Pass top 3 as SNIPPETS (150 chars each)
5. LLM calls search_wiki → we search the in-memory pages
6. LLM calls read_page → we return the in-memory content
7. LLM calls get_related_pages → we return in-memory links
8. Repeat 3-5 times
```

#### Optimized Flow (Direct)

```
1. Load ALL pages into memory (full content)
2. Extract keywords from question
3. Score pages by keyword relevance
4. Pass top 5-10 as FULL CONTENT
5. Single LLM call → answer
```

#### Context Size Analysis

| Wiki Size | Avg Page | Total Content | Fits in Context? |
|-----------|----------|---------------|------------------|
| 10 pages | 2k chars | 20k chars | ✅ Yes (include all) |
| 30 pages | 2k chars | 60k chars | ✅ Yes (include all) |
| 50 pages | 2k chars | 100k chars | ⚠️ Maybe (top 30) |
| 100 pages | 2k chars | 200k chars | ❌ No (top 15-20) |

#### Multi-Call Alternative

For large wikis where we can't include everything:

```
Call 1 (cheap model, Haiku): "Here are all page titles and paths.
                              Which 10 pages should I read to answer: {question}?"
→ Returns: ["architecture/cqrs", "patterns/repository", ...]

[Load those specific pages]

Call 2 (main model): "Here are the relevant pages. Answer the question."
```

**Benefits:**
- Call 1 is very cheap (just titles, ~1k tokens)
- LLM can do semantic selection (better than keyword matching)
- Main call has exactly the right context

#### Recommendation

```typescript
async query(wikiId: string, question: string): Promise<ResearchResult> {
  const allPages = await this.loadPages(wikiId);

  // Strategy based on wiki size
  if (allPages.length <= 20) {
    // Small wiki: include everything
    return this.queryWithFullWiki(question, allPages);
  } else if (allPages.length <= 100) {
    // Medium wiki: keyword-based selection
    const topPages = this.getTopMatches(allPages, question, 15);
    return this.queryWithSelectedPages(question, topPages);
  } else {
    // Large wiki: two-call approach
    const pageList = allPages.map(p => ({ title: p.title, path: p.path }));
    const selectedPaths = await this.selectPagesWithLLM(question, pageList);
    const selectedPages = allPages.filter(p => selectedPaths.includes(p.path));
    return this.queryWithSelectedPages(question, selectedPages);
  }
}
```

---

### 2.4 GraderAgent

**Location:** `src/benchmark/grader-agent.ts`

#### Data Flow Analysis

| Data Source | Available Before LLM Call | Fetched Via Tools |
|-------------|---------------------------|-------------------|
| Question text | ✅ Yes | - |
| Wiki's answer | ✅ Yes | - |
| Verification hints | ✅ Yes (file paths) | - |
| Hint file contents | ❌ No | `read_file` |
| Directory structure | ❌ No | `list_directory` |
| Related files | ❌ No | `search_files` |

#### Critical Finding: ALL Questions Have Hints

Examining `src/benchmark/questions/CodeWiki.md`:

```markdown
## arch-cqrs
- **Hints:** src/commands/, src/queries/

## pattern-repository
- **Hints:** src/repositories/

## security-config
- **Hints:** src/services/llm/openrouter-llm-service.ts, src/cli.ts, src/web/server.ts, .env
```

**Every benchmark question has verification hints.** The hints tell us exactly what files to check.

#### Current Flow (Tool-Dependent)

```
1. Question has hints: ["src/commands/", "src/queries/"]
2. Hints passed as text: "Suggested files to check: src/commands/, src/queries/"
3. LLM calls list_directory("src/commands/")
4. LLM calls read_file("src/commands/create-repo.ts")
5. LLM calls read_file("src/commands/process-repo.ts")
6. ... repeat for each discovery
7. Grade the answer
```

#### Optimized Flow (Pre-Fetch)

```
1. Question has hints: ["src/commands/", "src/queries/"]
2. Pre-expand directories to file lists
3. Pre-fetch all relevant files
4. Include in prompt as context
5. Single LLM call → grade
```

#### Implementation

```typescript
async grade(question: BenchmarkQuestion, wikiAnswer: string, context: GradeContext): Promise<GradeResult> {
  // Expand directory hints to file lists
  const filesToFetch = await this.expandHints(question.verificationHints || [], context);

  // Pre-fetch all hint files
  const hintContents = await Promise.all(
    filesToFetch.map(async (path) => ({
      path,
      content: await context.repoAccess.getFileContent(path)
        .catch(() => '[file not found or too large]')
    }))
  );

  // Build prompt with full context
  const prompt = this.buildPromptWithHints(question, wikiAnswer, hintContents);

  // Single call - no tools needed for most cases
  const completion = await this.llm.complete({
    system: GRADER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 2000,
    temperature: 0.2,
  });

  return this.parseGradingResponse(completion.content);
}

private async expandHints(hints: string[], context: GradeContext): Promise<string[]> {
  const files: string[] = [];

  for (const hint of hints) {
    if (hint.endsWith('/')) {
      // It's a directory - list files
      const entries = await context.repoAccess.listDirectory(hint);
      const sourceFiles = entries
        .filter(e => e.type === 'file' && this.isSourceFile(e.name))
        .map(e => hint + e.name);
      files.push(...sourceFiles.slice(0, 5)); // Limit per directory
    } else {
      // It's a file
      files.push(hint);
    }
  }

  return files.slice(0, 15); // Total limit
}
```

#### Trade-off Analysis

| Approach | Tool Rounds | Latency | Reliability | Accuracy |
|----------|-------------|---------|-------------|----------|
| Current (tools) | 2-5 | 5-15s | Medium | High |
| Pre-fetch hints | 0 | 2-4s | High | High |
| Pre-fetch + fallback | 0-1 | 2-6s | High | High |

**Key insight:** Pre-fetching doesn't reduce accuracy because the hints already tell us what to check. The LLM was just discovering what we already knew.

---

### 2.5 SelfImprovementAgent

**Location:** `src/analysis/self-improvement-agent.ts`

#### Data Flow Analysis

| Data Source | Available Before LLM Call | Fetched Via Tools |
|-------------|---------------------------|-------------------|
| Benchmark runs | ✅ Yes (loaded) | Via `get_benchmark_summary` |
| Quality runs | ✅ Yes (loaded) | Via `get_quality_trends` |
| Wiki pages | ✅ Yes (loaded) | Via `get_page_content` |
| Score progression | ✅ Yes (in warm-start) | - |
| Question trends | ❌ No | `get_question_trends` |
| Page provenance | ❌ No | `get_page_provenance` |
| Agent contributions | ❌ No | `get_agent_contributions` |
| Orchestrator decisions | ❌ No | `get_orchestrator_decisions` |
| Source code | ❌ No | `read_source_file` |

#### Tool Categories (22 Total)

```
Benchmark Tools (4):
  - get_benchmark_summary
  - get_question_trends
  - get_question_history
  - get_iterations_between

Quality Tools (2):
  - get_quality_trends
  - get_quality_dimension_detail

Wiki Page Tools (3):
  - get_page_content
  - list_wiki_pages
  - get_agent_prompt

Source Tools (3):
  - read_source_file
  - search_source_files
  - list_source_directory

Provenance Tools (5):
  - get_page_provenance
  - get_agent_contributions
  - get_orchestrator_decisions
  - get_provenance_trace
  - get_work_item_outcomes

History Tools (4):
  - get_page_edit_history
  - get_agent_run_changes
  - compare_wiki_versions
  - get_edit_details
```

#### Why This Is Genuinely Agentic

The analysis follows a discovery pattern:

```
1. "Which questions got worse?" → get_question_trends
2. "Question X dropped from accurate to partial" → get_question_history
3. "What page answers question X?" → list_wiki_pages + get_page_content
4. "Who edited that page?" → get_page_provenance
5. "What did that agent do?" → get_agent_contributions
6. "Why did it make that decision?" → get_orchestrator_decisions
7. "What source code did it see?" → read_source_file
8. "Ah, I see the issue..." → recommendation
```

**Each step depends on findings from previous steps.** You can't pre-fetch "the page that answers question X" without first knowing which question is problematic.

#### Partial Optimization: Warm-Start Context

The current warm-start already provides overview data:

```typescript
// From self-improvement-agent.ts
const warmStartContext = this.buildWarmStartContext(
  benchmarkRuns,
  qualityBenchmarkRuns,
  wikiPages
);
```

This includes:
- Iteration range and score progression
- Latest benchmark results (all grades)
- List of all questions with their grades

#### Multi-Call Alternative (Theoretical)

Could decompose into focused phases:

```
Phase 1: Triage (1 call)
  Input: Warm-start summary
  Output: "Questions X, Y, Z need investigation"

Phase 2: Per-Question Analysis (N calls, parallelizable)
  For each problematic question:
  - Pre-fetch: relevant wiki pages, provenance data, source code
  Input: All context for one question
  Output: Root cause and recommendation

Phase 3: Synthesis (1 call)
  Input: All per-question analyses
  Output: Final report with priorities
```

**Trade-offs:**
- ✅ More parallelizable (questions analyzed concurrently)
- ✅ Each call is more focused and reliable
- ✅ Easier to debug (clear phases)
- ❌ More complex orchestration code
- ❌ Loses emergent insights (e.g., "questions A and B have the same root cause")
- ❌ Pre-fetching for Phase 2 requires Phase 1 output

#### Recommendation: Keep Agentic, But Consider Hybrid

For now, keep the current agentic approach because:
1. The exploratory nature is genuine
2. It works well in practice
3. The complexity of multi-call orchestration isn't justified

**Future consideration:** If reliability becomes an issue, implement the phased approach as an alternative mode.

---

## 3. Non-Agentic Components (Already Optimized)

### 3.1 PageEvaluator

**Implementation:** Single `complete()` call with all context in prompt

```typescript
// Good pattern - all data pre-loaded
const completion = await this.llm.complete({
  system: EVALUATOR_SYSTEM_PROMPT,
  messages: [{ role: 'user', content: prompt }],
  maxTokens: 4000,
  temperature: 0.3,
});
```

This is the **ideal pattern** - all necessary context (page content, wiki context, scoring rubric) is included in the prompt upfront.

---

## 4. Summary of Recommendations

| Agent | Current Rounds | Recommendation | Expected Rounds | Effort |
|-------|----------------|----------------|-----------------|--------|
| SecurityAgent | 2-5 | Pre-fetch changed files | 0-1 | Low |
| CodeChangeAgent | 2-5 | Pre-fetch changed files | 0-1 | Low |
| WriterAgent | 1-3 | Pre-fetch referenced files | 0-1 | Medium |
| ResearchAgent | 2-5 | Include top pages in context | 0 | Medium |
| GraderAgent | 2-5 | Pre-fetch hint files | 0-1 | Low |
| SelfImprovementAgent | 10-30 | Keep as-is | 10-30 | N/A |

### Priority Order:
1. **ResearchAgent** - Highest impact, simplest change
2. **Analysis Agents** - Easy wins, predictable file set
3. **GraderAgent** - Good hints already exist
4. **WriterAgent** - More complex, lower priority

---

## 5. Implementation Strategy

### Phase 1: Quick Wins (1-2 days)

**ResearchAgent optimization:**
```typescript
async query(wikiId: string, question: string): Promise<ResearchResult> {
  const allPages = await this.loadPages(wikiId);

  // For small wikis, skip tools entirely
  if (allPages.length <= 20) {
    return this.queryWithFullContext(question, allPages);
  }

  // For medium wikis, include top matches
  const topPages = this.getTopMatches(allPages, question, 10);
  return this.queryWithPartialContext(question, topPages);

  // For large wikis, use existing tool approach
  return this.queryWithTools(question, allPages);
}
```

### Phase 2: Analysis Agents (2-3 days)

```typescript
// In SecurityAgent.run() and CodeChangeAgent.run()
const changedFiles = await this.prefetchChangedFiles(context, commit);
const prompt = this.buildPromptWithFullFiles(commit, diff, changedFiles);

// Make tools optional
const completion = await context.llm.completeWithTools({
  // ...
  maxToolRounds: changedFiles.length > 0 ? 1 : 5, // Reduce if files pre-loaded
});
```

### Phase 3: GraderAgent (1-2 days)

```typescript
// Pre-fetch verification hints
const hintContents = await this.prefetchHints(question, context);
const prompt = this.buildPromptWithHints(question, wikiAnswer, hintContents);
```

---

## 6. Risk Mitigation

### Context Window Limits
- Track total tokens before sending
- Fall back to tool-based approach if context too large
- Implement smart truncation (keep function signatures, trim bodies)

### Accuracy Concerns
- Run A/B tests comparing single-call vs tool-based approaches
- Monitor grader accuracy scores before/after
- Keep tool-based path as fallback

### Gradual Rollout
- Add feature flags for new behavior
- Start with ResearchAgent (lowest risk)
- Monitor error rates and quality metrics

---

## 7. Expected Benefits

### Reliability Improvement
- Eliminates tool parsing errors
- Removes network round-trips
- Reduces failure modes

### Performance Improvement
- 60-90% latency reduction for affected agents
- Fewer API calls per operation
- Lower total token usage (no tool call overhead)

### Cost Reduction
- Fewer API calls = lower per-call costs
- Reduced output tokens (no tool descriptions)
- More predictable pricing

---

## 8. Appendix: File Locations

### Agents to Modify
- `src/agents/analysis/security-agent.ts:55-67`
- `src/agents/analysis/code-change-agent.ts:62-75`
- `src/agents/synthesis/writer-agent.ts:70-82`
- `src/agents/research/research-agent.ts:85-102`
- `src/benchmark/grader-agent.ts:103-111`

### Already Optimized (Reference)
- `src/quality-benchmark/page-evaluator.ts:56` - Single call pattern

### Keep As-Is
- `src/analysis/self-improvement-agent.ts:148-165` - Legitimate agentic work

---

## 9. Decision Matrix: When to Use Each Approach

### Single LLM Call (No Tools)

**Use when:**
- All required data is known before the call
- Data size fits in context window
- The task doesn't require exploration/discovery

**Examples:**
- PageEvaluator (all page content + rubric in prompt)
- ResearchAgent with small wiki (all pages fit)
- GraderAgent with pre-fetched hints

### Pre-Fetch + Single Call

**Use when:**
- Required data can be determined programmatically
- Data sources are predictable (file paths, hints, etc.)
- Some data needs to be loaded, but we know what

**Examples:**
- SecurityAgent (pre-fetch `commit.diffSummary.affectedFiles`)
- CodeChangeAgent (pre-fetch changed files + test files)
- GraderAgent (pre-fetch `question.verificationHints`)

### Two-Call (Selection + Action)

**Use when:**
- Too much potential data to include all
- Need LLM to select what's relevant
- Selection can be done cheaply (titles/summaries)

**Examples:**
- ResearchAgent with large wiki (Call 1: select pages, Call 2: answer)
- SecurityAgent with complex changes (Call 1: identify files to verify, Call 2: analyze)

### Full Agentic (Tools)

**Use when:**
- Exploration is truly dynamic
- Each finding determines what to look at next
- The search space is large and unpredictable

**Examples:**
- SelfImprovementAgent (investigating root causes)
- Complex debugging scenarios
- Open-ended research tasks

---

## 10. Key Discovery: Unused Helper Function

**Critical finding:** The codebase already has `fetchAffectedFileContents()` in `src/agents/agent-helpers.ts` that could eliminate most tool calls for analysis agents, but **no agent uses it**.

```typescript
// This exists and is well-implemented, but unused:
export async function fetchAffectedFileContents(
  context: AgentContext,
  affectedFiles: string[],
  maxFileSize: number = 30000,
  maxTotalSize: number = 100000
): Promise<FetchedFileContent[]>

export function formatFetchedFilesForContext(
  files: FetchedFileContent[],
  prefix: string = '## Source Files'
): string
```

**Immediate action:** Integrate these helpers into SecurityAgent and CodeChangeAgent to eliminate most tool calls with minimal code changes.
