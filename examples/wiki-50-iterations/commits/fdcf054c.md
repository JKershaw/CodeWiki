---
title: "LLM-Powered Work Orchestration System"
confidence: 0.55
created: 2025-11-26T16:18:11.223Z
updated: 2025-11-26T16:22:46.442Z
commits: [fdcf054cda36dcc5761c1e6643612ac701335d75]
---
# LLM-Powered Work Orchestration System

The orchestration system serves as the intelligent decision-maker that determines which wiki maintenance work should be prioritized. Operating in a continuous loop, it analyzes the current state of the wiki, commit coverage, agent execution history, and content quality metrics to generate prioritized work queues for specialized agents.

The orchestrator can operate in two distinct modes: deterministic (using fixed strategies based on predefined rules) and LLM-powered (using a language model to make context-aware decisions). The LLM mode represents a meta-level AI system that reasons about which other AI agents should run and in what order, adapting its strategy based on the current state of the documentation. This allows the system to intelligently balance competing priorities like commit coverage, content quality, category organization, and consistency checks without requiring manual intervention.

The system persists its decision-making process through `OrchestratorRun` domain entities, which capture the reasoning, context, and generated work items for each orchestration cycle. This creates an audit trail of orchestration decisions and enables analysis of how work prioritization evolves over time. The architecture cleanly separates context gathering (analyzing current state), decision making (LLM or deterministic logic), and work item generation, making the system maintainable and testable.



## Source

- **Commit:** fdcf054c
- **Files:** `src/agents/orchestrator/context-gatherer.ts`, `src/agents/orchestrator/orchestrator.ts`, `src/agents/orchestrator/prompts.ts`, `src/cli.ts`, `src/domain/orchestrator-run.ts`, `src/repositories/file-based/file-orchestrator-run-repository.ts`, `src/repositories/file-based/index.ts`, `src/repositories/interfaces/index.ts`, `src/repositories/interfaces/orchestrator-run-repository.ts`, `src/services/llm/llm-service.ts`


---



## Related Pages

- [Wiki Quality Orchestration System](commits/64a8801e.md) - Both describe orchestration system logic and decision-making
- [CLI Simplification and Wiki Iteration Examples](commits/8c4122db.md) - CLI uses this orchestration system exclusively
- [Synthesis Agent System - Project Overview and Getting Started](commits/7b58314c.md) - Orchestrator manages synthesis agent execution
- [Overview Agent for Category Synthesis](commits/32b7cb2f.md) - Orchestrator triggers Overview Agent based on category size
- [Writer Agent - Content Transformation System](commits/659d7dd1.md) - Orchestrator may prioritize Writer Agent for content improvement