---
title: "File Filtering Infrastructure"
confidence: 0.50
created: Thu Nov 27 2025 14:16:19 GMT+0000 (Coordinated Universal Time)
updated: Thu Nov 27 2025 14:16:19 GMT+0000 (Coordinated Universal Time)
---

# File Filtering Infrastructure

Technical feature implementation with infrastructure decisions about file filtering patterns and build tooling

## Key Points



## Decisions Made

- Adopted gitignore-style syntax for .cwignore files to provide familiar pattern matching for developers
- Chose fast-glob and minimatch libraries for robust glob pattern support and compatibility
- Implemented ignore functionality at the codebase analysis level to filter out irrelevant files during processing
- Defaulted to ignoring examples/ directory to exclude generated wiki content from analysis

## Source Files

- `.cwignore`
- `package-lock.json`
- `package.json`
- `src/services/cwignore.test.ts`
- `src/services/cwignore.ts`
- `src/services/llm/codebase-tools.test.ts`
- `src/services/llm/codebase-tools.ts`

---
*Captured from commit 574dabed*
