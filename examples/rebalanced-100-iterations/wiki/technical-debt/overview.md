---
title: "Technical Debt Overview"
confidence: 1.00
created: Thu Nov 27 2025 14:06:04 GMT+0000 (Coordinated Universal Time)
updated: Thu Nov 27 2025 14:29:10 GMT+0000 (Coordinated Universal Time)
---

# Technical Debt Overview

## Recent Changes

### Commit 6d0a4e65

**Level:** medium

This commit implements agentic tool use for the project-overview agent, adding significant complexity without proper abstractions. While the tool integration is functionally sound, several maintainabi...

**Added:** Duplicated agent triggering pattern in orchestrator (project-overview vs getting-started logic), Complex tool execution flow without proper abstractions for error handling, Hardcoded magic numbers (10 pages, 50000 maxFileSize, 5 maxToolRounds)
**Resolved:** Replaced hardcoded response parsing with direct tool-driven content generation, Removed brittle string parsing logic in project-overview-agent.ts

## Current Hotspots

- `src/agents/orchestrator/orchestrator.ts (growing complexity in agent triggering logic)`
- `src/services/llm/anthropic-llm-service.ts (new complex tool execution path)`

## Priority Recommendations

- Extract common agent triggering logic into a reusable helper method in orchestrator.ts
- Create a ToolExecutor class to encapsulate tool execution complexity and error handling
- Add proper error handling and timeout logic for tool calls
- Replace magic numbers with named constants or configuration
- Consider adding integration tests for the tool execution pipeline

---
*Last updated from commit 6d0a4e65*
