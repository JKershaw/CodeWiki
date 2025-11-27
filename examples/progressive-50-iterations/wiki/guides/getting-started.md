---
title: "Getting Started"
confidence: 0.5
path: guides/getting-started
---

# Getting Started

CodeWiki is a system that generates living wikis from Git repositories using LLM-powered analysis to understand your codebase and create comprehensive documentation.

## Prerequisites

- **Node.js**: Version 20.4.0 or higher (specified in package.json engines)
- **Git**: For repository analysis
- **Anthropic API Key** (optional): For LLM-powered analysis. Without it, the system uses a mock LLM for testing.

## Installation

Clone the repository and install dependencies:

```bash
npm install
```

Set up your environment (optional but recommended):

```bash
# Create a .env file in the project root
echo "ANTHROPIC_API_KEY=your-api-key-here" > .env
```

Build the TypeScript code:

```bash
npm run build
```

## Project Structure

```
codewiki/
├── src/
│   ├── agents/           # AI agents (analysis, synthesis, research, orchestrator)
│   ├── cli.ts            # Command-line interface
│   ├── commands/         # Command handlers
│   ├── domain/           # Core domain models (repo, commit, wiki-page, etc.)
│   ├── executor/         # Orchestration execution engine
│   ├── mcp/              # Model Context Protocol server
│   ├── queries/          # Query handlers
│   ├── repositories/     # Data persistence layer
│   ├── services/         # External services (git, llm, cwignore)
│   └── web/              # Web server for UI
├── tests/
│   ├── unit/             # Unit tests
│   └── integration/      # Integration tests
├── .codewiki-data/       # Generated wiki data (created on first run)
└── .cwignore             # Patterns to ignore during analysis
```

**Key directories:**
- `src/domain/`: Contains the core entities (Repo, Commit, WikiPage, WorkItem, Conflict)
- `src/agents/`: LLM-powered agents that analyze code and generate documentation
- `src/cli.ts`: Main entry point for command-line usage
- `src/mcp/server.ts`: MCP server for AI tool integration

## Running the Project

### Process a Repository

Analyze a local Git repository and generate wiki pages:

```bash
# Process current directory with 10 iterations (default)
npm run cli process .

# Process with custom iteration count
npm run cli process . 20

# Process a specific repository path
npm run cli process /path/to/repo 15
```

### Query the Wiki

Ask questions about your codebase:

```bash
npm run cli query . "what is the architecture?"
npm run cli query . "why do we use CQRS?"
npm run cli query . "how does authentication work?"
```

### Check Status

View processing status for a repository:

```bash
npm run cli status <repo-id>
```

### List Repositories

See all connected repositories:

```bash
npm run cli list
```

### Start the Web UI

Launch the web interface to browse wiki pages:

```bash
npm run web
```

### Start the MCP Server

Expose the wiki as tools for AI agents:

```bash
npm run mcp
```

## Key Files to Understand

- **`src/cli.ts`**: Command-line interface with process, query, status, and list commands
- **`src/domain/wiki-page.ts`**: WikiPage entity that stores generated documentation
- **`src/domain/repo.ts`**: Repository entity tracking processing state
- **`src/agents/orchestrator/orchestrator.ts`**: Intelligent work orchestration using LLM
- **`src/agents/research/research-agent.ts`**: Answers questions by searching the wiki
- **`src/executor/executor.ts`**: Runs processing iterations
- **`src/mcp/server.ts`**: Model Context Protocol server for AI tool integration
- **`.cwignore`**: Configure which patterns to ignore during analysis

## Common Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run dev` | Run in watch mode for development |
| `npm run cli` | Run CLI commands |
| `npm run mcp` | Start MCP server |
| `npm run web` | Start web server |
| `npm test` | Run unit and integration tests |
| `npm run test:e2e` | Run end-to-end tests with Playwright |
| `npm run lint` | Lint TypeScript files |
| `npm run typecheck` | Type check without emitting files |

## Next Steps

1. **Process your first repository**: Run `npm run cli process .` to analyze the current codebase
2. **Explore the wiki**: Check `.codewiki-data/` to see generated wiki pages
3. **Query the wiki**: Use `npm run cli query . "your question"` to test the research agent
4. **Start the web UI**: Run `npm run web` to browse wiki pages in your browser
5. **Integrate with AI tools**: Use the MCP server (`npm run mcp`) to expose wiki as tools

For more details on architecture and design decisions, process your repository and query the generated wiki!