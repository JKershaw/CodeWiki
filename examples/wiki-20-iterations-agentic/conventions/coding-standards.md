---
title: "Coding Standards & Conventions"
confidence: 0.65
created: 2025-11-26T18:42:11.234Z
updated: 2025-11-26T18:46:28.773Z
commits: [e584b6e63665e575629f27f3f730ea8f6ad03a21, 7b58314c66cbb923e0844fa7c6f24e589a83b303]
---
# Coding Standards & Conventions

## Observed Conventions

- **Readonly Configuration Constants**: All thresholds and paths defined as `private readonly` class properties (MIN_PAGES_FOR_GUIDE, GUIDE_PATH), making configuration explicit and preventing accidental mutation.
- **Descriptive Variable Naming**: Variables clearly indicate content and intent (`hasProjectOverview`, `pagesWithoutLinks`, `categoriesWithoutOverview`), improving code readability.
- **Guard Clause Pattern**: Early returns for invalid states (e.g., not enough pages, guide already exists) prevent deeply nested conditionals and make happy path clear.
- **Structured Comments**: JSDoc-style comments at class level explaining agent purpose, trigger conditions, and behavior. Example: "Trigger: When wiki has 10+ pages but no guides/getting-started page."
- **Type Safety**: Strong TypeScript typing throughout (`AgentContext`, `WikiPage[]`, `AgentRunResult`) with explicit return types on all methods.
- **Cost Tracking**: All LLM operations return `costUsd` which is propagated through the result chain, enabling cost monitoring and optimization.
- **Confidence Scoring**: Every agent result includes confidence score (0-1), allowing downstream systems to weight or filter results.
- **Context Gathering Separation**: Complex context collection logic extracted to dedicated methods (`gatherGuideContext`, `gatherOverviewContext`) keeping main execution flow clean.
- **Consistent Error Handling**: Throwing descriptive errors for misuse (e.g., calling `runOnCommit` on synthesis agents that only work with wiki state).
- **Page Path Conventions**: Standard paths established (`guides/getting-started`, `architecture/overview`) with multiple accepted variations checked via `some()` predicate.

---
*Updated from commit 7b58314c*
