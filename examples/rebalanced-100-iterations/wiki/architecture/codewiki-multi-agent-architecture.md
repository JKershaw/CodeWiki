---
title: "CodeWiki Multi-Agent Architecture"
confidence: 0.50
created: Thu Nov 27 2025 14:27:20 GMT+0000 (Coordinated Universal Time)
updated: Thu Nov 27 2025 14:27:20 GMT+0000 (Coordinated Universal Time)
---

# CodeWiki Multi-Agent Architecture

This commit adds a comprehensive example wiki demonstrating CodeWiki's multi-agent architecture, orchestration strategies, and documentation philosophy. The example reveals detailed architectural decisions including dual-mode orchestration, CQRS boundaries, encyclopedia-style documentation mandate, and agent specialization patterns.

## Key Points



## Decisions Made

- Dual-mode orchestrator with deterministic default: System operates in fast, rule-based mode by default with optional LLM mode, prioritizing production reliability while enabling advanced capabilities
- Analysis vs Meta agent separation: Fundamental architectural boundary separates commit processing from content improvement, enabling clearer system design
- Encyclopedia-style documentation mandate: System enforces present-tense explanatory style, rejecting commit-history narrative through prompts, metrics, and dedicated transformation
- Three-tier fallback strategy: Design explicitly prioritizes system reliability over AI intelligence - must remain operational regardless of service availability
- Claude Haiku 4.5 for orchestration: Model selection optimized for cost, speed, and capability balance in production environments
- Context-driven orchestration: Gathers comprehensive wiki state before decisions rather than following fixed schedules

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
*Captured from commit 3797446e*
