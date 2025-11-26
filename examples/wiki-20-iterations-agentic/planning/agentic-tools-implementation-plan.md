---
title: "Agentic Tools Implementation Plan"
confidence: 0.50
created: 2025-11-26T18:42:30.323Z
updated: 2025-11-26T18:42:30.323Z
commits: [80221a0ae8ea931ececed3686086db2ea3fa0948]
---
# Agentic Tools Implementation Plan

Comprehensive planning document for implementing tool-using agents in CodeWiki. Details problem statement, architectural research, implementation phases, and rationale for giving agents the ability to explore codebases rather than relying solely on commit diffs.

## Key Points

- **ARCHITECTURE**: Problem identified: agents are "blind" to full codebase context, only seeing commit diffs and existing wiki pages, leading to poor quality output like "project purpose cannot be determined" even when README clearly explains it.
- **DESIGN**: Solution approach: implement tool-using agents following Anthropic's recommended patterns - start simple, augmented LLM with retrieval/tools/memory, agentic loop pattern (gather context → take action → verify → repeat).
- **RESEARCH**: Research basis documented from Anthropic's "Building Effective Agents" (2025) and SDK documentation - emphasizes that tool design optimization matters more than prompt engineering.
- **IMPLEMENTATION**: Three-phase plan: Phase 1 (Tool Infrastructure with read_file, search_files, search_content, list_directory tools), Phase 2 (Upgrade agents to use tools), Phase 3 (Safety & limits with path sandboxing, file size limits, token budgets).
- **ARCHITECTURE**: Current architecture gap identified: LLMService interface only supports completion, no tool use; agents make single-shot calls without iteration capability.

## Decisions Made

- Use Anthropic's agentic patterns rather than building custom solution - leverage research on what makes effective agents
- Implement tool loop in LLM service layer (completeWithTools method) with max rounds limit (default 5) to prevent infinite loops
- Start with four core codebase exploration tools: read_file, search_files, search_content, list_directory - sufficient for most documentation tasks
- Use Zod schemas for tool input validation, leveraging Anthropic SDK's zodToJsonSchema helpers
- Add repoPath to AgentContext to enable physical file system access while maintaining security boundaries
- Implement path sandboxing and file size limits (default 100KB) before making tools available to agents
- Prioritize upgrading synthesis agents (project-overview, getting-started) first since they benefit most from full codebase access

## Source Files

- `AGENTIC_TOOLS_PLAN.md`

---
*Captured from commit 80221a0a*
