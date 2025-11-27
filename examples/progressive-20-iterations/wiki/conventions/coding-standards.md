---
title: "Coding Standards & Conventions"
confidence: 0.8
path: conventions/coding-standards
---

# Coding Standards & Conventions

## Observed Conventions

- **DEFENSIVE_PROGRAMMING** [CATEGORY:convention] The service handles edge cases gracefully: missing `.cwignore` files return empty arrays, empty lines and comments are filtered, malformed patterns don't crash the system. [Affected: src/services/cwignore.ts]
- **EXPLICIT_DEPENDENCY_MANAGEMENT** [CATEGORY:convention] New dependencies (`fast-glob`, `minimatch`) are added with specific version constraints, and the package-lock.json is properly updated. [Affected: package.json, package-lock.json]
- **File Organization**: New services are placed in `src/services/` with co-located test files using `.test.ts` suffix. This follows the established pattern seen throughout the codebase.
- **TypeScript Strict Mode**: The code uses strict typing with explicit return types (`string[]`, `Promise<string[]>`, `boolean`), avoiding `any` types. Array types use modern syntax (`string[]` not `Array<string>`).
- **Error Handling Pattern**: Uses early returns and existence checks (`fs.existsSync()`) rather than try-catch blocks for predictable failures like missing files. This is a "fail gracefully" convention.
- **Comment Style**: The `.cwignore` file includes explanatory comments for users, demonstrating a documentation-first approach to configuration files.
- **Path Handling**: Consistent use of `path.join()` for cross-platform path construction and relative path normalization with `path.relative()`.
- **Test Coverage**: Comprehensive test coverage including happy paths, edge cases (empty files, comments, negation), and integration with existing systems. Tests verify both positive and negative cases.
- **Async/Await Pattern**: Modern async patterns used consistently (`async` functions, `await` for promises) rather than callbacks or `.then()` chains.

---
*Updated from commit 574dabed*
