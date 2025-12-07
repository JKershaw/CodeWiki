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

For semantic assertions where exact string matching isn't possible, we use a simple LLM call to judge correctness:

```typescript
// tests/helpers/llm-assert.ts
async function assertLLM(
  claim: string,
  evidence: string
): Promise<void> {
  const response = await llm.complete([{
    role: 'user',
    content: `Based on this evidence, answer only YES or NO.

Evidence:
${evidence}

Claim: ${claim}

Answer:`
  }]);

  const answer = response.content.trim().toUpperCase();
  if (!answer.startsWith('YES')) {
    throw new AssertionError(`LLM assertion failed: ${claim}`);
  }
}
```

This keeps assertions simple (pass/fail) while handling the semantic nature of LLM outputs.

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
| LLM-as-judge | Cheaper model (e.g., Haiku) | Just yes/no判定 |

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

## Implementation Order

```
Phase 1: Foundation
├── Test infrastructure (llm-assert helper, test config)
├── Test 1.1: SecurityAgent format
├── Test 1.2: PatternAgent format
├── Test 1.3: NarrativeAgent format
└── Test 1.4: BootstrapAgent format

Phase 2: Core Detection
├── Test 2.1: SQL injection detection
├── Test 2.2: Safe code (no false positive)
├── Test 2.3: Repository pattern detection
└── Test 2.4: ADR detection

Phase 3: Synthesis
├── Test 3.1: Bootstrap overview quality
└── Test 3.2: Writer relevance

Phase 4: Integration
├── Test 4.1: Analysis → Consolidation
└── Test 4.2: Multi-agent consistency

Phase 5: E2E
├── Test 5.1: Fresh wiki bootstrap
└── Test 5.2: Incremental updates
```

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
