---
title: "Wiki Synthesis Strategy"
confidence: 0.70
created: 2025-11-26T16:31:32.837Z
updated: 2025-11-26T16:34:58.791Z
commits: [64a8801ea6c6d6680e59da4c91ced8949a244e41]
---
# Wiki Synthesis Strategy

The wiki synthesis strategy defines how CodeWiki transforms raw commit documentation into structured, navigable knowledge. Rather than simply accumulating commit pages, the system employs a staged synthesis approach that prioritizes useful project understanding over comprehensive coverage.

## The Synthesis Problem

Wiki generation systems face a fundamental tension between completeness and utility. In large repositories, a naive approach of documenting every commit before synthesis produces wikis with poor signal-to-noise ratios. Analysis of generated wikis revealed that percentage-based synthesis triggers (such as "synthesize at 60% coverage") cause synthesis to occur too late—often after hundreds of commits have been processed—resulting in wikis where 59% of pages are raw commit documentation rather than conceptual articles.

For AI coding agents, this creates a poor user experience: they need rapid project understanding, not exhaustive historical documentation.

## Page-Count-Based Triggers

The synthesis strategy uses absolute page counts rather than percentage-based coverage to trigger synthesis work:

- **5 pages**: Initial synthesis begins, representing approximately 20% of typical iteration budgets
- **10 pages**: Enhanced synthesis with additional structural work (30% of iterations)
- **15 pages**: Full project overview generation required

This approach ensures that even large repositories receive useful synthesis early in the documentation process. A repository with 1,000 commits will have meaningful structure after just 15 pages, rather than waiting until 600 commits have been processed.

## Design Principle

The strategy follows a core principle: **"A useful wiki with good structure beats comprehensive coverage."**

This reflects the primary use case: AI coding agents need to quickly understand a project's architecture, patterns, and conventions. Exhaustive commit history is less valuable than well-organized conceptual documentation.

## Index as Project Introduction

The wiki index serves as the project's front door, not merely a table of contents. It explains what the project does, its key concepts, and provides navigational structure. Raw commit pages are collapsed into a "Recent Changes" section, acknowledging their lower value for system understanding.

## Implementation Architecture

The synthesis strategy is implemented across several components:

1. **Orchestrator triggers**: The [Orchestrator](../agents/orchestrator.md) monitors page count and schedules synthesis work at the defined thresholds
2. **Index generation**: Dynamic index construction that balances navigation with project introduction
3. **Project Overview Agent**: Generates high-level architecture and concept articles
4. **Getting Started Agent**: Creates onboarding documentation for new contributors

The orchestrator prioritizes synthesis and meta work earlier in the process, recognizing that structural improvements have higher impact than additional commit coverage.

## Technical Details

The implementation uses Git SHAs rather than internal UUIDs for commit identification in orchestrator context, improving clarity during debugging and making the system's decision-making more transparent.

Source files implementing this strategy include:
- `src/agents/orchestrator/orchestrator.ts`
- `src/agents/orchestrator/context-gatherer.ts`
- `src/agents/orchestrator/prompts.ts`
- `src/executor/executor.ts`

## Related Concepts

- [Orchestrator](../agents/orchestrator.md) - The agent that implements synthesis triggers
- [Wiki Structure](wiki-structure.md) - How synthesized content is organized
- [Agent Architecture](../architecture/agent-architecture.md) - The multi-agent system design