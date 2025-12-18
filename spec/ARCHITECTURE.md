# CodeWiki Architecture Specification

**Version:** 1.0
**Date:** December 17, 2025
**Status:** Living Document

---

## Executive Summary

CodeWiki is a sophisticated multi-agent documentation system that automatically generates and maintains living documentation (wikis) from Git repositories. Built on TypeScript/Node.js, the system employs over 20 specialized AI agents to analyze code changes, explore codebases, and synthesize high-level documentation.

### Key Characteristics

- **Intelligent & Adaptive**: Six-phase orchestration system that adapts processing strategies based on wiki maturity
- **Multi-Agent Architecture**: Specialized agents for analysis, meta-processing, synthesis, and self-healing
- **Self-Improving**: Consolidation agents detect and fix documentation issues automatically
- **Scalable**: Parallel worker pools process multiple work items concurrently
- **Flexible Storage**: Supports both MongoDB (production) and file-based (development) persistence
- **Rich Integration**: REST API, MCP server, and CLI interfaces for diverse workflows
- **Quality-First**: Four-level test pyramid including LLM-as-judge validation

### Core Value Proposition

CodeWiki transforms Git repositories into comprehensive, navigable documentation that captures:
- **What changed**: Code modifications and their scope
- **Why it changed**: Decision rationale, ADRs, and planning artifacts
- **How it works**: Module relationships, design patterns, and architectural conventions
- **Current state**: Live documentation that evolves with the codebase

The system processes commit history, explores directory structures, and synthesizes high-level guides—all with minimal human intervention.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Core Subsystems](#core-subsystems)
3. [Multi-Agent System](#multi-agent-system)
4. [Data Flow & Processing Pipelines](#data-flow--processing-pipelines)
5. [Key Abstractions & Patterns](#key-abstractions--patterns)
6. [Storage & Persistence](#storage--persistence)
7. [External Interfaces](#external-interfaces)
8. [Quality Assurance](#quality-assurance)
9. [Configuration & Deployment](#configuration--deployment)

---

## 1. System Overview

### 1.1 High-Level Architecture

```mermaid
graph TB
    subgraph "Entry Points"
        CLI[CLI Interface]
        WEB[Web Server]
        MCP[MCP Server]
    end

    subgraph "Application Layer"
        CMD[Commands<br/>Write Operations]
        QRY[Queries<br/>Read Operations]
    end

    subgraph "Processing Engine"
        ORCH[Orchestrator<br/>Outer Loop]
        EXEC[Executor<br/>Inner Loop]
        POOL[Worker Pool<br/>Parallel Execution]
    end

    subgraph "Agent System"
        ANALYSIS[Analysis Agents<br/>20+ Specialized]
        META[Meta Agents<br/>Quality & Links]
        SYNTH[Synthesis Agents<br/>High-Level Docs]
        CONSOL[Consolidation Agent<br/>Self-Healing]
    end

    subgraph "Infrastructure"
        LLM[LLM Service<br/>OpenRouter]
        REPO[Repository Access<br/>Local & GitHub]
        PERSIST[Persistence Layer<br/>MongoDB/File-based]
    end

    CLI --> CMD
    WEB --> CMD
    MCP --> QRY
    CLI --> QRY
    WEB --> QRY

    CMD --> EXEC
    QRY --> PERSIST

    ORCH --> CMD
    ORCH --> QRY
    EXEC --> ANALYSIS
    EXEC --> META
    EXEC --> SYNTH
    EXEC --> CONSOL
    EXEC --> POOL

    ANALYSIS --> LLM
    META --> LLM
    SYNTH --> LLM
    CONSOL --> LLM

    ANALYSIS --> REPO
    META --> REPO
    SYNTH --> REPO

    CMD --> PERSIST
    EXEC --> CMD

    style ORCH fill:#e1f5ff
    style EXEC fill:#e1f5ff
    style POOL fill:#e1f5ff
    style LLM fill:#fff4e1
    style REPO fill:#fff4e1
    style PERSIST fill:#fff4e1
```

### 1.2 Project Structure

The codebase is organized into clear functional layers:

```mermaid
graph LR
    subgraph "Source Code (src/)"
        AGENTS[agents/<br/>20+ AI Agents]
        CMD_DIR[commands/<br/>Write Operations]
        QRY_DIR[queries/<br/>Read Operations]
        DOMAIN[domain/<br/>Core Models]
        EXEC_DIR[executor/<br/>Orchestration]
        SERVICES[services/<br/>Infrastructure]
        REPOS[repositories/<br/>Persistence]
        WEB_DIR[web/<br/>HTTP Server]
        MCP_DIR[mcp/<br/>MCP Server]
        CLI_DIR[cli/<br/>CLI Commands]
        UTILS[utils/<br/>Utilities]
    end

    subgraph "Tests (tests/)"
        UNIT[unit/<br/>Logic Tests]
        INTEGRATION[integration/<br/>Component Tests]
        LLM_TEST[llm/<br/>LLM-as-Judge]
        E2E[e2e/<br/>Browser Tests]
    end

    style AGENTS fill:#e8f5e9
    style EXEC_DIR fill:#e8f5e9
    style CMD_DIR fill:#fff3e0
    style QRY_DIR fill:#fff3e0
    style SERVICES fill:#e3f2fd
    style REPOS fill:#e3f2fd
```

**Key Directories:**
- **agents/**: All AI agent implementations (analysis, meta, synthesis, consolidation)
- **commands/**: CQRS write operations (create, update, delete)
- **queries/**: CQRS read operations (get, list, search)
- **domain/**: Core business models and types
- **executor/**: Orchestration engine and worker pools
- **services/**: Infrastructure services (LLM, Git, GitHub, repository access)
- **repositories/**: Data persistence layer with multiple implementations
- **web/**: Express server, REST API, and web UI
- **mcp/**: Model Context Protocol server for AI tool integration
- **cli/**: Command-line interface implementations

### 1.3 Technology Stack

**Core Technologies:**
- TypeScript (strict mode)
- Node.js (with native test runner)
- Express.js (web framework)
- MongoDB / File-based storage (dual persistence)

**Key Dependencies:**
- **AI/LLM**: OpenRouter API (Claude, GPT, Gemini, etc.)
- **Git**: isomorphic-git (pure JavaScript implementation)
- **GitHub**: Octokit REST API
- **Type Safety**: Zod runtime validation
- **Testing**: Playwright (E2E), native Node test runner

---

## 2. Core Subsystems

### 2.1 Orchestrator System

The orchestrator implements a six-phase adaptive processing strategy that evolves with wiki maturity.

```mermaid
stateDiagram-v2
    [*] --> Phase0: Empty Wiki
    Phase0 --> Phase1: Basic Understanding
    Phase1 --> Phase2: 1-10 Pages
    Phase2 --> Phase3: 90% Dirs Touched
    Phase3 --> Phase4: Core Content Complete
    Phase4 --> Phase5: Quality Threshold
    Phase5 --> Phase5: Maintenance Mode

    note right of Phase0
        Reconnaissance
        Understand codebase structure
    end note

    note right of Phase1
        Skeleton
        Build navigable structure
    end note

    note right of Phase2
        Breadth
        Cover all directories
        BFS expansion
    end note

    note right of Phase3
        Depth + Guides
        Deepen coverage
        Create synthesis docs
    end note

    note right of Phase4
        Polish
        Address findings
        Improve quality
    end note

    note right of Phase5
        Maintenance
        Reactive processing
        New commits only
    end note
```

**Phase-Specific Strategies:**

| Phase | Focus | Work Allocation | Exit Criteria |
|-------|-------|----------------|---------------|
| **0: Reconnaissance** | Understand codebase | Bootstrap agent, initial exploration | 1+ pages created |
| **1: Skeleton** | Basic structure | Recent commits, key paths | 10+ pages |
| **2: Breadth** | Cover all areas | BFS directory selection | 90% directories touched |
| **3: Depth + Guides** | Deep coverage | Shallow pages, synthesis agents | Core content complete |
| **4: Polish** | Quality improvement | Findings, meta agents | Quality threshold met |
| **5: Maintenance** | Keep current | New commits only | Ongoing |

**Key Components:**
- **phased-orchestrator.ts**: Main orchestration logic and phase detection
- **context-gatherer.ts**: Collects wiki state, coverage metrics, commit status
- **file-coverage-tree.ts**: Tracks documentation coverage by directory tree
- **strategies.ts**: Phase-specific work generation strategies
- **prompts.ts**: LLM prompts for intelligent work prioritization

### 2.2 Executor System

The executor implements a two-loop architecture: orchestrator (outer) generates work, executor (inner) processes it.

```mermaid
sequenceDiagram
    participant O as Orchestrator<br/>(Outer Loop)
    participant WQ as Work Queue
    participant E as Executor<br/>(Inner Loop)
    participant WP as Worker Pool
    participant A as Agent
    participant C as Command Handler

    O->>O: Gather context
    O->>O: Detect phase
    O->>O: Apply strategy
    O->>WQ: Enqueue work items

    loop Process N items
        E->>WQ: Claim work item
        WQ-->>E: WorkItem
        E->>WP: Submit to pool
        WP->>A: Dispatch to agent
        A->>A: Execute with LLM + tools
        A-->>WP: AgentRunResult
        WP->>C: Update wiki pages
        C-->>WP: Success
        WP->>C: Mark iteration complete
        WP-->>E: Done
    end

    E-->>O: Processing complete
```

**Key Features:**
- **Parallel Processing**: Worker pool executes multiple agents concurrently
- **Deterministic IDs**: Prevents duplicate work items in queue
- **Graceful Shutdown**: Waits for in-flight work to complete
- **Tool Enforcement**: Validates agents actually read code
- **Error Handling**: Retries transient failures, records permanent ones

**Worker Pool Architecture:**

```mermaid
graph LR
    WQ[Work Queue] --> WP[Worker Pool<br/>Max Concurrency: 4]
    WP --> W1[Worker 1]
    WP --> W2[Worker 2]
    WP --> W3[Worker 3]
    WP --> W4[Worker 4]

    W1 --> A1[Agent Execution]
    W2 --> A2[Agent Execution]
    W3 --> A3[Agent Execution]
    W4 --> A4[Agent Execution]

    A1 --> CMD[Command Handler]
    A2 --> CMD
    A3 --> CMD
    A4 --> CMD

    style WP fill:#e1f5ff
    style CMD fill:#fff4e1
```

### 2.3 CQRS Pattern Implementation

Strict separation between reads (queries) and writes (commands) ensures consistency and auditability.

```mermaid
graph TB
    subgraph "Read Side (Queries)"
        Q1[Get Wiki Page]
        Q2[List Wiki Pages]
        Q3[Search Wiki]
        Q4[Get Work Queue]
        Q5[Get Agent Runs]
        Q6[Get Processing Status]
    end

    subgraph "Write Side (Commands)"
        C1[Create Wiki]
        C2[Update Wiki Page]
        C3[Enqueue Work]
        C4[Record Agent Run]
        C5[Update Processing Run]
        C6[Record Finding]
    end

    subgraph "Repository Layer"
        REPO_READ[Query Repositories]
        REPO_WRITE[Command Repositories]
    end

    Q1 --> REPO_READ
    Q2 --> REPO_READ
    Q3 --> REPO_READ
    Q4 --> REPO_READ
    Q5 --> REPO_READ
    Q6 --> REPO_READ

    C1 --> REPO_WRITE
    C2 --> REPO_WRITE
    C3 --> REPO_WRITE
    C4 --> REPO_WRITE
    C5 --> REPO_WRITE
    C6 --> REPO_WRITE

    REPO_WRITE --> PERSIST[(Database)]
    REPO_READ --> PERSIST

    style Q1 fill:#e8f5e9
    style Q2 fill:#e8f5e9
    style Q3 fill:#e8f5e9
    style Q4 fill:#e8f5e9
    style Q5 fill:#e8f5e9
    style Q6 fill:#e8f5e9
    style C1 fill:#fff3e0
    style C2 fill:#fff3e0
    style C3 fill:#fff3e0
    style C4 fill:#fff3e0
    style C5 fill:#fff3e0
    style C6 fill:#fff3e0
```

**Benefits:**
- **Separation of Concerns**: Read and write logic isolated
- **Audit Trail**: All changes tracked through commands
- **Scalability**: Queries and commands can be optimized independently
- **Testability**: Commands and queries tested in isolation
- **Type Safety**: Strong TypeScript types for all operations

---

## 3. Multi-Agent System

### 3.1 Agent Taxonomy

CodeWiki employs 20+ specialized agents organized into four functional categories:

```mermaid
graph TB
    subgraph "Analysis Agents"
        direction LR
        A1[Code Change<br/>General analysis]
        A2[Narrative<br/>ADRs & docs]
        A3[Security<br/>Vulnerabilities]
        A4[Technical Debt<br/>TODOs & smells]
        A5[Pattern<br/>Design patterns]
        A6[Dependency<br/>Dependency changes]
        A7[Codebase Explorer<br/>Deep directory docs]
    end

    subgraph "Meta Agents"
        direction LR
        M1[Link Agent<br/>Cross-references]
        M2[Structure Agent<br/>Organization]
        M3[Quality Agent<br/>Content quality]
        M4[Consistency Agent<br/>Cross-page check]
        M5[Source Verification<br/>Code alignment]
        M6[Category Agent<br/>Categorization]
    end

    subgraph "Synthesis Agents"
        direction LR
        S1[Project Overview<br/>Main overview]
        S2[Getting Started<br/>Setup guide]
        S3[Testing Guide<br/>Test docs]
        S4[Extension Guide<br/>Extension docs]
        S5[Overview Agent<br/>Category overviews]
        S6[Writer Agent<br/>Depth improvement]
        S7[Wiki Index<br/>Index page]
        S8[ToC Agent<br/>Table of contents]
        S9[Bootstrap Agent<br/>Initial structure]
    end

    subgraph "Consolidation Agent"
        direction LR
        CO1[Finding Detection<br/>Issue identification]
        CO2[Finding Handlers<br/>Auto-remediation]
    end

    style A1 fill:#e8f5e9
    style A2 fill:#e8f5e9
    style A3 fill:#e8f5e9
    style A4 fill:#e8f5e9
    style A5 fill:#e8f5e9
    style A6 fill:#e8f5e9
    style A7 fill:#e8f5e9
    style M1 fill:#fff3e0
    style M2 fill:#fff3e0
    style M3 fill:#fff3e0
    style M4 fill:#fff3e0
    style M5 fill:#fff3e0
    style M6 fill:#fff3e0
    style S1 fill:#e3f2fd
    style S2 fill:#e3f2fd
    style S3 fill:#e3f2fd
    style S4 fill:#e3f2fd
    style S5 fill:#e3f2fd
    style S6 fill:#e3f2fd
    style S7 fill:#e3f2fd
    style S8 fill:#e3f2fd
    style S9 fill:#e3f2fd
    style CO1 fill:#fce4ec
    style CO2 fill:#fce4ec
```

### 3.2 Agent Execution Flow

All agents follow a unified execution model with tool-based interaction:

```mermaid
sequenceDiagram
    participant E as Executor
    participant A as Agent
    participant L as LLM Service
    participant T as Tool System
    participant R as Repository Access
    participant W as Wiki Query

    E->>A: run(target, context)
    A->>A: Validate canHandle(target)
    A->>L: Request with tools

    loop Tool Call Rounds (max 5)
        L->>L: Generate tool calls
        L->>T: Execute tools

        alt Codebase Tool
            T->>R: read_file / list_directory
            R-->>T: File content / listing
        else Wiki Tool
            T->>W: search_pages / get_related
            W-->>T: Wiki content
        end

        T-->>L: Tool results
        L->>L: Process results
    end

    L-->>A: Final structured output
    A->>A: Parse markdown output
    A->>A: Extract wiki updates
    A-->>E: AgentRunResult<br/>(updates + findings)
```

**Tool Categories:**

1. **Codebase Tools** (read code):
   - `read_file`: Read source file contents
   - `list_directory`: List directory structure
   - `search_code`: Search codebase for patterns

2. **Wiki Tools** (read existing docs):
   - `search_pages`: Full-text wiki search
   - `get_related_pages`: Fetch related documentation
   - `list_pages`: List all wiki pages

### 3.3 Agent Registry & Dispatch

```mermaid
graph LR
    EXEC[Executor] --> REGISTRY[Agent Registry]
    REGISTRY --> DISPATCH{Target Type?}

    DISPATCH -->|CommitTarget| ANALYSIS[Analysis Agents]
    DISPATCH -->|PathTarget| EXPLORER[Codebase Explorer]
    DISPATCH -->|WikiTarget| META[Meta Agents]
    DISPATCH -->|SynthesisTarget| SYNTH[Synthesis Agents]

    ANALYSIS --> VALIDATE{canHandle?}
    EXPLORER --> VALIDATE
    META --> VALIDATE
    SYNTH --> VALIDATE

    VALIDATE -->|Yes| RUN[Agent.run]
    VALIDATE -->|No| SKIP[Skip]

    style REGISTRY fill:#e1f5ff
    style DISPATCH fill:#fff4e1
    style VALIDATE fill:#fff4e1
```

**Key Features:**
- **Centralized Registry**: Single source of truth for all agents
- **Type-Safe Dispatch**: Strong typing prevents mismatched targets
- **Lazy Initialization**: Agents created on first use
- **Introspection Support**: Access to agent prompts for self-improvement

### 3.4 Analysis Agent Processing Order

When processing commits, analysis agents execute in a specific order to build comprehensive documentation:

```mermaid
graph TD
    COMMIT[New Commit Detected] --> CC[1. Code Change Agent]
    CC -->|Base analysis complete| NAR[2. Narrative Agent]
    NAR -->|ADR/docs extracted| SEC[3. Security Agent]
    SEC -->|Vulnerabilities noted| TD[4. Technical Debt Agent]
    TD -->|TODOs cataloged| PAT[5. Pattern Agent]
    PAT -->|Patterns identified| DEP[6. Dependency Agent]
    DEP -->|Dependencies analyzed| MERGE[Merge Perspectives]
    MERGE --> OUTPUT[Enriched Wiki Pages]

    style CC fill:#e8f5e9
    style NAR fill:#e8f5e9
    style SEC fill:#e8f5e9
    style TD fill:#e8f5e9
    style PAT fill:#e8f5e9
    style DEP fill:#e8f5e9
    style OUTPUT fill:#e1f5ff
```

**Rationale:**
1. **Code Change** runs first to establish base content
2. **Narrative** extracts architectural decisions and planning artifacts
3. **Security** identifies vulnerabilities early
4. **Technical Debt** catalogs improvement opportunities
5. **Pattern** recognizes design patterns and conventions
6. **Dependency** tracks dependency changes and impacts

Each agent enriches the wiki pages created by previous agents, providing multiple perspectives on the same changes.

---

## 4. Data Flow & Processing Pipelines

### 4.1 End-to-End Processing Flow

```mermaid
flowchart TD
    START[Repository Registered] --> CLONE[Clone/Load Repository]
    CLONE --> HISTORY[Load Commit History]
    HISTORY --> WIKI[Create Default Wiki]

    WIKI --> ORCH_LOOP{Orchestrator Loop}
    ORCH_LOOP -->|Gather Context| CTX[Context Gathering]
    CTX --> PHASE[Detect Phase 0-5]
    PHASE --> STRATEGY[Apply Phase Strategy]
    STRATEGY --> WORK_GEN[Generate Work Items]
    WORK_GEN --> ENQUEUE[Enqueue to Work Queue]

    ENQUEUE --> EXEC_LOOP{Executor Loop}
    EXEC_LOOP -->|Claim Work| CLAIM[Claim Work Items]
    CLAIM --> DISPATCH[Dispatch to Agent]
    DISPATCH --> AGENT_EXEC[Agent Execution]
    AGENT_EXEC --> TOOLS[Tool Calls<br/>Read Code/Wiki]
    TOOLS --> LLM[LLM Processing]
    LLM --> OUTPUT[Structured Output]
    OUTPUT --> PARSE[Parse Results]
    PARSE --> UPDATE[Update Wiki Pages]
    UPDATE --> COMPLETE[Mark Complete]

    COMPLETE -->|More Work?| EXEC_LOOP
    EXEC_LOOP -->|No Work| ORCH_LOOP
    ORCH_LOOP -->|Stop Signal| END[Processing Complete]

    style ORCH_LOOP fill:#e1f5ff
    style EXEC_LOOP fill:#e1f5ff
    style AGENT_EXEC fill:#e8f5e9
    style LLM fill:#fff4e1
    style UPDATE fill:#fff3e0
```

### 4.2 Commit Processing Pipeline

When new commits are detected, they flow through a multi-stage analysis pipeline:

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant WQ as Work Queue
    participant E as Executor
    participant CC as Code Change Agent
    participant NA as Narrative Agent
    participant SA as Security Agent
    participant CMD as Update Command
    participant DB as Database

    O->>O: Detect unprocessed commits
    O->>WQ: Enqueue CommitTarget items

    E->>WQ: Claim commit work
    E->>CC: Process commit
    CC->>CC: Fetch diff
    CC->>CC: Pre-fetch affected files
    CC->>CC: Analyze with LLM
    CC-->>E: WikiPageUpdate[]
    E->>CMD: Update wiki pages
    CMD->>DB: Persist changes

    E->>WQ: Claim same commit (next agent)
    E->>NA: Process commit
    NA->>NA: Analyze for ADRs/docs
    NA-->>E: WikiPageUpdate[]
    E->>CMD: Enrich wiki pages
    CMD->>DB: Persist changes

    Note over E,SA: Security, Tech Debt,<br/>Pattern, Dependency<br/>agents follow...

    E->>SA: Process commit
    SA->>SA: Security analysis
    SA-->>E: WikiPageUpdate[] + Findings
    E->>CMD: Enrich wiki pages
    CMD->>DB: Persist changes
```

**Pipeline Characteristics:**
- **Sequential Agent Execution**: Each agent builds on previous results
- **Pre-fetching Optimization**: Affected files loaded once, reused across agents
- **Enrichment Model**: Later agents enrich pages created by earlier agents
- **Finding Generation**: Agents can flag issues for consolidation agent

### 4.3 Directory Exploration Pipeline

For undocumented directories, the system generates comprehensive documentation:

```mermaid
flowchart TD
    ORCH[Orchestrator] -->|Detects undocumented dir| GEN[Generate PathTarget]
    GEN --> ENQUEUE[Enqueue Work Item]
    ENQUEUE --> EXEC[Executor Claims Work]
    EXEC --> EXPLORER[Codebase Explorer Agent]

    EXPLORER --> LIST[List Files in Directory]
    LIST --> PRIORITIZE[Prioritize Key Files]
    PRIORITIZE --> READ[Read Top Files]
    READ --> SEARCH[Search Existing Wiki]
    SEARCH --> LLM[LLM Analysis]
    LLM --> DOC[Generate Documentation]
    DOC --> LINKS[Extract Links to Related]
    LINKS --> CREATE[Create Wiki Page]

    style EXPLORER fill:#e8f5e9
    style LLM fill:#fff4e1
    style CREATE fill:#fff3e0
```

**Explorer Agent Strategy:**
- **File Prioritization**: Focus on README, main entry points, key modules
- **Context Gathering**: Search existing wiki for related content
- **Comprehensive Output**: Single page documenting entire directory/module
- **Cross-linking**: Automatically links to related documentation

### 4.4 Synthesis Pipeline

High-level documentation is generated by synthesis agents in later phases:

```mermaid
graph TB
    TRIGGER[Phase 3+ Reached] --> ORCH[Orchestrator]
    ORCH -->|Generate SynthesisTarget| ST1[Project Overview Target]
    ORCH --> ST2[Getting Started Target]
    ORCH --> ST3[Testing Guide Target]
    ORCH --> ST4[Category Overview Target]

    ST1 --> S1[Project Overview Agent]
    ST2 --> S2[Getting Started Agent]
    ST3 --> S3[Testing Guide Agent]
    ST4 --> S4[Overview Agent]

    S1 --> SEARCH1[Search All Wiki Pages]
    S2 --> SEARCH2[Search Setup-Related Pages]
    S3 --> SEARCH3[Search Test Files]
    S4 --> SEARCH4[Search Category Pages]

    SEARCH1 --> SYNTH1[Synthesize Overview]
    SEARCH2 --> SYNTH2[Synthesize Getting Started]
    SEARCH3 --> SYNTH3[Synthesize Testing Guide]
    SEARCH4 --> SYNTH4[Synthesize Category Overview]

    SYNTH1 --> OUTPUT[High-Level Documentation]
    SYNTH2 --> OUTPUT
    SYNTH3 --> OUTPUT
    SYNTH4 --> OUTPUT

    style S1 fill:#e3f2fd
    style S2 fill:#e3f2fd
    style S3 fill:#e3f2fd
    style S4 fill:#e3f2fd
    style OUTPUT fill:#fff3e0
```

**Synthesis Characteristics:**
- **Wiki-Based Input**: Uses existing wiki pages, not raw code
- **Cross-Cutting Views**: Aggregates information across multiple pages
- **User-Focused**: Targets human readers (setup, testing, extension)
- **Late-Phase Generation**: Only after sufficient base content exists

### 4.5 Self-Healing Pipeline

The consolidation agent detects and fixes documentation issues:

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant CA as Consolidation Agent
    participant FD as Finding Detection
    participant FH as Finding Handlers
    participant CMD as Update Command

    O->>CA: Process WikiTarget
    CA->>FD: Scan for issues

    FD->>FD: Detect duplicate pages
    FD->>FD: Find broken links
    FD->>FD: Identify conflicts
    FD-->>CA: Finding[]

    CA->>FH: Route findings to handlers

    alt Duplicate Pages
        FH->>FH: Merge duplicates handler
        FH->>CMD: Merge pages command
    else Broken Links
        FH->>FH: Link repair handler
        FH->>CMD: Update links command
    else Conflicts
        FH->>FH: Conflict resolution handler
        FH->>CMD: Resolve conflict command
    end

    CMD-->>CA: Changes applied
    CA-->>O: Findings resolved
```

**Self-Healing Capabilities:**
- **Duplicate Detection**: Identifies pages covering same topic
- **Link Validation**: Finds and repairs broken cross-references
- **Conflict Resolution**: Resolves contradictory information
- **Automatic Remediation**: Applies fixes without human intervention

---

## 5. Key Abstractions & Patterns

### 5.1 Domain Model Hierarchy

```mermaid
classDiagram
    class Repo {
        +string id
        +string url
        +string name
        +RepoStatus status
        +Date lastProcessedAt
    }

    class Wiki {
        +string id
        +string repoId
        +string name
        +number pageCount
        +Date createdAt
    }

    class WikiPage {
        +string id
        +string wikiId
        +string title
        +string path
        +string content
        +string[] sourceCommits
        +string[] sourceAgentRunIds
        +string[] filesAccessed
        +string[] filesReferenced
        +string[] targetPaths
        +string[] links
        +string[] backlinks
        +string? category
        +SynthesisType? synthesisType
    }

    class Commit {
        +string id
        +string repoId
        +string sha
        +string message
        +string author
        +Date timestamp
        +boolean processed
    }

    class WorkItem {
        +string id
        +string repoId
        +string wikiId
        +WorkTarget target
        +AgentType agentType
        +number priority
        +WorkStatus status
    }

    class AgentRun {
        +string id
        +string iterationId
        +AgentType agentType
        +WorkTarget target
        +AgentRunResult result
        +Date startedAt
        +Date? completedAt
    }

    Repo "1" --> "many" Wiki
    Wiki "1" --> "many" WikiPage
    Repo "1" --> "many" Commit
    Repo "1" --> "many" WorkItem
    WorkItem "1" --> "1" AgentRun
    WikiPage "many" --> "many" Commit : references
```

### 5.2 Work Target Polymorphism

Work items can target different units of processing:

```mermaid
graph TB
    WT[WorkTarget<br/>Base Type] --> CT[CommitTarget]
    WT --> PT[PathTarget]
    WT --> WKT[WikiTarget]
    WT --> ST[SynthesisTarget]

    CT -->|Analyzed by| AA[Analysis Agents]
    PT -->|Explored by| CE[Codebase Explorer]
    WKT -->|Processed by| MA[Meta Agents]
    WKT -->|Fixed by| CON[Consolidation Agent]
    ST -->|Generated by| SA[Synthesis Agents]

    style WT fill:#e1f5ff
    style CT fill:#e8f5e9
    style PT fill:#e8f5e9
    style WKT fill:#fff3e0
    style ST fill:#e3f2fd
```

**Target Types:**
- **CommitTarget**: Specific Git commit (SHA + repo context)
- **PathTarget**: Filesystem path (directory or file)
- **WikiTarget**: Entire wiki (for meta-processing)
- **SynthesisTarget**: Synthesis request (overview, guide, etc.)

Each target type routes to appropriate agents via the registry's dispatch logic.

### 5.3 Command Pattern

All state mutations flow through command objects:

```mermaid
graph LR
    CLIENT[Client Code] --> CMD[Command Object]
    CMD --> VALIDATE[Validation]
    VALIDATE --> EXEC[Execute Business Logic]
    EXEC --> REPO[Repository Write]
    REPO --> DB[(Database)]
    DB --> EVENT[Emit Event]

    style CMD fill:#fff3e0
    style VALIDATE fill:#fff4e1
    style EXEC fill:#e8f5e9
```

**Command Examples:**
- **CreateWiki**: Creates new wiki instance
- **UpdateWikiPage**: Creates/updates/merges wiki page
- **EnqueueWork**: Adds work item to queue
- **RecordAgentRun**: Logs agent execution
- **RecordFinding**: Records detected issue

### 5.4 Repository Pattern

Data access abstracted behind interfaces with swappable implementations:

```mermaid
graph TB
    subgraph "Client Code"
        SERVICE[Service Layer]
    end

    subgraph "Repository Interface"
        INTERFACE[WikiPageRepository<br/>Interface]
    end

    subgraph "Implementations"
        MONGO[MongoWikiPageRepository]
        FILE[FileBasedWikiPageRepository]
    end

    SERVICE --> INTERFACE
    INTERFACE -.implements.- MONGO
    INTERFACE -.implements.- FILE

    MONGO --> MONGODB[(MongoDB)]
    FILE --> FS[(File System)]

    style INTERFACE fill:#e1f5ff
    style MONGO fill:#e8f5e9
    style FILE fill:#e8f5e9
```

**Benefits:**
- **Flexibility**: Switch storage backends without code changes
- **Testability**: Mock repositories for unit tests
- **Environment Adaptation**: MongoDB for production, file-based for development
- **Consistency**: Same interface contract for all implementations

### 5.5 Strategy Pattern

Phase-specific processing strategies encapsulate orchestration logic:

```mermaid
graph LR
    ORCH[Orchestrator] --> DETECT[Detect Current Phase]
    DETECT --> SELECT{Select Strategy}

    SELECT -->|Phase 0| S0[Reconnaissance Strategy]
    SELECT -->|Phase 1| S1[Skeleton Strategy]
    SELECT -->|Phase 2| S2[Breadth Strategy]
    SELECT -->|Phase 3| S3[Depth Strategy]
    SELECT -->|Phase 4| S4[Polish Strategy]
    SELECT -->|Phase 5| S5[Maintenance Strategy]

    S0 --> WORK[Generate Work Items]
    S1 --> WORK
    S2 --> WORK
    S3 --> WORK
    S4 --> WORK
    S5 --> WORK

    style ORCH fill:#e1f5ff
    style WORK fill:#fff3e0
```

### 5.6 Observer Pattern (Event System)

Wiki events broadcast state changes to interested parties:

```mermaid
sequenceDiagram
    participant CMD as Command Handler
    participant EVT as Event Bus
    participant SUB1 as Web UI Subscriber
    participant SUB2 as Metrics Subscriber
    participant SUB3 as Cache Subscriber

    CMD->>EVT: Emit WikiPageUpdated
    EVT->>SUB1: Notify
    EVT->>SUB2: Notify
    EVT->>SUB3: Notify

    SUB1->>SUB1: Refresh page display
    SUB2->>SUB2: Update metrics
    SUB3->>SUB3: Invalidate cache
```

**Event Types:**
- WikiPageCreated
- WikiPageUpdated
- WikiPageMerged
- WikiPageDeleted
- ProcessingRunStarted
- ProcessingRunCompleted

---

## 6. Storage & Persistence

### 6.1 Dual-Backend Architecture

```mermaid
graph TB
    subgraph "Application Layer"
        CMD[Commands]
        QRY[Queries]
    end

    subgraph "Repository Layer"
        FACTORY[Repository Factory]
        INTERFACE[Repository Interfaces]
    end

    subgraph "Implementation Layer"
        MONGO_IMPL[MongoDB Repositories]
        FILE_IMPL[File-based Repositories]
    end

    subgraph "Storage Layer"
        MONGODB[(MongoDB<br/>Production)]
        FILESYSTEM[(File System<br/>Development)]
    end

    CMD --> INTERFACE
    QRY --> INTERFACE
    INTERFACE --> FACTORY
    FACTORY -.creates.- MONGO_IMPL
    FACTORY -.creates.- FILE_IMPL

    MONGO_IMPL --> MONGODB
    FILE_IMPL --> FILESYSTEM

    style MONGODB fill:#4caf50
    style FILESYSTEM fill:#2196f3
```

### 6.2 Repository Interfaces

All persistence operations defined by interfaces:

- **WikiPageRepository**: CRUD for wiki pages
- **WikiRepository**: Wiki instance management
- **RepoRepository**: Repository registration
- **CommitRepository**: Commit tracking
- **WorkQueueRepository**: Work item persistence
- **AgentRunRepository**: Agent execution history
- **FindingRepository**: Issue tracking
- **ProcessingRunRepository**: Batch execution tracking
- **IterationRepository**: Individual work item iterations
- **OrchestratorRunRepository**: Orchestrator decision logging

### 6.3 MongoDB Implementation

**Production/staging environment:**
- Optimized indexes for query performance
- Aggregation pipelines for complex queries
- Transactional support where needed
- Connection pooling for concurrency

**Collections:**
- `repos`: Repository metadata
- `wikis`: Wiki instances
- `wiki_pages`: Documentation pages
- `commits`: Git commit tracking
- `work_queue`: Queued work items
- `agent_runs`: Agent execution logs
- `findings`: Detected issues
- `processing_runs`: Batch execution records
- `iterations`: Work item iterations

### 6.4 File-Based Implementation

**Development/restricted environments:**
- JSON files for structured data
- Markdown files for wiki content
- Directory structure mirrors logical organization
- No external dependencies

**Directory Structure:**
```
.codewiki-data/
├── repos/
│   └── {repoId}.json
├── wikis/
│   └── {wikiId}.json
├── pages/
│   └── {wikiId}/
│       └── {pageId}.md
├── commits/
│   └── {repoId}/
│       └── {sha}.json
├── work-queue/
│   └── {workItemId}.json
└── agent-runs/
    └── {agentRunId}.json
```

---

## 7. External Interfaces

### 7.1 Interface Overview

```mermaid
graph TB
    subgraph "External Clients"
        USER[Human Users]
        AI[AI Assistants]
        SCRIPT[Scripts/Automation]
    end

    subgraph "Interface Layer"
        CLI[CLI Interface]
        WEB[Web UI + REST API]
        MCP[MCP Server]
    end

    subgraph "Application Core"
        CMDS[Commands]
        QRYS[Queries]
    end

    USER --> CLI
    USER --> WEB
    AI --> MCP
    SCRIPT --> CLI
    SCRIPT --> WEB

    CLI --> CMDS
    CLI --> QRYS
    WEB --> CMDS
    WEB --> QRYS
    MCP --> QRYS

    style CLI fill:#4caf50
    style WEB fill:#2196f3
    style MCP fill:#ff9800
```

### 7.2 CLI Interface

Command-line interface for local and CI/CD usage:

**Key Commands:**
- `codewiki generate <repo-path>`: Generate wiki for repository
- `codewiki start`: Start web server
- `codewiki status <repo-id>`: Check processing status
- `codewiki export <wiki-id>`: Export wiki to static files
- `codewiki benchmark <wiki-id>`: Run quality benchmarks

### 7.3 Web Server & REST API

Express-based server providing HTTP access:

```mermaid
graph LR
    subgraph "HTTP Layer"
        BROWSER[Web Browser]
        HTTP_CLIENT[HTTP Clients]
    end

    subgraph "Web Server"
        ROUTES[Express Routes]
        AUTH[Authentication]
        SWAGGER[Swagger Docs]
    end

    subgraph "API Endpoints"
        REPO_API[/api/repos]
        WIKI_API[/api/wikis]
        PAGE_API[/api/wiki-pages]
        PROC_API[/api/processing]
        AGENT_API[/api/agents]
    end

    BROWSER --> ROUTES
    HTTP_CLIENT --> ROUTES
    ROUTES --> AUTH
    AUTH --> REPO_API
    AUTH --> WIKI_API
    AUTH --> PAGE_API
    AUTH --> PROC_API
    AUTH --> AGENT_API

    ROUTES --> SWAGGER

    style ROUTES fill:#2196f3
    style SWAGGER fill:#4caf50
```

**API Categories:**
- **Repository Management**: Register, list, update repositories
- **Wiki Operations**: Create, list, delete wikis
- **Content Access**: CRUD wiki pages, search content
- **Processing Control**: Start, stop, monitor processing
- **Observability**: Agent runs, metrics, coverage stats
- **Authentication**: GitHub OAuth, session management

**OpenAPI/Swagger Documentation:**
- Auto-generated from route definitions
- Interactive API testing interface
- Type-safe request/response schemas

### 7.4 MCP Server

Model Context Protocol server exposes CodeWiki to AI coding assistants:

```mermaid
sequenceDiagram
    participant AI as AI Assistant<br/>(Claude, etc.)
    participant MCP as MCP Server
    participant QUERY as Query Handlers
    participant DB as Database

    AI->>MCP: query_wiki("How does auth work?")
    MCP->>QUERY: SearchWiki query
    QUERY->>DB: Full-text search
    DB-->>QUERY: Matching pages
    QUERY-->>MCP: Formatted results
    MCP-->>AI: Documentation content

    AI->>AI: Use context to answer
    AI->>AI: Make informed code changes
```

**MCP Tools:**
- `query_wiki`: Ask questions about codebase
- `list_wiki_pages`: Browse available documentation
- `get_wiki_page`: Retrieve specific page
- `get_repo_status`: Check processing state
- `generate_spec`: Create task specifications

**Use Cases:**
- AI reads wiki before making changes
- AI answers developer questions about codebase
- AI generates specifications based on existing patterns
- AI validates changes against documented architecture

---

## 8. Quality Assurance

### 8.1 Four-Level Test Pyramid

```mermaid
graph TB
    E2E[E2E Tests<br/>Full system + browser<br/>Playwright]
    LLM[LLM Tests<br/>Real LLM calls<br/>LLM-as-Judge]
    INT[Integration Tests<br/>Component interactions<br/>Mocked LLM]
    UNIT[Unit Tests<br/>Pure logic<br/>Fully isolated]

    E2E --> LLM
    LLM --> INT
    INT --> UNIT

    style E2E fill:#f44336
    style LLM fill:#ff9800
    style INT fill:#4caf50
    style UNIT fill:#2196f3
```

### 8.2 Test Distribution

| Test Level | Count | Purpose | Speed | Cost |
|------------|-------|---------|-------|------|
| **Unit** | ~120 files | Pure logic, edge cases | Fast | Free |
| **Integration** | ~50 files | Component interactions | Medium | Free |
| **LLM** | ~15 files | Semantic correctness | Slow | Paid |
| **E2E** | ~10 files | User workflows | Slow | Free |

### 8.3 LLM-as-Judge Testing

Unique testing approach for validating AI agent quality:

```mermaid
sequenceDiagram
    participant TEST as Test Runner
    participant AGENT as Agent Under Test
    participant LLM as Production LLM
    participant JUDGE as Judge LLM

    TEST->>AGENT: Execute with real context
    AGENT->>LLM: Process with tools
    LLM-->>AGENT: Generate output
    AGENT-->>TEST: Agent output

    TEST->>JUDGE: Evaluate output
    Note over TEST,JUDGE: Prompt: "Rate accuracy 0-10"
    JUDGE->>JUDGE: Analyze output
    JUDGE-->>TEST: Score + reasoning

    TEST->>TEST: Assert score >= threshold
```

**LLM Test Characteristics:**
- **Real LLM Calls**: Uses actual LLM service, not mocks
- **Semantic Evaluation**: Judges meaning, not exact strings
- **Scoring Scale**: 0-10 with configurable thresholds
- **Detailed Feedback**: Reasoning and improvement suggestions
- **Result Logging**: JSON artifacts for analysis

**Benefits:**
- Catches prompt regressions
- Validates semantic accuracy
- Tests tool usage patterns
- Measures cross-agent consistency

### 8.4 Tool Enforcement

Validation layer ensures agents follow tool usage requirements:

```mermaid
graph LR
    AGENT[Agent Execution] --> RESULT[Agent Result]
    RESULT --> ENFORCE[Tool Enforcement]
    ENFORCE --> CHECK{Required Tools Used?}

    CHECK -->|Yes| PASS[Accept Result]
    CHECK -->|No - Warn Mode| WARN[Log Warning<br/>Accept Result]
    CHECK -->|No - Strict Mode| REJECT[Reject Result<br/>Throw Error]

    style ENFORCE fill:#ff9800
    style REJECT fill:#f44336
    style WARN fill:#ffeb3b
    style PASS fill:#4caf50
```

**Tool Requirements:**
- Analysis agents must read affected files
- Explorer agents must list directories
- Meta agents must read wiki pages
- Synthesis agents must search wiki

**Enforcement Modes:**
- **Warn**: Log violations but accept results (default)
- **Strict**: Reject results that don't meet requirements (testing)

### 8.5 Content Validation Pipeline

Multi-stage validation prevents low-quality content:

```mermaid
flowchart TD
    INPUT[Agent Output] --> V1{Template Check}
    V1 -->|Contains placeholders| REJECT1[Reject: Placeholder Found]
    V1 -->|Clean| V2{Length Check}
    V2 -->|Too short| REJECT2[Reject: Insufficient Content]
    V2 -->|Adequate| V3{Reference Check}
    V3 -->|Broken refs| REJECT3[Reject: Invalid References]
    V3 -->|Valid| V4{Duplicate Check}
    V4 -->|Duplicate| MERGE[Merge with Existing]
    V4 -->|Unique| ACCEPT[Accept & Persist]

    style REJECT1 fill:#f44336
    style REJECT2 fill:#f44336
    style REJECT3 fill:#f44336
    style ACCEPT fill:#4caf50
```

**Validation Stages:**
1. **Template Detection**: Rejects content with `{placeholder}` patterns
2. **Length Requirements**: Enforces minimum content length
3. **Reference Validation**: Checks file/page references exist
4. **Duplicate Detection**: Prevents redundant pages
5. **Link Validation**: Verifies cross-references

---

## 9. Configuration & Deployment

### 9.1 Environment Configuration

**Core Settings:**

| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENROUTER_API_KEY` | LLM API access | Required |
| `OPENROUTER_MODEL` | Default model | claude-haiku-4.5 |
| `MONGODB_URI` | Database connection | File-based fallback |
| `PORT` | Web server port | 3000 |
| `MAX_CONCURRENCY` | Parallel workers | 4 |
| `NODE_ENV` | Environment mode | development |

**GitHub Integration:**

| Variable | Purpose |
|----------|---------|
| `GITHUB_APP_CLIENT_ID` | OAuth client ID |
| `GITHUB_APP_CLIENT_SECRET` | OAuth secret |
| `GITHUB_WEBHOOK_SECRET` | Webhook validation |

**Processing Control:**

| Variable | Purpose | Default |
|----------|---------|---------|
| `ORCHESTRATOR_DEBUG` | Detailed logging | false |
| `AGENT_CONCURRENCY` | Agent parallelism | 4 |
| `TOOL_ENFORCEMENT_MODE` | Validation strictness | warn |
| `MAX_TOOL_ROUNDS` | LLM tool call limit | 5 |

### 9.2 Deployment Architectures

**Local Development:**
```mermaid
graph TB
    DEV[Developer Machine]
    DEV --> CLI[CLI Commands]
    DEV --> FS[File-based Storage]
    CLI --> PROC[Processing Engine]
    PROC --> FS

    style DEV fill:#4caf50
    style FS fill:#2196f3
```

**Production Deployment:**
```mermaid
graph TB
    LB[Load Balancer] --> WEB1[Web Server 1]
    LB --> WEB2[Web Server 2]

    WEB1 --> MONGO[(MongoDB Cluster)]
    WEB2 --> MONGO

    WEB1 --> OPENROUTER[OpenRouter API]
    WEB2 --> OPENROUTER

    WEB1 --> GITHUB[GitHub API]
    WEB2 --> GITHUB

    WORKER1[Worker Node 1] --> MONGO
    WORKER2[Worker Node 2] --> MONGO

    WORKER1 --> OPENROUTER
    WORKER2 --> OPENROUTER

    style LB fill:#ff9800
    style MONGO fill:#4caf50
    style OPENROUTER fill:#2196f3
    style GITHUB fill:#9c27b0
```

### 9.3 Scaling Considerations

**Horizontal Scaling:**
- Web servers: Stateless, can scale to N instances
- Worker nodes: Independent processing pools
- Database: MongoDB clustering and sharding

**Vertical Scaling:**
- Worker concurrency: Increase `MAX_CONCURRENCY`
- Memory: LLM context caching requires RAM
- CPU: Parallel agent execution benefits from cores

**Rate Limiting:**
- LLM API rate limits: Built-in retry with exponential backoff
- GitHub API limits: Request caching and batching
- Database connections: Connection pooling

### 9.4 Monitoring & Observability

**Metrics Exposed:**
- Processing run statistics (duration, items processed, errors)
- Agent execution counts by type
- LLM token usage and costs
- Wiki page counts and coverage percentages
- Work queue depth and throughput
- API request rates and latencies

**Logging Levels:**
- `error`: System failures requiring intervention
- `warn`: Recoverable issues (rate limits, validation warnings)
- `info`: High-level progress (phase transitions, processing starts/stops)
- `debug`: Detailed orchestration decisions
- `trace`: Full tool call and LLM interaction logs

---

## Appendix A: Key Files Reference

**Orchestration:**
- `src/agents/orchestrator/phased-orchestrator.ts`: Main orchestration logic
- `src/agents/orchestrator/context-gatherer.ts`: Wiki state collection
- `src/agents/orchestrator/file-coverage-tree.ts`: Coverage tracking
- `src/agents/orchestrator/strategies.ts`: Phase-specific strategies

**Agent System:**
- `src/agents/registry.ts`: Agent registration and dispatch
- `src/agents/base-agent.ts`: Agent interface definition
- `src/agents/agent-helpers.ts`: Shared agent utilities
- `src/agents/parsing/`: Output parsing logic

**Executor:**
- `src/executor/executor.ts`: Main execution engine
- `src/executor/continuous-worker-pool.ts`: Parallel worker pool
- `src/executor/tool-enforcement.ts`: Tool usage validation

**CQRS:**
- `src/commands/`: All write operations
- `src/queries/`: All read operations

**Services:**
- `src/services/llm/llm-service.ts`: LLM abstraction
- `src/services/repository/unified-repo-access.ts`: Repository access
- `src/services/git/git-service.ts`: Git operations
- `src/services/github/`: GitHub integration

**Repositories:**
- `src/repositories/interfaces/`: Repository contracts
- `src/repositories/mongo-based/`: MongoDB implementations
- `src/repositories/file-based/`: File-based implementations

---

## Appendix B: Architectural Decisions

### ADR-001: CQRS Pattern Adoption
**Status:** Accepted
**Decision:** Separate read and write operations into commands and queries
**Rationale:** Enables independent optimization, clear audit trails, and testability

### ADR-002: Multi-Agent Architecture
**Status:** Accepted
**Decision:** Decompose documentation into specialized agents
**Rationale:** Modularity, focused expertise, parallel processing, extensibility

### ADR-003: Phased Orchestration
**Status:** Accepted
**Decision:** Adapt processing strategy to wiki maturity (6 phases)
**Rationale:** Efficient resource usage, quality progression, intelligent work prioritization

### ADR-004: Tool-Based Agent Interaction
**Status:** Accepted
**Decision:** Agents read code/wiki through tool calls, not direct prompts
**Rationale:** Prevents hallucination, enables provenance tracking, validates research

### ADR-005: Dual Storage Backend
**Status:** Accepted
**Decision:** Support both MongoDB and file-based storage
**Rationale:** Production scalability (MongoDB) + development simplicity (files)

### ADR-006: Repository Pattern for Persistence
**Status:** Accepted
**Decision:** Abstract all data access behind interfaces
**Rationale:** Storage flexibility, testability, environment adaptation

### ADR-007: LLM-as-Judge Testing
**Status:** Accepted
**Decision:** Use LLM to evaluate semantic correctness of agent outputs
**Rationale:** Catches prompt regressions, validates semantic accuracy, measures quality

---

## Document Maintenance

This architecture specification is a living document that should be updated when:
- Major architectural changes are introduced
- New subsystems are added
- Processing phases are modified
- Agent system evolves significantly
- Storage backends change
- External interfaces are added/modified

**Review Schedule:** Quarterly or after major releases
**Owner:** Engineering team
**Last Updated:** December 17, 2025
