---
title: "Agentic Tool Use in Getting Started Agent"
confidence: 0.50
created: Thu Nov 27 2025 14:25:38 GMT+0000 (Coordinated Universal Time)
updated: Thu Nov 27 2025 14:25:38 GMT+0000 (Coordinated Universal Time)
---

# Agentic Tool Use in Getting Started Agent

The Getting Started Agent represents a sophisticated implementation of agentic tool use within the wiki synthesis system. This agent generates practical developer onboarding guides by actively exploring the actual codebase rather than relying solely on existing wiki content. The agent leverages three core codebase exploration tools: `read_file` for accessing specific files like package.json and README.md, `search_files` for pattern-based file discovery, and `list_directory` for understanding project structure.

The agent operates through an agentic loop powered by the LLM's `completeWithTools` capability, allowing it to make autonomous decisions about which files to read and how to structure the resulting documentation. This approach ensures that getting started guides contain accurate, real-world information like actual npm scripts, verified file paths, and current project dependencies rather than generic or outdated instructions. The system includes safety measures such as file size limits (50KB per file), path validation to prevent directory traversal, and a maximum of 5 tool rounds to control costs and execution time.

The agent triggers when a repository's wiki reaches 10+ pages but lacks a getting started guide, automatically creating comprehensive documentation at `guides/getting-started.md`. This represents a shift from traditional template-based documentation generation to dynamic, context-aware content creation that adapts to each project's actual structure and configuration.



## Source

- **Commit:** 1cec4b8a
- **Files:** `src/agents/synthesis/getting-started-agent.ts`
