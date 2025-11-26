---
title: "Multi-Agent Analysis Architecture"
confidence: 0.50
created: 2025-11-26T10:20:58.794Z
updated: 2025-11-26T10:20:58.794Z
commits: [4ec0c5460502ceb808354d1363f7e8496f33323e]
---
# Multi-Agent Analysis Architecture

This commit introduces a multi-agent analysis system design, implementing four specialized agents (Narrative, Security, Pattern, Dependency) as part of a larger architectural pattern. The code includes extensive inline documentation explaining the "why" behind each agent's purpose, responsibilities, and design patterns. This represents a significant architectural decision to use specialized AI agents for different types of code analysis, with clear role separation and extensible design.

## Key Points



## Decisions Made

- Decision to implement multiple specialized agents rather than one general-purpose analyzer, enabling focused expertise and better accuracy
- Decision to use confidence scoring (0-1 scale) to reflect analysis certainty, allowing downstream systems to weight agent findings appropriately
- Decision to make agents generate wiki updates directly, embedding documentation generation into the analysis pipeline
- Decision to include cost tracking (costUsd) at the agent level, making LLM usage transparent and measurable
- Decision to use early-exit patterns (e.g., dependency agent checking file relevance before LLM calls) to optimize resource usage
- Decision to parse structured LLM responses rather than rely on JSON, providing more resilient error handling

## Source Files

- `src/agents/analysis/dependency-agent.ts`
- `src/agents/analysis/index.ts`
- `src/agents/analysis/narrative-agent.ts`
- `src/agents/analysis/pattern-agent.ts`
- `src/agents/analysis/security-agent.ts`

---
*Captured from commit 4ec0c546*
