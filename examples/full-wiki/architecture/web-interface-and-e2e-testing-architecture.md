---
title: "Web Interface and E2E Testing Architecture"
confidence: 0.50
created: 2025-11-26T10:21:43.333Z
updated: 2025-11-26T10:21:43.333Z
commits: [60a1d8368046bd529a9398ebe0f6497dd39d5618]
---
# Web Interface and E2E Testing Architecture

Major feature addition implementing a complete web interface with E2E testing infrastructure. Commit introduces significant architectural decisions around testing strategy, deployment environment constraints, and user interface design. Configuration comments reveal critical deployment considerations for containerized environments.

## Key Points

- **ARCHITECTURE**: Playwright configuration reveals explicit design decision to support containerized/sandboxed environments (Claude Code web). Critical Chrome sandbox disabling with detailed rationale in comments explains deployment constraints and browser configuration strategy.
- **DESIGN**: Complete web interface architecture emerges: REST API backend, static frontend with three views (repos, wiki, query), real-time status polling mechanism. Shows transition from CLI-only to web-based user experience.
- **TECHNICAL_DECISION**: E2E test structure organized by domain (api, query, repositories, smoke, wiki) suggests feature-based testing strategy rather than page-based. Indicates mature testing philosophy.
- **BUG_FIX**: Date handling fix in file-commit-repository addresses JSON serialization issue - commits stored as JSON strings need runtime conversion. Shows evolution from in-memory to persistent storage considerations.
- **DEPLOYMENT**: Test configuration optimized for resource-constrained environments: single worker, serial execution, specific Chrome flags for containerized deployment. Reveals production environment assumptions.

## Decisions Made

- **Containerized Environment Support**: Explicitly designed for sandboxed environments like "Claude Code on the web" with disabled Chrome sandbox, single-process mode, and /tmp usage instead of /dev/shm. This is a foundational deployment decision affecting all browser-based testing.
- **Polling-Based Status Updates**: Web interface uses client-side polling (2-second intervals) for repository processing status rather than WebSockets or SSE, suggesting simpler deployment requirements and stateless architecture.
- **Serial Test Execution**: E2E tests run with single worker to "avoid resource issues" - indicates deliberate trade-off between speed and reliability in resource-constrained environments.
- **Three-View Interface Design**: Repository management, wiki browsing, and querying separated into distinct views with context-aware navigation (buttons disabled until repo selected).
- **Date Type Flexibility**: Repository layer handles both Date objects and ISO strings, accommodating JSON serialization. Shows architectural maturity in handling persistence layer concerns.

## Source Files

- `package.json`
- `playwright.config.ts`
- `src/repositories/file-based/file-commit-repository.ts`
- `src/web/index.ts`
- `src/web/public/app.js`
- `src/web/public/index.html`
- `src/web/public/styles.css`
- `src/web/server.ts`
- `tests/e2e/api.spec.ts`
- `tests/e2e/query.spec.ts`
- `tests/e2e/repositories.spec.ts`
- `tests/e2e/smoke.spec.ts`
- `tests/e2e/wiki.spec.ts`

---
*Captured from commit 60a1d836*
