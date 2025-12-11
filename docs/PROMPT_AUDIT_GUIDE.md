# Prompt Audit Guide

This document covers how to review and improve agent prompts for better model compatibility, particularly with smaller or less capable LLMs.

## Overview

CodeWiki uses ~42 prompts across 25+ agents. When prompts become too complex, simpler models (like `meta-llama/llama-4-maverick`) struggle to follow instructions correctly, leading to:

- Parse failures (model outputs narrative instead of structured data)
- Tool call failures (model describes actions instead of calling tools)
- Format violations (model ignores output format requirements)
- Instruction overload (model forgets earlier rules when given too many)

## Running the Prompt Audit

```bash
npx tsx scripts/audit-prompts.ts
```

This produces two reports:

1. **Static Analysis** - Scans source code for all `*PROMPT*` variable definitions
2. **Runtime Analysis** - Uses the agent registry to verify exposed prompts

### Understanding the Output

```
PROMPTS BY COMPLEXITY SCORE (highest first):
----------------------------------------------------------------------------------------------------
Variable Name                   Score  Sects  Lists  Code  Cond  Neg  Emph  Verbs  AvgSnt  Location
----------------------------------------------------------------------------------------------------
ORCHESTRATOR_SYSTEM_PROMPT        122     10     30     0    10    2     4      8      12  src/agents/...
SYSTEM_PROMPT                     122      9     39     0     4    6     1     11      20  src/agents/...
```

**Column definitions:**

| Column | Meaning | Why it matters |
|--------|---------|----------------|
| Score | Weighted complexity score | Higher = harder for models to follow |
| Sects | Markdown sections (## headers) | More sections = more context switching |
| Lists | Bullet/numbered list items | Long lists overwhelm attention |
| Code | Fenced code blocks | Generally fine, can help clarity |
| Cond | Conditionals (if/when/unless) | Branching logic confuses models |
| Neg | Negations (don't/never/avoid) | Models often miss or invert negations |
| Emph | Emphasis markers (MUST/REQUIRED) | Too many "critical" rules dilute importance |
| Verbs | Imperative verbs | High count = many instructions |
| AvgSnt | Average sentence length | Longer sentences = harder to parse |

## Complexity Score Formula

```typescript
complexityScore =
  (sections * 2) +
  (listItems * 1) +
  (codeBlocks * 3) +
  (conditionals * 4) +      // High weight: branching is hard
  (negations * 5) +         // Highest weight: negations often fail
  (emphasisMarkers * 3) +
  (imperativeVerbs * 0.5) +
  (avgSentenceLength * 0.5)
```

**Thresholds:**
- Score < 50: Low complexity, should work with most models
- Score 50-100: Medium complexity, may need testing with target model
- Score > 100: High complexity, likely to cause issues with simpler models

## What to Look For

### 1. Negation Overload

**Problem:** Models struggle with negations, especially multiple or nested ones.

```
❌ Bad: "Do NOT skip the tool calls. NEVER output text without first calling tools.
        Don't assume file contents. Avoid guessing."

✅ Better: "Always call tools first, then output text."
```

**Why it fails:** Each negation requires the model to mentally invert an action. Multiple negations compound confusion.

### 2. Emphasis Fatigue

**Problem:** When everything is CRITICAL/MUST/REQUIRED, nothing stands out.

```
❌ Bad: "You MUST use tools. This is CRITICAL. NEVER skip this step.
        It's IMPORTANT to ALWAYS verify. REQUIRED: output format."

✅ Better: "Use tools before generating output. Format: [specify format]"
```

**Why it fails:** Emphasis markers compete for attention. The model may randomly prioritize one over another.

### 3. Conditional Branching

**Problem:** Complex if/when/unless chains create decision trees models can't follow.

```
❌ Bad: "If the file exists, read it. Unless it's binary, in which case skip it.
        When you find imports, follow them—unless they're circular. Otherwise,
        if the directory is empty, report that instead."

✅ Better: "Read text files. Skip binary files. List imports found."
```

**Why it fails:** Models process sequentially; they lose track of which branch they're in.

### 4. List Overload

**Problem:** Lists with 30+ items exceed working memory.

```
❌ Bad: A single list with 45 bullet points

✅ Better: Group into 3-5 categories with 5-8 items each, or prioritize top 10
```

### 5. Section Sprawl

**Problem:** 10+ sections fragment instructions across too many contexts.

```
❌ Bad: 12 different ## sections, each with its own rules

✅ Better: Consolidate to 3-4 essential sections
```

## Best Practices for Prompt Writing

### 1. Prefer Positive Instructions

```
❌ "Don't output anything before calling tools"
✅ "Call tools first, then output your analysis"
```

### 2. Front-Load Critical Information

Put the most important instruction first. Models pay more attention to the beginning.

```
✅ "Your FIRST action must be calling list_directory. After exploring..."
```

### 3. Use Concrete Examples

Examples are more reliable than abstract rules.

```
✅ "Output format:
   SUMMARY: One sentence overview
   FINDINGS: Bullet list of discoveries

   Example:
   SUMMARY: This module handles user authentication.
   FINDINGS:
   - Uses JWT tokens for session management
   - Implements rate limiting"
```

### 4. Reduce Redundancy

Don't say the same thing three different ways.

```
❌ "Use tools. You must use tools. Tools are required. Never skip tools."
✅ "Use tools before generating any output."
```

### 5. Keep PREFETCH Variants Simple

PREFETCH prompts (used when context is pre-loaded) don't need tool instructions. They should be significantly simpler than their tool-based counterparts.

Compare:
- `SYSTEM_PROMPT`: 112 complexity (needs tool instructions)
- `SYSTEM_PROMPT_PREFETCH`: 36 complexity (context pre-loaded)

## Verifying Changes with LLM Tests

After modifying prompts, run the LLM test suite to catch regressions:

```bash
# Run all LLM tests
node --import tsx --test tests/llm/*.test.ts

# Run specific agent test
node --import tsx --test tests/llm/security-agent.test.ts
```

### What LLM Tests Validate

The tests use real LLM calls with an "LLM-as-judge" pattern:

1. **Format compliance**: Does output match expected structure?
2. **Semantic accuracy**: Does the agent find what it should?
3. **No hallucination**: Are claims grounded in actual code?
4. **Tool usage**: Does the agent use tools appropriately?

### Test Configuration

LLM tests use `qwen/qwen-turbo` by default (cheap, fast) but can be configured:

```bash
# Test with a specific model
OPENROUTER_MODEL=meta-llama/llama-4-maverick node --import tsx --test tests/llm/*.test.ts
```

### Adding Tests for Prompt Changes

When simplifying a prompt, add test cases that verify the simplified version still works:

```typescript
// tests/llm/codebase-explorer-agent.test.ts
it('produces valid wiki content with simplified prompt', async () => {
  const result = await agent.run(target, context);

  // Verify structure
  assert.ok(result.updates.length > 0, 'Should produce wiki pages');

  // Use LLM-as-judge for semantic validation
  const evaluation = await evaluateLLM(
    'Documentation accurately describes the code structure',
    result.updates[0].content
  );
  assert.ok(evaluation.passed, evaluation.reasoning);
});
```

## Iterative Improvement Process

1. **Audit**: Run `npx tsx scripts/audit-prompts.ts`
2. **Identify**: Find prompts with score > 100 or specific high-risk factors
3. **Simplify**: Reduce negations, consolidate sections, trim lists
4. **Test**: Run LLM tests with target model
5. **Measure**: Re-run audit to verify complexity reduced
6. **Validate**: Run full system test to check end-to-end behavior

## Common Patterns That Work

### Tool-Based Agents

```
You are a [role]. Use the provided tools to [objective].

## Tools
- tool_name: description

## Process
1. First, call [tool] to [purpose]
2. Then, call [tool] to [purpose]
3. Finally, output your analysis

## Output Format
[Exact format with example]
```

### PREFETCH Agents (No Tools)

```
You are a [role]. The code has been provided below.

## Your Task
[Single clear objective]

## Output Format
[Exact format with example]
```

## Reference: Current High-Complexity Prompts

As of the last audit, these prompts exceed the 100-point threshold:

| Agent | Score | Primary Issues |
|-------|-------|----------------|
| orchestrator | 122 | 10 conditionals, 30 list items |
| technical-debt | 122 | 6 negations, 39 list items |
| writer | 119 | 8 negations, 30 list items |
| codebase-explorer | 112 | 10 emphasis markers, 24 list items |
| pattern | 111 | 45 list items |
| wiki-editor | 109 | 10 conditionals, 29 list items |
| code-change | 104 | 6 negations, 6 conditionals |
| writer (PREFETCH) | 104 | 9 negations |

These are candidates for simplification when improving model compatibility.

## Further Reading

- [REAL_LLM_TESTING_STRATEGY.md](./REAL_LLM_TESTING_STRATEGY.md) - Full LLM testing approach
- [ITERATIVE_IMPROVEMENT_GUIDE.md](./ITERATIVE_IMPROVEMENT_GUIDE.md) - Discovery and fix workflow
- [CLAUDE.md](../CLAUDE.md) - Project development guidelines
