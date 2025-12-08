# Agent Optimization Plan: TDD-Based Refactoring

## Problem Summary

CodeWiki uses LLM-powered agents to analyze code and generate documentation. Many agents use **agentic tool-calling loops** where the LLM makes multiple requests to read files, search code, and explore directories. This approach has three significant problems:

1. **Reliability**: Each tool round introduces failure modes - parsing errors, timeouts, rate limits, and malformed responses compound across rounds
2. **Latency**: A 5-round tool loop takes 5x longer than a single call, with each round incurring network latency
3. **Cost**: Tool-calling consumes extra tokens describing tools and parsing results

**The key insight**: Most tool calls fetch **predictable data** that's already available or easily pre-determined:
- Changed files are listed in `commit.diffSummary.affectedFiles`
- Wiki pages are already loaded into memory
- Verification hints specify exactly which files to check

An audit of all 18 tool-using agents found that **13-15 can be optimized** to single-call or pre-fetch patterns. This document covers the TDD process and implementation plan for the highest-value agents.

### Related Documentation

- **[LLM_USAGE_AUDIT_REPORT.md](./LLM_USAGE_AUDIT_REPORT.md)** - Complete audit of all 29 LLM-using components with detailed analysis of each agent's data flow, tool usage patterns, and optimization potential. Includes code examples and specific file locations.

---

## TDD Process for Agent Refactoring

### Overview

Unlike traditional unit tests where assertions are binary pass/fail, LLM tests produce **scores on a 0-10 scale**. This gives us richer feedback:
- We can detect regressions before they become failures
- We can measure improvement, not just correctness
- We can compare before/after across multiple dimensions

The test infrastructure uses the **LLM-as-judge** pattern where a separate LLM evaluates whether output meets semantic criteria.

### Phase 1: Establish Baseline

**Goal**: Know exactly how the agent performs today before changing anything.

**Steps**:

1. **Run existing LLM tests** for the agent and record scores:
   ```bash
   node --import tsx --test tests/llm/<agent-name>.test.ts
   ```

2. **Save the test run** to create a baseline:
   - The test helpers automatically call `logTestResult()` and `saveTestRun()`
   - Results are saved to `tests/llm/results/` as JSON
   - Note the run ID for later comparison

3. **Run 3-5 times** to establish variance:
   - LLM outputs are non-deterministic
   - A score of 7 might fluctuate to 6 or 8 naturally
   - Record: average score, min, max, standard deviation

4. **Document baseline** in the test file or a tracking document:
   ```
   SecurityAgent Baseline (2024-01-15):
   - Detection accuracy: avg 7.8 (range 7-9)
   - False positive rate: avg 8.2 (range 8-9)
   - Format compliance: 100% (deterministic)
   ```

### Phase 2: Add Optimization-Specific Tests

**Goal**: Ensure the refactoring won't break edge cases or reduce quality.

**Steps**:

1. **Add equivalence tests** that verify pre-fetched data produces same results:
   - Create test case with known input/output
   - Run with current tool-based approach, record score
   - This becomes the target for the optimized version

2. **Add edge case tests** the tools currently handle:
   - Missing files (deleted after commit)
   - Permission errors (unreadable files)
   - Large files (truncation behavior)
   - Binary files (should be skipped)

3. **Add regression guards** for known-good behavior:
   - If the agent correctly identifies X vulnerability, add a test
   - If the agent correctly ignores Y false positive, add a test
   - Use threshold 8+ for things that MUST stay correct

### Phase 3: Implement the Optimization

**Goal**: Change from tool-calling to pre-fetched context.

**Steps**:

1. **Pre-fetch required data** before the LLM call:
   - Use existing helpers like `fetchAffectedFileContents()`
   - Load wiki pages from memory instead of via tools
   - Expand directory hints to file lists

2. **Update the prompt** to reference provided context:
   - Remove tool-use instructions
   - Add "Here are the relevant files:" section
   - Keep context size under limits (truncate if needed)

3. **Change call pattern**:
   - Replace `completeWithTools()` with `complete()`
   - Or reduce `maxToolRounds` to 1 for edge cases only

4. **Keep fallback** for complex cases:
   - If context would exceed limits, fall back to tools
   - If pre-fetch fails, fall back to tools
   - Log when fallback is used for monitoring

### Phase 4: Verify with Score Comparison

**Goal**: Prove the optimization maintains or improves quality.

**Steps**:

1. **Run the same test suite** against optimized agent:
   ```bash
   node --import tsx --test tests/llm/<agent-name>.test.ts
   ```

2. **Compare runs** using the result logger:
   - Load baseline run and new run
   - Check for regressions (score dropped >1 point)
   - Check for improvements (score increased)

3. **Acceptance criteria**:
   - No test drops below threshold (default 7)
   - Average score maintained or improved
   - No new failures in deterministic tests

4. **If regressions occur**:
   - Investigate specific failing cases
   - May need more context in prompt
   - May need to keep tools for specific scenarios
   - Iterate until criteria met

### Phase 5: Verify Non-Functional Improvements

**Goal**: Confirm the optimization achieves its intended benefits.

**Steps**:

1. **Measure latency**:
   - Time agent execution before and after
   - Expect 60-90% reduction for optimized agents

2. **Measure API calls**:
   - Count LLM requests before and after
   - Should go from 3-6 calls to 1-2 calls

3. **Monitor token usage**:
   - Input tokens may increase (more context)
   - Output tokens should decrease (no tool JSON)
   - Total cost should decrease

---

## Tier 1: High Value, Low Risk

These agents have the highest optimization potential with minimal risk.

### 1. ResearchAgent

**Location**: `src/agents/research/research-agent.ts`

**Current Test Coverage**: `tests/llm/specialized-agents.test.ts` (ResearchAgent section)

**Problem**:
- Loads ALL wiki pages into memory
- Only passes 150-char snippets to LLM
- LLM calls `read_page` tool to get content that's already in memory
- 2-5 tool rounds to answer a simple question

**What to Test Before Refactoring**:
1. Question answering accuracy with various question types
2. Source citation correctness (does it cite the right pages?)
3. Handling of questions with no relevant content
4. Multi-page synthesis (answer requires combining info)

**Optimization**:
- Include top 10-20 relevant pages as full content in prompt
- For small wikis (<20 pages), include everything
- Single LLM call with all context

**Tests to Add**:
```
- "Answer correctly identifies JWT expiration times" (existing)
- "Answer cites correct source pages"
- "Answer synthesizes info from multiple pages"
- "Returns low confidence for unanswerable questions"
- "Handles wiki with 50+ pages efficiently"
```

**Success Criteria**:
- Answer quality score >= baseline
- Source citation accuracy >= baseline
- Latency reduced by 70%+

---

### 2. GraderAgent

**Location**: `src/benchmark/grader-agent.ts`

**Current Test Coverage**: No dedicated test file (opportunity to create one)

**Problem**:
- Every benchmark question includes verification hints (file paths)
- Agent uses tools to discover these files
- The files to check are already known from hints

**What to Test Before Refactoring**:
1. Grading accuracy (correct scores for known answers)
2. Explanation quality (reasoning is clear and accurate)
3. Handling of partial answers
4. Handling of incorrect answers
5. False positive resistance (doesn't over-credit wrong answers)

**Optimization**:
- Pre-expand directory hints to file lists
- Pre-fetch all hint files
- Include in prompt as verification context
- Single LLM call

**Tests to Create** (`tests/llm/grader-agent.test.ts`):
```
- "Grades correct answer as accurate (score 9-10)"
- "Grades partial answer appropriately (score 5-7)"
- "Grades incorrect answer as inaccurate (score 1-3)"
- "Provides accurate reasoning for grade"
- "Uses verification files to check claims"
```

**Success Criteria**:
- Grading accuracy matches baseline
- Reasoning quality >= baseline
- Latency reduced by 60%+

---

### 3. OverviewAgent

**Location**: `src/agents/synthesis/overview-agent.ts`

**Current Test Coverage**: `tests/llm/synthesis-agents.test.ts`

**Problem**:
- Wiki pages are already loaded via CQRS query
- Only summaries are passed to LLM
- LLM uses tools to verify technical claims
- Verification is optional but always attempted

**What to Test Before Refactoring**:
1. Overview coherence and completeness
2. Accurate representation of category content
3. Proper linking to child pages
4. Technical accuracy of claims

**Optimization**:
- Include full content of category pages in prompt
- Make verification optional (only for technical claims)
- Single LLM call for most cases

**Tests to Verify**:
```
- "Overview accurately summarizes category pages"
- "Overview includes correct links to child pages"
- "Overview maintains technical accuracy"
- "Overview has appropriate structure and flow"
```

**Success Criteria**:
- Overview quality score >= baseline
- Link accuracy = 100%
- Latency reduced by 50%+

---

## Tier 2: High Value, Medium Complexity

These agents require more careful testing due to their impact on wiki quality.

### 4. SecurityAgent

**Location**: `src/agents/analysis/security-agent.ts`

**Current Test Coverage**: `tests/llm/security-agent.test.ts`

**Problem**:
- Receives commit diff (truncated to 12k chars)
- Uses tools to read full file contents
- Files to read are known from `commit.diffSummary.affectedFiles`
- Tool calls are predictable, not exploratory

**What to Test Before Refactoring**:
1. Detection of known vulnerability patterns (SQL injection, XSS, etc.)
2. False positive rate on safe code
3. Confidence calibration
4. Handling of large diffs

**Key Test Scenarios** (from existing tests):
```
- SQL injection detection (explicit pattern)
- XSS detection (DOM manipulation)
- Command injection detection (exec calls)
- Safe patterns not flagged as vulnerable
- Confidence reflects certainty appropriately
```

**Optimization**:
- Use `fetchAffectedFileContents()` helper (already exists, unused)
- Pre-fetch all changed files
- Include full content in prompt
- Reduce maxToolRounds to 1 (edge cases only)

**Tests to Add**:
```
- "Detects vulnerability when full context in prompt"
- "Handles large files with truncation"
- "Falls back to tools when context exceeds limit"
```

**Success Criteria**:
- Detection accuracy >= baseline
- False positive rate <= baseline (lower is better)
- No regressions on existing test cases

---

### 5. CodeChangeAgent

**Location**: `src/agents/analysis/code-change-agent.ts`

**Current Test Coverage**: `tests/llm/code-change-agent.test.ts`

**Problem**:
- Same pattern as SecurityAgent
- Uses tools to read changed files
- Files are known from diff summary
- 70% of tool calls are predictable file reads

**What to Test Before Refactoring**:
1. Change summary accuracy
2. Impact assessment quality
3. Test file association
4. Documentation generation quality

**Key Test Scenarios**:
```
- "Accurately summarizes feature additions"
- "Identifies breaking changes"
- "Associates changes with related tests"
- "Generates useful wiki content"
```

**Optimization**:
- Pre-fetch changed files using `fetchAffectedFileContents()`
- Pre-search for related test files
- Include both in prompt
- Single LLM call for typical cases

**Success Criteria**:
- Summary accuracy >= baseline
- Impact assessment quality >= baseline
- Related test identification >= baseline

---

### 6. WriterAgent

**Location**: `src/agents/synthesis/writer-agent.ts`

**Current Test Coverage**: `tests/llm/writer-agent.test.ts`

**Problem**:
- Rewrites wiki pages into encyclopedia-style articles
- Uses tools to verify code examples and file paths
- Source files are referenced in page content
- Verification is valuable but predictable

**What to Test Before Refactoring**:
1. Writing quality and style consistency
2. Technical accuracy of code examples
3. Proper link preservation
4. Source verification accuracy

**Optimization**:
- Extract file paths mentioned in content (regex)
- Pre-fetch those files
- Include as verification context
- Keep tools available for edge cases

**Tests to Verify**:
```
- "Maintains consistent encyclopedia style"
- "Preserves technical accuracy"
- "Code examples remain valid"
- "Links are properly formatted"
```

**Success Criteria**:
- Writing quality >= baseline
- Technical accuracy >= baseline
- Link integrity = 100%

---

## Implementation Order

Based on test coverage, optimization potential, and risk:

| Order | Agent | Rationale |
|-------|-------|-----------|
| 1 | ResearchAgent | Highest waste (data already in memory), existing tests |
| 2 | GraderAgent | Hints are explicit, needs new test file |
| 3 | OverviewAgent | Pages loaded, existing tests |
| 4 | SecurityAgent | Mature test suite, helper exists |
| 5 | CodeChangeAgent | Similar to Security, mature tests |
| 6 | WriterAgent | More complex, lower priority |

---

## Test Infrastructure Reference

### Running Tests

```bash
# Run all LLM tests for an agent
node --import tsx --test tests/llm/security-agent.test.ts

# Run all specialized agent tests
node --import tsx --test tests/llm/specialized-agents.test.ts
```

### Key Test Helpers

**`tests/llm/helpers/llm-assert.ts`**:
- `evaluateLLM(criteria, evidence, threshold)` - Returns score 0-10 with reasoning
- `assertLLM(criteria, evidence, threshold)` - Throws if score < threshold
- `formatEvaluationResult()` - Pretty-prints evaluation for logging

**`tests/llm/helpers/result-logger.ts`**:
- `startTestRun(model)` - Begin a new test run
- `logTestResult(name, result)` - Record a test result
- `saveTestRun()` - Persist results to JSON
- `compareRuns(id1, id2)` - Compare two runs for regressions

**`tests/llm/helpers/test-context.ts`**:
- `createLLMTestContext()` - Create test context with real LLM
- `createTestRepo(ctx, id, files)` - Create test repository with files
- `ctx.agentContext(repoId)` - Get agent execution context

### Writing New Tests

```typescript
describe('GraderAgent', () => {
  it('grades correct answer accurately', async () => {
    // Setup: Create wiki with known content
    const repoId = 'grader-test-correct';
    await createTestRepo(ctx, repoId, { 'src/auth.ts': '...' });

    // Execute: Grade a known-correct answer
    const result = await graderAgent.grade(question, correctAnswer, context);

    // Evaluate: Use LLM-as-judge
    const evalResult = await evaluateLLM(
      'The grading correctly identifies this as an accurate answer ' +
      'and provides reasoning that references the verification files.',
      JSON.stringify(result),
      7  // threshold
    );

    // Record for comparison
    logTestResult('Correct answer grading', evalResult);
  });
});
```

---

## Definition of Done

For each agent optimization:

1. **Baseline documented**: Average scores across 3+ runs recorded
2. **Tests added**: Edge cases and equivalence tests in place
3. **Implementation complete**: Agent uses pre-fetch pattern
4. **No regressions**: All tests pass, no scores dropped >1 point
5. **Performance verified**: Latency and API calls reduced
6. **Fallback works**: Edge cases handled gracefully
7. **Code reviewed**: Changes approved by team

---

## Risk Mitigation

### Context Window Limits
- Track total tokens before LLM call
- Fall back to tools if context exceeds 80% of limit
- Implement smart truncation (keep signatures, trim bodies)

### Accuracy Concerns
- Run A/B comparison before committing
- Keep tool-based path as fallback
- Monitor production quality metrics

### Gradual Rollout
- Start with ResearchAgent (lowest risk)
- Add feature flags for quick rollback
- Monitor error rates and quality scores

---

## Next Steps

1. Create `tests/llm/grader-agent.test.ts` with baseline tests
2. Run baseline measurements for all Tier 1 agents
3. Begin with ResearchAgent optimization
4. Document results and iterate
