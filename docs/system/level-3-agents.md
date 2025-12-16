# Level 3: Agent System

> **Navigation**: [Overview](./level-1-overview.md) → [Architecture](./level-2-architecture.md) → Agent System

## Purpose

The Agent System provides specialized AI workers that analyze code changes and wiki content. Each agent has a focused responsibility and produces structured outputs that update the wiki.

## Location

```
src/agents/
├── registry.ts              # Central agent registry
├── base-agent.ts            # Abstract base class
├── agent-types.ts           # Type definitions
├── analysis/                # Commit analysis agents
├── meta/                    # Wiki processing agents
├── synthesis/               # Guide generation agents
├── consolidation/           # Self-healing agents
└── orchestrator/            # Work prioritization
```

## Architecture Pattern

**Registry + Strategy Pattern**

- **Registry**: Central `Map<string, Agent>` holds singleton instances
- **Strategy**: Each agent implements the same interface with different behavior
- **Extension**: Add new agent class, register in `initializeRegistry()`

```
┌─────────────────────────────────────────────────────────────┐
│                     AgentRegistry                            │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Map<string, Agent>                                      ││
│  │                                                          ││
│  │  "code-change"  → CodeChangeAgent                        ││
│  │  "security"     → SecurityAgent                          ││
│  │  "narrative"    → NarrativeAgent                         ││
│  │  ...                                                     ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  getAgent(type: string): Agent | null                       │
│  getAllAgents(): Agent[]                                    │
│  getAgentPrompt(type: string): string | null                │
└─────────────────────────────────────────────────────────────┘
```

## Agent Interface

Every agent implements this contract:

```typescript
interface Agent {
  /** Unique identifier */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /** What type of work target this agent processes */
  readonly workTarget: 'commit' | 'path' | 'wiki-page' | 'finding';

  /** Execute the agent on a work item */
  execute(context: AgentContext): Promise<AgentResult>;

  /** Get the system prompt (for introspection) */
  getSystemPrompt(): string;
}
```

## Agent Categories

### Analysis Agents (Process Commits)

These agents analyze individual commits and generate wiki content about code changes.

| Agent | Purpose | Key Output |
|-------|---------|------------|
| **code-change** | General code analysis | Wiki pages describing changes |
| **narrative** | Detects ADRs, planning docs, READMEs | Documentation structure pages |
| **security** | Security audit | Security considerations, vulnerabilities |
| **technical-debt** | TODOs, code smells, complexity | Technical debt tracking |
| **pattern** | Design patterns and conventions | Architecture patterns documentation |
| **dependency** | Dependency changes | Dependency update documentation |
| **codebase-explorer** | Deep codebase understanding | Structural analysis |

**Execution Order**: `code-change` runs first to establish base content, then specialized agents add perspectives.

```
commit → code-change → narrative → security → pattern → dependency
             │              │          │          │          │
             ▼              ▼          ▼          ▼          ▼
          [base         [docs      [security  [patterns  [deps
           content]      notes]     notes]     found]     changes]
```

### Meta Agents (Process Wiki)

These agents analyze and improve the wiki itself.

| Agent | Purpose | Key Output |
|-------|---------|------------|
| **wiki-editor** | Process pending edit requests | Applied edits |
| **link** | Cross-reference management | Updated links |
| **structure** | Wiki organization | Structure recommendations |
| **quality** | Content quality review | Quality findings |
| **consistency** | Cross-page consistency | Consistency findings |
| **source-verification** | Verify content matches code | Accuracy findings |
| **category** | Category inference | Category assignments |

**Execution Order**: `wiki-editor` runs first to apply pending edits.

### Synthesis Agents (Create Guides)

These agents create high-level documentation from existing wiki content.

| Agent | Purpose | Output |
|-------|---------|--------|
| **overview** | Section summaries | Overview pages |
| **project-overview** | Project-wide summary | Main project page |
| **getting-started** | Onboarding guide | Getting started guide |
| **testing-guide** | Test documentation | Testing guide |
| **extension-guide** | Extension instructions | Extension guide |
| **bootstrap** | Initial wiki structure | Bootstrap pages |
| **wiki-index** | Wiki index page | Index page |
| **toc** | Table of contents | TOC page |

### Special Agents

| Agent | Purpose | Trigger |
|-------|---------|---------|
| **ConsolidationAgent** | Addresses findings (duplicates, links) | Finding work items |
| **ResearchAgent** | Quick queries about repos | MCP tool calls |
| **SpecAgent** | Generates implementation specs | CLI `spec` command |

## Data Flow

### Agent Execution Sequence

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Executor   │     │    Agent     │     │ LLM Service  │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │  execute(context)  │                    │
       │───────────────────>│                    │
       │                    │                    │
       │                    │  chat(prompt)      │
       │                    │───────────────────>│
       │                    │                    │
       │                    │  [LLM processes]   │
       │                    │                    │
       │                    │  toolResults       │
       │                    │<───────────────────│
       │                    │                    │
       │                    │ (may iterate       │
       │                    │  with tools)       │
       │                    │                    │
       │  AgentResult       │                    │
       │<───────────────────│                    │
       │                    │                    │
       │  [process edits,   │                    │
       │   create findings] │                    │
       │                    │                    │
```

### AgentContext Structure

```typescript
interface AgentContext {
  // What to analyze
  workItem: WorkItem;
  target: WorkTarget;

  // Repository info
  repoId: string;
  wikiId: string;

  // Access to services
  llm: LLMService;
  repos: Repositories;
  repoAccess: UnifiedRepoAccess;

  // Existing wiki content
  existingPages: WikiPage[];

  // For commit targets
  commit?: Commit;
  diff?: string;
}
```

### AgentResult Structure

```typescript
interface AgentResult {
  // Status
  success: boolean;
  error?: string;

  // Output
  editRequests: EditRequest[];   // Pages to create/update
  findings: Finding[];           // Issues found

  // Metrics
  tokensUsed: number;
  cost: number;
  toolCalls: number;
}
```

## Tools Available to Agents

Agents can use tools during LLM execution:

| Tool | Purpose |
|------|---------|
| `read_file` | Read file contents from repo |
| `search_code` | Search codebase with grep |
| `list_files` | List files in directory |
| `get_wiki_page` | Read existing wiki page |
| `list_wiki_pages` | List all wiki pages |

Tool definitions: `src/services/llm/codebase-tools.ts`, `src/services/llm/wiki-tools.ts`

## Creating a New Agent

### Step 1: Create Agent Class

```typescript
// src/agents/analysis/my-agent.ts
import { BaseAgent, type AgentContext, type AgentResult } from '../base-agent.js';

export class MyAgent extends BaseAgent {
  readonly name = 'my-agent';
  readonly description = 'Analyzes X and produces Y';
  readonly workTarget = 'commit' as const;

  getSystemPrompt(): string {
    return `You are an expert at analyzing X...`;
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    // Implementation
  }
}
```

### Step 2: Register in Registry

```typescript
// src/agents/registry.ts
import { MyAgent } from './analysis/my-agent.js';

function initializeRegistry(): void {
  // ... existing agents
  agentRegistry.set('my-agent', new MyAgent());
}

// Add to appropriate list if it should auto-run
export const ANALYSIS_AGENTS: AgentType[] = [
  // ... existing
  'my-agent',
];
```

### Step 3: Add Type

```typescript
// src/domain/agent-run.ts
export type AgentType =
  | 'code-change'
  | // ... existing
  | 'my-agent';
```

## API Reference

### Registry Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `getAgent` | `(type: string) => Agent \| null` | Get agent by name |
| `getAllAgents` | `() => Agent[]` | Get all registered agents |
| `getAgentPrompt` | `(type: string) => string \| null` | Get agent's system prompt |
| `getAvailableAgentTypes` | `() => string[]` | List all agent type names |

### Constants

| Constant | Type | Description |
|----------|------|-------------|
| `ANALYSIS_AGENTS` | `AgentType[]` | Ordered list of commit analysis agents |
| `META_AGENTS` | `AgentType[]` | Ordered list of wiki meta agents |

## Related Modules

| Module | Relationship |
|--------|--------------|
| [Executor](./level-3-executor.md) | Runs agents on work items |
| [Orchestrator](./level-3-orchestrator.md) | Decides which agents run on what |
| [Services/LLM](./level-3-services.md) | Provides AI capabilities |
| [Domain](./level-3-data.md) | Defines WorkItem, AgentRun types |

## Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/agents/registry.ts` | ~170 | Central registry, agent lists |
| `src/agents/base-agent.ts` | ~200 | Abstract base class |
| `src/agents/analysis/code-change-agent.ts` | ~300 | Primary analysis agent |
| `src/agents/meta/wiki-editor-agent.ts` | ~250 | Edit request processor |
| `src/agents/consolidation/consolidation-agent.ts` | ~350 | Finding resolver |

---

← [Architecture](./level-2-architecture.md) | [Executor →](./level-3-executor.md)
