# Level 3: Orchestrator

> **Navigation**: [Overview](./level-1-overview.md) → [Architecture](./level-2-architecture.md) → Orchestrator

## Purpose

The Orchestrator decides what work to do next. It analyzes repository state, wiki progress, and pending tasks to generate a prioritized work list. Can operate in deterministic mode (fast, predictable) or LLM mode (intelligent, adaptive).

## Location

```
src/agents/orchestrator/
├── orchestrator.ts        # Main orchestrator class
├── context-gatherer.ts    # Collects decision context
├── prompts.ts             # LLM prompts
├── strategies.ts          # Deterministic strategies
└── phased-orchestrator.ts # Multi-phase orchestration
```

## Architecture Pattern

**Strategy + Fallback Pattern**

- **LLM Strategy**: Uses AI to make intelligent prioritization decisions
- **Deterministic Fallback**: Fixed strategies when LLM unavailable or fails
- **Graceful Degradation**: Always produces work, never blocks

```
┌─────────────────────────────────────────────────────────────┐
│                      Orchestrator                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  generateWorkList(repoId, wikiId, maxItems)                 │
│          │                                                   │
│          ▼                                                   │
│  ┌─────────────────┐                                        │
│  │ Check Bootstrap │──▶ Return bootstrap work if needed     │
│  └────────┬────────┘                                        │
│           │                                                  │
│           ▼                                                  │
│  ┌─────────────────┐     ┌──────────────────────┐          │
│  │   LLM Mode?     │─Yes─▶│  generateWithLLM()  │          │
│  └────────┬────────┘     └──────────┬───────────┘          │
│           │No                       │                        │
│           │              ┌──────────┴──────────┐            │
│           │              │  Success?           │            │
│           │              └──────────┬──────────┘            │
│           │                    No   │   Yes                  │
│           │              ┌──────────┘   │                   │
│           ▼              ▼              ▼                    │
│  ┌─────────────────────────┐    ┌─────────────┐            │
│  │ generateDeterministic() │    │ Return work │            │
│  └─────────────────────────┘    └─────────────┘            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Decision Context

The orchestrator gathers comprehensive context before deciding:

### ContextGatherer Output

```typescript
interface OrchestratorContext {
  // Repository state
  repoId: string;
  totalCommits: number;
  unprocessedCommits: Commit[];

  // Wiki state
  wikiId: string;
  totalPages: number;
  pageList: WikiPage[];
  lowConfidencePages: WikiPage[];

  // Work state
  pendingWorkCount: number;
  pendingWorkKeys: string[];
  recentAgentRuns: AgentRun[];

  // Quality signals
  openFindings: Finding[];
  openConflicts: Conflict[];

  // Processing stats per agent
  processedByAgent: Map<AgentType, number>;
}
```

### Context Gathering Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    ContextGatherer                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  gatherContext(repoId, wikiId)                              │
│          │                                                   │
│          ├─▶ countCommitsByRepo()        → totalCommits     │
│          ├─▶ listUnprocessedCommits()    → unprocessed[]    │
│          ├─▶ listWikiPages()             → pages[]          │
│          ├─▶ countPendingWork()          → pendingCount     │
│          ├─▶ listOpenFindings()          → findings[]       │
│          ├─▶ listOpenConflicts()         → conflicts[]      │
│          ├─▶ listLowConfidencePages()    → lowConf[]        │
│          └─▶ countProcessedByAgent()     → agentStats       │
│                                                              │
│  All queries run in parallel for efficiency                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Work Generation Modes

### LLM Mode

Uses AI to make intelligent decisions based on context:

```
Context + System Prompt
        │
        ▼
┌──────────────────────────────────────────────────────────────┐
│  LLM Decision                                                 │
│                                                               │
│  Considers:                                                   │
│  ├─▶ What commits haven't been analyzed?                     │
│  ├─▶ Which agents haven't run recently?                      │
│  ├─▶ Are there quality issues to address?                    │
│  ├─▶ What would provide most value now?                      │
│  └─▶ Are there findings needing consolidation?               │
│                                                               │
│  Outputs structured work list with priorities                │
│                                                               │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
   parseOrchestratorResponse()
        │
        ▼
   WorkItem[]
```

### Deterministic Mode

Uses fixed strategies executed in order:

```typescript
// Strategy execution order
const strategies = [
  bootstrapStrategy,           // Initial wiki setup
  codebaseExplorationStrategy, // Deep codebase analysis
  unprocessedCommitsStrategy,  // New commits first
  findingsStrategy,            // Address quality issues
  metaAgentStrategy,           // Wiki improvement
];
```

### Strategy Interface

```typescript
interface Strategy {
  name: string;
  execute(context: StrategyContext): Promise<WorkItem[]>;
  shouldRun(context: StrategyContext): boolean;
}
```

## Work Item Generation

### Work Item Structure

```typescript
interface WorkItem {
  id: string;                    // Unique identifier
  repoId: string;               // Repository
  wikiId: string;               // Target wiki
  target: WorkTarget;           // What to process
  agentType: AgentType;         // Which agent
  priority: number;             // Higher = more important
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: Date;
  metadata?: Record<string, unknown>;
}
```

### Work Targets

```typescript
type WorkTarget =
  | { type: 'commit'; sha: string }           // Analyze a commit
  | { type: 'path'; path: string }            // Explore codebase path
  | { type: 'wiki-page'; pageId: string }     // Process wiki page
  | { type: 'finding'; findingId: string };   // Address a finding
```

## Bootstrap Detection

Special handling for new wikis:

```
┌─────────────────────────────────────────────────────────────┐
│  checkBootstrapNeeded()                                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  IF wiki has 0 pages:                                       │
│     └─▶ Return bootstrap work item                          │
│                                                              │
│  IF wiki missing essential pages (index, overview):         │
│     └─▶ Return synthesis work for missing pages             │
│                                                              │
│  OTHERWISE:                                                  │
│     └─▶ Return null (no bootstrap needed)                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Orchestrator Interface

```typescript
interface Orchestrator {
  /** Generate prioritized work list */
  generateWorkList(
    repoId: string,
    wikiId: string,
    maxItems?: number
  ): Promise<WorkItem[]>;

  /** Check if more work is available */
  hasMoreWork(
    repoId: string,
    wikiId: string
  ): Promise<boolean>;

  /** Get work statistics */
  getWorkSummary(
    repoId: string,
    wikiId: string
  ): Promise<WorkSummary>;
}
```

## Configuration

```typescript
interface OrchestratorConfig {
  /** Use LLM for decisions (default: false) */
  useLLM?: boolean;

  /** LLM model for orchestration */
  model?: string;  // default: 'anthropic/claude-haiku-4.5'
}
```

## LLM Prompts

### System Prompt (Summary)

The orchestrator system prompt instructs the LLM to:

1. Analyze repository and wiki state
2. Identify what work would add most value
3. Consider commit coverage, quality issues, and wiki gaps
4. Output structured work items with priorities
5. Balance between new content and quality maintenance

Location: `src/agents/orchestrator/prompts.ts`

## Progress Updates

The orchestrator can generate human-readable progress updates:

```typescript
interface ProgressUpdate {
  summary: string;           // What's happening
  completedWork: string[];   // Recent accomplishments
  nextSteps: string[];       // Upcoming work
  stats: {
    pagesCreated: number;
    commitsProcessed: number;
    findingsResolved: number;
  };
}
```

## Related Modules

| Module | Relationship |
|--------|--------------|
| [Executor](./level-3-executor.md) | Consumes generated work |
| [Agents](./level-3-agents.md) | Work items specify agent types |
| [CQRS](./level-3-cqrs.md) | Queries for context gathering |
| [Domain](./level-3-data.md) | WorkItem, Finding types |

## Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/agents/orchestrator/orchestrator.ts` | ~400 | Main orchestrator logic |
| `src/agents/orchestrator/context-gatherer.ts` | ~250 | Context collection |
| `src/agents/orchestrator/prompts.ts` | ~200 | LLM prompt templates |
| `src/agents/orchestrator/strategies.ts` | ~300 | Deterministic strategies |

---

← [Executor](./level-3-executor.md) | [CQRS →](./level-3-cqrs.md)
