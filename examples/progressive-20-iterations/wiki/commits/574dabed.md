---
title: "Repository Ignore Pattern System (.cwignore)"
confidence: 0.55
path: commits/574dabed
---

# Repository Ignore Pattern System (.cwignore)

The CodeWiki system implements a .cwignore file mechanism that allows repositories to specify paths and patterns to exclude from analysis. This feature mirrors the familiar .gitignore syntax, providing developers with fine-grained control over which files and directories the system examines when generating wiki documentation. By default, the system ignores common non-source directories like `node_modules/` and `.git/`, but projects can extend this with custom patterns through a `.cwignore` file at the repository root.

The ignore system integrates deeply into the codebase exploration tools used by LLM agents. When agents use tools like `search_files` to find code files or `list_directory` to browse project structure, the ignore patterns automatically filter results. This prevents the system from wasting token budget analyzing generated files, build artifacts, or other content that shouldn't influence the documentation. The implementation uses `fast-glob` for efficient pattern matching and `minimatch` for glob evaluation, with a caching layer to avoid repeatedly reading and parsing the ignore file.

The design follows established conventions from the Git ecosystem while adapting to CodeWiki's specific needs. Negation patterns (lines starting with `!`) are explicitly not supported since the underlying `fast-glob` library's ignore option doesn't handle them. Directory patterns ending with `/` are automatically expanded to `/**` to match all contents recursively. This makes the system intuitive for developers already familiar with `.gitignore` while providing clear boundaries for what's technically feasible.

## Key Findings

- **FEATURE** (high): .cwignore file parser supporting gitignore-style syntax with comments, empty lines, and glob patterns - src/services/cwignore.ts
- **FEATURE** (high): Integration of ignore patterns into codebase exploration tools (read_file, search_files, list_directory) used by LLM agents - src/services/llm/codebase-tools.ts
- **IMPLEMENTATION** (medium): Pattern caching mechanism to avoid re-reading .cwignore on every tool invocation - src/services/cwignore.ts
- **IMPLEMENTATION** (medium): Default ignore patterns (node_modules/**, .git/**) always applied regardless of .cwignore presence - src/services/cwignore.ts
- **IMPLEMENTATION** (low): Automatic expansion of directory patterns (examples/ becomes examples/**) for glob matching - src/services/cwignore.ts
- **LIMITATION** (low): Negation patterns (starting with !) are skipped and not supported due to fast-glob limitations - src/services/cwignore.ts
- **DEPENDENCY** (medium): Added fast-glob@3.3.2 for efficient file pattern matching and minimatch@10.0.1 for glob evaluation - package.json, package-lock.json
- **TESTING** (medium): Comprehensive unit tests covering pattern parsing, caching, and file system integration - tests/unit/cwignore.test.ts
- **EXAMPLE** (low): Project's own .cwignore file excludes examples/ directory from analysis - .cwignore

## Source

- **Commit:** 574dabed
- **Files:** `.cwignore`, `package-lock.json`, `package.json`, `src/services/cwignore.test.ts`, `src/services/cwignore.ts`, `src/services/llm/codebase-tools.test.ts`, `src/services/llm/codebase-tools.ts`


---



## Related Pages

- [Repository Ignore Patterns (.cwignore)](commits/9dad2c60) - Both commits implement the .cwignore pattern system
- [CodeWiki - Project Overview](architecture/overview) - Ignore patterns affect how the system analyzes repositories
- [Coding Standards & Conventions](conventions/coding-standards) - .cwignore provides conventions for repository analysis