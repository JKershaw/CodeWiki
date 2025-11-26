---
title: "This commit introduces a system of specialized analysis agents, representing a significant architect"
confidence: 0.50
created: 2025-11-25T22:08:48.023Z
updated: 2025-11-25T22:08:48.023Z
commits: [4ec0c5460502ceb808354d1363f7e8496f33323e]
---
# This commit introduces a system of specialized analysis agents, representing a significant architect

This commit introduces a system of specialized analysis agents, representing a significant architectural decision about how CodeWiki will analyze repository changes. The code itself contains embedded documentation that explains the philosophy and design of the agent system, including their responsibilities, confidence thresholds, and interaction patterns. The commit represents a design decision to use specialized agents rather than a monolithic analyzer.

## Key Points



## Decisions Made

- Decision to use specialized analysis agents instead of a single monolithic analyzer, allowing for focused expertise and parallel processing
- Decision to have agents self-document their purpose and confidence criteria in system prompts, making the AI behavior transparent and auditable
- Decision to make wiki page updates the primary output format, establishing how knowledge flows from code analysis to documentation
- Decision to implement agent-specific file filtering (e.g., dependency agent only runs on dependency files) to optimize costs and performance
- Decision to use structured prompt/response patterns with explicit section markers (SUMMARY:, FINDINGS:, etc.) for reliable parsing

## Source Files

- `src/agents/analysis/dependency-agent.ts`
- `src/agents/analysis/index.ts`
- `src/agents/analysis/narrative-agent.ts`
- `src/agents/analysis/pattern-agent.ts`
- `src/agents/analysis/security-agent.ts`

---
*Captured from commit 4ec0c546*
