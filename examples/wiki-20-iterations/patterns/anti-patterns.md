---
title: "Anti-Patterns to Avoid"
confidence: 0.50
created: 2025-11-26T14:51:38.334Z
updated: 2025-11-26T14:51:38.334Z
commits: [fdcf054cda36dcc5761c1e6643612ac701335d75]
---
# Anti-Patterns to Avoid

These patterns have been identified as problematic in the codebase:

## **Magic Numbers for Limits**

**Magic Numbers for Limits**: Hard-coded limits like `limit: 100`, `.slice(0, 10)`, `.slice(0, 5)` scattered throughout without named constants or configuration. Consider extracting to configuration object. [src/agents/orchestrator/context-gatherer.ts:66, 85, 139, 203, 212]

## **Magic Strings in Arrays**

**Magic Strings in Arrays**: String arrays like `commitIndicators` and `skipCategories` embedded in methods rather than extracted to module-level constants, reducing reusability and discoverability. [src/agents/orchestrator/context-gatherer.ts:115-119, 104]

## **Incomplete Diff Context**

**Incomplete Diff Context**: The provided diff is truncated ("... (diff truncated)"), limiting full pattern analysis. The `generate()` method implementation is cut off, potentially hiding additional patterns.

## **Potential God Object Risk**

**Potential God Object Risk**: `OrchestratorContext` aggregates many concerns (coverage, quality, activity). While currently reasonable, monitor for growth into an oversized data structure. Consider splitting if it grows beyond ~15 properties.


---
*Updated from commit fdcf054c*
