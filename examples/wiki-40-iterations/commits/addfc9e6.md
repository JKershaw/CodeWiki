---
title: "Meta-Agent Architecture for Wiki Quality Management"
confidence: 0.85
created: 2025-11-26T14:48:52.814Z
updated: 2025-11-26T15:09:23.435Z
commits: [addfc9e6ba26bc56753b30cadb7949e2afa582d8]
---
# Meta-Agent System for Wiki Quality Analysis

The system includes specialized meta-agents that analyze the entire wiki rather than individual commits. These agents operate at a higher level of abstraction, examining cross-cutting concerns like consistency and quality across all documentation pages. The meta-agent architecture recognizes that certain documentation issues can only be detected by looking at the wiki holistically—broken links, terminology inconsistencies, duplicate content, and structural problems emerge from relationships between pages rather than from individual page content.

Two meta-agents implement this capability: the Consistency Agent detects inconsistencies across pages (broken links, duplicate titles, similar content, orphaned pages, and category mismatches), while the Quality Agent evaluates overall documentation health (completeness, clarity, maintainability, and freshness). Both agents use a hybrid approach combining fast deterministic checks with LLM-powered deep analysis. The quick checks handle objective issues like broken links without consuming tokens, while LLM analysis handles subjective judgments about content quality and appropriate categorization. This design optimizes both cost and accuracy by reserving expensive LLM calls for problems that require semantic understanding.

The meta-agents integrate into the orchestrator as a separate execution phase that runs after commit-based agents complete. The orchestrator identifies which meta-agents are enabled, executes them with access to the complete wiki state, and stores their results as special agent runs with `commitId: null`. This separation allows meta-agents to maintain different interfaces and performance characteristics while sharing the same result storage and presentation infrastructure. The file-based repository implementation handles null commit IDs appropriately, storing meta-agent runs in a dedicated directory structure that distinguishes them from commit-specific analysis.



## Source

- **Commit:** addfc9e6
- **Files:** `src/agents/meta/consistency-agent.ts`, `src/agents/meta/index.ts`, `src/agents/meta/quality-agent.ts`, `src/agents/orchestrator/orchestrator.ts`, `src/cli.ts`, `src/executor/executor.ts`, `src/repositories/file-based/file-agent-run-repository.ts`, `tests/unit/consistency-agent.test.ts`, `tests/unit/quality-agent.test.ts`


---



## Related Pages

- [Intelligent Work Orchestration System](commits/fdcf054c.md) - Meta-agents managed by orchestration system
- [Full Wiki Example: Multi-Agent Documentation System Demonstration](commits/82193f9f.md) - Meta-agents are part of multi-agent documentation system
- [Wiki Generation System Example and Review](commits/3f14bd3e.md) - Meta-agents included in wiki generation example
- [Writer Agent: Encyclopedia-Style Content Generation](commits/659d7dd1.md) - Writer Agent is another type of meta-agent
- [Structure Agent and Wiki Page Naming System](commits/82525543.md) - Structure Agent is another meta-agent analyzing wiki holistically
- [Overview Agent and Category Synthesis System](commits/32b7cb2f.md) - Overview Agent is synthesis agent with similar meta-level focus