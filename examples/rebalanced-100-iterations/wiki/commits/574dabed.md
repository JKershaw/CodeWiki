---
title: ".cwignore File Support for Path Filtering"
confidence: 0.50
created: Thu Nov 27 2025 14:16:09 GMT+0000 (Coordinated Universal Time)
updated: Thu Nov 27 2025 14:16:09 GMT+0000 (Coordinated Universal Time)
---

# .cwignore File Support for Path Filtering

The CodeWiki system now supports `.cwignore` files for selectively excluding paths during repository analysis. This feature follows the familiar `.gitignore` syntax, allowing developers to specify glob patterns for files and directories that should be ignored when analyzing codebases. The system always excludes common paths like `node_modules/**` and `.git/**` by default, while allowing projects to define additional exclusions through a `.cwignore` file placed in the repository root.

The implementation uses the `fast-glob` library for efficient pattern matching and includes a caching mechanism to avoid re-parsing ignore files on subsequent analysis runs. The parser handles standard gitignore conventions including comment lines (starting with `#`), empty lines, and automatic conversion of directory patterns (ending with `/`) to recursive glob patterns (`/**`). While negation patterns (`!pattern`) are recognized in the syntax, they are intentionally not supported since the underlying `fast-glob` library's ignore option doesn't handle them effectively.

The `.cwignore` system is particularly valuable for CodeWiki analysis because it allows projects to exclude generated content, build artifacts, test fixtures, and other non-source files that would otherwise clutter the analysis results. This improves both performance and relevance of the generated documentation by focusing on actual source code rather than derived or temporary files.



## Source

- **Commit:** 574dabed
- **Files:** `.cwignore`, `package-lock.json`, `package.json`, `src/services/cwignore.test.ts`, `src/services/cwignore.ts`, `src/services/llm/codebase-tools.test.ts`, `src/services/llm/codebase-tools.ts`
