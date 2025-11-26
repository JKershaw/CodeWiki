---
title: "Intelligent Work Orchestration System"
confidence: 0.50
created: 2025-11-26T14:45:29.984Z
updated: 2025-11-26T14:45:29.984Z
commits: [fdcf054cda36dcc5761c1e6643612ac701335d75]
---
# Intelligent Work Orchestration System

The orchestration system provides intelligent work prioritization for automated wiki maintenance. It operates as a meta-controller that analyzes the current state of the wiki—including commit coverage, page quality, confidence scores, and recent agent activity—to determine what work should be performed next. The orchestrator can operate in two modes: a deterministic rule-based approach for predictable, fast decisions, or an LLM-powered mode that adapts intelligently to complex situations.

The orchestrator sits at the top of the agent hierarchy, producing prioritized work items that other agents (both analysis and meta agents) consume. Analysis agents process individual commits to extract information, while meta agents improve existing wiki content through categorization, linking, overview generation, and consistency checking. The orchestrator examines metrics like which commits have been processed by which agents, which categories lack overview pages, which pages need rewriting from commit-style to encyclopedia-style, and which pages have low confidence scores or missing links.

The LLM-powered mode uses a structured decision-making framework where an AI model receives detailed context about the wiki state and returns ranked work recommendations with confidence scores and reasoning. This allows the system to adapt to unusual situations, balance competing priorities intelligently, and avoid busy-work when the wiki is already in good shape. The orchestrator maintains a run history that tracks its decisions, execution outcomes, and token usage for transparency and debugging.

## Key Findings

- **FEATURE** (high): LLM-powered orchestration mode added with structured prompting and response parsing for intelligent work prioritization. src/agents/orchestrator/orchestrator.ts, src/agents/orchestrator/prompts.ts
- **ARCHITECTURE** (high): Context gathering system collects comprehensive wiki state metrics including commit coverage by agent, category statistics, page quality indicators, and recent activity. src/agents/orchestrator/context-gatherer.ts
- **DOMAIN** (medium): OrchestratorRun domain entity tracks orchestration decisions, LLM usage, generated work items, and execution outcomes for auditability. src/domain/orchestrator-run.ts
- **PERSISTENCE** (medium): File-based repository implementation for orchestrator runs with JSON serialization and deserialization. src/repositories/file-based/file-orchestrator-run-repository.ts
- **INTEGRATION** (medium): CLI extended with orchestrator run command supporting both deterministic and LLM-powered modes with configurable batch sizes. src/cli.ts
- **DESIGN** (high): Dual-mode operation with deterministic fallback ensures orchestrator always produces valid work items even if LLM calls fail. src/agents/orchestrator/orchestrator.ts
- **PATTERN** (medium): Structured LLM response format with JSON parsing and validation ensures reliable extraction of work recommendations and confidence scores. src/agents/orchestrator/prompts.ts
- **OPTIMIZATION** (medium): Analysis agents only process commits, while meta agents work on improving existing wiki content, creating clear separation of concerns. src/agents/orchestrator/orchestrator.ts

## Source

- **Commit:** fdcf054c
- **Files:** `src/agents/orchestrator/context-gatherer.ts`, `src/agents/orchestrator/orchestrator.ts`, `src/agents/orchestrator/prompts.ts`, `src/cli.ts`, `src/domain/orchestrator-run.ts`, `src/repositories/file-based/file-orchestrator-run-repository.ts`, `src/repositories/file-based/index.ts`, `src/repositories/interfaces/index.ts`, `src/repositories/interfaces/orchestrator-run-repository.ts`, `src/services/llm/llm-service.ts`
