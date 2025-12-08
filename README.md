# CodeWiki

Generate living wikis from Git repositories. CodeWiki analyzes commit history and code changes using specialized AI agents to build structured documentation that captures not just *what* code does, but *why* it exists, how it evolved, and lessons learned.

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment (copy and configure)
cp .env.example .env  # Add your OPENROUTER_API_KEY

# Run in development mode
npm run dev

# Or use the CLI
npm run cli process <repo-path>
```

## Architecture Overview

CodeWiki uses a **multi-agent architecture** with specialized AI agents that analyze code from different perspectives:

```
Repository → Orchestrator → Work Queue → Agents → Wiki Pages
                                           ↓
                              ┌────────────┼────────────┐
                              ↓            ↓            ↓
                          Analysis     Meta         Synthesis
                          Agents      Agents        Agents
```

### Two-Loop Model

1. **Outer Loop (Orchestrator)**: Examines repository state and wiki content, generates prioritized work items
2. **Inner Loop (Executor)**: Claims work items, runs agents in parallel, applies wiki updates

### Agent Categories

| Category | Purpose | Examples |
|----------|---------|----------|
| **Analysis** | Process commits, create initial content | code-change, security, technical-debt, pattern |
| **Meta** | Improve wiki quality | link, structure, quality, consistency |
| **Synthesis** | Generate summary pages | project-overview, getting-started, testing-guide |
| **Consolidation** | Self-healing | Merge duplicates, fix broken links |

## Development

### Commands

```bash
npm run build      # Compile TypeScript
npm run dev        # Watch mode
npm run web        # Start web server
npm run mcp        # Start MCP server
npm run cli        # Run CLI commands
```

### Testing

```bash
npm run test       # Unit + integration tests
npm run test:llm   # Real LLM tests (requires OPENROUTER_API_KEY)
npm run test:e2e   # Playwright E2E tests (run `npx playwright install` first)
npm run lint       # ESLint
npm run typecheck  # TypeScript checking
```

**Before committing:**
```bash
npm run lint && npm run typecheck && npm run test
```

### CLI Commands

```bash
npm run cli process <repo>           # Process a repository
npm run cli ask "<question>"         # Query current directory
npm run cli query <repo> "<question>" # Ask about a specific repo
npm run cli status <repo-id>         # Check processing status
npm run cli list                     # List connected repositories
```

## Project Structure

```
src/
├── agents/           # AI agents (20+)
│   ├── analysis/     # Commit analysis (code-change, security, etc.)
│   ├── meta/         # Wiki improvement (link, quality, etc.)
│   ├── synthesis/    # Summary generation (overview, guides)
│   └── consolidation/# Self-healing (duplicates, conflicts)
├── commands/         # CQRS write operations
├── queries/          # CQRS read operations
├── domain/           # Core business models
├── executor/         # Orchestration engine
├── services/
│   ├── git/          # Repository access
│   ├── llm/          # LLM integration (OpenRouter)
│   └── repository/   # Unified repo abstraction
├── repositories/     # Data persistence (MongoDB/file-based)
├── web/              # Express web interface
├── mcp/              # Model Context Protocol server
└── cli/              # CLI command implementations

tests/
├── unit/             # Pure logic tests
├── integration/      # Component interaction tests
├── llm/              # Real LLM tests (LLM-as-judge pattern)
├── e2e/              # Playwright browser tests
├── helpers/          # Test utilities (MockLLMService, createTestContext)
└── fixtures/         # Test data
```

## Key Concepts

### Work Items & Targets

Agents process **WorkItems** which contain a **WorkTarget**:
- `CommitTarget`: Analyze a specific git commit
- `PathTarget`: Explore a filesystem path
- `WikiTarget`: Process the entire wiki

### CQRS Pattern

All state changes go through **Commands**, all reads through **Queries**:
```typescript
// Write
await commands.createWikiPage({ ... })

// Read
const page = await queries.getWikiPage(pageId)
```

### Unified Repository Access

Single abstraction for local and GitHub repositories:
```typescript
const repo = await UnifiedRepoAccess.create(repoPath)
const content = await repo.readFile('src/index.ts')
```

### Agent Tools

Agents use tools to understand code (enforced, not optional):
- `read_file` - Read file contents
- `list_directory` - Explore structure
- `search_pages` - Query existing wiki

## Configuration

Key environment variables:

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | LLM API access (required) |
| `MONGODB_URI` | Database connection (optional, falls back to file-based) |
| `PORT` | Web server port (default: 3000) |

## Documentation

- `CLAUDE.md` - AI coding guidelines and TDD workflow
- `docs/` - Architecture decisions, testing strategy, agent analysis
