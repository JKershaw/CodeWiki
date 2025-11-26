---
title: "LLM-Powered Orchestrator Architecture"
confidence: 0.75
created: 2025-11-26T16:23:25.207Z
updated: 2025-11-26T16:27:25.195Z
commits: [fdcf054cda36dcc5761c1e6643612ac701335d75]
---
# LLM-Powered Orchestrator Architecture

The CodeWiki orchestrator employs a dual-mode architecture that balances operational predictability with intelligent adaptation. This design allows the system to prioritize work using either deterministic rules or LLM-powered analysis, depending on operational requirements and resource constraints.

## Architecture Overview

The orchestrator operates in two distinct modes:

- **Deterministic Mode**: Provides fast, predictable task prioritization using hard-coded rules and heuristics. This mode serves as the default operation mode and fallback mechanism.
- **LLM-Powered Mode**: Leverages large language models (specifically Claude Haiku 4.5) to make intelligent, context-aware prioritization decisions based on comprehensive wiki state analysis.

The system automatically falls back to deterministic mode if LLM operations fail, ensuring continuous operation regardless of external service availability.

## Context Gathering System

Before making prioritization decisions, the orchestrator collects multi-dimensional context about the current wiki state. The context gathering system analyzes:

- **Commit Coverage**: Which commits have been processed by which agents, identifying gaps in analysis
- **Wiki Quality Metrics**: Content quality indicators across all pages and categories
- **Category Structure**: Organization hierarchy and completeness of category overview pages
- **Confidence Scores**: Agent-reported confidence levels in their generated content
- **Recent Activity**: Timeline of recent wiki updates and modifications
- **Quality Indicators**: Detection of specific quality issues requiring attention

This contextual information is formatted as structured, human-readable text rather than JSON, optimizing it for LLM consumption and interpretation.

## Agent Classification

The architecture establishes a fundamental distinction between two classes of agents:

### Analysis Agents
These agents process individual commits to extract knowledge and generate documentation. They transform raw code changes into structured wiki content, operating on the primary knowledge extraction phase of the system.

### Meta Agents
These agents improve wiki structure and quality after initial content generation. They work at a higher level of abstraction, focusing on organization, integration, and refinement of existing documentation rather than extracting new knowledge from commits.

This architectural separation defines CodeWiki's two-phase knowledge extraction model: first extract information from commits, then refine and organize that information into coherent documentation.

## Quality Detection Heuristics

The orchestrator encodes editorial standards as programmatic quality detection heuristics:

- **Commit-Style Language**: Pages containing phrases like "this commit..." or "this change..." are flagged for rewriting into proper encyclopedia-style articles
- **Category Maturity**: Categories containing three or more pages are identified as needing overview pages to provide navigational context
- **Link Integration**: Pages without internal links to other wiki pages are detected as isolated content requiring better integration into the knowledge graph

These heuristics translate human editorial judgment into automated quality assessments that guide orchestrator priorities.

## Decision Persistence

The system treats orchestrator runs as first-class domain entities, persisting each decision-making session through a dedicated repository layer. This persistence enables:

- **Audit Trail**: Complete history of what the orchestrator decided and when
- **Pattern Analysis**: Identification of recurring prioritization patterns
- **Learning Opportunities**: Future analysis of orchestrator effectiveness and decision quality

The `OrchestratorRun` domain entity and corresponding file-based repository provide this persistence capability.

## Implementation Details

### Model Selection
The system defaults to Claude Haiku 4.5 for orchestration decisions, chosen for its balance of speed and cost-effectiveness. Orchestration decisions require intelligence but not maximum reasoning capability, making the faster, more economical model appropriate.

### Context Format
Rather than structured JSON, the orchestrator formats context as readable text. This design prioritizes LLM interpretability, allowing the model to naturally understand wiki state without requiring strict schema parsing.

### Integration Points
The orchestrator integrates with the broader system through:
- Command-line interface (`cli.ts`) for manual orchestration
- Context gathering service (`context-gatherer.ts`) for state analysis
- LLM service layer for model interactions
- Repository layer for persistence

## Related Concepts

- [Agent Architecture](../architecture/agent-architecture.md): Understanding the broader multi-agent system
- [Repository Pattern](../patterns/repository-pattern.md): How the system abstracts data persistence
- [LLM Service Integration](../services/llm-service.md): Details of LLM interaction patterns

---



## Related Pages

- [LLM-Powered Work Orchestration System](commits/fdcf054c.md) - Documents the LLM-powered orchestration system architecture
- [Wiki Quality Orchestration System](commits/64a8801e.md) - Quality orchestration relates to orchestrator architecture decisions
- [CLI Simplification and Wiki Iteration Examples](commits/8c4122db.md) - CLI simplification enforces LLM orchestration architecture