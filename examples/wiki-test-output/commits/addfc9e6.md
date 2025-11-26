---
title: "Meta-Agent System for Wiki Quality Analysis"
confidence: 0.55
created: 2025-11-26T15:38:00.934Z
updated: 2025-11-26T15:42:42.046Z
commits: [addfc9e6ba26bc56753b30cadb7949e2afa582d8]
---
# Meta-Agent System for Wiki Quality Analysis

The system includes two specialized meta-agents that analyze the entire wiki corpus to maintain documentation quality and consistency. Unlike regular agents that process individual commits, these meta-agents operate at the repository level, examining all wiki pages collectively to identify systemic issues that emerge as documentation grows.

The **Quality Agent** focuses on content excellence, evaluating each page for completeness, clarity, and usefulness. It checks for missing critical sections (like examples or related content), stale information that hasn't been updated alongside code changes, and documentation that lacks sufficient depth or explanation. The agent uses a combination of quick heuristic checks (token counts, section presence, timestamp analysis) and LLM-based deep analysis to assess whether pages meet documentation standards. It generates findings with specific improvement recommendations and can automatically create page updates to address common issues.

The **Consistency Agent** maintains coherence across the entire wiki, detecting problems that span multiple pages. It identifies broken cross-references (links to non-existent pages), duplicate or highly similar content that should be consolidated, orphaned pages with no incoming or outgoing links, terminology inconsistencies where the same concept has different names, and category mismatches where content is filed under the wrong organizational structure. The agent builds a link graph of all pages and uses both structural analysis and LLM-powered semantic comparison to find inconsistencies. Both agents integrate into the orchestrator workflow and can be triggered via CLI commands, with configurable thresholds for analysis depth and issue severity.



## Source

- **Commit:** addfc9e6
- **Files:** `src/agents/meta/consistency-agent.ts`, `src/agents/meta/index.ts`, `src/agents/meta/quality-agent.ts`, `src/agents/orchestrator/orchestrator.ts`, `src/cli.ts`, `src/executor/executor.ts`, `src/repositories/file-based/file-agent-run-repository.ts`, `tests/unit/consistency-agent.test.ts`, `tests/unit/quality-agent.test.ts`


---



## Related Pages

- [Complete Multi-Agent Wiki Generation System](commits/82193f9f.md) - Meta-agents are core components of the complete multi-agent system
- [LLM-Powered Work Orchestration System](commits/fdcf054c.md) - Meta-agents operate within orchestrator's work prioritization system
- [Writer Agent - Encyclopedia-Style Content Transformation](commits/659d7dd1.md) - Quality Agent and Writer Agent are both meta-agents for wiki improvement
- [Overview Agent for Category Synthesis](commits/32b7cb2f.md) - Quality Agent works alongside Overview Agent in meta-agent layer
- [Improve wiki export and agent prompts for better content quality](commits/b49c7432.md) - Both focus on improving wiki quality through agent processing
- [Anti-Patterns to Avoid](patterns/anti-patterns.md) - Quality Agent identifies documentation anti-patterns