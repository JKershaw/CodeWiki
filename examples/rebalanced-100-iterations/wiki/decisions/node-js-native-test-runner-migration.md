---
title: "Node.js Native Test Runner Migration"
confidence: 0.50
created: Thu Nov 27 2025 14:13:25 GMT+0000 (Coordinated Universal Time)
updated: Thu Nov 27 2025 14:13:25 GMT+0000 (Coordinated Universal Time)
---

# Node.js Native Test Runner Migration

Testing framework migration decision from Vitest to Node.js native test runner, representing a significant architectural choice for test infrastructure simplification.

## Key Points

- **ARCHITECTURE_DECISION**: Migration from Vitest to Node.js native test runner with complete removal of external testing framework dependencies
- **TESTING_STRATEGY**: Adoption of minimal mocking approach with custom mock implementations
- **DEPENDENCY_REDUCTION**: Elimination of bundler and test framework dependencies, reducing package complexity

## Decisions Made

- Replace Vitest with Node.js built-in test runner to reduce external dependencies
- Implement custom mocking infrastructure instead of relying on framework-provided mocks
- Maintain existing test structure while adapting to native Node.js testing patterns

## Source Files

- `package-lock.json`
- `package.json`
- `tests/fixtures/index.ts`
- `tests/fixtures/mock-context.ts`
- `tests/fixtures/mock-llm.ts`
- `tests/fixtures/mock-pages.ts`
- `tests/helpers/index.ts`
- `tests/helpers/mock-llm.ts`
- `tests/helpers/test-context.ts`
- `tests/integration/agent-workflow.test.ts`
- `tests/integration/commit-processing.test.ts`
- `tests/integration/wiki-analysis.test.ts`
- `tests/unit/codebase-tools.test.ts`
- `tests/unit/consistency-agent.test.ts`
- `tests/unit/cwignore.test.ts`
- `tests/unit/link-agent.test.ts`
- `tests/unit/quality-agent.test.ts`
- `tests/unit/structure-agent.test.ts`
- `vitest.config.ts`

---
*Captured from commit aaf040f3*
