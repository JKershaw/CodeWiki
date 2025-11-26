---
title: "Agentic Tool-Using Agents Design"
confidence: 0.50
created: 2025-11-26T17:41:01.912Z
updated: 2025-11-26T17:41:01.912Z
commits: undefined
---
# Agentic Tool-Using Agents Design

This is a comprehensive planning document that details the design and implementation strategy for adding tool-using capabilities to CodeWiki agents. The document identifies a significant architectural gap (agents are "blind" to the full codebase), proposes a solution based on Anthropic's agent-building best practices, and provides detailed implementation phases with code examples.

## Key Points

- **ARCHITECTURE**: Current agents only see commit diffs and existing wiki pages, lacking full codebase context. This leads to poor quality output like "project purpose cannot be determined" even when documentation exists.
- **DESIGN_DECISION**: Solution follows Anthropic's "augmented LLM" pattern: giving agents tools to explore the codebase (read files, search content, list directories) rather than changing the core architecture.
- **RESEARCH**: Design based on Anthropic's 2025 best practices: start simple, tool design matters more than prompts, use agentic loop pattern (gather context → take action → verify → repeat).
- **IMPLEMENTATION**: Three-phase plan: Phase 1 builds tool infrastructure with Zod schemas and security sandboxing, Phase 2 upgrades agents to use tools, Phase 3 adds safety limits and monitoring.
- **ARCHITECTURE**: Current architecture has no tool use support - agents make single LLM calls. Gap identified in llm-service interface and agent execution pattern.

## Decisions Made

- Agents need tool-using capabilities to access full codebase context, not just commit diffs, to produce higher quality wiki content
- Follow Anthropic's recommended patterns for building effective agents rather than inventing custom approaches
- Implement four core tools: read_file, search_files, search_content, list_directory, all with security sandboxing
- Extend LLMService interface with completeWithTools() method that implements agentic loop with configurable max rounds
- Use Zod for tool input validation and JSON Schema conversion for Anthropic API compatibility
- Path sandboxing and file size limits are critical safety features to prevent abuse or resource exhaustion
- Project Overview and Getting Started agents are primary beneficiaries - they need to read README.md, package.json, and explore directory structure
- Tool calls should be logged and monitored to track usage patterns and identify inefficiencies

## Source Files

- `AGENTIC_TOOLS_PLAN.md`

---
*Captured from commit 80221a0a*
