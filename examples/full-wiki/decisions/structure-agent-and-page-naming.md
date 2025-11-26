---
title: "Structure Agent and Page Naming"
confidence: 0.50
created: 2025-11-26T10:18:27.871Z
updated: 2025-11-26T10:18:27.871Z
commits: [82525543ff9587140a9ad12be99f55a1b41b69f2]
---
# Structure Agent and Page Naming

This commit introduces a significant architectural enhancement: a meta-level "Structure Agent" that analyzes the codebase's organization and wiki page naming. The commit reveals a multi-agent system design where specialized agents (narrative, structure) work together to generate living documentation. Key decisions include improving wiki page naming with contextual titles and adding a structure agent to identify organizational patterns.

## Key Points

- **ARCHITECTURE**: Introduction of meta-agent pattern - Structure Agent operates at a different level than analysis agents, suggesting a layered agent architecture
- **DESIGN_DECISION**: Wiki pages now require explicit titles (PAGE_TITLE field) rather than deriving them from paths, improving human readability
- **TOOLING**: Complete end-to-end testing script added for wiki generation with markdown export for quality review
- **AGENT_TYPES**: System distinguishes between analysis agents (narrative) and meta agents (structure), with orchestrator coordinating both
- **QUALITY**: Structure agent findings are surfaced in review output, enabling meta-level quality assessment

## Decisions Made

- Decision to add meta-agents that analyze the wiki structure itself, not just code commits - enables self-improving documentation quality
- Decision to make page titles explicit semantic labels (3-6 words) rather than path-derived names - prioritizes human comprehension over technical paths
- Decision to create comprehensive review/export tooling early - suggests quality and reviewability are first-class concerns
- Decision to track and display agent run statistics by type - enables observability into the multi-agent system's behavior

## Source Files

- `scripts/generate-and-review.ts`
- `src/agents/analysis/narrative-agent.ts`
- `src/agents/meta/index.ts`
- `src/agents/meta/structure-agent.ts`
- `src/agents/orchestrator/orchestrator.ts`
- `src/executor/executor.ts`
- `tests/unit/structure-agent.test.ts`

---
*Captured from commit 82525543*
