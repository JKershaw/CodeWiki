---
title: "Agentic Tool Use for Code Analysis"
confidence: 0.50
created: Thu Nov 27 2025 14:24:24 GMT+0000 (Coordinated Universal Time)
updated: Thu Nov 27 2025 14:24:24 GMT+0000 (Coordinated Universal Time)
---

# Agentic Tool Use for Code Analysis

Agent architecture evolution implementing tool-enabled analysis for deeper code understanding and context-aware documentation generation.

## Key Points



## Decisions Made

- Agents now use tool-based exploration rather than diff-only analysis to understand full context of changes
- Tool execution is limited to 5 rounds with 50KB file size limits to prevent runaway resource usage
- LLM system prompt explicitly guides tool usage workflow: read complete files, search for tests, understand dependencies before analysis
- Tool usage is tracked and reported as findings to provide transparency in the analysis process
- Token limits increased from 2000 to 3000 to accommodate richer analysis from additional context

## Source Files

- `src/agents/analysis/code-change-agent.ts`

---
*Captured from commit 9ac80919*
