# Level 3: Data Layer

> **Navigation**: [Overview](./level-1-overview.md) → [Architecture](./level-2-architecture.md) → Data Layer

## Purpose

The Data Layer provides domain models (business entities) and repositories (data persistence). Supports dual backends: MongoDB for production and file-based JSON for local development.

## Location

```
src/
├── domain/              # Business entities (type definitions)
│   ├── repo.ts
│   ├── commit.ts
│   ├── wiki.ts
│   ├── wiki-page.ts
│   ├── work-item.ts
│   ├── work-target.ts
│   ├── agent-run.ts
│   ├── finding.ts
│   ├── conflict.ts
│   ├── edit-request.ts
│   ├── processing-run.ts
│   └── orchestrator-run.ts
│
└── repositories/        # Data access layer
    ├── index.ts         # Repository factory
    ├── mongodb/         # MongoDB implementations
    └── file/            # File-based implementations
```

## Domain Models

### Core Entities

```
┌─────────────────────────────────────────────────────────────────┐
│                      Entity Relationships                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────┐      ┌────────┐      ┌────────┐                    │
│  │  Repo  │──1:N─│ Commit │      │  Wiki  │                    │
│  └───┬────┘      └────────┘      └───┬────┘                    │
│      │                               │                          │
│      └───────────1:1─────────────────┘                          │
│                                      │                          │
│                                      │ 1:N                      │
│                                      ▼                          │
│                               ┌───────────┐                     │
│                               │ WikiPage  │                     │
│                               └─────┬─────┘                     │
│                                     │                           │
│                          ┌──────────┼──────────┐                │
│                          │          │          │                │
│                          ▼          ▼          ▼                │
│                    ┌─────────┐ ┌─────────┐ ┌─────────┐         │
│                    │ Finding │ │ Conflict│ │EditReq  │         │
│                    └─────────┘ └─────────┘ └─────────┘         │
│                                                                  │
│  ┌──────────┐     ┌───────────┐     ┌─────────────┐            │
│  │ WorkItem │──N:1│ AgentRun  │     │ProcessingRun│            │
│  └──────────┘     └───────────┘     └─────────────┘            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Entity Definitions

#### Repo

```typescript
interface Repo {
  id: string;
  url: string;              // Git URL or local path
  name: string;             // Display name
  type: 'local' | 'github'; // Source type
  status: 'active' | 'archived' | 'error';
  lastProcessedAt?: Date;
  metadata?: {
    defaultBranch?: string;
    description?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
```

#### Commit

```typescript
interface Commit {
  id: string;
  repoId: string;
  sha: string;              // Git SHA
  message: string;          // Commit message
  author: string;
  authorEmail: string;
  date: Date;
  files: CommitFile[];      // Changed files
  processed: boolean;       // Has been analyzed
  processedBy: AgentType[]; // Which agents processed it
}

interface CommitFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}
```

#### Wiki

```typescript
interface Wiki {
  id: string;
  repoId: string;
  name: string;
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
  stats?: {
    pageCount: number;
    totalWords: number;
    lastUpdated: Date;
  };
}
```

#### WikiPage

```typescript
interface WikiPage {
  id: string;
  wikiId: string;
  path: string;             // URL path (e.g., 'docs/auth')
  title: string;
  content: string;          // Markdown content
  category?: string;        // Page category
  confidence: number;       // 0-1 quality score
  sources: PageSource[];    // What created/updated this
  metadata?: {
    wordCount: number;
    links: string[];
    lastAgentType?: AgentType;
  };
  createdAt: Date;
  updatedAt: Date;
}

interface PageSource {
  type: 'commit' | 'agent' | 'user';
  ref: string;              // SHA, agent name, or user ID
  timestamp: Date;
}
```

#### WorkItem

```typescript
interface WorkItem {
  id: string;
  repoId: string;
  wikiId: string;
  target: WorkTarget;
  agentType: AgentType;
  priority: number;         // Higher = more important
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  claimedBy?: string;       // Worker ID
  claimedAt?: Date;
  completedAt?: Date;
  error?: string;
  createdAt: Date;
}
```

#### WorkTarget

```typescript
type WorkTarget =
  | CommitTarget
  | PathTarget
  | WikiPageTarget
  | FindingTarget;

interface CommitTarget {
  type: 'commit';
  sha: string;
}

interface PathTarget {
  type: 'path';
  path: string;
}

interface WikiPageTarget {
  type: 'wiki-page';
  pageId: string;
}

interface FindingTarget {
  type: 'finding';
  findingId: string;
}
```

#### AgentRun

```typescript
interface AgentRun {
  id: string;
  repoId: string;
  wikiId: string;
  workItemId: string;
  agentType: AgentType;
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  tokensUsed: number;
  cost: number;             // USD
  toolCalls: number;
  result?: {
    pagesCreated: number;
    pagesUpdated: number;
    findingsCreated: number;
  };
  error?: string;
}
```

#### Finding

```typescript
interface Finding {
  id: string;
  wikiId: string;
  type: FindingType;
  pageId?: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'in_progress' | 'resolved' | 'dismissed';
  createdBy: AgentType;
  resolvedBy?: AgentType;
  resolution?: string;
  createdAt: Date;
  updatedAt: Date;
}

type FindingType =
  | 'duplicate_content'
  | 'broken_link'
  | 'inconsistent_terminology'
  | 'outdated_reference'
  | 'low_quality'
  | 'missing_category';
```

#### EditRequest

```typescript
interface EditRequest {
  id: string;
  wikiId: string;
  pageId?: string;          // Existing page or null for new
  path: string;
  operation: 'create' | 'update' | 'delete';
  content?: string;
  source: EditSource;
  status: 'pending' | 'applied' | 'rejected';
  createdAt: Date;
}

interface EditSource {
  type: 'agent' | 'user' | 'commit';
  ref: string;
}
```

#### ProcessingRun

```typescript
interface ProcessingRun {
  id: string;
  repoId: string;
  wikiId: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  totalIterations: number;
  completedIterations: number;
  failedIterations: number;
  totalCost: number;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}
```

## Repository Layer

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Repository Pattern                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │               Repository Interfaces                       │   │
│  │  (WikiRepository, CommitRepository, WorkItemRepository)  │   │
│  └──────────────────────────┬────────────────────────────────┘   │
│                             │                                    │
│              ┌──────────────┴──────────────┐                    │
│              │                             │                     │
│              ▼                             ▼                     │
│  ┌───────────────────────┐    ┌───────────────────────┐        │
│  │   MongoDB Backend     │    │   File-based Backend  │        │
│  │                       │    │                       │        │
│  │  - Production         │    │  - Local development  │        │
│  │  - Full features      │    │  - No external deps   │        │
│  │  - Scalable           │    │  - JSON files         │        │
│  └───────────────────────┘    └───────────────────────┘        │
│                                                                  │
│  Auto-detection: MONGODB_URI environment variable               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Repository Interface Example

```typescript
interface WikiRepository {
  // CRUD operations
  findById(id: string): Promise<Wiki | null>;
  findByRepoId(repoId: string): Promise<Wiki | null>;
  save(wiki: Wiki): Promise<void>;
  delete(id: string): Promise<void>;

  // Query operations
  list(): Promise<Wiki[]>;
  findActive(): Promise<Wiki[]>;
}
```

### Repositories Container

```typescript
interface Repositories {
  repos: RepoRepository;
  commits: CommitRepository;
  wikis: WikiRepository;
  wikiPages: WikiPageRepository;
  workItems: WorkItemRepository;
  agentRuns: AgentRunRepository;
  findings: FindingRepository;
  conflicts: ConflictRepository;
  editRequests: EditRequestRepository;
  processingRuns: ProcessingRunRepository;
  orchestratorRuns: OrchestratorRunRepository;
}
```

### Creating Repositories

```typescript
// Auto-detects backend based on MONGODB_URI
const repos = await createRepositories();

// Explicit MongoDB
const repos = await createMongoRepositories(mongoUri);

// Explicit file-based
const repos = createFileRepositories(dataDir);
```

## File-Based Storage

For local development, data is stored in `.codewiki-data/`:

```
.codewiki-data/
├── repos.json
├── commits.json
├── wikis.json
├── wiki-pages.json
├── work-items.json
├── agent-runs.json
├── findings.json
├── conflicts.json
├── edit-requests.json
├── processing-runs.json
└── orchestrator-runs.json
```

### JSON File Format

```json
{
  "version": 1,
  "updatedAt": "2024-01-15T10:30:00Z",
  "items": [
    { "id": "...", ... },
    { "id": "...", ... }
  ]
}
```

## MongoDB Storage

Collections match entity names:

```
codewiki (database)
├── repos
├── commits
├── wikis
├── wikiPages
├── workItems
├── agentRuns
├── findings
├── conflicts
├── editRequests
├── processingRuns
└── orchestratorRuns
```

### Indexes

Key indexes for performance:

```javascript
// commits
{ repoId: 1, sha: 1 }
{ repoId: 1, processed: 1 }

// wikiPages
{ wikiId: 1, path: 1 }
{ wikiId: 1, confidence: 1 }

// workItems
{ repoId: 1, wikiId: 1, status: 1 }
{ status: 1, priority: -1 }

// agentRuns
{ repoId: 1, agentType: 1 }
{ workItemId: 1 }
```

## Type Guards

Helper functions for runtime type checking:

```typescript
// Work target guards
function isCommitTarget(target: WorkTarget): target is CommitTarget {
  return target.type === 'commit';
}

function isPathTarget(target: WorkTarget): target is PathTarget {
  return target.type === 'path';
}

function isWikiPageTarget(target: WorkTarget): target is WikiPageTarget {
  return target.type === 'wiki-page';
}

function isFindingTarget(target: WorkTarget): target is FindingTarget {
  return target.type === 'finding';
}
```

## Related Modules

| Module | Relationship |
|--------|--------------|
| [CQRS](./level-3-cqrs.md) | Commands/queries use repositories |
| [Agents](./level-3-agents.md) | Agents produce/consume domain entities |
| [Executor](./level-3-executor.md) | Uses repositories via CQRS |

## Key Files

| File | Purpose |
|------|---------|
| `src/domain/wiki-page.ts` | WikiPage type and helpers |
| `src/domain/work-item.ts` | WorkItem type and factories |
| `src/domain/work-target.ts` | WorkTarget type union |
| `src/domain/finding.ts` | Finding type and categories |
| `src/repositories/index.ts` | Repository factory |
| `src/repositories/mongodb/` | MongoDB implementations |
| `src/repositories/file/` | File-based implementations |

---

← [CQRS](./level-3-cqrs.md) | [Services →](./level-3-services.md)
