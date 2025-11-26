---
title: "Meta-Agent Architecture for Wiki Quality Management"
confidence: 0.50
created: 2025-11-26T14:48:52.814Z
updated: 2025-11-26T14:48:52.814Z
commits: [addfc9e6ba26bc56753b30cadb7949e2afa582d8]
---
# Meta-Agent Architecture for Wiki Quality Management

The wiki documentation system includes a meta-agent layer that operates at a higher level than content-generating agents. Meta-agents analyze the entire wiki corpus to detect system-wide issues that individual agents cannot identify when operating on single commits. Two specialized meta-agents provide automated quality assurance: the Quality Agent evaluates documentation standards and completeness, while the Consistency Agent detects cross-page inconsistencies like broken links, duplicate content, and terminology conflicts.

These meta-agents run periodically on the complete wiki rather than per-commit, enabling holistic analysis that catches issues like contradictory information across pages, orphaned content with no incoming links, and content that belongs in different categories. They use both rule-based quick checks (for deterministic issues like broken links) and LLM-powered deep analysis (for semantic issues like terminology inconsistencies). The agents generate findings with severity levels and can propose wiki page updates to resolve identified issues, providing a self-healing mechanism for documentation quality.

The architecture separates concerns by giving meta-agents their own namespace (`agents/meta/`) and a distinct execution model through `runOnWiki()` rather than `runOnCommit()`. The orchestrator integrates these agents into the workflow, and the executor handles their specialized run requirements. This design allows the system to maintain documentation quality automatically while scaling to larger wikis, with configurable thresholds to balance thoroughness against processing costs.



## Source

- **Commit:** addfc9e6
- **Files:** `src/agents/meta/consistency-agent.ts`, `src/agents/meta/index.ts`, `src/agents/meta/quality-agent.ts`, `src/agents/orchestrator/orchestrator.ts`, `src/cli.ts`, `src/executor/executor.ts`, `src/repositories/file-based/file-agent-run-repository.ts`, `tests/unit/consistency-agent.test.ts`, `tests/unit/quality-agent.test.ts`
