---
title: "DEPENDENCY_INJECTION"
confidence: 0.50
created: 2025-11-26T12:49:50.660Z
updated: 2025-11-26T12:49:50.660Z
commits: [82525543ff9587140a9ad12be99f55a1b41b69f2]
---
# DEPENDENCY_INJECTION

**Category:** architecture

## Description

Constructor/parameter injection used throughout. Services receive dependencies as parameters rather than creating them (executor receives repos, git, llm, orchestrator).

## Usage in This Codebase

Found in: `src/executor/executor.ts`, `src/agents/orchestrator/orchestrator.ts`

## Examples

*See commit 82525543 for implementation example.*

---
*Last updated from commit 82525543*
