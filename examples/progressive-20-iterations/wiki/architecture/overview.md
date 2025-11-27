---
title: "CodeWiki - Project Overview"
confidence: 0.5
path: architecture/overview
---

# CodeWiki - Project Overview

CodeWiki is a system that generates living documentation from Git repositories by analyzing commit history and synthesizing structured knowledge about codebases. Unlike traditional documentation that captures what code does at a single point in time, CodeWiki preserves the full context of why architectural decisions were made, how systems evolved, what approaches were tried and abandoned, and what conventions emerged over time. This institutional memory is particularly valuable for AI coding agents, which need deep context to work effectively on unfamiliar codebases.

The system operates on a principle of eventual consistency rather than exhaustive batch processing. Instead of analyzing every commit before producing output, CodeWiki generates a useful wiki almost immediately from recent commits, then progressively enriches it by backfilling historical context over time. Every piece of information carries a confidence score based on analysis depth, allowing users and AI agents to calibrate their trust accordingly. The wiki grows organically—starting with broad strokes from recent work, then filling in history, identifying patterns, and synthesizing higher-order documentation like guides and architectural overviews.

CodeWiki exposes its knowledge through a Model Context Protocol (MCP) server, enabling AI coding agents to query for context before starting work. An agent can ask questions like "what are our testing conventions?" or "why did we move away from library X?" and receive synthesized answers drawn from the project's full history. The system also ingests learnings from AI coding sessions—patterns where agents made mistakes or conventions they missed—creating a feedback loop that makes future AI work progressively more effective.

## Architecture Overview

CodeWiki follows a clean, layered architecture with clear separation of concerns:

### CQRS Boundary Layer

All interaction with the core system happens through a Command-Query Responsibility Segregation (CQRS) layer. Commands modify state (`StartProcessingRepo`, `UpdateWikiPage`, `ResolveConflict`), while queries read it (`GetWikiPage`, `SearchWiki`, `GetRepoStatus`, `GetCommitCoverage`). Everything external—HTTP routes, MCP endpoints, CLI tools, agent harnesses—calls through this boundary. Everything internal—repositories, business logic, conflict resolution—is hidden behind it. This architectural choice makes the system easy to test, extend, and reason about.

### Repository Pattern

Storage is abstracted behind repository interfaces with two implementations. The MongoDB implementation is used in production, staging, and CI/CD tests. The file-based implementation is used in local development and restricted environments (like Claude's web environment) where external database connections aren't available. The application auto-detects which to use based on environment configuration, and tests spin up isolated database instances for parallel execution without collision.

Eight repository interfaces provide storage for all system state: `RepoRepository`, `CommitRepository`, `WikiPageRepository`, `AgentRunRepository`, `WorkQueueRepository`, `ConflictRepository`, `LearningRepository`, and `OrchestratorRunRepository`. Each has a clean interface defining its operations, decoupling the domain logic from storage concerns.

### Two-Loop Processing Model

CodeWiki operates as two coordinated loops:

**The Outer Loop (Orchestrator)** runs frequently and stays lightweight, typically making only 2-3 LLM tool calls per cycle. It examines the current state of the wiki, commit coverage, confidence scores, and agent history to decide what work should happen next. This produces a prioritized work list based on factors like whether the wiki is empty (start with recent commits), whether recent commits are covered (look at historical gaps), whether certain agents are underused (balance the work mix), or whether there are conflicts or low-confidence areas that need attention. The orchestrator doesn't create a rigid queue—it makes recommendations that get re-evaluated each cycle as conditions change.

**The Inner Loop (Executor)** takes the work list and fires off agents in parallel, throttled to configured bandwidth limits. Agents only read from the wiki during analysis—all write requests go to a queue processed serially by the writer agent. When the work list is exhausted, the executor triggers the orchestrator again to plan the next batch of work.

### Write Queue and Conflict Resolution

All wiki modifications flow through a single write queue processed exclusively by the writer agent. This architectural decision prevents race conditions and conflicting edits. When the writer detects a conflict—such as two commits asserting different values for the same fact—it resolves by timestamp (most recent wins) and logs the conflict for potential deeper investigation by the orchestrator. This centralized write path ensures wiki consistency while allowing parallel analysis operations.

## Key Components

### Domain Model

The core domain entities are defined in `src/domain/`:

- **Repo**: Connected repositories with GitHub details, processing status, configuration, and throttle settings
- **Commit**: Individual commits with metadata, diff summaries, which agents have processed them, and timestamps
- **WikiPage**: The wiki content itself—Markdown content, confidence scores, source commits, last updated timestamps, and backlinks
- **AgentRun**: Historical record of every agent execution, including which agent ran, what it analyzed, what updates it requested, duration, and cost
- **WorkItem**: Pending work in the queue with agent type, target (commit or wiki-wide), priority, status, and timestamps
- **Conflict**: Detected conflicts with their resolution history
- **Learning**: Insights from AI coding sessions that should be incorporated
- **OrchestratorRun**: History of orchestrator decision cycles

### Agent System

The agent system is organized into four categories in `src/agents/`:

**Analysis Agents** examine commits through different lenses:
- `CodeChangeAgent`: Standard analysis of what changed in a commit
- `NarrativeAgent`: Detects meta-documents like planning files, ADRs, and design docs
- `SecurityAgent`: Audits for security-relevant changes
- `TechnicalDebtAgent`: Identifies accumulating debt and shortcuts
- `PatternAgent`: Recognizes recurring patterns across commits
- `DependencyAgent`: Tracks external dependency changes and their implications

**Meta Agents** examine the wiki itself rather than the code:
- `StructureAgent`: Checks if pages are too long or if hierarchy needs reorganization
- `LinkAgent`: Verifies backlinks work and identifies orphaned pages
- `QualityAgent`: Assesses content clarity and source citations
- `ConsistencyAgent`: Detects contradictions between pages

**Synthesis Agents** create higher-order content:
- `OverviewAgent`: Creates summary pages for modules or features
- `ProjectOverviewAgent`: Generates comprehensive project introduction pages
- `GettingStartedAgent`: Writes onboarding guides for new developers
- `WriterAgent`: The single agent responsible for all wiki modifications

**Special Purpose Agents**:
- `OrchestratorAgent`: Makes decisions about what work to prioritize next
- `ResearchAgent`: Answers questions by searching and synthesizing wiki content (exposed via MCP)

All agents extend `BaseAgent` which provides common functionality for LLM interaction, token budgeting, and logging.

### Services Layer

The `src/services/` directory contains supporting infrastructure:

- **Git Service**: Interacts with Git repositories using `simple-git`, handling cloning, commit retrieval, and diff generation
- **LLM Service**: Abstracts LLM interaction behind a service interface, providing rate limiting and cost tracking. Currently uses the Anthropic SDK but designed to support provider changes
- **CWIgnore Service**: Handles `.cwignore` files for filtering which files should be included in analysis

### Web Interface

The `src/web/` directory implements a web UI providing:
- GitHub OAuth for authentication
- Repository selection from user's accessible repos
- "Start Processing" button to begin wiki generation
- Visual display of all commits with processing indicators
- Real-time progress as the wiki grows
- Drill-down to see agent reasoning and decisions
- Query interface to ask questions and get answers from the wiki
- Throttle controls to manage processing speed and cost

### MCP Server

The `src/mcp/` directory implements a Model Context Protocol server that exposes the research agent to external systems. AI coding agents with MCP access can query CodeWiki for context before starting work. The server accepts questions and returns synthesized answers with confidence scores and source references.

### CLI Tool

The `src/cli.ts` provides command-line access to CodeWiki functionality for scripting and automation. The package.json defines a `codewiki` binary that makes the CLI available after installation.

## Technology Stack

- **Runtime**: Node.js 20.4+ with ES modules
- **Language**: TypeScript with strict type checking
- **Database**: MongoDB Atlas (production/staging) with file-based fallback
- **Web Framework**: Express for HTTP server
- **LLM Provider**: Anthropic Claude (abstracted for provider flexibility)
- **Git Integration**: simple-git library
- **Testing**: Node's built-in test runner for unit/integration tests, Playwright for end-to-end tests
- **Hosting**: Heroku with automatic deployment from main branch
- **CI/CD**: GitHub Actions running tests, linting, type-checking, and deployment

## Where to Start Reading the Code

For new developers looking to understand the codebase:

1. **Start with the domain model** (`src/domain/`): These files define the core entities and their relationships. Understanding `Repo`, `Commit`, `WikiPage`, and `AgentRun` provides the conceptual foundation.

2. **Read the CQRS interfaces** (`src/commands/types.ts` and `src/queries/types.ts`): These define all operations the system supports, providing a map of what the system can do.

3. **Examine a simple agent** (`src/agents/analysis/code-change-agent.ts`): This shows the typical agent structure—how they receive context, analyze content, and request wiki updates.

4. **Study the orchestrator** (`src/agents/orchestrator/orchestrator-agent.ts`): This is the brain of the system, deciding what work happens when. Understanding its logic reveals how the system prioritizes and balances different types of work.

5. **Look at the executor** (`src/executor/executor.ts`): This shows how the work list from the orchestrator gets executed—how agents are instantiated, run in parallel, and have their results processed.

6. **Review the repository interfaces** (`src/repositories/interfaces/`): These show what storage operations are needed and how the domain is persisted.

7. **Explore the writer agent** (`src/agents/synthesis/writer-agent.ts`): This is the only component that modifies wiki pages, making it critical for understanding how analysis results become documentation.

The codebase follows consistent patterns—agents are structured similarly, repositories follow the same interface conventions, and the command/query separation is maintained throughout. Once you understand one agent or one repository, the others follow the same structure.

## Related Documentation

- [Infrastructure](testing/infrastructure.md)
- [Integration Patterns](testing/integration-patterns.md)
- [Dependencies](development/dependencies.md)
- [Testing](guides/testing.md)
- [Testing Strategy](architecture/testing-strategy.md)
- [Fixtures Api](development/fixtures-api.md)
- [Orchestrator Executor Coordination](architecture/orchestrator-executor-coordination.md)
- [Work Queue Design](architecture/work-queue-design.md)