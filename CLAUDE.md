# CLAUDE.md

This file provides guidance for Claude Code when working with the CodeWiki project.

## Project Overview

CodeWiki generates living wikis from Git repositories. It's a TypeScript/Node.js project using ESLint for linting and Node's built-in test runner for tests.

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
- Tests are in `tests/unit/` and `tests/integration/`
