---
title: "Agentic Tool Use in Synthesis Agents"
confidence: 0.55
created: 2025-11-26T18:36:10.434Z
updated: 2025-11-26T18:45:02.654Z
commits: [1cec4b8a6dabf5525420e7bd78639a8e3e1bb051]
---
# Agentic Tool Use in Synthesis Agents

The Getting Started Agent demonstrates agentic tool use, a pattern where LLM-powered agents actively explore the codebase using tools rather than relying solely on pre-gathered context. This approach shifts from passive content synthesis to active codebase exploration, where the agent decides what files to read, directories to explore, and patterns to search based on its understanding of what information it needs.

The agent uses three core codebase exploration tools: `read_file` for accessing complete file contents (package.json, README.md, source files), `search_files` for finding files matching glob patterns, and `list_directory` for understanding project structure. These tools are provided through the `codebaseTools` collection and execute within a sandboxed `ToolContext` that enforces repository boundaries and file size limits (50KB default). The LLM service's `completeWithTools` method implements an iterative agentic loop supporting up to 5 tool rounds, where the agent can chain multiple tool calls together to gather comprehensive information before generating its final output.

This pattern represents a significant architectural evolution from the traditional approach seen in other synthesis agents like the Overview Agent and Writer Agent, which operate on pre-filtered wiki page content. The Getting Started Agent now reads actual source files to extract real project commands from package.json, explores the actual directory structure, and verifies setup instructions from README.md. The result is documentation grounded in the current state of the codebase rather than synthesized from potentially outdated wiki pages. The agent's prompt explicitly instructs it to "use tools to explore the ACTUAL codebase" and output only information verified from source files, eliminating guesswork about file paths, commands, or project structure.



## Source

- **Commit:** 1cec4b8a
- **Files:** `src/agents/synthesis/getting-started-agent.ts`


---



## Related Pages

- [Agentic Tool Use](architecture/agentic-tool-use.md) - Implements agentic tool use pattern in synthesis agents
- [Codebase Tools](components/codebase-tools.md) - Uses the three core codebase exploration tools
- [Agentic Tool Use for Code Analysis](commits/9ac80919.md) - Related implementation of tool use in different agent type
- [Agentic Tool Use in Project Overview Agent](commits/6d0a4e65.md) - Sequential commits implementing tool use across synthesis agents
- [Agentic Tool Use System](commits/80221a0a.md) - Part of the broader agentic tool use system implementation
- [Synthesis Agents: Project Overview and Getting Started Documentation](commits/7b58314c.md) - Related to synthesis agents system
- [Getting Started](guides/getting-started.md) - Getting Started Agent mentioned in commit