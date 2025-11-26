---
title: "This commit adds a comprehensive project planning document (PLAN.md) that establishes the vision, ph"
confidence: 0.50
created: 2025-11-25T22:11:36.274Z
updated: 2025-11-25T22:11:36.274Z
commits: [b908ecb120818e12f51e066a6a8619fc00adbe45]
---
# This commit adds a comprehensive project planning document (PLAN.md) that establishes the vision, ph

This commit adds a comprehensive project planning document (PLAN.md) that establishes the vision, philosophy, architecture, and technical decisions for CodeWiki. This is a foundational meta-document that explains the entire "why" behind the system - not just what it does, but the reasoning behind architectural choices, design principles, and implementation strategies.

## Key Points

- **PLANNING**: Complete project vision document covering purpose, philosophy, architecture, and implementation strategy
- **PHILOSOPHY**: Five core principles explicitly stated: eventual consistency, confidence over completeness, organic growth, architectural simplicity, and clean abstractions
- **ARCHITECTURE**: Detailed architecture explanation including CQRS layer, repository pattern, two-loop orchestrator/executor model, and write queue with conflict resolution
- **DESIGN**: Component breakdown of all major system parts (web interface, agents, MCP endpoint) with clear responsibilities
- **ADR**: Implicit architectural decisions: MongoDB vs file-based storage, Node.js runtime choice, single database for all state
- **DESIGN**: Data model specification showing core collections and their relationships

## Decisions Made

- **Eventual consistency over batch processing**: System prioritizes fast, incremental wiki generation (80% in 20 minutes) over complete sequential processing (100% in 10 hours). Rationale: Immediate usefulness beats delayed perfection.
- **CQRS architectural boundary**: All external interactions go through command/query layer to separate core logic from interfaces. Rationale: Clean separation makes system easier to reason about and enables multiple interfaces (HTTP, MCP, CLI).
- **Repository pattern with dual implementations**: MongoDB for production, file-based for development/restricted environments. Rationale: Enables work in environments without database access (like Claude's web environment) while keeping production robust.
- **Two-loop orchestrator/executor model**: Lightweight orchestrator decides what to do, separate executor runs the work. Rationale: Keeps decision-making fast and re-evaluates priorities frequently rather than committing to rigid queue.
- **Single write queue with writer agent**: All wiki modifications go through one bottleneck. Rationale: Prevents race conditions and conflicting edits while allowing parallel reads.
- **Confidence scoring system**: Every wiki entry has confidence based on analysis depth and verification. Rationale: Users and agents can calibrate trust; low-confidence areas get prioritized for processing.
- **Multiple specialized agents**: Different agents for code changes, narrative, security, technical debt, patterns, dependencies, synthesis, meta-analysis. Rationale: Different lenses reveal different insights; orchestrator balances the work mix.
- **Self-documenting approach**: CodeWiki will generate its own wiki using AI agents. Rationale: Repository becomes proof-of-concept and demonstrates the system's value.

## Source Files



---
*Captured from commit b908ecb1*
