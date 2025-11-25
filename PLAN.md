# CodeWiki

## Project Overview

CodeWiki is a system that generates a living wiki from a Git repository. It reads commit history, analyzes code changes, and builds structured documentation that captures not just what the code does, but why it exists, how it evolved, and the conventions and lessons learned along the way.

The core insight is that traditional documentation tells you what code does, but rarely captures the reasoning behind architectural decisions, the failed approaches that were tried first, or the subtle constraints that led to certain patterns. This institutional memory is exactly what AI coding agents need to work effectively on a codebase.

CodeWiki exposes its knowledge through an MCP server, allowing AI coding agents to query for context before starting work. When an agent is given a task, it can ask CodeWiki questions like "what are our testing conventions?" or "why did we move away from library X?" and receive synthesized answers drawn from the full history of the project.

The system also ingests learnings from AI coding sessions—patterns where agents made mistakes, conventions they didn't know about—and folds these back into the wiki, creating a feedback loop that makes future AI work more effective.

## Philosophy & Principles

### Eventual Consistency Over Batch Processing

A wiki generated sequentially from every commit would be comprehensive but slow and expensive. Instead, CodeWiki produces a useful wiki almost immediately from recent commits, then progressively enriches it by backfilling historical context over time. An 80% wiki in 20 minutes beats a 100% wiki in 10 hours.

### Confidence Over Completeness

Every piece of information in the wiki carries a confidence score based on how many commits have been analyzed, how many agents have verified it, and how recently it's been checked. Users and AI agents can calibrate their trust accordingly. Low-confidence pages are prioritized for further processing.

### Organic Growth

The wiki grows like a living thing. Early on, it captures broad strokes from recent commits. As more processing happens, it fills in history, develops guides and overviews, identifies patterns, and synthesizes higher-order documentation. You can watch this happen in real time.

### Simplicity in Architecture

All state lives in one database. No external queue services, no complex infrastructure. Queues are just database records with timestamps and status fields. This keeps the system easy to reason about, easy to deploy, and easy for AI coding agents to work on.

### Clean, Simple Abstractions

The codebase uses clear architectural boundaries. A CQRS layer separates the core system from all external interfaces. A repository pattern abstracts storage. Each component has a single responsibility. When adding a feature, it should be obvious where the code belongs.

### The Repo as Its Own Best Example

CodeWiki will be built using AI coding agents and will generate its own wiki. The repository must therefore embody the qualities that make wikis useful: clear philosophy documents, well-structured code, meaningful commit messages, and documentation that explains not just what but why.

## Architecture

### CQRS Layer

All interaction with the core system happens through commands (things that change state) and queries (things that read state). This boundary separates the core logic from external concerns like HTTP routes, MCP endpoints, CLI tools, and agent harnesses.

Commands: `StartProcessingRepo`, `RunAgent`, `UpdateWikiPage`, `ResolveConflict`, `SetThrottle`, etc.

Queries: `GetWikiPage`, `SearchWiki`, `GetRepoStatus`, `GetCommitCoverage`, `GetConfidenceScores`, etc.

Everything outside calls commands and queries. Everything inside—repositories, business logic, conflict resolution—is hidden behind this interface.

### Repository Pattern

Storage is abstracted behind repository interfaces. Two implementations exist:

- **MongoDB**: Used in production, staging, and CI/CD tests
- **File-based**: Used in local development and restricted environments (like Claude's web environment) where external database connections aren't available

The application auto-detects which to use based on environment configuration. Tests spin up isolated database instances so they can run in parallel without collision.

### Two-Loop Model

**Outer Loop (Orchestrator)**: Runs frequently and lightweight. It examines the current state of the wiki, commit coverage, confidence scores, and agent history. It decides what work should happen next and produces a prioritized work list. This isn't a rigid queue—it's recommendations that get re-evaluated each cycle.

The orchestrator considers factors like:
- Is the wiki empty? Start with the most recent commit.
- Are recent commits covered? Look at historical gaps.
- Are certain agents underused? Balance the work mix.
- Are there flagged conflicts or low-confidence areas? Prioritize those.
- Are there enough raw materials to synthesize guides or overviews?

**Inner Loop (Executor)**: Takes the work list and fires off agents, throttled to the configured bandwidth. Agents run in parallel since they only read from the wiki—all write requests go to a queue. When the work list is exhausted, it triggers the orchestrator again.

### Write Queue & Conflict Resolution

All wiki modifications flow through a single write queue processed by the writer agent. This prevents race conditions and conflicting edits.

When the writer detects a conflict (e.g., two commits asserting different values for the same fact), it resolves by timestamp—the most recent commit wins. It also logs the conflict for the orchestrator to potentially investigate further.

## Core Components

### Web Interface

- GitHub OAuth for authentication
- Repository selection from user's accessible repos
- "Start Processing" to begin wiki generation
- Visual display of all commits with indicators showing which have been processed, which agents have run, what's queued
- Real-time progress as the wiki grows
- Drill-down to see agent thinking and decisions
- Query interface to ask questions and get answers from the wiki
- Throttle controls to manage processing speed and cost

### Orchestrator

The decision-maker. It runs frequently, stays lightweight (2-3 tool calls typically), and outputs a prioritized work list. It has visibility into wiki state, commit coverage, agent history, confidence scores, and any flagged issues.

### Analysis Agents

Each looks at commits through a different lens:

- **Code Change Agent**: Standard analysis of what changed in a commit
- **Narrative Agent**: Detects meta-documents like planning files, idea docs, ADRs
- **Security Agent**: Audits for security-relevant changes
- **Technical Debt Agent**: Identifies accumulating debt and shortcuts
- **Pattern Agent**: Recognizes recurring patterns across commits
- **Dependency Agent**: Tracks external dependency changes and their implications

New analysis agents can be added over time. The orchestrator learns to incorporate them into the work mix.

### Research Agent

A shared service for querying the wiki. Any other agent can use it, and it's exposed through the MCP endpoint. Given a question, it searches the wiki, synthesizes relevant information, and returns a coherent answer with confidence indicators.

### Writer Agent

The only component that modifies wiki files. It receives update requests, understands wiki structure and conventions, manages links and cross-references, handles formatting, and resolves conflicts. Single point of control ensures consistency.

### Meta Agents

These examine the wiki itself rather than the code:

- **Structure Agent**: Are pages too long? Is the hierarchy getting unwieldy?
- **Link Agent**: Are backlinks working? Are there orphaned pages?
- **Quality Agent**: Is content clear? Are sources cited?
- **Consistency Agent**: Do pages contradict each other?

They generate improvement suggestions that feed back into orchestrator prioritization.

### Synthesis Agents

Create higher-order content once enough raw material exists:

- **Guide Agent**: Writes how-to guides based on patterns in the code
- **Overview Agent**: Creates summary pages for modules or features
- **History Agent**: Writes narrative histories of how features evolved
- **Convention Agent**: Extracts and documents coding conventions

### MCP Endpoint

Exposes the research agent to external systems. An AI coding agent with MCP access can query CodeWiki for context before starting work. The endpoint accepts questions and returns synthesized answers with confidence scores and source references.

## Data Model

All state lives in MongoDB (or file-based equivalent). Core collections:

**Repos**: Connected repositories, their GitHub details, processing status, configuration, throttle settings.

**Commits**: All commits for connected repos. Metadata, diff summary, which agents have processed them, timestamps.

**AgentRuns**: History of every agent execution. Which agent, which commit (if applicable), what it found, what updates it requested, duration, cost.

**WikiPages**: The wiki content itself. Markdown content, confidence score, source commits, last updated, backlinks.

**WorkQueue**: Pending work items. Agent type, target (commit or wiki-wide), priority, status, timestamps. Not a separate queue service—just database records.

**Conflicts**: Detected conflicts and their resolution. Feeds back to orchestrator for potential deeper investigation.

**Learnings**: Insights from AI coding sessions that should be incorporated into the wiki. Patterns where agents struggled, conventions they missed.

## Technical Decisions

**Runtime**: Node.js 20.4

**Database**: MongoDB Atlas (production, staging instances) with file-based fallback for environments without external network access. Tests spin up isolated instances.

**Hosting**: Heroku with automatic deployment from main branch.

**CI/CD**: GitHub Actions. Run tests (with real MongoDB), lint, type-check, deploy on success.

**Testing**: End-to-end tests using Playwright for the web interface. Chrome configured with appropriate flags (no-sandbox, etc.) for containerized environments. Integration tests for commands and queries. Unit tests for pure logic.

**Process Model**: Single worker initially. Web process handles HTTP and the UI. Worker process runs the orchestrator loop and executes agents. Communication through the database.

**LLM Integration**: Abstracted behind a service interface so the specific provider can change. Rate limiting and cost tracking built in from the start.

## Development Approach

### Extreme Programming Style

Small iterations, continuous integration, end-to-end tests that verify real user flows. Refactor freely because tests catch regressions. Keep the codebase clean because it's being continuously worked on.

### Dogfooding

CodeWiki will be built using AI coding agents and will generate its own wiki. This creates pressure to make both the tooling and the codebase excellent. If the AI agent struggles to work on CodeWiki, that's a bug in either the system or the code structure.

### Philosophy Documents

The repo includes documents like this plan that capture the high-level thinking. These get folded into the generated wiki and provide the AI coding agent with context about why things are the way they are, not just what they are.

### Incremental Capability

Start simple:
1. Manual trigger: "run 10 iterations"
2. Single agent at a time
3. Basic wiki output
4. Simple web UI

Then layer in:
- Automatic continuous processing
- Parallel agent execution
- Confidence scoring
- Visual progress display
- MCP endpoint
- Synthesis agents
- Learning ingestion

Each increment is usable. The system doesn't need all features to provide value.
