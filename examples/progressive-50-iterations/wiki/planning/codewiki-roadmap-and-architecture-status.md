---
title: "CodeWiki Roadmap and Architecture Status"
confidence: 0.5
path: planning/codewiki-roadmap-and-architecture-status
---

# CodeWiki Roadmap and Architecture Status

Significant planning and architectural documentation found. This merge introduces a comprehensive roadmap document comparing original vision (PLAN.md) against current implementation, along with a complete wiki structure documenting the project's architecture, agent system, and agentic tool-use patterns. The roadmap explicitly identifies gaps and future phases needed to reach a shareable demo.

## Key Points

- **PLANNING**: Comprehensive roadmap document (ROADMAP.md) comparing PLAN.md vision against actual implementation status, with clear gap analysis and future phases
- **ARCHITECTURE**: Agentic tool-use architecture pattern documented, showing shift from static analysis to agents that explore codebase dynamically
- **ARCHITECTURE**: Complete project overview document describing CQRS architecture, two-loop processing model, and repository pattern
- **DECISION**: Explicit decision to deprioritize auth/payments/multi-tenant complexity until costs are understood
- **PLANNING**: Three-phase roadmap to shareable demo: (1) Web UI, (2) Query Interface, (3) MCP Server
- **STATUS**: Agent implementation status: 5/6 analysis agents done, all 4 meta agents done, 3 synthesis agents done, 3/13 agents upgraded to use agentic tools
- **PLANNING**: Agentic tools implementation plan document created

## Decisions Made

- **Deferral of monetization complexity**: User accounts, auth, payments, usage tracking, and multi-tenant infrastructure deliberately deferred "until costs understood." This represents a strategic pivot from PLAN.md's "full product with auth, payments, GitHub OAuth" to a simpler deployment model focused on proving value first.
- **Three-phase path to demo**: Rather than building everything from PLAN.md, explicit decision to focus on (1) Web UI for viewing wikis, (2) Query interface for asking questions, (3) MCP server for AI agent integration. These three phases deliver core value without auth complexity.
- **Agentic tool-use architecture**: Shift from agents receiving pre-extracted commit data to agents that can explore the codebase themselves using tools. Only 3/13 agents upgraded so far, but architecture pattern established.
- **Eventual consistency principle**: System produces "useful wiki almost immediately from recent commits, then progressively enriches it by backfilling historical context over time" rather than batch-processing sequentially.
- **Two-loop processing model**: Lightweight orchestrator loop (2-3 LLM calls) frequently re-evaluates priorities, while executor loop runs agents in parallel. This enables adaptive prioritization based on wiki state rather than rigid queue processing.
- **Single writer pattern**: All wiki modifications flow through a single write queue processed by Writer Agent, preventing race conditions. Conflicts resolved by timestamp-based precedence.

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
