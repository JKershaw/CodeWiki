---
title: "CodeWiki Multi-Agent Architecture Design"
confidence: 0.50
created: 2025-11-26T17:45:55.818Z
updated: 2025-11-26T17:45:55.818Z
commits: undefined
---
# CodeWiki Multi-Agent Architecture Design

This commit adds comprehensive example output demonstrating CodeWiki's architecture and capabilities through a 50-iteration wiki generation example. The example showcases the system's multi-agent architecture, orchestration strategies, and documentation philosophy. This is meta-documentation about the CodeWiki system itself, revealing its core architectural decisions and design principles.

## Key Points

- **ARCHITECTURE**: Dual-mode orchestrator design with deterministic fallback pattern - operates in deterministic mode by default with optional LLM-powered intelligent mode using Claude Haiku 4.5. Three-tier fallback strategy prioritizes reliability over intelligence.
- **ARCHITECTURE**: Clear separation between Analysis Agents (process individual commits) and Meta Agents (synthesize/improve existing wiki content). This architectural boundary enables targeted orchestration strategies and clearer system responsibilities.
- **DESIGN**: Writer Agent as specialized meta agent that transforms commit-style documentation into encyclopedia-style articles. Operates at synthesis tier, detecting and rewriting phrases like "this commit adds" into present-tense explanations.
- **PHILOSOPHY**: Encyclopedia-style documentation philosophy enforced throughout the system - documentation should explain concepts as they exist, not describe history of how they were added. Philosophy embedded in agent prompts, quality metrics, and transformation rules.
- **ARCHITECTURE**: Context-gathering system assembles comprehensive wiki state snapshot before orchestration decisions: commit coverage metrics, category organization, page quality indicators, agent activity history. Enables data-driven decision-making.
- **DESIGN**: Quality tracking system maintains indicators for orchestration: pages with commit-style language, pages lacking internal links, low-confidence pages, categories missing overviews. Informs prioritization of improvement work.
- **ARCHITECTURE**: Comprehensive audit trail for every orchestration execution: context snapshot, decisions and rationale, agent execution results, timestamps and performance metrics. Enables pattern analysis and ongoing optimization.
- **DESIGN**: Overview Agent as synthesis agent that generates Wikipedia-style overview pages for categories once they reach sufficient size. Operates on collections of existing pages rather than individual commits.

## Decisions Made

- **Dual-mode orchestrator with deterministic default**: System operates in fast, rule-based deterministic mode by default, with optional LLM-powered mode for intelligent optimization. Decision prioritizes production reliability while enabling advanced capabilities when needed.
- **Three-tier fallback strategy**: LLM orchestration → deterministic strategy → continued operation. Design philosophy explicitly prioritizes reliability over intelligence - system must remain operational regardless of AI service availability.
- **Analysis vs Meta agent separation**: Fundamental architectural boundary separates commit processing (analysis agents) from content improvement (meta agents). Enables clearer system design and targeted orchestration.
- **Encyclopedia-style documentation mandate**: System enforces present-tense, third-person explanatory style throughout, rejecting commit-history narrative. Philosophy embedded in prompts, metrics, and dedicated Writer Agent for transformation.
- **Claude Haiku 4.5 for orchestration**: Model selection optimizes for cost, speed, and capability balance in production where orchestration decisions happen frequently.
- **Context-driven orchestration**: System gathers comprehensive wiki state before making decisions rather than following fixed schedules. Enables data-driven prioritization based on actual wiki needs.

## Source Files

- `examples/wiki-50-iterations/architecture/codewiki-system-architecture-and-agent-design.md`
- `examples/wiki-50-iterations/architecture/overview.md`
- `examples/wiki-50-iterations/commits/32b7cb2f.md`
- `examples/wiki-50-iterations/commits/3f14bd3e.md`
- `examples/wiki-50-iterations/commits/4101e622.md`
- `examples/wiki-50-iterations/commits/64a8801e.md`
- `examples/wiki-50-iterations/commits/659d7dd1.md`
- `examples/wiki-50-iterations/commits/7b58314c.md`
- `examples/wiki-50-iterations/commits/8c4122db.md`
- `examples/wiki-50-iterations/commits/b49c7432.md`
- `examples/wiki-50-iterations/commits/ddc9b52b.md`
- `examples/wiki-50-iterations/commits/fdcf054c.md`
- `examples/wiki-50-iterations/conventions/coding-standards.md`
- `examples/wiki-50-iterations/decisions/llm-powered-orchestrator-architecture.md`
- `examples/wiki-50-iterations/guides/getting-started.md`
- `examples/wiki-50-iterations/index.md`
- `examples/wiki-50-iterations/patterns/anti-patterns.md`
- `examples/wiki-50-iterations/planning/wiki-synthesis-strategy.md`

---
*Captured from commit 68a74ae6*
