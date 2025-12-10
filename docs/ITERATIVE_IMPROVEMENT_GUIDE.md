# CodeWiki Iterative Improvement Guide

You are improving CodeWiki, a system that generates living wikis from Git repositories using multiple specialized LLM agents. Your goal is to systematically find and fix issues preventing reliable wiki generation across different LLM models.

## Your Mission

Iteratively improve the system by:
1. Running the system to discover real-world failures
2. Analyzing the rich diagnostic data from runs
3. Diagnosing root causes (code, prompt, architecture, or combination)
4. Adding tests to capture the issues
5. Implementing fixes following best practices
6. Verifying improvements

## Environment Setup

```bash
cd /home/user/CodeWiki
npm install
```

Environment variables are configured in `.env` - no need to pass them inline.

## Phase 1: Discovery - Run the System

Run CodeWiki against a test repository:

```bash
npm run dev -- \
  --repo https://github.com/JKershaw/CursorMCPBridge \
  --iterations 50 \
  --verbose 2>&1 | tee run-output.log
```

## Phase 2: Analyze Run Data

The system produces rich diagnostic data. Check:

**Console output patterns:**
- `[agent-name] Parse failed` - Parser couldn't handle LLM output
- `[agent-name] Parse stats: X ok, Y failed` - Partial parse success
- `0 links produced`, `0 patterns found` - Empty results
- Agent-specific warnings and info logs

**Data directory (`.codewiki-data/`):**
- SQLite database with agent runs, findings, wiki pages
- Use SQL queries to analyze patterns across runs
- Check confidence scores, page content quality

**Log analysis:**
```bash
# Count parse failures by agent
grep -o '\[[a-z-]*\] Parse failed' run-output.log | sort | uniq -c

# Find empty output warnings
grep -E '0 (links|patterns|findings|pages)' run-output.log

# Check agent completion rates
grep -E '\[.*\] (completed|failed)' run-output.log
```

## Phase 3: Diagnosis - Understand the Root Cause

For each issue found, determine the root cause category:

**A. Prompt Issue** - LLM doesn't understand what format to output
- Symptoms: LLM outputs valid content but wrong structure
- Check: Read the agent's prompt (look for `buildPrompt` or `SYSTEM_PROMPT`)
- Solution: Add concrete examples showing exact expected format ("Show, Don't Just Tell")

**B. Parser Issue** - Parser too rigid for LLM output variations
- Symptoms: Content looks correct but regex doesn't match
- Check: Read `parseResponse()` and compare to actual LLM output in logs
- Solution: Add fallback patterns to handle format variations

**C. Architecture Issue** - Fundamental design problem
- Symptoms: Agent can't succeed regardless of prompt/parser
- Check: Does the agent have access to the information it needs?
- Solution: May require refactoring agent responsibilities

**D. Model Variation** - Different LLMs behave differently
- Symptoms: Works with one model, fails with another
- Check: Compare outputs across models
- Solution: Make prompts more explicit, add more fallback patterns

## Phase 4: Exploration - Before Any Fix

Before implementing a fix, thoroughly understand the agent:

```bash
# Read the agent implementation
cat src/agents/[category]/[agent-name].ts

# Check existing tests
ls tests/unit/*[agent-name]* tests/llm/*[agent-name]*

# Search for related parsing logic
grep -r "parseResponse\|parseSection" src/agents/[category]/[agent-name].ts
```

Answer these questions:
1. What format does the prompt ask for?
2. What does `parseResponse()` actually parse?
3. Are there concrete examples in the prompt?
4. What fallback patterns exist?
5. What do existing tests cover?

## Phase 5: Test First - Capture the Issue

Add or update tests to capture the failure before fixing:

```bash
# Run existing LLM tests to see current state
node --import tsx --test tests/llm/[agent-name].test.ts
```

If no test exists for this failure mode, create one in `tests/llm/` or `tests/unit/`.

## Phase 6: Fix - Apply Best Practices

**For Prompt Issues:**
- Add a `## Example` or `## Example Output` section with realistic, complete examples
- Show the EXACT format expected, not just placeholders
- Examples should demonstrate edge cases (multiple items, optional fields)

**For Parser Issues:**
- Add fallback patterns to `parseListItemsWithFallback()` or similar
- Handle both colon format (`SECTION:`) and markdown heading format (`## SECTION`)
- Log parse failures for debugging: `console.info('[agent] Parse stats...')`

**For Both:**
- Keep the rich format when available (strength, reason, paths)
- Gracefully degrade to simpler format when LLM doesn't comply
- Never silently fail - log what went wrong

## Phase 7: Verify - Run All Checks

```bash
# Must pass before committing
npm run lint && npm run typecheck && npm run test

# Run LLM tests to verify semantic improvements
node --import tsx --test tests/llm/*.test.ts
```

## Phase 8: Iterate

After fixing issues, run another batch and compare:

```bash
npm run dev -- \
  --repo https://github.com/JKershaw/CursorMCPBridge \
  --iterations 50 \
  --verbose 2>&1 | tee run-output-v2.log

# Compare results
grep -c "Parse failed" run-output.log run-output-v2.log
grep -c "0 .* produced" run-output.log run-output-v2.log
```

## Key Files Reference

| Purpose | Location |
|---------|----------|
| Analysis agents | `src/agents/analysis/*.ts` |
| Synthesis agents | `src/agents/synthesis/*.ts` |
| Meta agents | `src/agents/meta/*.ts` |
| Parsing utilities | `src/agents/parsing/` |
| LLM tests | `tests/llm/*.test.ts` |
| Test helpers | `tests/helpers/` |
| Run data | `.codewiki-data/` |

## Success Criteria

The system is "perfect" when:
- All agents produce non-empty, meaningful output
- Parse success rate is >95% across different LLM models
- Wiki pages are coherent and interconnected
- No agent crashes or unhandled exceptions
- LLM tests pass consistently (allowing for minor model variation)

## Anti-Patterns to Avoid

- Don't add complexity without understanding the root cause
- Don't fix prompts when the parser is the problem (and vice versa)
- Don't ignore rate limiting messages - they're normal, wait for retry
- Don't commit without running lint, typecheck, and tests
- Don't over-engineer fallbacks - prefer prompt clarity first
