# CodeWiki System Documentation

Welcome to the CodeWiki system documentation. This multi-level documentation helps you understand CodeWiki from high-level concepts down to implementation details.

## Quick Navigation

| Level | Document | Description | Audience |
|-------|----------|-------------|----------|
| **1** | [System Overview](./level-1-overview.md) | What CodeWiki is and how to use it | Everyone |
| **2** | [Architecture](./level-2-architecture.md) | Components and how they interact | Developers starting out |
| **3** | Module Details | Deep dives into subsystems | Active contributors |

## Documentation Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                      Level 1: Overview                           │
│              "What is CodeWiki?" (~200 words)                   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Level 2: Architecture                          │
│           "What are the major components?" (~500 words)         │
└──────────────────────────────┬──────────────────────────────────┘
                               │
       ┌───────────┬───────────┼───────────┬───────────┐
       │           │           │           │           │
       ▼           ▼           ▼           ▼           ▼
┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
│  Agents   │ │ Executor  │ │Orchestratr│ │   CQRS    │ │  Data +   │
│           │ │           │ │           │ │           │ │ Services  │
└───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘
   Level 3: Module Details (~1500 words each)
```

## Level 3: Module Documentation

### Core Processing

| Module | Description | Key Concepts |
|--------|-------------|--------------|
| [Agent System](./level-3-agents.md) | AI workers that analyze code | Registry, Agent types, Tool system |
| [Executor](./level-3-executor.md) | Work processing engine | Worker pool, CQRS commands, Tool enforcement |
| [Orchestrator](./level-3-orchestrator.md) | Work prioritization | Context gathering, Strategies, LLM mode |

### Data & Infrastructure

| Module | Description | Key Concepts |
|--------|-------------|--------------|
| [CQRS Layer](./level-3-cqrs.md) | Command/Query separation | Commands, Queries, Handlers |
| [Data Layer](./level-3-data.md) | Domain models & persistence | Entities, Repositories, Dual backends |
| [Services](./level-3-services.md) | External integrations | LLM, Git, GitHub, Auth |

## How to Use This Documentation

### I'm new to the project
1. Start with [Level 1: Overview](./level-1-overview.md) to understand what CodeWiki does
2. Read [Level 2: Architecture](./level-2-architecture.md) for the component map
3. Explore Level 3 modules as needed for your task

### I need to fix a bug
1. Identify which subsystem is affected
2. Go directly to the relevant Level 3 module
3. Use the "Key Files" section to locate code

### I want to add a feature
1. Review [Level 2: Architecture](./level-2-architecture.md) to understand where it fits
2. Read relevant Level 3 modules
3. Check "Extension Guide" sections for how-to instructions

### I'm debugging agent behavior
1. Start with [Agent System](./level-3-agents.md)
2. Understand the agent execution flow in [Executor](./level-3-executor.md)
3. Check how work is prioritized in [Orchestrator](./level-3-orchestrator.md)

## Visual Legend

Throughout the documentation, these visual conventions are used:

```
DIAGRAM ELEMENTS
────────────────
┌─────────┐
│  Box    │  = Component/Module
└─────────┘

    │
    ▼         = Data flow / dependency
    │

- - - ▶       = Optional / async flow

  ◀───▶       = Bidirectional communication


COLOR MEANINGS (in diagrams with color)
───────────────────────────────────────
🔵 Blue    = Entry points (CLI, Web, API)
🟢 Green   = Data flow / success paths
🟡 Yellow  = Processing / transformation
🟣 Purple  = External services
⚪ Gray    = Storage / persistence
```

## Key Architectural Patterns

| Pattern | Where Used | Purpose |
|---------|------------|---------|
| **Registry** | Agent System | Centralized agent management |
| **CQRS** | Commands/Queries | Separate read and write paths |
| **Worker Pool** | Executor | Parallel work processing |
| **Strategy** | Orchestrator | Multiple work generation approaches |
| **Repository** | Data Layer | Abstract storage implementations |

## File Quick Reference

| What | Where |
|------|-------|
| Agent definitions | `src/agents/` |
| Work execution | `src/executor/` |
| State mutations | `src/commands/` |
| State queries | `src/queries/` |
| Domain entities | `src/domain/` |
| Data storage | `src/repositories/` |
| LLM integration | `src/services/llm/` |
| Web API | `src/web/` |
| CLI | `src/cli/` |

## Related Documentation

- [CLAUDE.md](../../CLAUDE.md) - Development guidelines
- [docs/plans/](../plans/) - Feature planning documents
- [tests/](../../tests/) - Test suite documentation

---

*Last updated: Generated from codebase analysis*
