# Level 3: CQRS Layer

> **Navigation**: [Overview](./level-1-overview.md) → [Architecture](./level-2-architecture.md) → CQRS Layer

## Purpose

The CQRS (Command Query Responsibility Segregation) layer separates read and write operations. Commands mutate state with full audit trails. Queries provide read-only access to data.

## Location

```
src/
├── commands/           # State mutations (17 files)
│   ├── agent-run.ts
│   ├── create-wiki.ts
│   ├── finding.ts
│   ├── iteration.ts
│   ├── orchestrator-run.ts
│   ├── processing-run.ts
│   ├── register-repository.ts
│   ├── update-wiki-page.ts
│   └── work-queue.ts
│
└── queries/            # State reads (26 files)
    ├── agent-run.ts
    ├── commit.ts
    ├── conflict.ts
    ├── finding.ts
    ├── wiki-page.ts
    ├── wiki.ts
    ├── work-item.ts
    └── ...
```

## Architecture Pattern

**Command-Handler + Query-Handler Pattern**

- **Commands**: Encapsulate mutations as data objects
- **Command Handlers**: Execute mutations, return results
- **Queries**: Encapsulate reads as data objects
- **Query Handlers**: Execute reads, return data

```
┌─────────────────────────────────────────────────────────────┐
│                         CQRS Pattern                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  WRITE PATH                      READ PATH                   │
│  ──────────                      ─────────                   │
│                                                              │
│  ┌─────────────┐                ┌─────────────┐             │
│  │  Command    │                │   Query     │             │
│  │  (data)     │                │   (data)    │             │
│  └──────┬──────┘                └──────┬──────┘             │
│         │                              │                     │
│         ▼                              ▼                     │
│  ┌─────────────┐                ┌─────────────┐             │
│  │  Handler    │                │  Handler    │             │
│  │  (logic)    │                │  (logic)    │             │
│  └──────┬──────┘                └──────┬──────┘             │
│         │                              │                     │
│         ▼                              ▼                     │
│  ┌─────────────┐                ┌─────────────┐             │
│  │ Repository  │                │ Repository  │             │
│  │  (write)    │                │  (read)     │             │
│  └─────────────┘                └─────────────┘             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Command Structure

### Anatomy of a Command

```typescript
// 1. Command type definition
interface CreateWikiCommand {
  type: 'CREATE_WIKI';
  payload: {
    id: string;
    repoId: string;
    name: string;
  };
}

// 2. Command factory function
function createCreateWikiCommand(payload: {
  id: string;
  repoId: string;
  name: string;
}): CreateWikiCommand {
  return {
    type: 'CREATE_WIKI',
    payload,
  };
}

// 3. Command handler
async function handleCreateWiki(
  command: CreateWikiCommand,
  repos: Repositories
): Promise<Wiki> {
  const wiki = {
    id: command.payload.id,
    repoId: command.payload.repoId,
    name: command.payload.name,
    createdAt: new Date(),
    status: 'active',
  };

  await repos.wikis.save(wiki);
  return wiki;
}
```

### Command Naming Convention

```
create{Entity}Command  → Create new entity
update{Entity}Command  → Modify existing entity
delete{Entity}Command  → Remove entity
{action}{Entity}Command → Domain-specific action
```

## Query Structure

### Anatomy of a Query

```typescript
// 1. Query type definition
interface GetWikiByIdQuery {
  type: 'GET_WIKI_BY_ID';
  wikiId: string;
}

// 2. Query factory function
function createGetWikiByIdQuery(wikiId: string): GetWikiByIdQuery {
  return {
    type: 'GET_WIKI_BY_ID',
    wikiId,
  };
}

// 3. Query handler
async function handleGetWikiById(
  query: GetWikiByIdQuery,
  repos: Repositories
): Promise<Wiki | null> {
  return repos.wikis.findById(query.wikiId);
}
```

## Commands Reference

### Wiki Commands

| Command | Purpose | Key Fields |
|---------|---------|------------|
| `CreateWiki` | Create new wiki | `id`, `repoId`, `name` |
| `UpdateWikiPage` | Create/update page | `wikiId`, `path`, `content` |
| `DeleteWiki` | Remove wiki | `wikiId` |

### Repository Commands

| Command | Purpose | Key Fields |
|---------|---------|------------|
| `RegisterRepository` | Add repo to system | `id`, `url`, `name` |
| `UpdateRepositoryStatus` | Change repo state | `repoId`, `status` |

### Work Queue Commands

| Command | Purpose | Key Fields |
|---------|---------|------------|
| `SaveWorkItems` | Add items to queue | `items[]` |
| `ClaimWorkItemOne` | Claim next available | `repoId`, `wikiId` |
| `CompleteWorkItem` | Mark work done | `itemId`, `result` |
| `FailWorkItem` | Mark work failed | `itemId`, `error` |

### Agent Run Commands

| Command | Purpose | Key Fields |
|---------|---------|------------|
| `CreateAgentRun` | Start agent record | `id`, `agentType`, `workItemId` |
| `CompleteAgentRun` | Finish agent record | `runId`, `result`, `cost` |
| `FailAgentRun` | Record agent failure | `runId`, `error` |

### Processing Run Commands

| Command | Purpose | Key Fields |
|---------|---------|------------|
| `StartProcessingRun` | Begin batch session | `id`, `repoId`, `iterations` |
| `UpdateProcessingProgress` | Update stats | `runId`, `completed`, `failed` |
| `CompleteProcessingRun` | End session | `runId`, `summary` |
| `StopProcessingRun` | Request stop | `runId` |

### Finding Commands

| Command | Purpose | Key Fields |
|---------|---------|------------|
| `CreateFinding` | Record quality issue | `id`, `type`, `pageId` |
| `MarkFindingInProgress` | Being addressed | `findingId` |
| `ResolveFinding` | Mark fixed | `findingId`, `resolution` |
| `DismissFinding` | Ignore issue | `findingId`, `reason` |

### Iteration Commands

| Command | Purpose | Key Fields |
|---------|---------|------------|
| `StartIteration` | Begin work iteration | `id`, `processingRunId` |
| `UpdateIterationWorkItem` | Track work in iteration | `iterationId`, `workItemId` |
| `CompleteIteration` | End iteration | `iterationId` |

## Queries Reference

### Wiki Queries

| Query | Returns | Parameters |
|-------|---------|------------|
| `GetWikiById` | `Wiki \| null` | `wikiId` |
| `GetWikiByRepoId` | `Wiki \| null` | `repoId` |
| `ListWikis` | `Wiki[]` | - |
| `GetActiveWikiForRepo` | `Wiki \| null` | `repoId` |

### Wiki Page Queries

| Query | Returns | Parameters |
|-------|---------|------------|
| `GetWikiPageById` | `WikiPage \| null` | `pageId` |
| `GetWikiPageByPath` | `WikiPage \| null` | `wikiId`, `path` |
| `ListWikiPages` | `WikiPage[]` | `wikiId` |
| `SearchWikiPages` | `WikiPage[]` | `wikiId`, `query` |
| `ListLowConfidencePages` | `WikiPage[]` | `wikiId`, `threshold` |

### Work Item Queries

| Query | Returns | Parameters |
|-------|---------|------------|
| `GetWorkItemById` | `WorkItem \| null` | `itemId` |
| `ListWorkItems` | `WorkItem[]` | `repoId`, `status?` |
| `CountPendingWork` | `number` | `repoId`, `wikiId` |
| `GetPendingWorkKeys` | `string[]` | `repoId`, `wikiId` |

### Commit Queries

| Query | Returns | Parameters |
|-------|---------|------------|
| `GetCommitBySha` | `Commit \| null` | `repoId`, `sha` |
| `ListCommits` | `Commit[]` | `repoId`, `limit?` |
| `ListUnprocessedCommits` | `Commit[]` | `repoId` |
| `CountCommitsByRepo` | `number` | `repoId` |
| `CountProcessedByAgent` | `Map<AgentType, number>` | `repoId` |

### Agent Run Queries

| Query | Returns | Parameters |
|-------|---------|------------|
| `GetAgentRunById` | `AgentRun \| null` | `runId` |
| `ListAgentRuns` | `AgentRun[]` | `repoId`, `limit?` |
| `GetAgentRunsByWorkItem` | `AgentRun[]` | `workItemId` |

### Finding Queries

| Query | Returns | Parameters |
|-------|---------|------------|
| `GetFindingById` | `Finding \| null` | `findingId` |
| `ListOpenFindings` | `Finding[]` | `wikiId` |
| `ListFindingsByPage` | `Finding[]` | `pageId` |
| `CountFindingsByType` | `Map<FindingType, number>` | `wikiId` |

### Conflict Queries

| Query | Returns | Parameters |
|-------|---------|------------|
| `ListOpenConflicts` | `Conflict[]` | `wikiId` |
| `GetConflictById` | `Conflict \| null` | `conflictId` |

## Usage Pattern

### In Executor

```typescript
// Claiming work
const workItem = await handleClaimWorkItemOne(
  createClaimWorkItemOneCommand({ repoId, wikiId }),
  this.repos
);

// Updating wiki
await handleUpdateWikiPage(
  createUpdateWikiPageCommand({
    wikiId,
    path: 'docs/feature.md',
    content: '# Feature\n...',
    source: { type: 'agent', agentType: 'code-change' },
  }),
  this.repos
);

// Recording agent run
await handleCompleteAgentRun(
  createCompleteAgentRunCommand({
    runId,
    tokensUsed: 1500,
    cost: 0.003,
    toolCalls: 5,
  }),
  this.repos
);
```

### In Web Routes

```typescript
// Query wiki pages
const pages = await handleListWikiPages(
  createListWikiPagesQuery({ wikiId }),
  repos
);

// Query processing status
const runs = await handleListAgentRuns(
  createListAgentRunsQuery({ repoId, limit: 10 }),
  repos
);
```

## Benefits of CQRS

1. **Audit Trail**: Commands capture intent, enabling logging
2. **Testability**: Commands/queries are pure data, easy to test
3. **Separation**: Read optimization separate from write logic
4. **Flexibility**: Can swap implementations (MongoDB ↔ file-based)
5. **Clarity**: Clear distinction between mutations and reads

## Related Modules

| Module | Relationship |
|--------|--------------|
| [Executor](./level-3-executor.md) | Uses commands for state changes |
| [Orchestrator](./level-3-orchestrator.md) | Uses queries for context |
| [Data Layer](./level-3-data.md) | Repositories implement storage |
| [Web](./level-2-architecture.md) | Routes use queries for data |

## Key Files

| File | Purpose |
|------|---------|
| `src/commands/work-queue.ts` | Work item mutations |
| `src/commands/update-wiki-page.ts` | Wiki page mutations |
| `src/commands/agent-run.ts` | Agent execution tracking |
| `src/queries/index.ts` | Query re-exports |
| `src/queries/wiki-page.ts` | Wiki page queries |

---

← [Orchestrator](./level-3-orchestrator.md) | [Data Layer →](./level-3-data.md)
