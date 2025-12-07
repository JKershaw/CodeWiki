# LLM Test Coverage Analysis

## Executive Summary

This document analyzes the current LLM test suite for CodeWiki to assess how well it covers realistic production scenarios. The test suite uses the **LLM-as-judge** pattern, which is an excellent approach for semantic validation. However, the current tests primarily use **synthetic, simplified examples** that may not catch issues that would arise with real-world codebases.

**Key Finding:** The test suite provides a solid foundation for validating agent behavior but needs extension to cover more realistic, complex, and edge-case scenarios to ensure production reliability.

---

## Current Test Coverage

### Test Files Analyzed

| File | Agents Tested | Test Types |
|------|--------------|------------|
| `smoke.test.ts` | LLM assertion infrastructure | Infrastructure validation |
| `security-agent.test.ts` | SecurityAgent | Format compliance, SQL injection, hardcoded secrets |
| `pattern-agent.test.ts` | PatternAgent | Repository pattern, Factory pattern |
| `narrative-agent.test.ts` | NarrativeAgent | ADR detection, roadmap detection |
| `bootstrap-agent.test.ts` | BootstrapAgent | Wiki generation from README |
| `code-change-agent.test.ts` | CodeChangeAgent | Feature addition, bug fix detection |
| `dependency-agent.test.ts` | DependencyAgent | New deps, version updates |
| `technical-debt-agent.test.ts` | TechnicalDebtAgent | TODO/FIXME, complexity detection |
| `writer-agent.test.ts` | WriterAgent | Style transformation, fact preservation |
| `specialized-agents.test.ts` | SpecAgent, ResearchAgent, CodebaseExplorerAgent | Spec generation, Q&A, codebase exploration |
| `synthesis-agents.test.ts` | GettingStartedAgent, TestingGuideAgent, ProjectOverviewAgent, etc. | Guide generation |
| `meta-agents.test.ts` | ConsistencyAgent, QualityAgent, LinkAgent, StructureAgent | Wiki quality analysis |
| `integration/multi-agent.test.ts` | Multiple agents | Consistency across agents |
| `e2e/wiki-generation.test.ts` | Full pipeline | Bootstrap, incremental updates |

### What the Tests Cover Well

1. **Format Compliance** - All tests verify agents return parseable JSON with correct structure
2. **Basic Detection** - Tests verify agents detect obvious patterns (SQL injection, Repository pattern, ADRs)
3. **LLM-as-Judge** - Rich semantic evaluation with scores, reasoning, and improvement suggestions
4. **Result Logging** - Test results are saved to JSON for analysis
5. **Multi-Agent Consistency** - Tests verify agents don't contradict each other
6. **Full Pipeline** - E2E tests cover bootstrap + incremental update flow

---

## Gaps in Realistic Production Coverage

### 1. Overly Simple Test Code Examples

**Current State:** Test fixtures are small, clean, well-commented, single-purpose files.

**Production Reality:** Real codebases have:
- Large files (1000+ lines)
- Complex nested logic
- Mixed concerns in single files
- Inconsistent style and formatting
- Legacy code patterns
- Mixed TypeScript/JavaScript

**Examples of Simple Test Code:**

```typescript
// Current test: Clear, obvious SQL injection
const query = "SELECT * FROM users WHERE email = '" + email + "'";

// Production reality: Buried in 500-line file with unclear data flow
const query = buildUserQuery(opts); // Is this safe? Depends on 3 other files
```

### 2. Missing Edge Cases

| Edge Case | Production Risk | Currently Tested |
|-----------|-----------------|------------------|
| Very large diffs (10k+ lines) | Truncation issues, missed context | No |
| Binary files in commits | Parsing errors | No |
| Empty/trivial commits | False positives | No |
| Merge commits | Duplicate detection | No |
| Non-English comments/docs | Internationalization | No |
| Minified code | Parsing failures | No |
| Symlinks and special files | Path resolution | No |

### 3. No Adversarial Testing

**Missing Tests:**
- Code that looks vulnerable but is safe (false positive testing)
- Code that looks safe but is vulnerable (false negative testing)
- Intentionally confusing variable names
- Security through obscurity patterns
- Comment/string injection that could confuse analysis

### 4. Limited Language/Framework Coverage

**Current:** All tests use TypeScript/Node.js examples

**Production:** CodeWiki should handle:
- Python
- Go
- Rust
- Java
- Mixed language repos
- Framework-specific patterns (React, Django, Rails)

### 5. No Model Regression Testing

**Problem:** When model versions change or different models are used, there's no baseline to compare against.

**Missing:**
- Baseline scores for each test across model versions
- Regression alerts when scores drop
- Model comparison matrix

### 6. Missing Complex Git Scenarios

**Not Tested:**
- Merge commits with conflicts
- Commits that revert previous changes
- Commits that move/rename files
- Commits with submodule changes
- Large initial imports (vendor directories)

### 7. No Performance/Cost Testing

**Missing:**
- Tests for API timeout handling (only retry logic exists)
- Tests for rate limiting behavior
- Cost tracking per test
- Token usage validation

---

## Recommended Extensions

### Priority 1: More Realistic Code Examples

Add tests with production-like code:

```typescript
// tests/llm/fixtures/realistic-code/large-service.ts
// 500+ line file with mixed concerns, legacy patterns, etc.

// tests/llm/fixtures/realistic-code/subtle-vulnerability.ts
// Security issue buried in complex control flow
```

**Suggested New Tests:**

1. **SecurityAgent with subtle vulnerabilities**
   - SQL injection via ORM misuse
   - XSS in template engines
   - Path traversal in file uploads
   - SSRF in URL fetching

2. **PatternAgent with anti-patterns**
   - God classes
   - Circular dependencies
   - Feature envy

3. **TechnicalDebtAgent with production debt**
   - Deeply nested callbacks
   - Copy-pasted code blocks
   - Outdated API usage

### Priority 2: False Positive/Negative Testing

Add tests that specifically measure:

```typescript
describe('False Positive Prevention', () => {
  it('does NOT flag parameterized queries as SQL injection', async () => {
    // This already exists but needs expansion
  });

  it('does NOT flag escaped HTML as XSS', async () => {
    // New test needed
  });

  it('does NOT flag environment variables as hardcoded secrets', async () => {
    // New test needed
  });
});
```

### Priority 3: Multi-Language Support Tests

```typescript
describe('Python Security Analysis', () => {
  it('detects SQL injection in Python', async () => {
    // Test with cursor.execute(f"SELECT * FROM users WHERE id={user_id}")
  });
});

describe('Go Security Analysis', () => {
  it('detects SQL injection in Go', async () => {
    // Test with fmt.Sprintf("SELECT * FROM users WHERE id=%s", id)
  });
});
```

### Priority 4: Regression Testing Infrastructure

```typescript
// tests/llm/baselines/model-scores.json
{
  "claude-3-sonnet": {
    "security-sql-injection": { "minScore": 8, "avgScore": 9.2 },
    "pattern-repository": { "minScore": 7, "avgScore": 8.5 }
  },
  "qwen/qwen-turbo": {
    "security-sql-injection": { "minScore": 7, "avgScore": 8.7 }
  }
}

// Compare against baselines and alert on regression
```

### Priority 5: Stress Testing

```typescript
describe('Large Input Handling', () => {
  it('handles 10k line diff without timeout', async () => {
    // Test with massive commit
  });

  it('handles 50+ files in single commit', async () => {
    // Test with broad changes
  });
});
```

---

## Suggested New Test File Structure

```
tests/llm/
├── helpers/
│   ├── llm-assert.ts
│   ├── test-context.ts
│   └── result-logger.ts
├── fixtures/
│   ├── realistic-code/           # NEW: Production-like code samples
│   │   ├── large-service.ts
│   │   ├── legacy-api.ts
│   │   └── mixed-concerns.ts
│   ├── vulnerable-code/          # NEW: Various vulnerability patterns
│   │   ├── subtle-sqli.ts
│   │   ├── xss-templates.ts
│   │   └── ssrf-fetcher.ts
│   ├── safe-code/                # NEW: Safe patterns that look scary
│   │   ├── escaped-html.ts
│   │   ├── parameterized-orm.ts
│   │   └── env-secrets.ts
│   └── multi-language/           # NEW: Non-TypeScript examples
│       ├── python/
│       ├── go/
│       └── java/
├── regression/                   # NEW: Model regression tests
│   ├── baselines.json
│   └── regression.test.ts
├── edge-cases/                   # NEW: Edge case tests
│   ├── large-inputs.test.ts
│   ├── empty-commits.test.ts
│   └── binary-files.test.ts
├── false-positives/              # NEW: False positive tests
│   └── safe-patterns.test.ts
└── [existing test files...]
```

---

## Test Quality Metrics to Track

| Metric | Current | Target |
|--------|---------|--------|
| Average LLM Judge Score | ~8.5 | >8.0 |
| False Positive Rate | Unknown | <5% |
| False Negative Rate | Unknown | <10% |
| Test Code Realism | Low | High |
| Language Coverage | 1 (TS) | 4+ |
| Edge Case Coverage | ~20% | >80% |

---

## Immediate Action Items

1. **Create realistic code fixtures** - Extract real code patterns from open source projects
2. **Add false positive test suite** - Specifically test that safe code isn't flagged
3. **Add Python/Go test examples** - Verify multi-language support
4. **Implement baseline scoring** - Track scores across model versions
5. **Add large input tests** - Verify handling of big diffs
6. **Document expected scores** - Set minimum thresholds for CI

---

## Conclusion

The current LLM test suite provides excellent infrastructure for semantic testing with the LLM-as-judge pattern. The scoring, logging, and multi-agent tests are well-designed. However, to ensure production reliability, the tests need to:

1. Use more realistic, messy, production-like code
2. Test edge cases and adversarial inputs
3. Support multiple programming languages
4. Track regressions across model versions
5. Measure false positive/negative rates

**Recommendation:** Extend the test suite with the suggested additions before relying on it for production deployments. The current tests validate basic functionality; extended tests will validate production-readiness.
