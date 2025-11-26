---
title: "Coding Standards & Conventions"
confidence: 0.50
created: 2025-11-26T14:51:38.332Z
updated: 2025-11-26T14:51:38.332Z
commits: [fdcf054cda36dcc5761c1e6643612ac701335d75]
---
# Coding Standards & Conventions

## Observed Conventions

- **Naming: Agent Type Constants**: Agent types defined as const arrays (`ANALYSIS_AGENTS`, `META_AGENTS`) in SCREAMING_SNAKE_CASE at module level for clear scope and reusability. [src/agents/orchestrator/context-gatherer.ts:41-47, orchestrator.ts:11-33]
- **File Organization: Feature Folders**: Orchestrator functionality grouped in `agents/orchestrator/` folder with clear separation: context gathering, prompt handling, and main orchestrator logic. Each file has single responsibility.
- **TypeScript Interface Documentation**: Comprehensive JSDoc comments on interfaces describing purpose and structure (e.g., `OrchestratorContext`, `OrchestratorConfig`). Provides inline documentation without external docs.
- **Error Handling: Try-Catch with Logging**: Error boundaries wrap LLM calls with console.error logging and graceful degradation rather than propagating failures. [Implied from fallback pattern]
- **Async/Await Consistency**: All asynchronous code uses async/await rather than raw Promises, improving readability and error handling.
- **Array Method Chaining**: Heavy use of functional array methods (`.filter().map().slice()`) for data transformation, following declarative style. [src/agents/orchestrator/context-gatherer.ts:82-90]
- **Nullish Coalescing**: Consistent use of `??` operator for default values rather than `||`, correctly handling falsy values. [src/agents/orchestrator/context-gatherer.ts:99]
- **Path Conventions**: Wiki paths use forward slash hierarchy (e.g., `category/subcategory/page`), with special pages named `overview` or `index`.
- **Percentage Formatting**: Confidence and coverage percentages consistently formatted with `.toFixed(0)` for whole numbers with `%` suffix.
- **Timestamp Handling**: All timestamps use native `Date` objects, with sorting via `.getTime()` comparison for clarity.

---
*Updated from commit fdcf054c*
