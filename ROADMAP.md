# CodeWiki Roadmap

## Current State vs Original Plan

### What PLAN.md Envisioned vs What's Built

| Component | PLAN.md Vision | Status |
|-----------|----------------|--------|
| **CQRS Layer** | Commands & queries boundary | ✅ Done |
| **Repository Pattern** | MongoDB + file-based fallback | ✅ Done (file-based working) |
| **Two-Loop Model** | Orchestrator + Executor | ✅ Done |
| **Write Queue** | Single writer, conflict resolution | ✅ Done (Writer Agent) |
| **Analysis Agents** | Code-change, narrative, security, pattern, dependency | ✅ 5/6 done (no tech-debt agent) |
| **Meta Agents** | Structure, link, quality, consistency | ✅ All 4 done |
| **Synthesis Agents** | Guide, overview, history, convention | ⚠️ 3 done (overview, project-overview, getting-started) |
| **Research Agent** | Query the wiki | ✅ Done |
| **Agentic Tool Use** | Agents explore codebase | ⚠️ 3/13 agents upgraded |
| **Web Interface** | Full UI with OAuth, progress, drill-down | ⚠️ API only, no frontend |
| **MCP Endpoint** | Expose research agent | ❌ Not started |
| **CLI** | Process repos locally | ✅ Done |

## Remaining Roadmap

### Phase 1: Web UI
Make it visually usable.

- Frontend pages (repo list, wiki viewer)
- Processing controls (start, stop, progress)
- Real-time updates

### Phase 2: Query Interface
Core value proposition.

- Query UI (ask questions, see answers)
- Research agent endpoint
- Streaming responses
- Source citations

### Phase 3: MCP Server
AI coding integration.

- MCP endpoint for queries
- Auth tokens
- Rate limiting

### Phase 4: Polish

- More tool-using agents (10 remaining)
- GitHub OAuth (optional)
- Error handling & monitoring

## Deferred (Until Costs Understood)

- User accounts & auth
- Payments integration
- Usage tracking & billing
- Multi-tenant infrastructure

## Summary

**PLAN.md scope:** Full product with auth, payments, GitHub OAuth, real-time UI

**Current reality:** Solid backend, CLI works great, wiki quality is good with tool-using agents

**Gap to shareable demo:**
1. Web UI (can see the wiki)
2. Query interface (can ask questions)
3. MCP server (AI agents can use it)

Three phases, no auth complexity. Can be run locally or as a single shared instance.
