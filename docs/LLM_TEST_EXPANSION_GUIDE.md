# LLM Test Suite Expansion Guide

## Executive Summary

Our LLM test suite has a critical gap: **tests check outcomes, not process correctness**. When agent parsing fails, the system uses silent fallbacks and produces degraded output. Tests pass because "something" is returned, giving false confidence that the system works correctly.

This guide explains the problem, documents specific issues discovered, and provides a roadmap for expanding test coverage to catch these problems.

---

## Background: Why This Guide Exists

### The Discovery

While running the `CodebaseExplorerAgent` with real LLM calls, console output revealed systematic failures:

```
[codebase-explorer] Failed to parse SUMMARY { section: 'SUMMARY', ... }
[codebase-explorer] Failed to parse FINDINGS { section: 'FINDINGS', ... }
[codebase-explorer] Failed to parse WIKI_PAGES { section: 'WIKI_PAGES', ... }
[codebase-explorer] Removing unverified path from finding: auth-service.ts
[codebase-explorer] Using prose fallback for wiki page
```

**Yet all tests passed.** The tests verified "did we get output?" rather than "did parsing succeed?"

### The Root Problem

The system has graceful degradation by design:

```
LLM returns unexpected format
    ↓
Parser fails to match expected pattern
    ↓
System logs warning (not error)
    ↓
System uses fallback (prose extraction, default values)
    ↓
Agent produces "something"
    ↓
Test checks "something exists" → PASS ✓
```

This is good for production resilience but bad for test reliability. Tests should catch when the system operates in degraded mode.

---

## Issues Discovered

### Issue 1: Format Mismatch Between Prompts and LLM Output

**Problem**: Prompts request `SECTION_NAME:` format, but LLMs often return `## SECTION_NAME` (markdown headers).

**Evidence**:
- Parser expects: `SUMMARY:\n[content]`
- LLM returns: `## SUMMARY\n[content]`
- Result: Parser fails, uses fallback

**Affected Agents**: Any agent using `parseSection()` with colon-based patterns.

**Files**:
- `src/agents/parsing/response-parser.ts` - Contains `parseSection()` and `parseSectionFlexible()`
- `src/agents/analysis/codebase-explorer-agent.ts:611-636` - Has manual fallbacks for markdown format

### Issue 2: Silent Path Removal from Findings

**Problem**: When LLMs mention file paths not verified by tool calls, those paths are silently removed.

**Evidence**:
```
[codebase-explorer] Removing unverified path from finding: auth-service.ts (verified 3 paths via tools)
```

**Impact**:
- Findings lose their file references
- Coverage tracking is degraded
- No test catches this data loss

**Files**:
- `src/agents/analysis/codebase-explorer-agent.ts:858-901` - `validateFindingPaths()` function

### Issue 3: Prose Fallback Hiding Complete Parse Failures

**Problem**: When all structured parsing fails, `extractProseContent()` salvages unstructured text.

**Evidence**:
```
[codebase-explorer] Using prose fallback for wiki page
```

**Impact**:
- Wiki pages created from unstructured prose rather than properly formatted sections
- Content quality is degraded
- Tests only check "page exists" not "page was properly structured"

**Files**:
- `src/agents/parsing/response-parser.ts:811-890` - `extractProseContent()` function
- `src/agents/analysis/codebase-explorer-agent.ts:696-710` - Prose fallback for wiki pages

### Issue 4: Default Confidence Masking Parse Failures

**Problem**: When `CONFIDENCE:` section fails to parse, a default value (0.7) is used.

**Evidence**:
```
[codebase-explorer] Using default confidence 0.7
```

**Impact**:
- Test assertions on confidence pass (0.7 is valid)
- No indication that confidence was never actually provided by LLM

**Files**:
- `src/agents/parsing/response-parser.ts:335-373` - `parseConfidence()` function

---

## Current Test Coverage Analysis

### What Tests Currently Check

| Test Type | What It Verifies | Gap |
|-----------|------------------|-----|
| Format Compliance | `result.result` exists | Doesn't check if sections parsed or used fallbacks |
| Documentation Accuracy | LLM judge on content quality | Doesn't verify parsing succeeded |
| File Reference Accuracy | % of valid file paths | Doesn't track paths silently removed |
| Tool Usage | Files were read | Doesn't verify findings kept their paths |

### What Tests Should Also Check

1. **Parsing Success Rate**: How many sections parsed successfully vs. used fallbacks
2. **Fallback Triggers**: Assert that no fallbacks were triggered (or count them)
3. **Data Completeness**: Findings should retain their file paths after validation
4. **Format Compliance (Strict)**: LLM output should match expected format without fallbacks

---

## Test Expansion Roadmap

### Phase 1: Add Parsing Health Metrics

**Goal**: Make parsing success/failure observable in tests.

**Changes Required**:

1. **Modify `ParseContext` to track fallback usage** (`src/agents/parsing/response-parser.ts`)
   - Add `fallbacksUsed: string[]` to `ParseContext`
   - Update `parseSectionFlexible()` to record when markdown fallback is used
   - Update `parseConfidence()` to record when default is used

2. **Expose parse stats from agents**
   - Agents should return `parseStats` alongside results
   - `parseStats` should include: sections attempted, sections succeeded, fallbacks used

3. **Add test helper to assert no fallbacks**
   ```
   tests/llm/helpers/parse-assert.ts
   - assertNoFallbacks(parseStats)
   - assertParseSuccess(parseStats, requiredSections)
   ```

### Phase 2: Add Strict Format Compliance Tests

**Goal**: Verify LLM output matches expected format without relying on fallbacks.

**New Test File**: `tests/llm/format-compliance.test.ts`

**Tests to Add**:

| Test Name | Purpose |
|-----------|---------|
| `SUMMARY section uses colon format` | LLM returns `SUMMARY:` not `## SUMMARY` |
| `FINDINGS section is properly formatted` | Items match expected pipe-separated format |
| `WIKI_PAGES uses === delimiters` | Pages use `=== path: X ===` format |
| `CONFIDENCE is explicitly provided` | Not using default value |

**Implementation Approach**:
- Run agent with real LLM
- Check `parseStats.fallbacksUsed.length === 0`
- If fallbacks were needed, test fails with details about which sections needed fallbacks

### Phase 3: Track Silently Removed Data

**Goal**: Make path removal from findings observable and testable.

**Changes Required**:

1. **Return removed paths alongside validated findings** (`codebase-explorer-agent.ts`)
   - `validateFindingPaths()` should return `{ findings, removedPaths }`
   - Agent result should include `removedPaths` for test inspection

2. **Add test assertions for path retention**
   - `assertNoPathsRemoved(result)` - Strict: no paths should be removed
   - `assertPathRemovalRate(result, maxRate)` - Soft: allow some removal but track rate

**New Tests**:

| Test Name | Purpose |
|-----------|---------|
| `findings retain file paths after validation` | Paths in findings match paths from tool calls |
| `path removal rate is below threshold` | Track degradation over time |

### Phase 4: Add Degradation Tracking

**Goal**: Even when allowing degraded operation, track and trend degradation metrics.

**New File**: `tests/llm/helpers/degradation-tracker.ts`

**Metrics to Track**:
- Fallback usage rate per section type
- Path removal rate
- Prose extraction usage rate
- Default confidence usage rate

**Test Results Should Include**:
```json
{
  "degradation": {
    "summaryFallbacks": 2,
    "findingsFallbacks": 1,
    "confidenceDefaults": 3,
    "pathsRemoved": 15,
    "proseExtractions": 1
  }
}
```

This enables trend analysis: "Degradation is increasing after prompt change X"

---

## Implementation Priority

### Immediate (Before Next Feature Work)

1. Add `fallbacksUsed` tracking to `ParseContext`
2. Add one test that asserts `fallbacksUsed.length === 0`
3. Run test suite - **expect many failures** (this is correct!)
4. Document baseline degradation rate

### Short-Term (Next Sprint)

1. Investigate why LLMs return markdown format instead of colon format
2. Either fix prompts or update parsers to expect markdown
3. Reduce fallback usage to near-zero
4. Add path retention tests

### Medium-Term (Ongoing)

1. Track degradation metrics over time
2. Add degradation regression alerts
3. Establish thresholds for acceptable degradation

---

## Files to Modify

### Core Parsing (`src/agents/parsing/response-parser.ts`)

| Function | Change Needed |
|----------|---------------|
| `ParseContext` interface | Add `fallbacksUsed: string[]` |
| `parseSection()` | Record fallback when default used |
| `parseSectionFlexible()` | Record which fallback pattern matched |
| `parseConfidence()` | Record when default used |
| `getParseStats()` | Include fallback stats |

### Codebase Explorer Agent (`src/agents/analysis/codebase-explorer-agent.ts`)

| Location | Change Needed |
|----------|---------------|
| `parseResponse()` | Return parse stats |
| `validateFindingPaths()` | Return removed paths |
| `run()` / `runWithPrefetch()` | Include parse stats in result |

### Test Helpers (`tests/llm/helpers/`)

| File | Create/Modify |
|------|---------------|
| `parse-assert.ts` | NEW: Assertions for parsing success |
| `degradation-tracker.ts` | NEW: Track degradation metrics |
| `result-logger.ts` | MODIFY: Include degradation in logs |

### Test Files (`tests/llm/`)

| File | Changes |
|------|---------|
| `format-compliance.test.ts` | NEW: Strict format tests |
| `codebase-explorer-agent.test.ts` | Add parsing assertions |
| All agent test files | Add `assertNoFallbacks()` calls |

---

## Expected Initial State

When you first add strict parsing tests, **expect them to fail**. This is correct behavior - we're exposing hidden problems.

### Likely Findings

1. **SUMMARY parsing**: ~50% fallback to markdown format
2. **FINDINGS parsing**: ~30% format mismatches
3. **CONFIDENCE parsing**: ~20% using default
4. **Path retention**: ~30% of paths removed from findings

### What "Success" Looks Like

After improvements:
- Fallback rate < 5%
- Path retention > 95%
- All format compliance tests pass

---

## Iterative Improvement Process

### Step 1: Establish Baseline

1. Add parsing metrics to tests
2. Run full LLM test suite
3. Document current rates:
   - Fallback usage per section
   - Path removal rate
   - Default value usage

### Step 2: Identify Root Causes

For each high-fallback section:
1. Examine actual LLM output (logged in test)
2. Compare to expected format in prompt
3. Identify mismatch

### Step 3: Fix Prompts or Parsers

Two approaches:
- **Fix prompts**: Make format instructions clearer/stricter
- **Fix parsers**: Update expected patterns to match LLM tendencies

Usually a combination works best.

### Step 4: Verify Improvement

1. Re-run tests
2. Compare metrics to baseline
3. Fallback rate should decrease

### Step 5: Tighten Thresholds

Once baseline is good:
1. Add strict assertions (no fallbacks allowed)
2. Tests become regression protection

---

## Quick Start for Developers

### Running Current Tests

```bash
# Set API key
source .env

# Run all LLM tests
node --import tsx --test tests/llm/*.test.ts

# Run specific agent test
node --import tsx --test tests/llm/codebase-explorer-agent.test.ts
```

### Adding Parsing Health Checks

After modifying `response-parser.ts` to track fallbacks:

```typescript
// In your test
const result = await agent.run(target, ctx);

// Check parsing health
const parseStats = result.parseStats;
assert.strictEqual(parseStats.fallbacksUsed.length, 0,
  `Fallbacks were used: ${parseStats.fallbacksUsed.join(', ')}`);
```

### Debugging Parse Failures

When a test fails due to fallbacks:

1. Check test output for logged warnings
2. Look for `[agent-name] Failed to parse X` messages
3. Examine `responsePreview` in the log to see what LLM actually returned
4. Compare to expected format in agent's prompt

---

## Reference: Current Test File Locations

```
tests/
└── llm/
    ├── helpers/
    │   ├── llm-assert.ts           # LLM-as-judge assertions
    │   ├── result-logger.ts        # Test result logging
    │   ├── test-context.ts         # Test setup helpers
    │   └── file-reference-validator.ts  # File path validation
    ├── codebase-explorer-agent.test.ts  # Main focus for expansion
    ├── security-agent.test.ts
    ├── pattern-agent.test.ts
    ├── narrative-agent.test.ts
    ├── bootstrap-agent.test.ts
    └── [other agent tests]
```

---

## Summary

Our LLM tests have a blind spot: they verify outcomes exist but not that the process worked correctly. By adding parsing health metrics and strict format assertions, we can catch degradation before it affects users.

The key insight is that **silent fallbacks are technical debt in tests**. They help production resilience but hide problems from tests. Making fallback usage observable and testable closes this gap.

Start by adding metrics, establish a baseline, then iteratively improve until strict assertions pass.
