---
title: "Getting Started"
confidence: 0.50
created: 2025-11-26T18:44:32.802Z
updated: 2025-11-26T18:44:32.802Z
commits: []
---
# Getting Started

CodeWiki is a system that automatically generates living documentation wikis from Git repositories using LLM-powered analysis.

## Prerequisites

- **Node.js**: Version 20.4.0 or higher (specified in `package.json` engines)
- **Git**: Required for repository analysis
- **Anthropic API Key** (optional): For production LLM analysis. Without it, the system uses a mock LLM service

## Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd codewiki

# Install dependencies
npm install

# Build TypeScript files
npm run build
```

## Environment Setup

Create a `.env` file in the project root (optional, but recommended for production):

```bash
ANTHROPIC_API_KEY=your_api_key_here
PORT=3000
```

Without an API key, CodeWiki will use a mock LLM service for testing.

## Project Structure

```
codewiki/
├── src/
│   ├── agents/           # LLM agents (analysis, orchestrator, research, synthesis, meta)
│   ├── cli.ts            # Command-line interface
│   ├── commands/         # Command handlers
│   ├── domain/           # Core entities (repo, commit, wiki-page, work-item, etc.)
│   ├── executor/         # Iteration execution logic
│   ├── mcp/              # Model Context Protocol server
│   ├── queries/          # Query handlers
│   ├── repositories/     # Data access layer
│   ├── services/         # External services (git, llm)
│   └── web/              # Web server and API
├── dist/                 # Compiled JavaScript (after build)
├── .codewiki-data/       # Local file storage for repositories
└── package.json
```

**Key directories:**
- **`src/agents/`**: Contains the LLM-powered agents that analyze code and orchestrate wiki generation
- **`src/domain/`**: Core business entities like repositories, commits, wiki pages, and work items
- **`src/services/`**: Git operations and LLM integration (Anthropic Claude or mock)
- **`src/web/`**: Express-based web server with REST API

## Running the Project

### CLI Mode (Recommended for First Use)

Process a local Git repository:

```bash
# Process current directory with 10 iterations (default)
npm run cli process . 10

# Process a specific repository path
npm run cli process /path/to/repo 20

# Query the generated wiki
npm run cli query . "what is the architecture?"

# List all repositories
npm run cli list

# Check processing status
npm run cli status <repo-id>
```

### Web Server Mode

Start the web interface:

```bash
npm run web
```

Then open http://localhost:3000 in your browser to:
- Add repositories for processing
- Browse generated wiki pages
- Query the documentation
- Monitor processing status

### MCP Server Mode

Run as a Model Context Protocol server:

```bash
npm run mcp
```

This allows integration with MCP-compatible tools.

## Key Files to Understand

- **`src/cli.ts`**: Entry point for command-line usage with commands like `process`, `query`, `status`, and `list`
- **`src/index.ts`**: Main library module and application initialization
- **`src/web/server.ts`**: Express web server providing REST API and web interface
- **`src/agents/orchestrator/orchestrator.ts`**: LLM-powered orchestration that decides what wiki pages to create/update
- **`src/domain/repo.ts`**: Repository entity and business logic
- **`src/domain/wiki-page.ts`**: Wiki page entity representing generated documentation
- **`src/executor/executor.ts`**: Executes processing iterations

## Common Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to JavaScript in `dist/` |
| `npm run dev` | Run in development mode with auto-reload |
| `npm run cli` | Run CLI commands (see CLI Mode above) |
| `npm run web` | Start the web server on port 3000 |
| `npm run mcp` | Start as MCP server |
| `npm test` | Run unit tests with Vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:e2e` | Run end-to-end tests with Playwright |
| `npm run lint` | Lint TypeScript files with ESLint |
| `npm run typecheck` | Type-check without emitting files |

## Quick Start Example

```bash
# 1. Install and build
npm install
npm run build

# 2. Process your first repository (current directory)
npm run cli process . 5

# 3. Query the generated wiki
npm run cli query . "what does this project do?"

# 4. Start the web UI (optional)
npm run web
```

## How It Works

1. **Repository Loading**: CodeWiki loads a Git repository and all its commits
2. **Orchestration**: An LLM-powered orchestrator analyzes commits and decides what documentation to create
3. **Wiki Generation**: Specialized agents write wiki pages covering architecture, guides, and decisions
4. **Iteration**: The process runs for N iterations, progressively building comprehensive documentation
5. **Query**: A research agent can answer questions by searching and synthesizing wiki content

## Next Steps

- **Architecture Documentation**: See the wiki page on system architecture (if generated)
- **API Reference**: Explore `src/web/server.ts` for REST API endpoints
- **Agent System**: Read `src/agents/` to understand the LLM agent architecture
- **Storage**: Check `.codewiki-data/` for file-based data storage (or configure MongoDB)