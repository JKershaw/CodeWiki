# Real LLM Testing Strategy

## Overview

Our current test suite uses mock LLM services, which effectively test code logic, parsing, and integration—but they cannot validate that our prompts work correctly with real LLMs. This document outlines a strategy for a new test class that uses real LLM calls to catch prompt and model compatibility issues.

## The Testing Gap

### What Mock Tests Catch
- Parsing logic errors (regex, data extraction)
- Data flow bugs (agent → wiki updater)
- Integration issues (component wiring)
- Type errors and business logic

### What Mock Tests Miss
- **Prompt effectiveness**: Does the LLM understand what we're asking?
- **Format compliance**: Does the LLM return parseable output?
- **Model compatibility**: Do prompts work across different models?
- **Detection accuracy**: Does the agent actually find the issues it should?
- **False positives**: Does the agent flag things incorrectly?
- **Edge cases**: Partial responses, unexpected formats, hallucinations

## Test Classification

```
tests/
├── unit/           # Pure logic, no I/O, mocked dependencies
├── integration/    # Component interaction, mocked LLM
├── e2e/            # Full system, mocked LLM, browser automation
└── llm/            # Real LLM calls, LLM-as-judge assertions  ← NEW
```

## LLM-as-Judge Pattern

For semantic assertions where exact string matching isn't possible, we use an LLM call to evaluate correctness. Rather than simple YES/NO, we get rich diagnostic feedback.

### Evaluation Result Structure

```typescript
interface EvaluationResult {
  score: number;          // 0-10 scale
  passed: boolean;        // score >= threshold
  reasoning: string;      // Why this score was given
  improvements: string[]; // What could make this better
}
```

### Implementation

```typescript
// tests/helpers/llm-assert.ts
async function evaluateLLM(
  criteria: string,
  evidence: string,
  threshold: number = 7
): Promise<EvaluationResult> {
  const response = await llm.complete([{
    role: 'user',
    content: `Evaluate the following output against the given criteria.

Criteria: ${criteria}

Evidence:
${evidence}

Respond in this exact JSON format:
{
  "score": <0-10>,
  "reasoning": "<why you gave this score>",
  "improvements": ["<suggestion 1>", "<suggestion 2>"]
}

Be specific in your reasoning. A score of 7+ means the criteria is met.`
  }]);

  const result = JSON.parse(response.content);
  return {
    ...result,
    passed: result.score >= threshold
  };
}

// Convenience wrapper that throws on failure
async function assertLLM(
  criteria: string,
  evidence: string,
  threshold: number = 7
): Promise<EvaluationResult> {
  const result = await evaluateLLM(criteria, evidence, threshold);

  if (!result.passed) {
    throw new AssertionError(
      `LLM assertion failed (score: ${result.score}/10, threshold: ${threshold})\n` +
      `Criteria: ${criteria}\n` +
      `Reasoning: ${result.reasoning}\n` +
      `Improvements: ${result.improvements.join(', ')}`
    );
  }

  return result; // Return for logging even on success
}
```

### Benefits of Rich Evaluation

| Aspect | Simple YES/NO | Scored Evaluation |
|--------|---------------|-------------------|
| **Debugging failures** | "It failed" | "Score 4/10 because X, Y, Z" |
| **Near-misses** | Hidden | "Score 6/10 - almost passing" |
| **Quality trends** | Not tracked | Can track score over time |
| **Improvement hints** | None | Specific suggestions |
| **Threshold tuning** | Binary | Adjust threshold per test |

### Example Test Output

```
✓ SecurityAgent detects SQL injection
  Score: 9/10
  Reasoning: Correctly identified SQL injection vulnerability in db.ts:15.
             Accurately described the concatenation-based query construction.
             Severity rating of HIGH is appropriate.
  Improvements:
    - Could mention specific remediation (parameterized queries)
    - Could reference OWASP SQL injection guidelines

✗ SecurityAgent ignores safe code
  Score: 4/10 (threshold: 7)
  Reasoning: Flagged the parameterized query as potential SQL injection.
             While it mentioned the query uses parameters, it still raised
             a LOW severity finding.
  Improvements:
    - Should recognize parameterized queries as safe pattern
    - Should not create findings for properly secured code
```

### Threshold Guidelines

| Test Type | Suggested Threshold | Rationale |
|-----------|---------------------|-----------|
| Detection (must find) | 7 | Some flexibility in description |
| False positive (must not find) | 8 | Higher bar for avoiding noise |
| Content quality | 6 | More subjective, allow variation |
| Format compliance | 9 | Should be nearly perfect |

## Test Categories Within LLM Suite

### Unit (Single Agent Calls)
Test individual agents with real LLM to verify:
- Response format is parseable
- Agent detects what it should detect
- Agent doesn't false-positive on clean inputs

### Integration (Multi-Agent Flows)
Test agent combinations:
- Analysis → Consolidation flow
- Multiple analysis agents on same commit
- Consistency agent reviewing generated content

### End-to-End (Full Wiki Build)
Test complete wiki generation:
- Bootstrap a wiki from scratch
- Process commits and update wiki
- Verify wiki is coherent and accurate

## Execution Model

- **Manual execution**: Run on-demand to save costs
- **Command**: `npm run test:llm` (when implemented)
- **Timeout**: 60+ seconds per test (LLM calls are slow)
- **Parallelism**: Limited to avoid rate limits
- **Retries**: Allow 1 retry for transient failures

## Cost Considerations

| Role | Model Choice | Rationale |
|------|--------------|-----------|
| Agent under test | Production model | Test real behavior |
| LLM-as-judge | Cheaper model (e.g., Haiku) | JSON eval is simple task |

### Logging Evaluations

Even passing tests produce valuable data. Consider logging all evaluations:

```typescript
// tests/llm/results/2024-01-15-run.json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "model": "claude-3-sonnet",
  "tests": [
    {
      "name": "SecurityAgent detects SQL injection",
      "passed": true,
      "score": 9,
      "reasoning": "...",
      "improvements": ["..."]
    }
  ],
  "summary": {
    "total": 12,
    "passed": 11,
    "avgScore": 8.2
  }
}
```

This enables:
- Tracking quality trends over time
- Comparing scores across model versions
- Identifying consistently low-scoring tests for prompt improvement

---

## Test Plan: First Tests to Implement

### Priority 1: Format Compliance (Foundation)

Before testing accuracy, we must verify responses are parseable. These tests don't need LLM-as-judge—just check that parsing succeeds.

#### Test 1.1: SecurityAgent Format Compliance
- **Category**: Unit
- **Priority**: Critical
- **Purpose**: Verify SecurityAgent returns parseable response
- **Setup**: Repo with any TypeScript file
- **Assert**:
  - `result.result` exists (parsing succeeded)
  - `result.result.confidence` is a number between 0-1
  - `result.result.findings` is an array
- **No LLM judge needed**: Pure format verification

#### Test 1.2: PatternAgent Format Compliance
- **Category**: Unit
- **Priority**: Critical
- **Purpose**: Verify PatternAgent returns parseable response
- **Assert**: Same structure checks as above

#### Test 1.3: NarrativeAgent Format Compliance
- **Category**: Unit
- **Priority**: Critical
- **Purpose**: Verify NarrativeAgent returns parseable response
- **Assert**: Same structure checks as above

#### Test 1.4: BootstrapAgent Format Compliance
- **Category**: Unit
- **Priority**: Critical
- **Purpose**: Verify BootstrapAgent generates parseable wiki content
- **Setup**: Empty wiki, repo with README
- **Assert**:
  - `result.updates` is an array with length > 0
  - Each update has valid `pagePath` and `content`

### Priority 2: Detection Accuracy (Core Value)

These tests verify agents find what they should. Uses LLM-as-judge.

#### Test 2.1: SecurityAgent Detects SQL Injection
- **Category**: Unit
- **Priority**: High
- **Purpose**: Verify security detection works
- **Setup**: Repo with obvious SQL injection:
  ```typescript
  db.query("SELECT * FROM users WHERE id = " + id);
  ```
- **Assert (deterministic)**: At least one finding exists
- **Assert (LLM judge)**: "The analysis identifies a SQL injection vulnerability"

#### Test 2.2: SecurityAgent Ignores Safe Code
- **Category**: Unit
- **Priority**: High
- **Purpose**: Verify no false positives on safe patterns
- **Setup**: Repo with parameterized query:
  ```typescript
  db.query("SELECT * FROM users WHERE id = ?", [id]);
  ```
- **Assert (LLM judge)**: "The analysis does NOT flag this as SQL injection"

#### Test 2.3: PatternAgent Detects Repository Pattern
- **Category**: Unit
- **Priority**: High
- **Purpose**: Verify pattern detection works
- **Setup**: Repo with clear repository pattern implementation
- **Assert (deterministic)**: At least one finding
- **Assert (LLM judge)**: "The analysis identifies a repository pattern"

#### Test 2.4: NarrativeAgent Detects ADR
- **Category**: Unit
- **Priority**: High
- **Purpose**: Verify ADR detection works
- **Setup**: Repo with `docs/adr/001-use-postgres.md` containing decision record
- **Assert (deterministic)**: Finding exists with narrative_type
- **Assert (LLM judge)**: "The analysis identifies an Architecture Decision Record"

### Priority 3: Synthesis Quality (Wiki Content)

Verify generated wiki content is useful and accurate.

#### Test 3.1: BootstrapAgent Creates Coherent Overview
- **Category**: Unit
- **Priority**: High
- **Purpose**: Verify bootstrap creates useful wiki
- **Setup**: Repo with README, package.json, src/ structure
- **Assert (deterministic)**: Overview page created
- **Assert (LLM judge)**: "The generated overview accurately describes the project based on the README"

#### Test 3.2: WriterAgent Updates Are Relevant
- **Category**: Unit
- **Priority**: Medium
- **Purpose**: Verify writer creates relevant content from findings
- **Setup**: Provide findings about authentication changes
- **Assert (LLM judge)**: "The wiki update accurately reflects the authentication changes described in the findings"

### Priority 4: Integration Flows

#### Test 4.1: Analysis → Consolidation Flow
- **Category**: Integration
- **Priority**: Medium
- **Purpose**: Verify findings flow through consolidation correctly
- **Setup**: Run SecurityAgent, feed results to ConsolidationAgent
- **Assert**: Consolidated output maintains key information from analysis

#### Test 4.2: Multi-Agent Analysis Consistency
- **Category**: Integration
- **Priority**: Medium
- **Purpose**: Verify multiple agents don't contradict
- **Setup**: Run Security + Pattern + Narrative on same commit
- **Assert (LLM judge)**: "The analyses from different agents are consistent and don't contradict each other"

### Priority 5: End-to-End Wiki Build

#### Test 5.1: Bootstrap Fresh Wiki
- **Category**: E2E
- **Priority**: Medium
- **Purpose**: Full wiki bootstrap works
- **Setup**: Real repo (could use CodeWiki itself)
- **Assert (deterministic)**:
  - Wiki has overview page
  - Wiki has table of contents
  - No broken internal links
- **Assert (LLM judge)**: "The generated wiki provides a useful overview of the project"

#### Test 5.2: Process Commit and Update Wiki
- **Category**: E2E
- **Priority**: Lower (complex setup)
- **Purpose**: Incremental updates work
- **Setup**: Bootstrapped wiki, then new commit
- **Assert**: Wiki updated to reflect commit changes

---

## Implementation Guide

Follow these steps in order. Each step validates the previous before moving on.

### Step 1: Smoke Test the Assertion Infrastructure

**Goal**: Confirm `evaluateLLM` and `assertLLM` work before writing any real tests.

```
tests/
└── llm/
    ├── helpers/
    │   └── llm-assert.ts      ← Create this first
    └── smoke.test.ts          ← Minimal test to validate helpers
```

**Tasks**:
1. Create `tests/llm/helpers/llm-assert.ts` with `evaluateLLM` and `assertLLM` functions
2. Create `tests/llm/smoke.test.ts`:
   ```typescript
   it('evaluateLLM returns valid score structure', async () => {
     const result = await evaluateLLM(
       'The text mentions a greeting',
       'Hello, world!'
     );
     assert.ok(typeof result.score === 'number');
     assert.ok(result.score >= 0 && result.score <= 10);
     assert.ok(typeof result.reasoning === 'string');
     assert.ok(Array.isArray(result.improvements));
   });

   it('assertLLM passes for true claims', async () => {
     await assertLLM('The text contains a greeting', 'Hello there!');
   });

   it('assertLLM fails for false claims', async () => {
     await assert.rejects(
       () => assertLLM('The text mentions elephants', 'Hello there!'),
       /LLM assertion failed/
     );
   });
   ```
3. Run: `node --import tsx --test tests/llm/smoke.test.ts`
4. **Must pass before proceeding**

### Step 2: One Real Unit Test

**Goal**: Validate the full flow with one actual agent test.

**Tasks**:
1. Create `tests/llm/security-agent.test.ts`
2. Implement just Test 2.1 (SQL injection detection):
   ```typescript
   it('detects SQL injection in vulnerable code', async () => {
     // Setup repo with vulnerable code
     // Run SecurityAgent with real LLM
     // Assert format (deterministic)
     // Assert detection (LLM judge)
   });
   ```
3. Run it, observe output
4. **Validates**: Agent → LLM → Parse → Assert flow works end-to-end

### Step 3: Test Output & Reporting

**Goal**: Ensure test output is useful before scaling up.

**Tasks**:
1. Verify passing test shows: score, reasoning, improvements
2. Verify failing test shows: why it failed, what threshold was missed
3. Add result logging (optional but recommended):
   ```typescript
   // tests/llm/helpers/result-logger.ts
   function logResult(testName: string, result: EvaluationResult) {
     // Append to tests/llm/results/<date>.json
   }
   ```
4. Run the security test a few times, check logs make sense
5. **Must be debuggable before adding more tests**

### Step 4: Add All Unit Tests

Now confident the infrastructure works, add remaining tests:

```
tests/llm/
├── helpers/
│   ├── llm-assert.ts
│   └── result-logger.ts
├── smoke.test.ts              ✓ Done
├── security-agent.test.ts     ✓ Done (one test)
├── pattern-agent.test.ts      ← Add
├── narrative-agent.test.ts    ← Add
└── bootstrap-agent.test.ts    ← Add
```

**Order within each file**:
1. Format compliance test first (no LLM judge needed)
2. Detection/quality tests second (with LLM judge)
3. False positive tests last

**After completing unit tests**:
- Run full suite: `npm run test:llm`
- Review scores across all tests
- Identify any agents consistently scoring low (prompt improvement candidates)

### Step 5: Integration & E2E (Later)

Only after unit tests are stable:
- Add integration tests (multi-agent flows)
- Add E2E tests (full wiki generation)

---

## Quick Reference: File Structure

```
tests/llm/
├── helpers/
│   ├── llm-assert.ts          # evaluateLLM, assertLLM
│   ├── result-logger.ts       # Optional: log results to JSON
│   └── test-repos.ts          # Helper to create test repositories
├── results/                   # Gitignored, stores run logs
│   └── 2024-01-15-run.json
├── smoke.test.ts              # Infrastructure validation
├── security-agent.test.ts     # SecurityAgent tests
├── pattern-agent.test.ts      # PatternAgent tests
├── narrative-agent.test.ts    # NarrativeAgent tests
├── bootstrap-agent.test.ts    # BootstrapAgent tests
└── integration/               # Later: multi-agent tests
    └── analysis-flow.test.ts
```

---

## Success Criteria

A test suite is "complete enough" when:
1. All format compliance tests pass (agents return parseable output)
2. Core detection tests pass (agents find obvious issues)
3. No regressions when switching models or updating prompts

## Running Tests Manually

Until automated:
```bash
# Set API key
export OPENROUTER_API_KEY=your-key

# Run all LLM tests
npm run test:llm

# Run specific test file
node --import tsx --test tests/llm/security-agent.test.ts
```

## Future Considerations

- **CI Integration**: Run on PR to main (with cost budget)
- **Model Matrix**: Test across Claude, GPT-4, etc.
- **Regression Detection**: Alert when pass rate drops
- **Cost Tracking**: Log API costs per test run
