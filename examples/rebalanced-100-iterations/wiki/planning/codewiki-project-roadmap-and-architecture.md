---
title: "CodeWiki Project Roadmap and Architecture"
confidence: 0.50
created: Thu Nov 27 2025 14:19:08 GMT+0000 (Coordinated Universal Time)
updated: Thu Nov 27 2025 14:19:08 GMT+0000 (Coordinated Universal Time)
---

# CodeWiki Project Roadmap and Architecture

Comprehensive project documentation including a detailed roadmap comparing current state to original vision, complete architecture overview explaining the two-loop CQRS system, and extensive meta-documentation about agentic tool use patterns.

## Key Points

- **PLANNING**: New comprehensive roadmap comparing PLAN.md vision against current implementation status, showing 80% completion with clear next phases
- **ARCHITECTURE**: Complete system architecture documentation explaining CQRS boundary, two-loop processing model, write queue, and agent system
- **DESIGN**: Agentic tool use architecture pattern documentation explaining tool-use loops and exploration capabilities
- **PLANNING**: Implementation plan for agentic tools feature rollout
- **GUIDE**: Multiple development guides including getting started, agent development, and coding standards

## Decisions Made

- CQRS architecture chosen with clear command/query boundary separating core logic from external interfaces
- Two-loop processing model: lightweight orchestrator loop for prioritization, parallel executor loop for agent work
- Repository pattern with MongoDB production and file-based development implementations for environment flexibility
- Single write queue with timestamp-based conflict resolution to prevent race conditions
- Agentic tool use pattern allowing agents to explore codebase dynamically rather than receiving fixed context
- Three-phase roadmap prioritizing Web UI, Query Interface, then MCP Server integration
- Deferred user accounts and billing until costs are understood

## Source Files

- `ROADMAP.md`
- `examples/wiki-20-iterations-agentic/agents/code-change-agent.md`
- `examples/wiki-20-iterations-agentic/architecture/agentic-tool-use.md`
- `examples/wiki-20-iterations-agentic/architecture/overview.md`
- `examples/wiki-20-iterations-agentic/commits/1cec4b8a.md`
- `examples/wiki-20-iterations-agentic/commits/3797446e.md`
- `examples/wiki-20-iterations-agentic/commits/4101e622.md`
- `examples/wiki-20-iterations-agentic/commits/64a8801e.md`
- `examples/wiki-20-iterations-agentic/commits/68a74ae6.md`
- `examples/wiki-20-iterations-agentic/commits/6d0a4e65.md`
- `examples/wiki-20-iterations-agentic/commits/7b58314c.md`
- `examples/wiki-20-iterations-agentic/commits/80221a0a.md`
- `examples/wiki-20-iterations-agentic/commits/9ac80919.md`
- `examples/wiki-20-iterations-agentic/commits/e584b6e6.md`
- `examples/wiki-20-iterations-agentic/components/codebase-tools.md`
- `examples/wiki-20-iterations-agentic/conventions/coding-standards.md`
- `examples/wiki-20-iterations-agentic/guides/agent-development.md`
- `examples/wiki-20-iterations-agentic/guides/getting-started.md`
- `examples/wiki-20-iterations-agentic/index.md`
- `examples/wiki-20-iterations-agentic/patterns/anti-patterns.md`
- `examples/wiki-20-iterations-agentic/planning/agentic-tools-implementation-plan.md`
- `src/agents/analysis/code-change-agent.ts`
- `src/agents/orchestrator/orchestrator.ts`

---
*Captured from commit adbc48ad*
