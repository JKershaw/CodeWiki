---
title: "CodeWiki - Project Overview"
confidence: 0.50
created: 2025-11-26T17:43:04.661Z
updated: 2025-11-26T17:43:04.661Z
commits: undefined
---
# CodeWiki - Project Overview

## What is CodeWiki?

CodeWiki is a system that generates living documentation from Git repositories by analyzing commit history and code changes. Unlike traditional documentation that simply describes what code does, CodeWiki captures the reasoning behind architectural decisions, the evolution of features, failed approaches that were tried first, and the subtle constraints that led to certain patterns. This institutional memory is exactly what developers—both human and AI—need to work effectively on a codebase.

The core innovation is treating a repository's history as a rich source of knowledge that can be mined, synthesized, and structured into a queryable wiki. CodeWiki reads commits, analyzes code changes through multiple specialized lenses (security, patterns, dependencies, technical debt), and builds structured documentation that grows organically over time. The system embraces eventual consistency: it produces a useful 80% wiki from recent commits almost immediately, then progressively enriches it by backfilling historical context rather than waiting hours to process everything sequentially.

CodeWiki exposes its knowledge through a Model Context Protocol (MCP) server, allowing AI coding agents to query for context before starting work. When an agent is given a task, it can ask questions like "what are our testing conventions?" or "why did we move away from library X?" and receive synthesized answers drawn from the full history of the project. The system also ingests learnings from AI coding sessions—patterns where agents made mistakes, conventions they didn't know about—and folds these back into the wiki, creating a feedback loop that makes future AI work more effective.

## Architecture Overview

CodeWiki follows a clean, layered architecture built on three core principles: CQRS for external boundaries, the repository pattern for storage abstraction, and a two-loop orchestration model for intelligent work scheduling.

### CQRS Layer

All interaction with the core system happens through a Command-Query Responsibility Segregation (CQRS) boundary. Commands change state (`StartProcessingRepo`, `UpdateWikiPage`, `ResolveConflict`), while queries read state (`GetWikiPage`, `SearchWiki`, `GetRepoStatus`). Everything outside the core—HTTP routes, MCP endpoints, CLI tools—calls commands and queries. Everything inside—repositories, business logic, agents—is hidden behind this interface. This separation makes the system easy to test, easy to extend with new interfaces, and easy for AI agents to understand.

### Repository Pattern

Storage is abstracted behind repository interfaces with two implementations: MongoDB for production and a file-based system for local development or restricted environments. The application auto-detects which to use based on environment configuration. This design decision reflects the philosophy of simplicity—tests can spin up isolated database instances and run in parallel, while development can happen without external dependencies.

### Two-Loop Orchestration Model

The system operates on two concurrent loops:

**The Outer Loop (Orchestrator)** runs frequently and stays lightweight. It examines the current state of the wiki, commit coverage, confidence scores, and agent history to decide what work should happen next. It produces a prioritized work list based on factors like: Are there unprocessed recent commits? Are there historical gaps? Are certain agents underused? Are there conflicts or low-confidence areas that need attention? This isn't a rigid queue—it's a set of recommendations that get re-evaluated each cycle.

**The Inner Loop (Executor)** takes the work list and executes agents in parallel, throttled to configured bandwidth limits. Agents can run concurrently because they only read from the wiki—all writes go through a centralized write queue. When the work list is exhausted, the executor triggers the orchestrator again.

### Write Queue & Conflict Resolution

All wiki modifications flow through a single write queue processed by the writer agent. This prevents race conditions and ensures consistency. When the writer detects a conflict (e.g., two commits asserting different values for the same fact), it resolves by timestamp—the most recent commit wins—and logs the conflict for the orchestrator to potentially investigate further.

## Key Components

### Domain Model (src/domain/)

The domain layer defines the core entities of the system: `Repo`, `Commit`, `WikiPage`, `AgentRun`, `WorkItem`, `Conflict`, and `Learning`. These are pure TypeScript types that represent the business concepts, independent of storage or external concerns. Each domain entity has clear responsibilities and relationships.

### Commands & Queries (src/commands/, src/queries/)

The CQRS layer is implemented through explicit command and query handlers. Commands like `StartProcessingRepo` and `UpdateWikiPage` orchestrate business logic and coordinate between repositories. Queries like `GetWikiPage` and `SearchWiki` retrieve and format data for consumers. This layer enforces the boundary between the core system and external interfaces.

### Agent System (src/agents/)

The agent system is organized into several categories:

**Analysis Agents** (src/agents/analysis/) examine individual commits through different lenses:
- `CodeChangeAgent`: Standard analysis of code modifications
- `NarrativeAgent`: Detects meta-documents like planning files and ADRs
- `SecurityAgent`: Audits security-relevant changes
- `PatternAgent`: Recognizes recurring patterns across commits
- `DependencyAgent`: Tracks external dependency changes

**Orchestrator** (src/agents/orchestrator/) is the decision-making brain that determines what work should happen next. It uses a context gatherer to understand the current state and produces prioritized work recommendations.

**Research Agent** (src/agents/research/) is a shared service for querying the wiki. Any other agent can use it, and it's exposed through the MCP endpoint to external AI coding agents.

**Writer Agent** (src/agents/writer/) is the single point of control for all wiki modifications. It receives update requests, understands wiki structure and conventions, manages links and cross-references, and resolves conflicts.

**Meta Agents** (src/agents/meta/) examine the wiki itself rather than the code, looking for structural issues, broken links, quality problems, and inconsistencies.

**Synthesis Agents** (src/agents/synthesis/) create higher-order content once enough raw material exists, writing guides, overviews, histories, and convention documentation.

All agents extend a `BaseAgent` class that provides common functionality like LLM integration, logging, and error handling.

### Repository Implementations (src/repositories/)

The repository interfaces define contracts for data access without specifying implementation. Two implementations exist:

**MongoDB Implementation** (src/repositories/mongodb/) uses MongoDB Atlas for production and staging. Collections include: Repos, Commits, AgentRuns, WikiPages, WorkQueue, Conflicts, and Learnings.

**File-based Implementation** (src/repositories/file-based/) stores data as JSON files, enabling development in environments without external database access (like Claude's web environment).

The system automatically selects the appropriate implementation based on environment configuration.

### Services (src/services/)

Supporting services provide cross-cutting functionality:

**Git Service** (src/services/git/) wraps `simple-git` to interact with repositories, fetch commits, and extract diffs.

**LLM Service** (src/services/llm/) abstracts LLM interactions behind a provider interface. Currently uses Anthropic's Claude, but the abstraction allows for provider switching. Includes rate limiting and cost tracking.

### Web Interface (src/web/)

An Express-based web server provides the human interface to CodeWiki. Users can connect repositories, trigger processing, view commit coverage, see agent execution history, browse the wiki, and query for information. The interface displays real-time progress as the wiki grows and provides throttle controls to manage processing speed and cost.

### MCP Server (src/mcp/)

A Model Context Protocol server exposes the research agent to external systems. AI coding agents with MCP access can query CodeWiki for context before starting work. The endpoint accepts natural language questions and returns synthesized answers with confidence scores and source references.

### CLI (src/cli.ts)

A command-line interface for administrative tasks and scripting. Allows starting processing, querying status, and managing repositories without the web interface.

### Executor (src/executor/)

The execution engine that processes the work queue, manages agent execution, handles throttling, and coordinates the two-loop orchestration model.

## Data Flow

1. **Initialization**: A user connects a repository through the web interface or CLI
2. **Commit Discovery**: The Git service fetches commit history and stores commit metadata
3. **Orchestration**: The orchestrator examines the current state and produces a prioritized work list
4. **Execution**: The executor processes the work list, launching agents in parallel
5. **Analysis**: Analysis agents examine commits and generate wiki update requests
6. **Writing**: The writer agent receives update requests, resolves conflicts, and modifies wiki pages
7. **Synthesis**: Once sufficient raw material exists, synthesis agents create higher-order documentation
8. **Meta-Analysis**: Meta agents examine wiki structure and quality, generating improvement suggestions
9. **Iteration**: The orchestrator runs again, considering new information and adjusting priorities

Throughout this flow, confidence scores are calculated based on how many commits have been analyzed and how many agents have verified information. Low-confidence pages are prioritized for further processing.

## Technology Stack

- **Runtime**: Node.js 20.4+ with TypeScript for type safety
- **Database**: MongoDB Atlas (production) with file-based fallback for development
- **Web Framework**: Express for HTTP server and API endpoints
- **Git Integration**: simple-git library for repository operations
- **LLM Integration**: Anthropic Claude SDK with abstracted provider interface
- **MCP**: Model Context Protocol SDK for exposing wiki knowledge to AI agents
- **Testing**: Vitest for unit/integration tests, Playwright for end-to-end web tests
- **Build**: TypeScript compiler (tsc) for production builds, tsx for development
- **Deployment**: Heroku with automatic deployment from main branch
- **CI/CD**: GitHub Actions running tests, linting, type checking, and deployment

## Development Philosophy

CodeWiki is built following Extreme Programming principles: small iterations, continuous integration, end-to-end tests that verify real user flows, and fearless refactoring backed by comprehensive tests. The codebase is designed to be self-documenting and AI-agent-friendly since the project itself will be built using AI coding agents and will generate its own wiki.

The architecture prioritizes simplicity: all state lives in one database, no external queue services, clear boundaries between components, and single responsibilities for each module. This makes the system easy to reason about, easy to deploy, and easy for both human and AI developers to work on effectively.

## Where to Start Reading the Code

For new developers, the recommended reading path is:

1. **Start with PLAN.md** - Read this first to understand the philosophy and high-level design
2. **Domain Models** (src/domain/) - Understand the core entities and their relationships
3. **CQRS Layer** (src/commands/, src/queries/) - See how external interfaces interact with the core
4. **Base Agent** (src/agents/base-agent.ts) - Understand the common agent functionality
5. **Orchestrator** (src/agents/orchestrator/) - See how work is prioritized and scheduled
6. **One Analysis Agent** (src/agents/analysis/code-change-agent.ts) - Understand how commits are analyzed
7. **Repository Interfaces** (src/repositories/interfaces/) - See how storage is abstracted
8. **Web Server** (src/web/server.ts) - Understand the HTTP API and web interface
9. **MCP Server** (src/mcp/server.ts) - See how external agents interact with the wiki

The codebase is structured so that each directory has clear boundaries and responsibilities. Following the imports from any entry point will lead you through the architecture naturally.

## Related Documentation

- [Agentic Tool-Using Agents Design](planning/agentic-tool-using-agents-design.md)
- [Coding Standards & Conventions](conventions/coding-standards.md)
- [Anti-Patterns to Avoid](patterns/anti-patterns.md)