---
title: "Agentic Tool Use Architecture"
confidence: 0.50
created: Thu Nov 27 2025 14:25:48 GMT+0000 (Coordinated Universal Time)
updated: Thu Nov 27 2025 14:25:48 GMT+0000 (Coordinated Universal Time)
---

# Agentic Tool Use Architecture

This commit documents a significant architectural upgrade from static wiki synthesis to dynamic tool-based exploration in the getting-started agent, representing a shift toward more interactive and accurate documentation generation.

## Key Points



## Decisions Made

- Replace static wiki content analysis with dynamic tool-based codebase exploration for higher accuracy
- Implement tool execution pattern with 5-round limit and 50KB file size constraints for performance
- Shift from template parsing to direct LLM markdown output for simpler processing
- Use actual package.json scripts and directory structure rather than inferred information

## Source Files

- `src/agents/synthesis/getting-started-agent.ts`

---
*Captured from commit 1cec4b8a*
