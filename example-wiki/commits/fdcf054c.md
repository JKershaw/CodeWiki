---
title: "LLM-Powered Work Orchestration System"
confidence: 0.55
created: 2025-11-26T17:39:49.830Z
updated: 2025-11-26T17:44:00.645Z
commits: undefined
---
# LLM-Powered Work Orchestration System

The orchestrator system manages work prioritization across multiple analysis and maintenance agents in the wiki generation pipeline. It examines the current state of the wiki—including commit coverage, page quality metrics, category organization, and recent agent activity—to determine what work should be performed next. The orchestrator can operate in two modes: a deterministic mode using fixed prioritization strategies, and an LLM-powered mode that makes context-aware decisions by reasoning about the wiki's current needs.

The LLM-powered mode represents an intelligent layer that can adapt to complex scenarios. Rather than following rigid rules, it receives a comprehensive context snapshot and reasons about priorities holistically. For example, if many commits lack security analysis, it might prioritize the security agent. If categories have grown but lack overview pages, it might prioritize the category-overview agent. The system uses the ContextGatherer to collect metrics like commit processing rates, confidence scores, pages needing rewrites, and recent agent successes, then formats this information for LLM consumption. The orchestrator persists its decision-making process and outcomes through OrchestratorRun domain entities, enabling analysis of orchestration patterns over time.

The architecture maintains operational resilience through graceful degradation—if the LLM call fails or times out, the system automatically falls back to deterministic strategies. This ensures the orchestration system remains functional even when external LLM services are unavailable. The orchestrator distinguishes between analysis agents (which process commits) and meta-agents (which improve wiki quality), allowing it to balance new content generation with maintenance activities. Each orchestration run produces a prioritized list of WorkItems that downstream systems can consume sequentially or in parallel.



## Source

- **Commit:** fdcf054c
- **Files:** `src/agents/orchestrator/context-gatherer.ts`, `src/agents/orchestrator/orchestrator.ts`, `src/agents/orchestrator/prompts.ts`, `src/cli.ts`, `src/domain/orchestrator-run.ts`, `src/repositories/file-based/file-orchestrator-run-repository.ts`, `src/repositories/file-based/index.ts`, `src/repositories/interfaces/index.ts`, `src/repositories/interfaces/orchestrator-run-repository.ts`, `src/services/llm/llm-service.ts`


---



## Related Pages

- [Orchestration Strategy: Page-Count Based Synthesis Triggers](commits/64a8801e) - Orchestrator uses page-count based synthesis triggers as strategy
- [Project Overview and Getting Started Documentation Agents](commits/7b58314c) - Orchestrator manages synthesis agents like overview and getting started agents
- [CLI Architecture and Wiki Progression Examples](commits/8c4122db) - CLI uses orchestration system as primary mode of operation
- [Agentic Tool-Using Architecture](commits/80221a0a) - Orchestrator coordinates tool-using agents in the system
- [CodeWiki - Project Overview](architecture/overview) - Core orchestration system is central to overall architecture