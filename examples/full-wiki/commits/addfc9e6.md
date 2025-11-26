---
title: "Meta-Agent Architecture: Quality and Consistency Analysis"
confidence: 0.55
created: 2025-11-26T12:25:50.976Z
updated: 2025-11-26T13:05:14.107Z
commits: [addfc9e6ba26bc56753b30cadb7949e2afa582d8]
---
# Meta-Agent Architecture: Quality and Consistency Analysis

The wiki documentation system includes a meta-agent layer that operates at a higher level than commit-based agents. Meta-agents analyze the entire wiki corpus to identify systemic issues that cannot be detected by examining individual commits in isolation. Two specialized meta-agents provide complementary analysis capabilities: the Quality Agent evaluates documentation standards and completeness, while the Consistency Agent detects conflicts and redundancies across pages.

The Consistency Agent performs both quick heuristic checks and deep LLM-based semantic analysis to identify problems that emerge from the wiki as a whole. It detects broken cross-references where pages link to non-existent content, finds duplicate or highly similar pages that should be merged, identifies orphaned pages with no incoming or outgoing links, and flags potential category mismatches where content about security appears in architecture folders or vice versa. The agent uses a two-tier approach: fast rule-based checks for obvious structural issues, followed by LLM analysis for semantic inconsistencies like terminology variations or contradictory information across pages.

The Quality Agent complements this by evaluating individual pages against documentation standards, checking for completeness, clarity, and proper structure. Together, these meta-agents ensure wiki documentation maintains high quality and internal coherence as it grows. The orchestrator integrates these agents into the workflow, running them periodically on the full wiki corpus rather than per-commit. This design reflects a key architectural principle: some quality issues only become apparent when viewing the documentation holistically rather than incrementally.



## Source

- **Commit:** addfc9e6
- **Files:** `src/agents/meta/consistency-agent.ts`, `src/agents/meta/index.ts`, `src/agents/meta/quality-agent.ts`, `src/agents/orchestrator/orchestrator.ts`, `src/cli.ts`, `src/executor/executor.ts`, `src/repositories/file-based/file-agent-run-repository.ts`, `tests/unit/consistency-agent.test.ts`, `tests/unit/quality-agent.test.ts`


---



## Related Pages

- [Structure Agent and Wiki Organization System](commits/82525543.md) - Both describe meta-agents for wiki analysis (Quality/Consistency and Structure)
- [Link Agent - Wiki Cross-Reference System](commits/4d2e0c45.md) - Link Agent is another meta-agent complementing Quality/Consistency agents
- [Overview Agent for Wiki Category Synthesis](commits/32b7cb2f.md) - Overview Agent is another meta-agent in the same system
- [Meta-Agent Wiki Analysis Architecture](architecture/meta-agent-wiki-analysis-architecture.md) - Architectural documentation for these meta-agents
- [Meta-Agent Architecture Pattern](undefined/meta-agent-architecture-pattern.md) - Meta-agent pattern that Quality/Consistency agents implement
- [Full Wiki Example: Multi-Agent Documentation System](commits/82193f9f.md) - Meta-agents are part of the complete multi-agent system
- [Security Audit: Commit addfc9e6](security/audit-addfc9e6.md) - Security audit for this specific commit
- [Multi Agent System](architecture/multi-agent-system.md) - Meta-agents are part of the multi-agent architecture