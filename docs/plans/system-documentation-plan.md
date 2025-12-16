# Multi-Level System Documentation Plan

This document outlines a comprehensive approach to documenting the CodeWiki system from high-level overview down to specific module details.

## Core Philosophy

**Progressive Disclosure**: Users should be able to understand the system at whatever depth they need. A newcomer needs the 30-second pitch; a contributor needs module internals; a maintainer needs implementation details.

**Context Preservation**: When drilling down, users should never lose sight of where they are in the overall system. Each level should reference its parent and children.

**Answer-Oriented**: Each level answers specific questions rather than just describing code.

---

## Abstraction Levels

### Level 1: System Overview (The "Elevator Pitch")

**Target Audience**: New users, stakeholders, anyone needing quick context

**Key Questions Answered**:
- What is this system?
- What problem does it solve?
- How do I use it?

**Key Information**:
```
┌─────────────────────────────────────────────────────────────┐
│  PURPOSE                                                     │
│  "CodeWiki generates living wikis from Git repositories     │
│   using AI agents that understand code changes."            │
│                                                              │
│  CORE FLOW (single diagram)                                 │
│  Git Repo → Agents Analyze → Wiki Generated → Browse/Query  │
│                                                              │
│  ENTRY POINTS                                                │
│  • CLI: `codewiki process .`                                │
│  • Web: http://localhost:3000                               │
│  • API: MCP protocol for AI integration                     │
│                                                              │
│  KEY CONCEPTS (5-7 max)                                     │
│  • Agents: AI workers that analyze code                     │
│  • Wiki Pages: Generated documentation                      │
│  • Work Queue: Tasks for agents to process                  │
└─────────────────────────────────────────────────────────────┘
```

**Display Format**: Single page, no scrolling required. Visual diagram prominent. Links to Level 2 components.

**Length**: ~200 words + 1 diagram

---

### Level 2: Subsystem Architecture (The "Component Map")

**Target Audience**: Developers starting to work on the project, architects evaluating the system

**Key Questions Answered**:
- What are the major components?
- How do they interact?
- Where does my feature/bug fit?

**Key Information**:

```
┌─────────────────────────────────────────────────────────────┐
│  SUBSYSTEM INVENTORY (with one-liner descriptions)          │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Agents    │  │  Executor   │  │ Orchestrator│         │
│  │ "AI Workers"│  │"Work Runner"│  │"Prioritizer"│         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                              │
│  INTERACTION DIAGRAM                                         │
│  [Shows data flow between all subsystems]                   │
│                                                              │
│  SUBSYSTEM CARDS (expandable)                               │
│  Each card shows:                                            │
│  • Purpose (2 sentences)                                    │
│  • Key files (3-5 most important)                           │
│  • Dependencies (which other subsystems it uses)            │
│  • Dependents (which subsystems use it)                     │
└─────────────────────────────────────────────────────────────┘
```

**Subsystems Identified for CodeWiki**:

| Subsystem | Purpose | Key Location |
|-----------|---------|--------------|
| **Agent System** | AI workers that analyze code and generate wiki content | `src/agents/` |
| **Executor** | Runs agents, manages work queue, enforces rules | `src/executor/` |
| **Orchestrator** | Decides what work to do and in what order | `src/agents/orchestrator/` |
| **CQRS Layer** | Commands (mutations) and Queries (reads) | `src/commands/`, `src/queries/` |
| **Domain Models** | Core business entities and types | `src/domain/` |
| **Repository Layer** | Data persistence (MongoDB or file-based) | `src/repositories/` |
| **Services** | External integrations (LLM, Git, GitHub) | `src/services/` |
| **Web Interface** | REST API and browser UI | `src/web/` |
| **CLI** | Command-line interface | `src/cli/` |
| **MCP Server** | AI integration protocol | `src/mcp/` |

**Display Format**: Interactive diagram with clickable components. Each component links to its Level 3 detail page.

**Length**: ~500 words + architecture diagram + subsystem table

---

### Level 3: Module Details (The "Developer Guide")

**Target Audience**: Developers actively working on a specific subsystem

**Key Questions Answered**:
- How does this module work internally?
- What are the key classes/functions?
- What patterns does it use?
- How do I extend it?

**Key Information per Module**:

```
┌─────────────────────────────────────────────────────────────┐
│  MODULE: Agent System                                        │
│  Location: src/agents/                                       │
│  Parent: Level 2 Architecture                               │
│                                                              │
│  PURPOSE (paragraph)                                         │
│  The agent system provides specialized AI workers...         │
│                                                              │
│  ARCHITECTURE PATTERN                                        │
│  • Pattern: Registry + Strategy                              │
│  • Key abstraction: Agent interface                          │
│  • Extension point: Create new agent, register in registry   │
│                                                              │
│  KEY COMPONENTS                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ registry.ts (Central agent registry)                │    │
│  │ base-agent.ts (Abstract base class)                 │    │
│  │ agent-types.ts (Type definitions)                   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  DATA FLOW                                                   │
│  [Sequence diagram showing typical agent execution]          │
│                                                              │
│  API SURFACE                                                 │
│  • Agent.execute(context): Promise<AgentResult>             │
│  • Registry.getAgent(name): Agent                           │
│  • Registry.getAgentsForTarget(target): Agent[]             │
│                                                              │
│  EXTENSION GUIDE                                             │
│  "To add a new agent: 1) Create class... 2) Register..."    │
│                                                              │
│  RELATED MODULES                                             │
│  → Executor (calls agents)                                  │
│  → LLM Service (agents use for AI calls)                    │
│  → Domain (agents produce findings, edits)                  │
└─────────────────────────────────────────────────────────────┘
```

**Display Format**: Structured document with collapsible sections. Code examples inline. Links to specific files (Level 4).

**Length**: ~1000-2000 words per module

---

### Level 4: Code Reference (The "Implementation Details")

**Target Audience**: Developers debugging or modifying specific code

**Key Questions Answered**:
- What does this function do exactly?
- What are the parameters and return types?
- What edge cases are handled?
- What are the dependencies?

**Key Information per File/Class**:

```
┌─────────────────────────────────────────────────────────────┐
│  FILE: src/agents/registry.ts                               │
│  Module: Agent System (Level 3)                             │
│  Lines: 150                                                  │
│                                                              │
│  EXPORTS                                                     │
│  • AgentRegistry (class)                                    │
│  • getDefaultRegistry() (function)                          │
│                                                              │
│  CLASS: AgentRegistry                                        │
│  ├── register(agent: Agent): void                           │
│  │   "Adds an agent to the registry"                        │
│  │   Throws: DuplicateAgentError if name exists             │
│  │                                                           │
│  ├── getAgent(name: string): Agent | undefined              │
│  │   "Retrieves agent by name"                              │
│  │                                                           │
│  └── getAgentsForTarget(target: WorkTarget): Agent[]        │
│      "Returns all agents that can handle this target type"  │
│      Respects execution order constraints                    │
│                                                              │
│  INTERNAL STATE                                              │
│  • agents: Map<string, Agent>                               │
│  • executionOrder: string[]                                 │
│                                                              │
│  USED BY                                                     │
│  • executor.ts:45 - Gets agents for work items              │
│  • orchestrator.ts:120 - Checks agent capabilities          │
│                                                              │
│  USES                                                        │
│  • ./agent-types.ts - Agent interface definition            │
└─────────────────────────────────────────────────────────────┘
```

**Display Format**: Auto-generated from code with manual annotations. Hyperlinked to source. Usage examples from tests.

**Length**: Varies by file complexity

---

## Visual Design Principles

### 1. Consistent Visual Language

```
COLORS (semantic meaning):
┌──────────────────────────────────────────────────────────┐
│  🔵 Blue    = Entry points (CLI, Web, API)              │
│  🟢 Green   = Data flow / success paths                 │
│  🟡 Yellow  = Processing / transformation               │
│  🟣 Purple  = External services (LLM, Git)              │
│  ⚪ Gray    = Storage / persistence                     │
└──────────────────────────────────────────────────────────┘

SHAPES:
┌──────────────────────────────────────────────────────────┐
│  [Rectangle]  = Components/Modules                       │
│  (Cylinder)   = Data stores                              │
│  <Diamond>    = Decision points                          │
│  →            = Data flow                                │
│  - - →        = Optional/async flow                      │
└──────────────────────────────────────────────────────────┘
```

### 2. Navigation Patterns

**Breadcrumbs**: Always show path from Level 1
```
System Overview > Agent System > registry.ts
```

**Zoom In/Out**: Each component has clear links to:
- Parent (zoom out)
- Children (zoom in)
- Siblings (same level)

**Cross-References**: When a module references another:
```
Uses: LLM Service (→ link to LLM Service Level 3)
```

### 3. Information Density by Level

| Level | Words/Page | Diagrams | Code Examples |
|-------|------------|----------|---------------|
| 1 | ~200 | 1 main | 3-line snippets |
| 2 | ~500 | 1 architecture | Minimal |
| 3 | ~1500 | 2-3 focused | Inline, annotated |
| 4 | ~500 | 0-1 | Full implementations |

---

## Diagram Types by Level

### Level 1: System Context Diagram
```
                    ┌─────────┐
                    │  User   │
                    └────┬────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    ┌─────────┐    ┌─────────┐    ┌─────────┐
    │   CLI   │    │   Web   │    │   MCP   │
    └────┬────┘    └────┬────┘    └────┬────┘
         │               │               │
         └───────────────┼───────────────┘
                         ▼
                  ┌─────────────┐
                  │  CodeWiki   │
                  │   System    │
                  └──────┬──────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    ┌─────────┐    ┌─────────┐    ┌─────────┐
    │Git Repos│    │   LLM   │    │Database │
    └─────────┘    └─────────┘    └─────────┘
```

### Level 2: Component Diagram
```
┌─────────────────────────────────────────────────────────────┐
│                        CodeWiki System                       │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │   CLI    │  │   Web    │  │   MCP    │  ← Interfaces    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
│       └─────────────┼─────────────┘                         │
│                     ▼                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Commands & Queries (CQRS)               │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                        │
│       ┌─────────────┼─────────────┐                         │
│       ▼             ▼             ▼                         │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐                  │
│  │ Agents  │◄─│ Executor │◄─│Orchestratr│  ← Core Logic    │
│  └────┬────┘  └────┬─────┘  └───────────┘                  │
│       │            │                                         │
│       ▼            ▼                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Domain Models                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                     │                                        │
│                     ▼                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Repositories                        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Level 3: Sequence/Flow Diagrams
```
Agent Execution Flow
────────────────────
Executor          Agent           LLM Service       Repository
    │                │                 │                 │
    │ execute()      │                 │                 │
    │───────────────>│                 │                 │
    │                │ chat()          │                 │
    │                │────────────────>│                 │
    │                │                 │ (API call)      │
    │                │    response     │                 │
    │                │<────────────────│                 │
    │                │                 │                 │
    │                │ saveResult()    │                 │
    │                │─────────────────│────────────────>│
    │                │                 │                 │
    │   AgentResult  │                 │                 │
    │<───────────────│                 │                 │
```

### Level 4: State/Data Diagrams
```
WorkItem State Machine
──────────────────────
┌─────────┐    claim()    ┌────────────┐
│ pending │──────────────>│ in_progress│
└─────────┘               └─────┬──────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
               complete()               fail()
                    │                       │
                    ▼                       ▼
             ┌───────────┐           ┌──────────┐
             │ completed │           │  failed  │
             └───────────┘           └──────────┘
```

---

## Content Organization

### Navigation Structure

```
📁 System Documentation
├── 📄 Overview (Level 1)
│   └── "What is CodeWiki?"
│
├── 📁 Architecture (Level 2)
│   ├── 📄 Component Map
│   ├── 📄 Data Flow
│   └── 📄 Technology Stack
│
├── 📁 Subsystems (Level 3)
│   ├── 📁 Agent System
│   │   ├── 📄 Overview
│   │   ├── 📄 Analysis Agents
│   │   ├── 📄 Meta Agents
│   │   ├── 📄 Synthesis Agents
│   │   └── 📄 Creating New Agents
│   │
│   ├── 📁 Executor
│   │   ├── 📄 Overview
│   │   ├── 📄 Work Processing Loop
│   │   └── 📄 Tool Enforcement
│   │
│   ├── 📁 Orchestrator
│   │   ├── 📄 Overview
│   │   ├── 📄 Strategies
│   │   └── 📄 Context Gathering
│   │
│   ├── 📁 CQRS Layer
│   │   ├── 📄 Commands Reference
│   │   └── 📄 Queries Reference
│   │
│   ├── 📁 Data Layer
│   │   ├── 📄 Domain Models
│   │   └── 📄 Repositories
│   │
│   └── 📁 Services
│       ├── 📄 LLM Service
│       ├── 📄 Git Service
│       └── 📄 GitHub Integration
│
└── 📁 Reference (Level 4)
    ├── 📄 API Reference
    ├── 📄 Type Definitions
    └── 📄 Configuration Options
```

---

## Implementation Approach

### Phase 1: Foundation
1. Create Level 1 overview with main diagram
2. Create Level 2 component map
3. Establish visual language and templates

### Phase 2: Core Subsystems
4. Document Agent System (highest complexity, most important)
5. Document Executor
6. Document Orchestrator
7. Document CQRS layer

### Phase 3: Supporting Systems
8. Document Domain Models
9. Document Repositories
10. Document Services

### Phase 4: Reference & Polish
11. Generate API reference (Level 4)
12. Add cross-references and navigation
13. Create search/index capability

---

## Quality Criteria

A good multi-level documentation system should:

1. **Enable 30-second understanding** - Level 1 should convey purpose instantly
2. **Support task-oriented lookup** - "How do I add an agent?" should be findable
3. **Maintain context** - Never lose sight of the whole while exploring parts
4. **Stay current** - Generated from code where possible, marked with freshness dates
5. **Be searchable** - Full-text search across all levels
6. **Show relationships** - Dependencies and dependents always visible

---

## Display Technology Options

### For CodeWiki's Wiki Format:

**Option A: Hierarchical Wiki Pages**
- One wiki page per level/component
- Navigation via internal links
- Diagrams as embedded Mermaid/ASCII

**Option B: Expandable Single Page**
- JavaScript-powered collapsible sections
- Progressive disclosure within one page
- Faster navigation, larger initial load

**Option C: Hybrid**
- Level 1-2 on landing page
- Level 3+ as separate pages
- Search sidebar always visible

### Recommended: Option C (Hybrid)
- Best balance of overview and detail
- Supports both browsing and searching
- Can be progressively enhanced

---

## Metrics for Success

Track these to evaluate documentation effectiveness:

1. **Time to first contribution** - How long until a new dev submits a PR?
2. **Support question reduction** - Fewer "how does X work?" questions
3. **Documentation freshness** - % of docs updated in last 30 days
4. **Cross-reference completeness** - All modules linked to dependents
5. **Search effectiveness** - % of searches that find relevant content

---

## Next Steps

1. [ ] Review this plan with stakeholders
2. [ ] Create templates for each level
3. [ ] Write Level 1 overview
4. [ ] Create Level 2 component diagram
5. [ ] Prioritize Level 3 modules by importance
6. [ ] Establish update workflow (automation where possible)
