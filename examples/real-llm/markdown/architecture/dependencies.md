---
title: "Dependencies"
confidence: 1.00
created: 2025-11-25T22:26:21.154Z
updated: 2025-11-25T22:28:19.831Z
commits: [60a1d8368046bd529a9398ebe0f6497dd39d5618, 84389967e435d61e9e39d9d51b732370a30098e4, 15782f7c6bbf978ee9d070e879a73b0801b03472]
---
# Dependencies

## Recent Changes (af17f139)

### Added
- **mongodb**: ^6.3.0 - Database driver for persistent storage of domain entities (repos, wiki pages, commits, agent runs)
- **express**: ^4.18.2 - HTTP framework for exposing REST API and potential web interface
- **zod**: ^3.22.4 - Runtime type validation and schema definition, complementing TypeScript's compile-time checking
- **simple-git**: ^3.22.0 - Git operations wrapper for cloning repos and reading commit history
- **uuid**: ^9.0.1 - Generating unique IDs for domain entities (visible in code creating repos, wiki pages, agent runs)
- **@types/express**: ^4.17.21 - TypeScript definitions for Express
- **@types/node**: ^20.10.0 - TypeScript definitions for Node.js APIs
- **@types/uuid**: ^9.0.7 - TypeScript definitions for uuid package
- **typescript**: ^5.3.2 - TypeScript compiler for building the project
- **tsx**: ^4.6.2 - TypeScript execution and watch mode for development
- **vitest**: ^1.0.4 - Fast unit test runner with native ESM and TypeScript support
- **@playwright/test**: ^1.40.1 - End-to-end testing framework for integration tests
- **eslint**: ^8.55.0 - Code linting for maintainability
- **@typescript-eslint/eslint-plugin**: ^6.13.2 - ESLint rules for TypeScript
- **@typescript-eslint/parser**: ^6.13.2 - ESLint parser for TypeScript syntax






## Breaking Changes

- MongoDB 6.x uses new connection string format and authentication mechanisms
- Express 4.x will eventually need migration to Express 5.x (major version)
- Vitest 1.x is recently stable, may have API changes in future major versions
- TypeScript 5.x includes new features that may require code adjustments when updating from 4.x


## Security Notes

- **MongoDB**: Version 6.3.0 is relatively recent (late 2023). Should verify no known CVEs. Connection string handling requires care to avoid credential leaks.
- **Express 4.18.2**: Mature version with known security track record. Should implement helmet and other security middleware before production.
- **simple-git**: Executes Git commands - requires careful input validation to prevent command injection. The ^3.22.0 version should be checked for recent security patches.
- **uuid**: Standard package for ID generation, low security risk.
- **Zod**: Validation library helps prevent injection attacks and malformed data - positive security choice.
- **All @types packages**: No runtime security impact.
- **Development dependencies**: No production runtime risk, but Playwright runs browsers which increases attack surface during testing.


**Impact Level:** minimal

---
*Last updated from commit af17f139*
