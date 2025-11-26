---
title: "Multi-Agent Processing Architecture"
confidence: 0.50
created: 2025-11-26T12:33:15.061Z
updated: 2025-11-26T12:33:15.061Z
commits: [296d345be67c674f9784914ac65b726cd0c1712d]
---
# Multi-Agent Processing Architecture

Documentation update describing the implementation and rationale for multi-agent processing architecture. The PROGRESS.md update explains the agent registry, processing order strategy, and incremental processing approach with per-agent commit tracking.

## Key Points



## Decisions Made

- Agent processing follows deliberate ordering: code-change agent runs first to establish foundational wiki content, then specialized agents (narrative, security, pattern, dependency) layer additional perspectives onto the same commits
- Each commit is tracked per-agent via `processedBy` array, enabling incremental multi-agent processing where commits can be revisited by different agents independently
- Coverage metrics track both overall completion (via code-change primary agent) and per-agent coverage, providing visibility into multi-agent processing progress
- All five analysis agents are now active and registered in the executor, completing the transition from single-agent to comprehensive multi-agent analysis

## Source Files

- `PROGRESS.md`
- `src/agents/orchestrator/orchestrator.ts`
- `src/executor/executor.ts`
- `src/repositories/file-based/file-commit-repository.ts`

---
*Captured from commit 296d345b*
