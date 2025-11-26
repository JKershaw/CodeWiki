---
title: "Multi-Agent Processing Architecture"
confidence: 0.50
created: 2025-11-26T10:19:49.928Z
updated: 2025-11-26T10:19:49.928Z
commits: [296d345be67c674f9784914ac65b726cd0c1712d]
---
# Multi-Agent Processing Architecture

This commit documents the activation of a multi-agent processing architecture, representing a significant system evolution from single-agent to parallel multi-agent analysis. The PROGRESS.md update provides clear architectural documentation about agent roles, processing order, and tracking mechanisms.

## Key Points

- **ARCHITECTURE_DECISION**: Decision to enable parallel processing with five specialized analysis agents (code-change, narrative, security, pattern, dependency) instead of single-agent processing. This represents a fundamental architectural shift in how commits are analyzed.
- **PROCESSING_STRATEGY**: Explicit ordering strategy where code-change establishes base wiki content first, then specialized agents add their perspectives. This sequencing decision prevents race conditions and ensures consistent foundation.
- **DATA_MODEL**: Introduction of per-agent commit tracking via `processedBy` array enables incremental multi-agent processing. Each commit can be independently tracked across multiple agents.
- **AGENT_REGISTRY**: Documentation of active agents with clear purpose statements creates a living registry of system capabilities.
- **COVERAGE_METRICS**: Addition of per-agent coverage metrics in WorkSummary interface provides visibility into multi-agent processing progress.

## Decisions Made

- **Sequential processing strategy**: Code-change agent must run first to establish base wiki content before specialized agents add their perspectives. This prevents conflicts and ensures coherent documentation foundation.
- **Per-agent tracking**: Each commit tracks which agents have processed it via `processedBy` array, enabling independent progress tracking and resumable processing per agent.
- **Five specialized agents**: System now uses code-change (general), narrative (meta-docs), security (auditing), pattern (design), and dependency (changes) agents in parallel rather than a single monolithic analyzer.
- **Agent ordering matters**: Explicitly documented that ANALYSIS_AGENTS array order is significant for processing sequence, not arbitrary.
- **Date normalization**: Added robustness for JSON storage that may convert Date objects to ISO strings, showing attention to persistence concerns.

## Source Files

- `PROGRESS.md`
- `src/agents/orchestrator/orchestrator.ts`
- `src/executor/executor.ts`
- `src/repositories/file-based/file-commit-repository.ts`

---
*Captured from commit 296d345b*
