---
title: "Agentic Tool Use Architecture Decision"
confidence: 0.50
created: Thu Nov 27 2025 14:28:43 GMT+0000 (Coordinated Universal Time)
updated: Thu Nov 27 2025 14:28:43 GMT+0000 (Coordinated Universal Time)
---

# Agentic Tool Use Architecture Decision

This commit implements agentic tool use for the project-overview agent, enabling it to actively read source files (README.md, PLAN.md, package.json) to gather project context rather than relying solely on existing wiki pages. This represents an architectural evolution from passive synthesis to active codebase exploration.

## Key Points



## Decisions Made

- Agent evolution from passive wiki synthesis to active source code exploration using LLM tool calls
- Tool execution bounded to 5 rounds with 50KB file size limit to prevent excessive resource usage
- Prioritized reading of README.md and PLAN.md as primary sources of architectural truth
- Maintained backward compatibility with existing wiki-based synthesis approach

## Source Files

- `src/agents/orchestrator/orchestrator.ts`
- `src/agents/synthesis/project-overview-agent.ts`
- `src/services/llm/anthropic-llm-service.ts`
- `src/services/llm/codebase-tools.test.ts`
- `src/services/llm/codebase-tools.ts`
- `src/services/llm/index.ts`
- `src/services/llm/llm-service.ts`
- `src/services/llm/mock-llm-service.ts`
- `src/services/llm/tools.ts`

---
*Captured from commit 6d0a4e65*
