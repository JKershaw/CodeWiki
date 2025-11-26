---
title: "CQRS Architecture Pattern Decision"
confidence: 0.50
created: 2025-11-26T12:36:10.788Z
updated: 2025-11-26T12:36:10.788Z
commits: [af17f139216b14a9963812157b3923ef5bde7d66]
---
# CQRS Architecture Pattern Decision

This commit establishes the foundational CQRS architecture for the CodeWiki project. The code structure reveals a deliberate architectural decision to separate commands (state changes) from queries (state reads), with an abstracted repository pattern allowing multiple storage implementations. The domain models show a system designed for AI-assisted wiki generation from git repositories, with built-in conflict detection and learning feedback mechanisms.

## Key Points

- **ARCHITECTURE**: CQRS pattern chosen as core architectural principle - complete separation of commands (src/commands/) from queries (src/queries/) with dedicated types and handlers. Comments explicitly state "Commands are things that change state" and "All state changes flow through commands, providing a clean boundary between core logic and external interfaces (HTTP, MCP, CLI, etc.)"
- **ARCHITECTURE**: Repository pattern with interface abstraction (src/repositories/interfaces/) and file-based implementation (src/repositories/file-based/), enabling future storage backend swaps without touching domain logic
- **DOMAIN**: Domain-driven design with rich entities: Repo, Commit, WikiPage, AgentRun, WorkItem, Conflict, Learning - each representing a first-class concept in the system
- **DESIGN**: Multi-agent architecture implied by AgentRun domain model with agentType field, suggesting extensible agent system for different analysis tasks
- **DESIGN**: Conflict detection system built into core domain (src/domain/conflict.ts), treating conflicts as first-class entities rather than exceptions
- **DESIGN**: Learning/feedback loop built into domain model (src/domain/learning.ts), enabling AI agents to improve over time
- **INFRASTRUCTURE**: Local-first design with .codewiki-data/ directory for file-based storage, reducing external dependencies for initial development

## Decisions Made

- **CQRS Architecture**: System built around strict command/query separation to provide clean boundaries between core logic and external interfaces (HTTP, MCP, CLI). Commands handle all state changes; queries handle all reads. This enables flexible interface layers without polluting domain logic.
- **Repository Pattern**: Storage abstraction through interfaces allows swapping backends (file-based now, MongoDB dependency suggests future database support) without modifying domain or command/query logic.
- **Domain-Driven Design**: Rich domain models (Repo, Commit, WikiPage, AgentRun, etc.) as first-class entities rather than anemic data structures, ensuring business logic lives in the domain layer.
- **Conflict as Entity**: Conflicts treated as domain entities to be tracked and resolved, not exceptions to be caught, enabling systematic conflict resolution workflows.
- **AI Learning Loop**: Learning entity captures AI feedback and improvements, building institutional knowledge into the system itself.
- **Local-First Storage**: File-based repository implementation for initial development, reducing infrastructure requirements and enabling offline operation.
- **Multi-Agent Extensibility**: AgentRun abstraction suggests pluggable agent system where different specialized agents can process repositories.

## Source Files

- `.gitignore`
- `package.json`
- `src/commands/index.ts`
- `src/commands/start-processing-repo.ts`
- `src/commands/types.ts`
- `src/commands/update-wiki-page.ts`
- `src/domain/agent-run.ts`
- `src/domain/commit.ts`
- `src/domain/conflict.ts`
- `src/domain/index.ts`
- `src/domain/learning.ts`
- `src/domain/repo.ts`
- `src/domain/wiki-page.ts`
- `src/domain/work-item.ts`
- `src/index.ts`
- `src/queries/get-repo-status.ts`
- `src/queries/get-wiki-page.ts`
- `src/queries/index.ts`
- `src/queries/search-wiki.ts`
- `src/queries/types.ts`
- `src/repositories/file-based/file-agent-run-repository.ts`
- `src/repositories/file-based/file-commit-repository.ts`
- `src/repositories/file-based/file-conflict-repository.ts`
- `src/repositories/file-based/file-learning-repository.ts`
- `src/repositories/file-based/file-repo-repository.ts`
- `src/repositories/file-based/file-store.ts`
- `src/repositories/file-based/file-wiki-page-repository.ts`
- `src/repositories/file-based/file-work-queue-repository.ts`
- `src/repositories/file-based/index.ts`
- `src/repositories/index.ts`
- `src/repositories/interfaces/agent-run-repository.ts`
- `src/repositories/interfaces/commit-repository.ts`
- `src/repositories/interfaces/conflict-repository.ts`
- `src/repositories/interfaces/index.ts`
- `src/repositories/interfaces/learning-repository.ts`
- `src/repositories/interfaces/repo-repository.ts`
- `src/repositories/interfaces/wiki-page-repository.ts`
- `src/repositories/interfaces/work-queue-repository.ts`
- `tsconfig.json`

---
*Captured from commit af17f139*
