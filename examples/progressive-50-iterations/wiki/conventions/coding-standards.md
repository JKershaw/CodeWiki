---
title: "Coding Standards & Conventions"
confidence: 1
path: conventions/coding-standards
---

# Coding Standards & Conventions

## Observed Conventions

- **Agent Type Constants**: Each agent declares a readonly type property matching AgentType union, enabling type-safe orchestration and routing
- **Explicit File Extensions**: All imports use .js extensions (e.g., './base-agent.js'), following ES module best practices even in TypeScript
- **Context Parameter Pattern**: All agent methods receive an AgentContext containing injected dependencies (repos, git, llm), avoiding global state
- **Error Handling Convention**: Throws descriptive errors with context (e.g., "Commit not found: ${commitId}") rather than returning null/undefined
- **Prompt Engineering Structure**: Prompts follow consistent format: Context → Instructions → Expected Format, with clear section markers
- **Response Parsing Robustness**: Parser handles missing sections gracefully with default values and filters out "none" or "n/a" responses
- **Diff Truncation**: Large diffs are truncated at 12000 chars with visual indicator, preventing token budget overruns
- **Cost Tracking**: Returns completion.costUsd in result, enabling budget monitoring at orchestration level
- **Confidence Scoring**: All agents return confidence scores (0-1), allowing downstream filtering and quality assessment
- **Barrel Exports Alphabetically Ordered**: index.ts exports are kept in alphabetical order (code-change, dependency, narrative, pattern, security, technical-debt)

---
*Updated from commit a286af4b*
