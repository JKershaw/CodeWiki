---
title: "CQRS Architecture Decision"
confidence: 0.50
created: 2025-11-26T10:23:03.657Z
updated: 2025-11-26T10:23:03.657Z
commits: [af17f139216b14a9963812157b3923ef5bde7d66]
---
# CQRS Architecture Decision

This commit establishes the foundational architecture of CodeWiki using CQRS (Command Query Responsibility Segregation) pattern. It represents a significant architectural decision documenting the system's structure, domain model, and separation of concerns. The commit message and code structure reveal core design principles about state management, agent orchestration, and wiki generation.

## Key Points

- **ARCHITECTURE**: CQRS pattern chosen as core architecture - all state changes flow through commands (StartProcessingRepo, UpdateWikiPage), queries read state without modification
- **DESIGN**: Repository pattern with interface-based abstraction allows pluggable storage (file-based implementation provided, MongoDB dependency suggests future database support)
- **DOMAIN_MODEL**: Domain entities defined: Repo, Commit, WikiPage, AgentRun, WorkItem, Conflict, Learning - reveals system's core concepts and their relationships
- **AGENT_SYSTEM**: Agent types defined (Planner, Narrative, Structure, Reference, Curator) with execution tracking via AgentRun - suggests multi-agent collaboration model
- **CONFLICT_RESOLUTION**: Conflict detection and resolution system built-in, suggesting anticipation of competing agent edits
- **LEARNING_SYSTEM**: Learning entity suggests system that improves over time by recording insights
- **DATA_LOCALITY**: File-based storage in .codewiki-data/ directory indicates local-first approach initially

## Decisions Made

- CQRS chosen to provide clean boundary between core logic and external interfaces (HTTP, MCP, CLI) - enables multiple frontend paradigms
- Repository pattern with interfaces enables storage flexibility (file-based now, database later)
- Multi-agent architecture with distinct roles (Planner, Narrative, Structure, Reference, Curator) rather than monolithic processor
- Built-in conflict detection/resolution acknowledges that multiple agents may produce competing documentation
- Learning system suggests iterative improvement - system records what works and adapts
- Domain model separates concerns: Repo (source), Commit (history), WikiPage (output), AgentRun (execution), WorkItem (queue), Conflict (coordination), Learning (improvement)
- File-based storage initially (.codewiki-data/) but MongoDB dependency indicates planned database migration

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
