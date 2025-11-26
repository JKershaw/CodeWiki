---
title: "CodeWiki Project Plan and Architecture"
confidence: 0.50
created: 2025-11-26T10:23:33.361Z
updated: 2025-11-26T10:23:33.361Z
commits: [b908ecb120818e12f51e066a6a8619fc00adbe45]
---
# CodeWiki Project Plan and Architecture

Comprehensive project planning document establishing CodeWiki's vision, architecture, and principles. This is a foundational meta-document that defines the entire system's purpose, design philosophy, technical architecture, and implementation strategy.

## Key Points

- **PLANNING**: Complete project vision document defining CodeWiki as a living documentation system that generates wikis from Git repositories, exposes knowledge through MCP, and learns from AI coding sessions
- **PHILOSOPHY**: Six core principles established: eventual consistency over batch processing, confidence over completeness, organic growth, simplicity in architecture, clean abstractions, and self-documenting approach
- **ARCHITECTURE**: CQRS-based architecture defined with clear separation between commands/queries and core logic, repository pattern for storage abstraction (MongoDB/file-based), and two-loop orchestrator/executor model
- **DESIGN**: Multi-agent system architecture with specialized agents: analysis agents (code change, narrative, security, debt, pattern, dependency), research agent, writer agent, meta agents (structure, link, quality, consistency), and synthesis agents (guide, overview, history, convention)
- **DESIGN**: Write queue and conflict resolution strategy using single writer agent with timestamp-based conflict resolution
- **DESIGN**: Data model with MongoDB collections for repos, commits, agent runs, wiki pages, work queue, conflicts, and learnings
- **DECISION**: Technology stack selection: Node.js 20.4, MongoDB primary storage, file-based fallback for restricted environments, TypeScript for type safety
- **DECISION**: MCP (Model Context Protocol) chosen as the interface for AI agent integration, allowing external agents to query wiki for context

## Decisions Made

- Eventual consistency architecture: Prioritize fast, useful initial results (80% wiki in 20 minutes) over slow comprehensive processing (100% in 10 hours), with progressive enrichment over time
- Confidence-scored content: Every wiki entry carries confidence metadata based on analysis depth, verification, and recency, allowing users and agents to calibrate trust
- CQRS boundary: All external interaction through commands and queries, completely separating interface concerns from core business logic
- Single writer pattern: All wiki modifications flow through one writer agent to prevent race conditions and ensure consistency
- Dual storage strategy: Auto-detect between MongoDB (production) and file-based (local/restricted) repositories based on environment
- Two-loop orchestrator model: Lightweight frequent orchestrator decides what to process; separate executor runs agents in parallel against read-only wiki
- Self-documenting approach: CodeWiki will generate its own documentation, serving as its own best example
- Agent specialization: Multiple focused agents rather than one general-purpose analyzer, allowing targeted expertise and parallel processing
- Organic wiki growth: Start with recent commits, backfill history progressively, synthesize higher-order docs only when sufficient raw material exists

## Source Files



---
*Captured from commit b908ecb1*
