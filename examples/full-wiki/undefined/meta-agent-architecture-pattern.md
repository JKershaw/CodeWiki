---
title: "Meta-Agent Architecture Pattern"
confidence: 0.50
created: 2025-11-26T12:32:37.326Z
updated: 2025-11-26T12:32:37.326Z
commits: [4d2e0c45078eba61baaed35ac0a8c86472de1c29]
---
# Meta-Agent Architecture Pattern

This commit introduces a meta-agent architecture pattern: agents that analyze and improve the wiki itself rather than processing commits. The Link Agent specifically creates cross-references between wiki pages to build a knowledge graph. This is a significant architectural evolution showing the system's self-improving capability.

## Key Points



## Decisions Made

- Introduced meta-agents as a distinct category that operates on the wiki itself rather than commits, enabling the system to analyze and improve its own knowledge base
- Link Agent analyzes all wiki pages to find semantic relationships and creates bidirectional cross-references, building a knowledge graph from isolated documentation
- Meta-agents use different execution paths in the orchestrator - they receive the entire wiki state rather than individual commits
- Link Agent only runs when pages lack links or have low confidence, avoiding redundant analysis
- Links are stored bidirectionally - both forward links (in content) and backlinks (in relatedPages metadata)

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
