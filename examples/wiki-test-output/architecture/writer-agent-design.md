---
title: "Writer Agent Design"
confidence: 0.50
created: 2025-11-26T15:40:45.942Z
updated: 2025-11-26T15:40:45.942Z
commits: [659d7dd1c6000904ad6b487a8fd185291854f550]
---
# Writer Agent Design

Design and implementation documentation for the Writer Agent, a synthesis-level component that transforms raw commit-style wiki content into polished encyclopedia articles. Includes rationale for separation of concerns between analysis and presentation.

## Key Points

- **ARCHITECTURE**: Introduction of Writer Agent as a dedicated synthesis component to transform raw analysis into polished documentation. Implements separation between content generation (analysis agents) and content presentation (writer agent). Related paths: src/agents/synthesis/writer-agent.ts, src/agents/orchestrator/orchestrator.ts
- **DESIGN_DECISION**: Writer Agent operates at synthesis tier, processing existing wiki pages rather than commits. This reinforces the multi-tier architecture where raw analysis is separated from presentation layer. Related paths: src/agents/synthesis/writer-agent.ts
- **PATTERN**: Detection heuristics for "commit-style" content include checking for phrases like "this commit", "this adds", etc. Provides concrete definition of what constitutes raw vs. polished content. Related paths: src/agents/synthesis/writer-agent.ts
- **DESIGN_DECISION**: Writer Agent skips certain categories (commits, security) and overview pages, acknowledging that some content is appropriately commit-focused or already synthesized. Related paths: src/agents/orchestrator/orchestrator.ts

## Decisions Made

- Created dedicated Writer Agent to handle transformation of raw analysis into encyclopedia-style articles, separating concerns between content extraction (analysis tier) and content presentation (synthesis tier)
- Writer Agent operates on wiki pages rather than commits, positioning it as a synthesis-level agent that refines existing documentation
- Implemented automatic detection of pages needing rewriting based on linguistic patterns ("this commit", "this adds", etc.) and content length heuristics
- Designed system prompt emphasizing encyclopedia-style writing over commit summaries, with specific guidance on voice, tense, and structure
- Prioritizes rewriting lower-confidence pages first, treating rewriting as a confidence-boosting operation
- Excludes certain categories (commits, security) from rewriting since they are inherently commit-focused
- Added confidence boost (+0.2) after successful rewrite, treating polished presentation as increasing page quality

## Source Files

- `src/agents/orchestrator/orchestrator.ts`
- `src/agents/synthesis/index.ts`
- `src/agents/synthesis/writer-agent.ts`
- `src/executor/executor.ts`

---
*Captured from commit 659d7dd1*
