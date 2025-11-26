---
title: "This commit introduces the core processing pipeline and CLI for CodeWiki, a system that generates li"
confidence: 0.50
created: 2025-11-25T22:10:43.353Z
updated: 2025-11-25T22:10:43.353Z
commits: [c69224baf050cd8bb45211b4d17cb71653b28d72]
---
# This commit introduces the core processing pipeline and CLI for CodeWiki, a system that generates li

This commit introduces the core processing pipeline and CLI for CodeWiki, a system that generates living documentation from Git repositories. The most significant narrative content is embedded in the system prompts and architecture of the CodeChangeAgent, which reveals the philosophical approach: focusing on the "why" behind code changes rather than just the "what", and establishing patterns for documentation generation (e.g., wiki page naming conventions, confidence scoring methodology).

## Key Points

- **ARCHITECTURAL_PATTERN**: Agent-based architecture established with orchestrator pattern, separation of analysis agents, and executor for wiki updates
- **DOCUMENTATION_PHILOSOPHY**: System explicitly designed to capture "why" not just "what" - focuses on architectural decisions, rationale, and connections between code
- **CONFIDENCE_SCORING**: Established confidence scoring methodology (0.9+ clear docs, 0.7-0.9 reasonable inference, 0.5-0.7 ambiguous, <0.5 needs review) as a core principle
- **WIKI_CONVENTIONS**: Documentation standards established: lowercase paths with hyphens, grouped content by category (architecture/, components/, guides/), preference for updating over creating
- **AGENT_EXTENSIBILITY**: Agent interface designed for multiple analysis lenses - base Agent interface allows different specialized agents to analyze same commits differently

## Decisions Made

- Agent-based architecture: Commits are analyzed through multiple "lenses" (agents) rather than a monolithic analyzer, allowing specialized analysis types (code-change, narrative, dependency, etc.)
- LLM-driven analysis: Core analysis uses LLM with structured prompts and response parsing, rather than rule-based heuristics
- Wiki as primary output: System generates wiki pages rather than inline documentation, allowing documentation to evolve independently from code
- Confidence-based updates: All wiki updates include confidence deltas, enabling progressive refinement and uncertainty tracking
- CLI-first approach: System designed as CLI tool first (bin entry, cli.ts), suggesting batch processing model rather than continuous integration

## Source Files

- `package.json`
- `src/agents/analysis/code-change-agent.ts`
- `src/agents/analysis/index.ts`
- `src/agents/base-agent.ts`
- `src/agents/index.ts`
- `src/agents/orchestrator/index.ts`
- `src/agents/orchestrator/orchestrator.ts`
- `src/cli.ts`
- `src/executor/executor.ts`
- `src/executor/index.ts`
- `src/index.ts`
- `src/services/git/git-service.ts`
- `src/services/git/index.ts`
- `src/services/index.ts`
- `src/services/llm/index.ts`
- `src/services/llm/llm-service.ts`
- `src/services/llm/mock-llm-service.ts`

---
*Captured from commit c69224ba*
