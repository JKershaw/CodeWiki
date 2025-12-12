# CLAUDE.md

This file provides guidance for Claude Code when working with the CodeWiki project.

## Project Overview

CodeWiki generates living wikis from Git repositories. It's a TypeScript/Node.js project using ESLint for linting and Node's built-in test runner for tests.

## Setup

Dependencies are not installed by default. Run the following before starting development:

```bash
npm install
```

To run end-to-end tests, you also need to install Playwright browsers:

```bash
npx playwright install
```

## Development Workflow

### Test Driven Development (TDD)

**Always follow Test Driven Development.** Before implementing any feature or fix:

1. **Research existing tests first** - Before starting any work, explore the test suite to understand:
   - How similar features are tested
   - What test patterns and helpers are available
   - Whether related tests already exist that need updating
   - The LLM test suite for agent-related changes

2. **Write tests before implementation** - Follow the red-green-refactor cycle:
   - Write a failing test that describes the expected behavior
   - Implement the minimum code to make the test pass
   - Refactor while keeping tests green

3. **Consider all test types** - Depending on the change, you may need:
   - Unit tests for isolated logic
   - Integration tests for component interactions
   - LLM tests for agent behavior verification
   - E2E tests for user-facing features

### Before Starting Any Task

Always research the existing codebase and tests:

```bash
# Explore relevant test files
ls tests/unit/ tests/integration/ tests/llm/

# Search for related tests
grep -r "describe.*FeatureName" tests/
```

Review `tests/helpers/` for available test utilities like `MockLLMService` and `createTestContext`.

## Development Commands

- `npm run build` - Compile TypeScript and copy static assets
- `npm run dev` - Run in development mode with watch
- `npm run test` - Run unit and integration tests
- `npm run test:e2e` - Run end-to-end tests with Playwright
- `npm run lint` - Run ESLint on source files
- `npm run typecheck` - Run TypeScript type checking

## Before Implementing Features

When given a feature spec or guide, follow this process BEFORE writing any code:

1. **Map spec to code locations** - For each file the spec says to modify, READ that file first. Understand what it does and why the spec targets it specifically. If you find yourself wanting to modify a different file, STOP and reconsider.

2. **Trace the execution flow** - Before changing anything, trace how the relevant code actually executes. For example, if fixing "work generation," trace: What calls `generateWorkList`? What does it call? Where does the problematic behavior occur?

3. **Write a failing integration test first** - Write a test that demonstrates the actual problem in the real system, not a unit test for new code you haven't written yet. The test should fail before your fix and pass after.

4. **Verify your plan against the spec** - Before implementing, explicitly check:
   - Am I modifying the files the spec says to modify?
   - Am I following the approach the spec describes?
   - If my plan differs from the spec, why? (Ask the user if unclear)

5. **Keep changes minimal** - If the spec says "~50 lines new, ~50 modified," that's a constraint. Exceeding it significantly suggests you're overcomplicating the solution.

**Common mistakes to avoid:**
- Finding code that "looks relevant" and modifying it without verifying it's the right integration point
- Writing unit tests for new isolated functions instead of integration tests for system behavior
- Ignoring specific file names in the spec because you found something "similar"
  
## Before Committing Code

Always run the following checks before committing any code changes:

```bash
npm run lint && npm run typecheck && npm run test
```

All three checks must pass before committing. Fix any errors before proceeding with the commit.

## Code Style

- TypeScript with strict type checking
- ESLint for code style enforcement
- Source code lives in `src/`

## Testing

### Test Locations

- Unit tests: `tests/unit/*.test.ts`
- Integration tests: `tests/integration/*.test.ts`
- E2E tests: `tests/e2e/*.spec.ts` (Playwright)
- LLM tests: `tests/llm/*.test.ts` (real LLM integration tests)
- Test helpers: `tests/helpers/` (MockLLMService, createTestContext, etc.)
- Test fixtures: `tests/fixtures/`

### Running a Single Test File

```bash
node --import tsx --test tests/unit/specific-file.test.ts
```

### LLM Tests

LLM tests use real LLM calls via OpenRouter to verify agent semantic accuracy. They use the "LLM-as-judge" pattern where another LLM evaluates outputs on a 0-10 scale.

**Requirements:**
- Set `OPENROUTER_API_KEY` environment variable
- Tests use `qwen/qwen-turbo` by default (cheap, fast)

**Running LLM tests:**
```bash
# Run all LLM tests
node --import tsx --test tests/llm/*.test.ts

# Run specific agent test
node --import tsx --test tests/llm/security-agent.test.ts
```

**Test structure:**
- `tests/llm/helpers/` - Test utilities (context, assertions, result logging)
- `tests/llm/results/` - JSON test results for analysis
- `tests/llm/integration/` - Multi-agent consistency tests
- `tests/llm/e2e/` - Full wiki generation pipeline tests

See `docs/REAL_LLM_TESTING_STRATEGY.md` for the full testing strategy.

## Critical Rules

### Data Protection

- **Never delete data directories** (`.codewiki-data`, database files, etc.) without explicit user permission
- **Never modify user configuration files** (`.env`, config files) without explicit user permission
- If you believe data needs to be cleared or config needs changing, ask the user first

### External Services and APIs

- **Never assume an external service, API, or model doesn't exist** based on your training data
- Your knowledge has a cutoff date - new models and services are released regularly
- **Verify before acting**: Use web search, API calls, or ask the user to confirm
- Observed behavior (successful API calls, costs being reported) is stronger evidence than your assumptions about what should or shouldn't exist

### Rate Limiting and Retries

- Rate limiting and retry messages are **normal operational behavior**, not failures
- When you see "Rate limited, waiting..." or similar messages, the system is working correctly and will recover
- Do not intervene or try to "fix" rate limiting - wait for it to clear
- The system has built-in handling for rate limits and transient errors
