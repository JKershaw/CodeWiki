---
title: "CodeWiki - Project Overview"
confidence: 0.50
created: 2025-11-26T18:43:46.923Z
updated: 2025-11-26T18:43:46.923Z
commits: []
---
# CodeWiki - Project Overview

## What is CodeWiki?

CodeWiki is a system that generates living documentation from Git repositories by analyzing commit history and synthesizing institutional knowledge. Unlike traditional documentation that simply describes what code does, CodeWiki captures the reasoning behind architectural decisions, the evolution of design patterns, failed approaches that were abandoned, and the subtle constraints that shaped the current implementation. This institutional memory is exactly what developers—both human and AI—need to work effectively on a codebase.

The system operates on a principle of eventual consistency: it produces a useful wiki almost immediately from recent commits, then progressively enriches it by backfilling historical context over time. Rather than batch-processing every commit sequentially (which would be slow and expensive), CodeWiki prioritizes recent changes and high-value insights, delivering an 80% complete wiki in minutes rather than a 100% complete wiki in hours.

CodeWiki exposes its knowledge through an MCP (Model Context Protocol) server, allowing AI coding agents to query for context before starting work. When given a task, an agent can ask questions like "what are our testing conventions?" or "why did we move away from library X?" and receive synthesized answers drawn from the full history of the project. The system also ingests learnings from AI coding sessions—patterns where agents made mistakes or conventions they didn't know about—and folds these back into the wiki, creating a feedback loop that continuously improves future AI assistance.

## Architecture Overview

CodeWiki follows a clean, layered architecture with clear separation of concerns:

### CQRS Boundary Layer

All interaction with the core system happens through **commands** (operations that change state) and **queries** (operations that read state). This architectural boundary separates the core business logic from external concerns like HTTP routes, MCP endpoints, CLI tools, and agent execution harnesses.

Commands include operations like `StartProcessingRepo`, `UpdateWikiPage`, and `ResolveConflict`. Queries include `GetWikiPage`, `SearchWiki`, `GetRepoStatus`, and `GetCommitCoverage`. Everything outside this boundary calls commands and queries; everything inside—repositories, business logic, conflict resolution—is hidden behind these interfaces.

### Repository Pattern

Storage is abstracted behind repository interfaces with two implementations:
- **MongoDB-based**: Used in production, staging, and CI/CD environments
- **File-based**: Used in local development and restricted environments without external database access

The application auto-detects which to use based on environment configuration, and tests spin up isolated database instances for parallel execution without collision.

### Two-Loop Processing Model

CodeWiki operates using two distinct processing loops:

**The Orchestrator Loop** (outer loop) runs frequently but stays lightweight—typically making only 2-3 LLM calls per cycle. It examines the current state of the wiki, commit coverage, confidence scores, and agent execution history to decide what work should happen next. Rather than maintaining a rigid queue, it produces a prioritized work list that gets re-evaluated each cycle based on factors like:
- Whether the wiki is empty (start with recent commits)
- Which commits lack coverage (fill historical gaps)
- Whether certain agent types are underutilized (balance the work mix)
- Whether there are flagged conflicts or low-confidence areas (prioritize quality)
- Whether sufficient raw material exists for synthesis (create guides and overviews)

**The Executor Loop** (inner loop) takes the work list and fires off agents in parallel, throttled to configured bandwidth limits. Agents run concurrently since they only read from the wiki—all write requests flow through a queue. When the work list is exhausted, the executor triggers the orchestrator again.

### Write Queue and Conflict Resolution

All wiki modifications flow through a single write queue processed by the Writer Agent. This prevents race conditions and conflicting edits. When the writer detects a conflict (e.g., two commits asserting different values for the same fact), it resolves using timestamp-based precedence—the most recent commit wins—and logs the conflict for potential deeper investigation by the orchestrator.

## Key Components

### Agent System

CodeWiki employs multiple specialized agents, each examining the codebase through a different lens:

**Analysis Agents** process individual commits:
- **Code Change Agent**: Standard analysis of what changed in a commit
- **Narrative Agent**: Detects meta-documents like planning files, ADRs, and idea documents
- **Security Agent**: Audits for security-relevant changes
- **Pattern Agent**: Recognizes recurring patterns across commits
- **Dependency Agent**: Tracks external dependency changes and their implications

**Meta Agents** examine the wiki itself:
- **Structure Agent**: Identifies organizational issues (pages too long, unwieldy hierarchies)
- **Link Agent**: Manages backlinks and detects orphaned pages
- **Quality Agent**: Assesses content clarity and source citation
- **Consistency Agent**: Finds contradictions between pages

**Synthesis Agents** create higher-order documentation:
- **Overview Agent**: Creates summary pages for modules and features
- **Project Overview Agent**: Generates comprehensive project introductions
- **Getting Started Agent**: Writes onboarding guides
- **Writer Agent**: The only component that modifies wiki files, ensuring consistency

**Special-Purpose Agents**:
- **Research Agent**: A shared service for querying the wiki, used by other agents and exposed through the MCP endpoint
- **Orchestrator**: The decision-maker that prioritizes work and manages the processing pipeline

### Web Interface

An Express-based web application provides:
- Repository selection and processing initiation
- Visual display of all commits with processing status indicators
- Real-time progress monitoring as the wiki grows
- Drill-down views showing agent thinking and decisions
- Query interface for asking questions and receiving synthesized answers
- Throttle controls to manage processing speed and cost

### MCP Server

Exposes the Research Agent to external systems via the Model Context Protocol. AI coding agents with MCP access can query CodeWiki for context before starting work, receiving synthesized answers with confidence scores and source references.

### Command and Query Handlers

The CQRS layer is implemented through dedicated command and query handlers in `src/commands/` and `src/queries/`. These provide type-safe interfaces to the core system, handling validation, error cases, and coordination between repositories.

## Data Model

All state lives in MongoDB (or file-based equivalent) with the following core collections:

- **Repos**: Connected repositories with GitHub details, processing status, and configuration
- **Commits**: All commits for connected repos, including metadata, diffs, and agent processing records
- **AgentRuns**: Complete history of every agent execution with findings, updates, duration, and cost
- **WikiPages**: The wiki content itself with confidence scores, source commits, and backlinks
- **WorkQueue**: Pending work items (not a separate service—just database records with status flags)
- **Conflicts**: Detected conflicts and their resolutions
- **Learnings**: Insights from AI coding sessions to incorporate into the wiki
- **OrchestratorRuns**: History of orchestrator decisions and work prioritization

## Technical Stack

- **Runtime**: Node.js 20.4+ with ES modules
- **Language**: TypeScript with strict type checking
- **Database**: MongoDB Atlas (production) with file-based fallback
- **Web Framework**: Express
- **LLM Provider**: Anthropic Claude (abstracted behind service interface)
- **Git Integration**: simple-git library
- **Testing**: Vitest for unit/integration tests, Playwright for end-to-end tests
- **CI/CD**: GitHub Actions with automatic Heroku deployment
- **Protocol**: Model Context Protocol SDK for AI agent integration

## Development Philosophy

CodeWiki embraces **dogfooding**—it is built using AI coding agents and generates its own wiki. This creates continuous pressure to make both the tooling excellent and the codebase AI-friendly. The project follows extreme programming practices with small iterations, continuous integration, and end-to-end tests that verify real user flows.

The codebase maintains **simple, clean abstractions**: the CQRS layer separates concerns, the repository pattern abstracts storage, and each component has a single responsibility. When adding a feature, it should be obvious where the code belongs.

All state lives in one database—no external queue services, no complex infrastructure. This keeps the system easy to reason about, easy to deploy, and easy for AI agents to work on.

## Where to Start Reading the Code

For a new developer joining the project, the recommended reading order is:

1. **Start with `PLAN.md`** - This document (already read above) provides the complete philosophical and architectural foundation

2. **Review the domain models** in `src/domain/` - These define the core entities: `Repo`, `Commit`, `WikiPage`, `AgentRun`, `WorkItem`, etc. Understanding these types is essential to understanding the system

3. **Examine the CQRS boundary** in `src/commands/` and `src/queries/` - These show how external systems interact with the core. Start with `start-processing-repo.ts` and `get-wiki-page.ts`

4. **Explore the repository interfaces** in `src/repositories/interfaces/` - These define the data access contracts that both MongoDB and file-based implementations satisfy

5. **Study the base agent** in `src/agents/base-agent.ts` - This provides the foundation all agents build upon, showing how they interact with the LLM service and repositories

6. **Pick one agent to read deeply** - Start with `src/agents/analysis/code-change-agent.ts` as it's the most straightforward. Then explore synthesis agents like `overview-agent.ts` to see how higher-order documentation is created

7. **Understand the orchestrator** in `src/agents/orchestrator/` - This is the brain of the system, deciding what work to prioritize

8. **Review the executor** in `src/executor/` - This shows how the work list gets processed and agents get invoked

9. **Explore the web interface** in `src/web/` to see how the system is exposed to users

10. **Check the MCP server** in `src/mcp/` to understand the AI agent integration point

The codebase is structured to be readable by both humans and AI agents, with clear boundaries, consistent patterns, and extensive use of TypeScript's type system to make contracts explicit.

## Related Documentation

- [Agentic Tool Use](architecture/agentic-tool-use.md)
- [Codebase Tools](components/codebase-tools.md)
- [Code Change Agent](agents/code-change-agent.md)
- [Agent Development](guides/agent-development.md)
- [Coding Standards & Conventions](conventions/coding-standards.md)
- [Anti-Patterns to Avoid](patterns/anti-patterns.md)
- [Agentic Tools Implementation Plan](planning/agentic-tools-implementation-plan.md)