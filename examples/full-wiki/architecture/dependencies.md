---
title: "Dependencies"
confidence: 1.00
created: 2025-11-26T13:01:47.979Z
updated: 2025-11-26T13:04:17.144Z
commits: [4d2e0c45078eba61baaed35ac0a8c86472de1c29, 60a1d8368046bd529a9398ebe0f6497dd39d5618, 84389967e435d61e9e39d9d51b732370a30098e4]
---
# Dependencies

## Recent Changes (af17f139)

### Added
- **mongodb**: ^6.3.0 - Database driver for persistent storage of repositories, commits, wiki pages, and agent runs
- **express**: ^4.18.2 - HTTP server framework for exposing REST API and potential MCP server endpoints
- **zod**: ^3.22.4 - Runtime type validation and schema definition, likely for command/query validation and API contracts
- **simple-git**: ^3.22.0 - Git operations library for cloning repositories and analyzing commit history
- **uuid**: ^9.0.1 - UUID generation for entity IDs throughout the domain model
- **@types/express**: ^4.17.21 - TypeScript definitions for Express
- **@types/node**: ^20.10.0 - TypeScript definitions for Node.js APIs
- **@types/uuid**: ^9.0.7 - TypeScript definitions for uuid package
- **typescript**: ^5.3.2 - TypeScript compiler and language support
- **tsx**: ^4.6.2 - TypeScript execution engine for development workflow
- **vitest**: ^1.0.4 - Unit testing framework (Vite-based, fast alternative to Jest)
- **@playwright/test**: ^1.40.1 - End-to-end testing framework for integration tests
- **eslint**: ^8.55.0 - Linting tool for code quality
- **@typescript-eslint/eslint-plugin**: ^6.13.2 - TypeScript-specific ESLint rules
- **@typescript-eslint/parser**: ^6.13.2 - TypeScript parser for ESLint






## Breaking Changes

- Express 4.x is stable but Express 5.x exists (breaking changes involve error handling and route matching)
- MongoDB driver 6.x requires MongoDB server 3.6+ and has different connection patterns than 5.x
- ESLint 8.x is being used; ESLint 9.x with flat config is available but would require different configuration approach
- Node.js 20.4.0+ is required (uses modern ESM, top-level await, etc.)


## Security Notes

- **MongoDB 6.3.0**: Latest stable version with no known high-severity CVEs. Connection string handling requires care to avoid credential leakage
- **Express 4.18.2**: Mature framework, ensure proper security middleware (helmet, cors, rate limiting) is added in future commits
- **simple-git 3.22.0**: Executes shell commands for Git operations - potential command injection risk if user input reaches Git commands. Must sanitize repository URLs and paths
- **uuid 9.0.1**: Cryptographically secure random UUID generation, no known vulnerabilities
- **Zod 3.22.4**: Validation library helps prevent injection attacks by enforcing schema compliance
- **Development dependencies**: Playwright/Vitest/ESLint have no runtime security impact
- **License compatibility**: All dependencies use permissive licenses (MIT, Apache-2.0, ISC) - no GPL conflicts
- **Recommendation**: Add dependency scanning (npm audit, Snyk, or Dependabot) in CI/CD pipeline


**Impact Level:** minimal

---
*Last updated from commit af17f139*
