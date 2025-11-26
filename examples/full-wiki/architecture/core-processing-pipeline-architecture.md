---
title: "Core Processing Pipeline Architecture"
confidence: 0.50
created: 2025-11-26T10:22:40.333Z
updated: 2025-11-26T10:22:40.333Z
commits: [c69224baf050cd8bb45211b4d17cb71653b28d72]
---
# Core Processing Pipeline Architecture

This commit implements the core processing pipeline for CodeWiki, establishing the fundamental architecture for agent-based analysis of git commits. The code reveals several key architectural decisions: a multi-agent system with orchestration, separation of concerns between agents/services/execution, and a specific prompt engineering approach for extracting structured documentation from commits.

## Key Points

- **ARCHITECTURAL_PATTERN**: Multi-agent system with orchestrator pattern - agents analyze commits independently and generate wiki updates
- **DESIGN_DECISION**: Structured prompt parsing with explicit format markers (SUMMARY:, FINDINGS:, etc.) for reliable LLM output extraction
- **SEPARATION_OF_CONCERNS**: Clear layering: agents for analysis, services for infrastructure, executor for coordination, CLI for interface
- **EXTENSIBILITY**: Agent interface design allows multiple analysis "lenses" on same commit data
- **DATA_MODEL**: Wiki pages as structured updates with confidence deltas and source tracking

## Decisions Made

- Chose agent-based architecture over monolithic analyzer to enable different perspectives on same commit (code change, narrative, architecture, etc.)
- Implemented structured text parsing rather than JSON responses from LLM to handle formatting inconsistencies and allow more natural prompting
- Separated agent execution from orchestration to enable future parallel processing and retry logic
- Made confidence scoring explicit at both finding and page-update level to track uncertainty
- Auto-generate commit pages at commits/{sha} path to ensure every commit has baseline documentation
- Used lowercase-with-hyphens path convention for wiki pages to maintain consistency

## Source Files

- `package.json`
- `src/agents/analysis/code-change-agent.ts`
- `src/agents/analysis/index.ts`
- `src/agents/base-agent.ts`
- `src/agents/index.ts`
- `src/agents/orchestrator/index.ts`
- `src/agents/orchestrator/orchestrator.ts`
- `src/cli.ts`
- `src/executor/executor.ts`
- `src/executor/index.ts`
- `src/index.ts`
- `src/services/git/git-service.ts`
- `src/services/git/index.ts`
- `src/services/index.ts`
- `src/services/llm/index.ts`
- `src/services/llm/llm-service.ts`
- `src/services/llm/mock-llm-service.ts`

---
*Captured from commit c69224ba*
