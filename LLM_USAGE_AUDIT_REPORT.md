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

### 2.1 Analysis Agents (SecurityAgent, CodeChangeAgent)

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

**Current Implementation:**
- Receives a question about the codebase
- Uses wiki tools to search, read pages, follow links
- Already has "warm start" keyword matching

**What Data Is Available:**
```typescript
// ALL wiki pages are already loaded:
const allPages = pagesResult.data; // Full content available

// Warm start already identifies relevant pages:
const warmStartSuggestions = this.getWarmStartSuggestions(allPages, question);
```

**Optimization Opportunity: HIGH**

The warm-start logic already identifies relevant pages using keyword matching. Instead of providing snippets and requiring tool calls to read full pages:

```typescript
// Current: Provide snippets, require read_page tool calls
warmStart.map(({ page }) => ({
  title: page.title,
  path: page.path,
  snippet: this.extractSnippet(page.content, keywords[0]),
}));

// Optimized: Include full content of top N pages
const relevantPages = scored
  .filter(s => s.score > 0.5)
  .sort((a, b) => b.score - a.score)
  .slice(0, 5); // Top 5 instead of top 3

const prompt = `
## Question
${question}

## Relevant Wiki Pages (full content)
${relevantPages.map(({ page }) => `
### ${page.title} (${page.path})
${page.content}
`).join('\n---\n')}
`;
```

**Expected Impact:**
- Eliminates all tool rounds for most queries
- Reduces latency by 70-90%
- Improves reliability significantly
- Works well for wikis up to ~50-100 pages

**Trade-off:**
- Won't work for very large wikis (context overflow)
- May miss pages that keyword search doesn't find

**Recommendation:**
- For small wikis (<20 pages): Include ALL pages in context
- For medium wikis (20-100 pages): Include top 10 keyword-matched pages
- For large wikis (>100 pages): Keep current tool-based approach
- Add parameter: `agentic: boolean` to allow caller to choose

---

### 2.4 GraderAgent

**Current Implementation:**
- Grades wiki answers by reading actual source code
- Questions have `verificationHints` suggesting files to check

**What Data Is Available:**
```typescript
// Verification hints tell us exactly what to check:
question.verificationHints // e.g., ["src/services/auth.ts", "tests/auth.test.ts"]
```

**Optimization Opportunity: MEDIUM-HIGH**

```typescript
// Pre-fetch hint files
const hintFiles = await Promise.all(
  (question.verificationHints || []).map(async (path) => ({
    path,
    content: await repoAccess.getFileContent(path).catch(() => '[not found]')
  }))
);

// Include in prompt
const prompt = `
## Question
${question.question}

## Wiki's Answer
${wikiAnswer}

## Source Code to Verify Against
${hintFiles.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}

Grade the wiki's answer based on the source code above.
`;
```

**Expected Impact:**
- Eliminates tool rounds for questions with good hints
- Falls back to tools for questions without hints

**Recommendation:**
- Pre-fetch all verification hints
- Make tools optional for edge cases
- Improve hint coverage in benchmark questions

---

### 2.5 SelfImprovementAgent

**Current Implementation:**
- Analyzes benchmark trends across multiple runs
- Uses 22 tools across 6 categories
- Up to 30 tool rounds

**What Data Is Available:**
The agent needs to explore dynamically based on findings - this is genuine agentic work.

**Optimization Opportunity: LOW**

This is the one case where tool use is genuinely necessary:
- The analysis is exploratory - the agent doesn't know what to look for in advance
- Findings in one area inform what to investigate next
- The 22 tools cover many different data sources

**Recommendation:** Keep as-is. This is legitimate agentic behavior.

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
