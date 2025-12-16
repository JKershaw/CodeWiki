# Level 3: Executor

> **Navigation**: [Overview](./level-1-overview.md) → [Architecture](./level-2-architecture.md) → Executor

## Purpose

The Executor is the inner loop that processes work items from the queue. It coordinates agent execution, manages concurrency, enforces tool usage rules, and routes agent outputs to the appropriate handlers.

## Location

```
src/executor/
├── executor.ts              # Main executor class (~800 lines)
├── continuous-worker-pool.ts # Concurrent worker management
└── tool-enforcement.ts      # Tool usage validation
```

## Architecture Pattern

**Worker Pool + Command Pattern**

- **Worker Pool**: Multiple concurrent workers claiming work items
- **Command Pattern**: All state changes flow through CQRS commands
- **On-Demand**: Workers request one item at a time (no pre-fetching)

```
┌─────────────────────────────────────────────────────────────────┐
│                         Executor                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              ContinuousWorkerPool                        │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │   │
│  │  │Worker 1 │  │Worker 2 │  │Worker 3 │  │Worker 4 │    │   │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘    │   │
│  │       │            │            │            │          │   │
│  │       └────────────┴─────┬──────┴────────────┘          │   │
│  │                          │                               │   │
│  └──────────────────────────┼───────────────────────────────┘   │
│                             │                                    │
│                             ▼                                    │
│                     ┌──────────────┐                            │
│                     │  Work Queue  │                            │
│                     │  (claim one) │                            │
│                     └──────────────┘                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Core Execution Loop

### Main Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      runIterations()                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. CREATE PROCESSING RUN                                       │
│     └─▶ handleStartProcessingRun(command)                       │
│                                                                  │
│  2. START WORKER POOL                                           │
│     └─▶ runContinuousPool(maxConcurrency, workerFn)            │
│                                                                  │
│  3. WORKER LOOP (each worker):                                  │
│     ┌─────────────────────────────────────────────────────┐    │
│     │  a. Check for pending edit requests                  │    │
│     │     └─▶ If found, process immediately               │    │
│     │                                                      │    │
│     │  b. Claim work item from queue                       │    │
│     │     └─▶ handleClaimWorkItemOne(command)             │    │
│     │                                                      │    │
│     │  c. If no work, ask Orchestrator for more           │    │
│     │     └─▶ orchestrator.generateWorkList()             │    │
│     │     └─▶ handleSaveWorkItems(command)                │    │
│     │                                                      │    │
│     │  d. Run appropriate agent                            │    │
│     │     └─▶ agent.execute(context)                      │    │
│     │                                                      │    │
│     │  e. Process agent results                            │    │
│     │     └─▶ Create edit requests                        │    │
│     │     └─▶ Create findings                             │    │
│     │                                                      │    │
│     │  f. Complete or fail work item                       │    │
│     │     └─▶ handleCompleteWorkItem/handleFailWorkItem   │    │
│     │                                                      │    │
│     │  g. Repeat until iterations exhausted               │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                  │
│  4. COMPLETE PROCESSING RUN                                     │
│     └─▶ handleCompleteProcessingRun(command)                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Work Item Processing Detail

```
┌──────────────┐
│  Work Item   │
│  (claimed)   │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  SELECT AGENT                                                 │
│  ├─▶ If target is 'commit': use item.agentType               │
│  ├─▶ If target is 'path': use codebase-explorer              │
│  ├─▶ If target is 'finding': use consolidation               │
│  └─▶ If target is 'wiki-page': use meta agents               │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  BUILD CONTEXT                                                │
│  ├─▶ Load commit + diff (if commit target)                   │
│  ├─▶ Load existing wiki pages                                │
│  ├─▶ Create UnifiedRepoAccess                                │
│  └─▶ Assemble AgentContext                                   │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  EXECUTE AGENT                                                │
│  └─▶ agent.execute(context)                                  │
│      ├─▶ LLM calls with tools                                │
│      ├─▶ Tool enforcement validation                         │
│      └─▶ Returns AgentResult                                 │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  PROCESS RESULTS                                              │
│  ├─▶ For each editRequest:                                   │
│  │   └─▶ handleUpdateWikiPage(command)                       │
│  ├─▶ For each finding:                                       │
│  │   └─▶ handleCreateFinding(command)                        │
│  └─▶ Record AgentRun                                         │
│      └─▶ handleCompleteAgentRun(command)                     │
└──────────────────────────────────────────────────────────────┘
```

## Tool Enforcement

Agents must follow tool usage rules. The executor validates this.

```typescript
interface ToolRequirements {
  required: string[];      // Must use these tools
  forbidden: string[];     // Must not use these tools
  minCalls?: number;       // Minimum total tool calls
}
```

### Validation Flow

```
Agent Execution
       │
       ▼
┌──────────────────────┐
│  Collect tool calls  │
│  during execution    │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  validateToolUsage() │
│  ├─▶ Check required  │
│  ├─▶ Check forbidden │
│  └─▶ Check minCalls  │
└──────────┬───────────┘
           │
     ┌─────┴─────┐
     │           │
     ▼           ▼
┌─────────┐  ┌─────────────┐
│  Pass   │  │    Fail     │
│         │  │             │
│ Continue│  │ Log warning │
│         │  │ or throw    │
└─────────┘  └─────────────┘
```

## Concurrency Management

### ContinuousWorkerPool

Manages parallel worker execution with coordination:

```typescript
interface WorkerPoolConfig {
  maxConcurrency: number;    // Max parallel workers
  maxIterations: number;     // Total items to process
  onProgress?: (completed: number) => void;
}
```

```
┌─────────────────────────────────────────────────────────────┐
│                  ContinuousWorkerPool                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  State:                                                      │
│  ├─▶ completed: number (items finished)                     │
│  ├─▶ active: number (workers currently running)             │
│  └─▶ shouldStop: boolean (graceful shutdown flag)           │
│                                                              │
│  Workers compete for work:                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │Worker 1 │  │Worker 2 │  │Worker 3 │  │Worker 4 │        │
│  │ active  │  │ waiting │  │ active  │  │ active  │        │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘        │
│                                                              │
│  Coordination:                                               │
│  ├─▶ Atomic increment of completed count                    │
│  ├─▶ Workers check shouldStop before claiming               │
│  └─▶ Empty queue triggers orchestrator refill               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## ExecutionSummary

Returned from `runIterations()`:

```typescript
interface ExecutionSummary {
  processingRunId: string;     // Unique run ID
  iterations: number;          // Items attempted
  successful: number;          // Items completed
  failed: number;              // Items failed
  totalCost: number;           // LLM costs in USD
  wikiPagesCreated: number;    // New pages
  wikiPagesUpdated: number;    // Modified pages
  duplicatesFiltered: number;  // Skipped duplicates
}
```

## CQRS Commands Used

The executor uses these commands for state changes:

| Command | Purpose |
|---------|---------|
| `StartProcessingRun` | Begin a processing session |
| `UpdateProcessingProgress` | Update progress stats |
| `CompleteProcessingRun` | Mark session complete |
| `FailProcessingRun` | Mark session failed |
| `StopProcessingRun` | Request graceful stop |
| `ClaimWorkItemOne` | Claim next available work |
| `SaveWorkItems` | Add new work to queue |
| `CompleteWorkItem` | Mark work done |
| `FailWorkItem` | Mark work failed |
| `CreateAgentRun` | Start agent execution record |
| `CompleteAgentRun` | Finish agent execution record |
| `UpdateWikiPage` | Apply page changes |

## API Reference

### Executor Class

```typescript
class Executor {
  constructor(
    repos: Repositories,
    git: GitService,
    llm: LLMService,
    orchestrator: Orchestrator,
    repoServiceFactory?: RepositoryServiceFactory
  );

  /** Run N iterations of work processing */
  runIterations(
    repoId: string,
    iterations: number
  ): Promise<ExecutionSummary>;

  /** Stop processing gracefully */
  stop(): void;

  /** Check if currently running */
  isRunning(): boolean;
}
```

### Worker Function Signature

```typescript
type WorkerFunction = (
  workerId: number,
  signal: AbortSignal
) => Promise<WorkerResult>;
```

## Related Modules

| Module | Relationship |
|--------|--------------|
| [Agents](./level-3-agents.md) | Executes agents on work items |
| [Orchestrator](./level-3-orchestrator.md) | Gets work when queue empty |
| [CQRS](./level-3-cqrs.md) | All state changes via commands |
| [Services/LLM](./level-3-services.md) | LLM calls for agents |

## Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/executor/executor.ts` | ~800 | Main executor logic |
| `src/executor/continuous-worker-pool.ts` | ~200 | Worker pool management |
| `src/executor/tool-enforcement.ts` | ~150 | Tool validation rules |

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MAX_CONCURRENCY` | 4 | Number of parallel workers |

---

← [Agents](./level-3-agents.md) | [Orchestrator →](./level-3-orchestrator.md)
