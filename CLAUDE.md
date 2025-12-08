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
