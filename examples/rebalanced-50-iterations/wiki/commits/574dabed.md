---
title: "CodeWiki Ignore File System"
confidence: 0.50
created: Thu Nov 27 2025 14:02:13 GMT+0000 (Coordinated Universal Time)
updated: Thu Nov 27 2025 14:02:13 GMT+0000 (Coordinated Universal Time)
---

# CodeWiki Ignore File System

The .cwignore file system provides a gitignore-style mechanism for excluding files and directories from CodeWiki's repository analysis. This filtering capability allows users to ignore generated content, build artifacts, documentation outputs, and other files that shouldn't be included when analyzing a codebase for wiki generation.

The system follows familiar gitignore syntax conventions, supporting glob patterns, comments, and directory exclusions. By default, common directories like `node_modules` and `.git` are always excluded. Users can create a `.cwignore` file in their repository root to specify additional patterns. The implementation uses fast-glob for efficient pattern matching and includes caching to avoid repeatedly parsing ignore files during analysis sessions.

The ignore system integrates with CodeWiki's codebase analysis tools, ensuring that irrelevant files are filtered out before processing, which improves performance and focuses the analysis on actual source code rather than generated or temporary content.



## Source

- **Commit:** 574dabed
- **Files:** `.cwignore`, `package-lock.json`, `package.json`, `src/services/cwignore.test.ts`, `src/services/cwignore.ts`, `src/services/llm/codebase-tools.test.ts`, `src/services/llm/codebase-tools.ts`
