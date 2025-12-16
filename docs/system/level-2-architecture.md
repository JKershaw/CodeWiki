# Level 2: Subsystem Architecture

> **Navigation**: [Level 1: Overview](./level-1-overview.md) ← You are here → Level 3: Module Details

## Component Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CodeWiki System                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         INTERFACE LAYER                                 │ │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐               │ │
│  │  │     CLI      │   │     Web      │   │     MCP      │               │ │
│  │  │  src/cli/    │   │  src/web/    │   │  src/mcp/    │               │ │
│  │  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘               │ │
│  └─────────┼──────────────────┼──────────────────┼───────────────────────┘ │
│            └──────────────────┼──────────────────┘                          │
│                               ▼                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                          CQRS LAYER                                     │ │
│  │  ┌─────────────────────────┐   ┌─────────────────────────┐            │ │
│  │  │       Commands          │   │        Queries          │            │ │
│  │  │   (state mutations)     │   │    (state reads)        │            │ │
│  │  │    src/commands/        │   │    src/queries/         │            │ │
│  │  └────────────┬────────────┘   └────────────┬────────────┘            │ │
│  └───────────────┼─────────────────────────────┼────────────────────────┘ │
│                  └──────────────┬──────────────┘                           │
│                                 ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        PROCESSING LAYER                                 │ │
│  │                                                                         │ │
│  │   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐            │ │
│  │   │ Orchestrator │───▶│   Executor   │───▶│    Agents    │            │ │
│  │   │ (prioritize) │    │ (run work)   │    │  (analyze)   │            │ │
│  │   └──────────────┘    └──────────────┘    └──────────────┘            │ │
│  │    src/agents/          src/executor/       src/agents/                │ │
│  │    orchestrator/                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                 │                                           │
│                                 ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         DOMAIN LAYER                                    │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │ │
│  │  │  Repo │ Commit │ Wiki │ WikiPage │ WorkItem │ AgentRun │ Finding │  │ │
│  │  │                        src/domain/                               │  │ │
│  │  └─────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                 │                                           │
│                                 ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      INFRASTRUCTURE LAYER                               │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │ │
│  │  │ Repositories │  │   Services   │  │    Utils     │                 │ │
│  │  │ (data access)│  │(LLM,Git,Auth)│  │  (helpers)   │                 │ │
│  │  │src/repos/    │  │src/services/ │  │ src/utils/   │                 │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                 │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Subsystem Inventory

### Interface Layer

| Subsystem | Purpose | Key Files | Dependencies |
|-----------|---------|-----------|--------------|
| **CLI** | Command-line interface for local repo processing | `src/cli.ts`, `src/cli/` | Commands, Queries, Executor |
| **Web** | REST API and browser UI for wiki browsing | `src/web/server.ts`, `src/web/routes/` | Commands, Queries, Services |
| **MCP** | Model Context Protocol for AI tool integration | `src/mcp/server.ts` | Queries, Agents |

### Processing Layer

| Subsystem | Purpose | Key Files | Dependencies |
|-----------|---------|-----------|--------------|
| **[Orchestrator](./level-3-orchestrator.md)** | Decides what work to prioritize | `src/agents/orchestrator/` | Queries, Domain |
| **[Executor](./level-3-executor.md)** | Runs agents on work items from queue | `src/executor/` | Agents, Commands, Services |
| **[Agents](./level-3-agents.md)** | AI workers analyzing code and wiki | `src/agents/` | LLM Service, Domain |

### Data Layer

| Subsystem | Purpose | Key Files | Dependencies |
|-----------|---------|-----------|--------------|
| **[CQRS](./level-3-cqrs.md)** | Command/Query separation for state management | `src/commands/`, `src/queries/` | Repositories, Domain |
| **[Domain](./level-3-data.md)** | Business entities and type definitions | `src/domain/` | None |
| **[Repositories](./level-3-data.md)** | Data persistence abstraction | `src/repositories/` | Domain |

### Infrastructure Layer

| Subsystem | Purpose | Key Files | Dependencies |
|-----------|---------|-----------|--------------|
| **[Services](./level-3-services.md)** | External integrations (LLM, Git, GitHub) | `src/services/` | External APIs |
| **Utils** | Shared utilities and helpers | `src/utils/` | None |

## Data Flow

### Wiki Generation Flow

```
1. USER INPUT
   │
   ▼
2. REPOSITORY REGISTRATION
   CLI: codewiki process .
   └─▶ RegisterRepository command
   └─▶ Fetch commit history via Git Service
   │
   ▼
3. WORK GENERATION (Orchestrator)
   └─▶ Analyze repository state
   └─▶ Generate prioritized work list
   └─▶ Add items to work queue
   │
   ▼
4. WORK EXECUTION (Executor Loop)
   ┌─────────────────────────────────────────┐
   │  For each work item:                    │
   │  ├─▶ Claim from queue                   │
   │  ├─▶ Select appropriate agents          │
   │  ├─▶ Run agent.execute()                │
   │  │   └─▶ LLM Service (AI analysis)      │
   │  ├─▶ Process results (edits, findings)  │
   │  ├─▶ Update wiki pages                  │
   │  └─▶ Mark work complete                 │
   └─────────────────────────────────────────┘
   │
   ▼
5. CONSOLIDATION (optional)
   └─▶ ConsolidationAgent addresses findings
   └─▶ Merge duplicates, fix links
   │
   ▼
6. WIKI READY
   └─▶ Browse via Web UI
   └─▶ Query via CLI or MCP
```

### Request/Response Flow (CQRS)

```
┌──────────────────┐          ┌──────────────────┐
│   Read Path      │          │   Write Path     │
├──────────────────┤          ├──────────────────┤
│                  │          │                  │
│  Query ─────────▶│          │  Command ───────▶│
│       │          │          │         │        │
│       ▼          │          │         ▼        │
│  Repository      │          │  Validation      │
│  (read-only)     │          │         │        │
│       │          │          │         ▼        │
│       ▼          │          │  Repository      │
│  Return Data     │          │  (mutate)        │
│                  │          │         │        │
└──────────────────┘          │         ▼        │
                              │  Return Result   │
                              │                  │
                              └──────────────────┘
```

## Agent Architecture

### Agent Categories

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            AGENT SYSTEM                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ANALYSIS AGENTS (process commits)                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │  code-   │ │narrative │ │ security │ │ pattern  │ │dependency│      │
│  │  change  │ │          │ │          │ │          │ │          │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                                          │
│  META AGENTS (process wiki)                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │  wiki-   │ │   link   │ │structure │ │ quality  │ │consistency│     │
│  │  editor  │ │          │ │          │ │          │ │          │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                                          │
│  SYNTHESIS AGENTS (create guides)                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                   │
│  │ overview │ │ getting- │ │ testing- │ │bootstrap │                   │
│  │          │ │ started  │ │  guide   │ │          │                   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘                   │
│                                                                          │
│  SPECIAL AGENTS                                                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                    │
│  │ Orchestrator │ │Consolidation │ │   Research   │                    │
│  │ (prioritize) │ │ (fix issues) │ │  (queries)   │                    │
│  └──────────────┘ └──────────────┘ └──────────────┘                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Agent Execution Order

```
1. ANALYSIS PHASE
   code-change ──▶ narrative ──▶ security ──▶ pattern ──▶ dependency
        │
        ▼
2. META PHASE
   wiki-editor ──▶ link ──▶ structure ──▶ quality ──▶ consistency
        │
        ▼
3. CONSOLIDATION PHASE
   ConsolidationAgent (addresses findings)
```

## Storage Architecture

### Dual Backend Support

```
┌─────────────────────────────────────────────────────────────────┐
│                    Repository Interface                          │
│  (WikiRepository, WorkItemRepository, etc.)                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
┌───────────────────────┐       ┌───────────────────────┐
│   MongoDB Backend     │       │   File-based Backend  │
│   (production)        │       │   (local development) │
│                       │       │                       │
│   MONGODB_URI set     │       │   MONGODB_URI unset   │
│                       │       │   .codewiki-data/     │
└───────────────────────┘       └───────────────────────┘
```

### Data Entities

```
┌─────────────────────────────────────────────────────────────────┐
│  Repo              │  Git repository being processed            │
├─────────────────────────────────────────────────────────────────┤
│  Commit            │  Individual commits from repos             │
├─────────────────────────────────────────────────────────────────┤
│  Wiki              │  Generated wiki per repository             │
├─────────────────────────────────────────────────────────────────┤
│  WikiPage          │  Individual documentation pages            │
├─────────────────────────────────────────────────────────────────┤
│  WorkItem          │  Queued tasks for agent processing         │
├─────────────────────────────────────────────────────────────────┤
│  AgentRun          │  Execution history and results             │
├─────────────────────────────────────────────────────────────────┤
│  Finding           │  Issues needing consolidation              │
├─────────────────────────────────────────────────────────────────┤
│  EditRequest       │  Pending page modifications                │
├─────────────────────────────────────────────────────────────────┤
│  ProcessingRun     │  Batch processing sessions                 │
├─────────────────────────────────────────────────────────────────┤
│  OrchestratorRun   │  Work list generation history              │
└─────────────────────────────────────────────────────────────────┘
```

## External Dependencies

```
┌─────────────────────────────────────────────────────────────────┐
│                     CodeWiki System                              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  OpenRouter │     │   GitHub    │     │   MongoDB   │
│    (LLM)    │     │    API      │     │  (optional) │
│             │     │             │     │             │
│ Claude,     │     │ OAuth,      │     │ Production  │
│ Gemini,     │     │ Repo API    │     │ storage     │
│ Grok, etc.  │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Level 3 Module Details

Dive deeper into specific subsystems:

- [Agent System](./level-3-agents.md) - AI workers and their specializations
- [Executor](./level-3-executor.md) - Work processing engine
- [Orchestrator](./level-3-orchestrator.md) - Work prioritization logic
- [CQRS Layer](./level-3-cqrs.md) - Commands and Queries reference
- [Data Layer](./level-3-data.md) - Domain models and repositories
- [Services](./level-3-services.md) - LLM, Git, and external integrations

---

← [Level 1: Overview](./level-1-overview.md)
