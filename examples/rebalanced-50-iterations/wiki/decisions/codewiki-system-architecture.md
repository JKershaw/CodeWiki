---
title: "CodeWiki System Architecture"
confidence: 0.50
created: Thu Nov 27 2025 14:04:00 GMT+0000 (Coordinated Universal Time)
updated: Thu Nov 27 2025 14:04:00 GMT+0000 (Coordinated Universal Time)
---

# CodeWiki System Architecture

This commit deletes an entire example wiki directory that contained comprehensive documentation about CodeWiki's architecture, design decisions, and system philosophy. The deleted content reveals significant narrative documentation about the system's multi-agent architecture, CQRS design, orchestration strategies, and documentation philosophy.

## Key Points



## Decisions Made

- Dual-mode orchestrator with deterministic default: System prioritizes reliability over intelligence with fast rule-based mode and optional LLM-powered intelligent mode using Claude Haiku 4.5
- Three-tier fallback strategy: LLM orchestration → deterministic strategy → continued operation, explicitly prioritizing system reliability over AI capabilities
- CQRS architecture: All external interaction through Command-Query separation with commands changing state and queries reading state
- Encyclopedia-style documentation mandate: System enforces present-tense explanatory style, rejecting commit-history narrative through dedicated Writer Agent
- Analysis vs Meta agent separation: Clear architectural boundary between commit processing agents and content improvement agents
- Repository pattern with dual storage: MongoDB for production, file-based for development with auto-detection

## Source Files

- `example-wiki/architecture/codewiki-multi-agent-architecture-design.md`
- `example-wiki/architecture/overview.md`
- `example-wiki/commits/3f14bd3e.md`
- `example-wiki/commits/4101e622.md`
- `example-wiki/commits/64a8801e.md`
- `example-wiki/commits/659d7dd1.md`
- `example-wiki/commits/68a74ae6.md`
- `example-wiki/commits/7b58314c.md`
- `example-wiki/commits/80221a0a.md`
- `example-wiki/commits/8c4122db.md`
- `example-wiki/commits/ddc9b52b.md`
- `example-wiki/commits/fdcf054c.md`
- `example-wiki/conventions/coding-standards.md`
- `example-wiki/guides/getting-started.md`
- `example-wiki/index.md`
- `example-wiki/patterns/anti-patterns.md`
- `example-wiki/planning/agentic-tool-using-agents-design.md`

---
*Captured from commit c600a87f*
