---
title: "LLM-Powered Orchestrator Architecture"
confidence: 0.70
created: 2025-11-26T15:48:45.862Z
updated: 2025-11-26T15:52:01.300Z
commits: [fdcf054cda36dcc5761c1e6643612ac701335d75]
---
# LLM-Powered Orchestrator Architecture

The orchestrator in CodeWiki employs a dual-mode architecture that balances deterministic reliability with AI-powered intelligence. The system can operate in either deterministic mode (default) or LLM-powered mode, providing flexibility between fast, predictable behavior and context-aware decision-making.

## Architecture Overview

The orchestrator architecture consists of three primary components:

1. **Context Gatherer** - Assembles comprehensive snapshots of wiki state
2. **Orchestration Engine** - Makes decisions about agent work prioritization
3. **Fallback System** - Ensures reliability through graceful degradation

This design enables the orchestrator to make intelligent decisions about which agents should run and in what order, while maintaining system stability even when AI components fail.

## Dual-Mode Operation

### Deterministic Mode (Default)

The deterministic orchestration strategy provides fast, predictable agent scheduling based on predefined rules. This mode prioritizes reliability and speed, making it suitable for production environments where consistent behavior is essential.

### LLM-Powered Mode

When enabled via the `useLLM` flag, the orchestrator leverages AI to make context-aware decisions about work prioritization. This mode uses Claude Haiku 4.5 as the default model, balancing cost, speed, and capability for orchestration tasks. The LLM analyzes comprehensive wiki state to determine optimal agent execution strategies.

## Context Gathering

The context gathering subsystem creates detailed snapshots of the wiki's current state to inform orchestration decisions. These snapshots include:

- **Commit Coverage Metrics** - Which commits have been analyzed and which remain unprocessed
- **Category Organization** - Structure and completeness of wiki categories
- **Page Quality Indicators** - Pages requiring attention based on quality metrics
- **Recent Agent Activity** - Historical context of recent orchestration decisions

### Quality Indicators

The system tracks several quality indicators that guide improvement work:

- Pages with commit-style language requiring rewrite
- Pages lacking internal links
- Pages with low confidence scores
- Categories without overview pages

These metrics enable data-driven orchestration decisions focused on improving wiki quality.

## Agent Classification

The architecture establishes a clear separation between two types of agents:

### Analysis Agents

Analysis agents process commits from the repository, extracting information and creating initial wiki content. These agents focus on transforming raw commit data into structured documentation.

### Meta Agents

Meta agents synthesize and improve existing wiki content. Rather than processing commits, these agents work to enhance page quality, establish connections between concepts, and maintain overall wiki organization. For details on one such agent, see [Writer Agent Design](writer-agent-design.md).

This architectural separation enables targeted orchestration strategies for different types of work.

## Fallback Pattern

The orchestrator implements a robust fallback pattern to ensure system resilience:

1. **Primary**: LLM orchestration attempts to make intelligent decisions
2. **Fallback**: On failure, the system gracefully degrades to deterministic strategy
3. **Guarantee**: Work continues regardless of AI component availability

This pattern prioritizes system reliability while allowing experimentation with AI-driven features.

## Run Tracking

Every orchestrator execution is tracked with comprehensive metadata:

- Context snapshot at decision time
- Decisions made and rationale
- Agent execution results
- Timestamps and duration

This audit trail enables analysis of orchestration patterns and provides data for future optimization of both deterministic and LLM-powered strategies.

## Implementation Components

The orchestrator architecture is implemented across several key modules:

- `context-gatherer.ts` - Wiki state snapshot generation
- `orchestrator.ts` - Core orchestration logic and mode switching
- `prompts.ts` - LLM prompting strategies for intelligent orchestration
- `orchestrator-run.ts` - Domain model for tracking orchestration executions
- `orchestrator-run-repository.ts` - Persistence of orchestration history

## Design Rationale

The dual-mode architecture reflects several key design principles:

- **Reliability First**: Deterministic mode as default ensures production stability
- **Intelligent When Possible**: LLM mode enables context-aware optimization
- **Data-Driven Decisions**: Comprehensive metrics inform both orchestration modes
- **Clear Boundaries**: Explicit agent categorization improves system understanding
- **Graceful Degradation**: Fallback pattern maintains service continuity
- **Continuous Improvement**: Run tracking enables ongoing optimization

This architecture allows CodeWiki to benefit from AI capabilities while maintaining the reliability required for automated documentation systems.