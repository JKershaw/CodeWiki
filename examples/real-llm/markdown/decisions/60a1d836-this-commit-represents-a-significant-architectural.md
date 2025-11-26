---
title: "This commit represents a significant architectural decision to add a web interface to CodeWiki, alon"
confidence: 0.50
created: 2025-11-25T22:09:30.152Z
updated: 2025-11-25T22:09:30.152Z
commits: [60a1d8368046bd529a9398ebe0f6497dd39d5618]
---
# This commit represents a significant architectural decision to add a web interface to CodeWiki, alon

This commit represents a significant architectural decision to add a web interface to CodeWiki, along with comprehensive E2E testing infrastructure. The commit includes several important technical decisions around containerized deployment, browser automation constraints, and API architecture. The Playwright configuration file contains explicit documentation of environment-specific constraints and workarounds.

## Key Points

- **ADR**: Containerized environment constraints explicitly documented in playwright.config.ts with critical Chrome sandbox disabling decisions and rationale for containerized/web-based development environments like "Claude Code on the web".
- **DESIGN**: Introduction of three-tier architecture: web server (Express), frontend SPA, and REST API layer, representing significant architectural expansion beyond CLI-only interface.
- **DESIGN**: Date handling robustness improvements to handle both Date objects and ISO strings, indicating cross-boundary serialization concerns between API and persistence layers.
- **DESIGN**: E2E test organization strategy with separate test files for different concerns (smoke, api, repositories, wiki, query), demonstrating testing architecture principles.
- **DECISION**: Serial test execution (workers: 1) chosen to avoid resource contention in containerized environments, with explicit retry strategy for flaky tests.

## Decisions Made

- **Containerized Development Support**: Explicitly disabled Chrome sandbox and related security features to enable Playwright testing in containerized environments like web-based IDEs. This is marked as "CRITICAL" in the configuration, indicating a fundamental constraint of the deployment environment.
- **Single-Process Browser Mode**: Chose to run browser tests in single-process mode with disabled GPU and zygote processes, optimizing for resource-constrained containerized environments over performance.
- **REST API Architecture**: Introduced a complete REST API layer (`/api/repos`, `/api/query`, etc.) as the interface between frontend and backend, establishing clear separation of concerns.
- **Date Serialization Handling**: Added defensive programming for date handling to support both object instances and JSON-serialized strings, addressing type coercion issues in API boundaries.
- **Test Execution Strategy**: Implemented serial test execution with retry logic specifically for containerized environments, prioritizing reliability over speed.

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
