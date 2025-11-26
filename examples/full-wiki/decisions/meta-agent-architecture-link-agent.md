---
title: "Meta-Agent Architecture: Link Agent"
confidence: 0.50
created: 2025-11-26T10:19:08.369Z
updated: 2025-11-26T10:19:08.369Z
commits: [4d2e0c45078eba61baaed35ac0a8c86472de1c29]
---
# Meta-Agent Architecture: Link Agent

Significant architectural decision documenting the creation of a "Link Agent" - a meta-agent that analyzes wiki pages to create cross-references and build a knowledge graph. This represents a major evolution in the system's architecture from simple documentation generation to intelligent relationship discovery.

## Key Points



## Decisions Made

- Decision to introduce "meta-agents" as a distinct class of agents that operate on the wiki itself rather than individual commits, enabling higher-order analysis and improvements
- Decision to implement link discovery as the first meta-agent, addressing the problem of isolated wiki pages lacking semantic connections
- Decision to trigger meta-agents conditionally based on wiki state (e.g., pages without links) rather than on every commit, optimizing for efficiency
- Decision to use LLM-based semantic analysis for relationship discovery rather than simple keyword matching or manual linking

## Source Files

- `examples/link-agent-test/results.json`
- `package-lock.json`
- `package.json`
- `src/agents/index.ts`
- `src/agents/meta/index.ts`
- `src/agents/meta/link-agent.ts`
- `src/agents/orchestrator/orchestrator.ts`
- `src/executor/executor.ts`
- `tests/unit/link-agent.test.ts`

---
*Captured from commit 4d2e0c45*
