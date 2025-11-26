---
title: "LLM-Powered Work Orchestration System"
confidence: 0.55
created: 2025-11-26T15:36:49.563Z
updated: 2025-11-26T15:42:42.043Z
commits: [fdcf054cda36dcc5761c1e6643612ac701335d75]
---
# LLM-Powered Work Orchestration System

The orchestrator is an intelligent work prioritization system that determines which agents should run next and what tasks they should perform. It analyzes the current state of the wiki—including commit coverage, page quality, category organization, and recent agent activity—to create prioritized work queues for both analysis agents (which process commits) and meta agents (which improve existing wiki content).

The system operates in two modes: a deterministic mode using fixed strategies for predictable, fast decisions, and an LLM-powered mode that uses an AI model to make context-aware decisions based on the full state of the wiki. When LLM mode is enabled, the system uses a specialized prompt that receives detailed context about commit coverage, page quality metrics, category organization needs, and recent agent activity. The LLM then suggests which agents to run, what priority to assign, and provides reasoning for its decisions. If the LLM call fails, the system gracefully falls back to deterministic strategies.

The orchestrator maintains its own run history through an `OrchestratorRun` domain model and dedicated repository, allowing the system to track decision patterns over time. Context gathering is handled by a separate `ContextGatherer` service that compiles comprehensive snapshots of wiki state, including metrics like pages needing rewrites (those still using commit-style language like "This commit adds..."), categories missing overview pages, low-confidence pages, and pages without cross-links.



## Source

- **Commit:** fdcf054c
- **Files:** `src/agents/orchestrator/context-gatherer.ts`, `src/agents/orchestrator/orchestrator.ts`, `src/agents/orchestrator/prompts.ts`, `src/cli.ts`, `src/domain/orchestrator-run.ts`, `src/repositories/file-based/file-orchestrator-run-repository.ts`, `src/repositories/file-based/index.ts`, `src/repositories/interfaces/index.ts`, `src/repositories/interfaces/orchestrator-run-repository.ts`, `src/services/llm/llm-service.ts`


---



## Related Pages

- [Complete Multi-Agent Wiki Generation System](commits/82193f9f.md) - Orchestrator is a core component of the complete multi-agent system described in 82193f9f
- [Meta-Agent System for Wiki Quality Analysis](commits/addfc9e6.md) - Orchestrator manages meta-agents including the Quality Agent described in addfc9e6
- [Writer Agent - Encyclopedia-Style Content Transformation](commits/659d7dd1.md) - Orchestrator creates work queues for the Writer Agent and other synthesis components
- [Overview Agent for Category Synthesis](commits/32b7cb2f.md) - Orchestrator manages Overview Agent as part of synthesis layer
- [Wiki Documentation Generation System Example](commits/3f14bd3e.md) - LLM-powered orchestration is central to the wiki generation system architecture
- [Writer Agent Design](architecture/writer-agent-design.md) - Orchestrator manages writer agent work prioritization