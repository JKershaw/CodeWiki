---
title: "Intelligent LLM-Powered Orchestration Architecture"
confidence: 0.50
created: 2025-11-26T14:50:32.049Z
updated: 2025-11-26T14:50:32.049Z
commits: [fdcf054cda36dcc5761c1e6643612ac701335d75]
---
# Intelligent LLM-Powered Orchestration Architecture

Significant architectural implementation documenting the introduction of LLM-powered intelligent orchestration. The code includes extensive inline documentation explaining the dual-mode architecture (deterministic vs. LLM-powered), the decision-making process, context gathering strategy, and the system's philosophy of adaptive work prioritization.

## Key Points

- **ARCHITECTURE**: Introduction of dual-mode orchestrator design with deterministic fallback strategy. The system can operate in either deterministic mode (fixed strategies) or LLM-powered mode (adaptive intelligence), with automatic fallback if LLM calls fail. Related paths: src/agents/orchestrator/orchestrator.ts, src/agents/orchestrator/context-gatherer.ts
- **DESIGN**: Comprehensive context gathering system that creates a "snapshot of wiki state" for decision-making, including coverage metrics, quality indicators, recent activity, and category analysis. Related paths: src/agents/orchestrator/context-gatherer.ts
- **PHILOSOPHY**: Clear separation between analysis agents (process commits) and meta-agents (improve wiki structure), with the orchestrator as the decision-maker that examines state to prioritize work. Related paths: src/agents/orchestrator/orchestrator.ts
- **ARCHITECTURE**: Structured prompt engineering with separate system and user prompts, plus response parsing to extract prioritized work decisions from LLM output. Related paths: src/agents/orchestrator/prompts.ts
- **PERSISTENCE**: Introduction of OrchestratorRun domain entity and repository for tracking orchestrator decisions, context snapshots, and outcomes over time. Related paths: src/domain/orchestrator-run.ts, src/repositories/interfaces/orchestrator-run-repository.ts

## Decisions Made

- Decision to implement dual-mode orchestration (deterministic vs. LLM-powered) with automatic fallback, choosing adaptability while maintaining reliability when LLM services are unavailable
- Decision to use Claude Haiku as default model for orchestration, balancing cost and capability for frequent decision-making tasks
- Decision to separate context gathering into its own service layer, making the orchestrator's decision inputs explicit and testable
- Decision to track orchestrator runs persistently, enabling analysis of decision patterns and outcomes over time
- Decision to format context as structured markdown for LLM consumption, making the state snapshot human-readable and LLM-friendly
- Decision to identify "pages needing rewrite" by detecting commit-style language patterns, automating quality improvement detection

## Source Files

- `src/agents/orchestrator/context-gatherer.ts`
- `src/agents/orchestrator/orchestrator.ts`
- `src/agents/orchestrator/prompts.ts`
- `src/cli.ts`
- `src/domain/orchestrator-run.ts`
- `src/repositories/file-based/file-orchestrator-run-repository.ts`
- `src/repositories/file-based/index.ts`
- `src/repositories/interfaces/index.ts`
- `src/repositories/interfaces/orchestrator-run-repository.ts`
- `src/services/llm/llm-service.ts`

---
*Captured from commit fdcf054c*
