---
title: "CodeWiki Ignore File Feature"
confidence: 0.50
created: Thu Nov 27 2025 14:11:45 GMT+0000 (Coordinated Universal Time)
updated: Thu Nov 27 2025 14:11:45 GMT+0000 (Coordinated Universal Time)
---

# CodeWiki Ignore File Feature

This commit introduces a .cwignore file feature that allows CodeWiki to selectively ignore files and directories during repository analysis, similar to .gitignore but specifically for codebase documentation generation.

## Key Points

- **FEATURE**: New .cwignore file support allows filtering files during codebase analysis, with glob pattern matching via fast-glob and minimatch libraries
- **ARCHITECTURE**: Integrated ignore functionality into codebase tools with comprehensive test coverage across unit and integration tests
- **IMPLEMENTATION**: Added fast-glob and minimatch dependencies while removing vitest from dependencies (moved to dev)

## Decisions Made

- Implemented .cwignore pattern matching using industry-standard glob libraries (fast-glob, minimatch) for consistency with existing tooling patterns
- Chose to ignore example directories by default since they contain generated content rather than source code that needs analysis
- Integrated ignore functionality directly into the codebase analysis tools rather than as a separate preprocessing step
- Used comprehensive testing strategy covering both unit tests for the ignore service and integration tests for the full analysis pipeline

## Source Files

- `.cwignore`
- `package-lock.json`
- `package.json`
- `src/services/cwignore.ts`
- `src/services/llm/codebase-tools.test.ts`
- `src/services/llm/codebase-tools.ts`
- `tests/helpers/index.ts`
- `tests/helpers/mock-llm.ts`
- `tests/helpers/test-context.ts`
- `tests/integration/commit-processing.test.ts`
- `tests/integration/wiki-analysis.test.ts`
- `tests/unit/consistency-agent.test.ts`
- `tests/unit/cwignore.test.ts`
- `tests/unit/link-agent.test.ts`
- `tests/unit/quality-agent.test.ts`
- `tests/unit/structure-agent.test.ts`

---
*Captured from commit 9dad2c60*
