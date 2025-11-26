---
title: "CodeWiki Project Plan and Architecture"
confidence: 0.50
created: 2025-11-26T12:36:42.412Z
updated: 2025-11-26T12:36:42.412Z
commits: [b908ecb120818e12f51e066a6a8619fc00adbe45]
---
# CodeWiki Project Plan and Architecture

Complete project planning document establishing CodeWiki's architecture, philosophy, and implementation strategy. This is a foundational meta-document that defines the entire project vision, including the core insight about AI agents needing institutional memory, the CQRS architecture decision, the two-loop orchestration model, and the "eventual consistency over batch processing" philosophy.

## Key Points

- **PLANNING**: Complete project vision document establishing CodeWiki as a living wiki system for Git repositories, designed specifically to provide AI coding agents with institutional memory and context
- **PHILOSOPHY**: Six core principles defined: eventual consistency over batch processing, confidence over completeness, organic growth, simplicity in architecture, clean abstractions, and the repo as its own best example
- **ARCHITECTURE**: CQRS architecture decision with command/query separation creating a clean boundary between core logic and external interfaces
- **ARCHITECTURE**: Two-loop model established: lightweight orchestrator (outer loop) for decision-making and executor (inner loop) for parallel agent execution
- **DESIGN**: Repository pattern with dual implementations (MongoDB for production, file-based for development) enabling environment-agnostic deployment
- **DESIGN**: Single-writer queue pattern for conflict resolution, preventing race conditions by funneling all writes through one agent
- **ARCHITECTURE**: Multi-agent system with specialized agents: analysis agents (code, narrative, security, debt, pattern, dependency), meta agents (structure, link, quality, consistency), synthesis agents (guide, overview, history, convention), plus research and writer agents
- **DESIGN**: MCP server endpoint for exposing wiki knowledge to external AI coding agents

## Decisions Made

- **CQRS Architecture**: All external interaction flows through commands (state changes) and queries (reads), creating a clean separation between core logic and interfaces (HTTP, MCP, CLI). This makes the system easier to reason about and extend.
- **Eventual Consistency Philosophy**: Prioritize fast, useful results over slow comprehensive analysis. Generate an 80% wiki in 20 minutes rather than a 100% wiki in 10 hours by processing recent commits first and backfilling history progressively.
- **Confidence-Based Information**: Every wiki entry carries a confidence score based on analysis depth, verification, and recency. This allows users and AI agents to calibrate trust appropriately.
- **Two-Loop Orchestration**: Separate lightweight decision-making (orchestrator evaluating wiki state and generating work lists) from execution (parallel agent runs). This prevents rigid queue systems and allows dynamic re-prioritization.
- **Single-Writer Pattern**: All wiki modifications flow through one writer agent processing a queue. This eliminates race conditions and provides a single point for conflict resolution (timestamp-based: most recent wins).
- **Repository Pattern with Dual Implementation**: Abstract storage behind interfaces with MongoDB for production and file-based for development/restricted environments. Auto-detection based on environment configuration.
- **Database-as-Queue**: No external queue services—work queue is just database records with status fields. Keeps infrastructure simple and deployment straightforward.
- **Multi-Agent Specialization**: Different agents analyze commits through different lenses (code changes, narrative, security, technical debt, patterns, dependencies) rather than one monolithic analyzer.
- **Meta-Analysis Loop**: Agents that examine the wiki itself (structure, links, quality, consistency) create feedback loops for improvement.
- **MCP Integration**: Expose research capabilities via MCP server so external AI agents can query for context before starting work.

## Source Files



---
*Captured from commit b908ecb1*
