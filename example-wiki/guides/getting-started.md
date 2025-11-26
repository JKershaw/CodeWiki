---
title: "Getting Started"
confidence: 0.50
created: 2025-11-26T17:43:30.927Z
updated: 2025-11-26T17:43:30.927Z
commits: undefined
---
# Getting Started

This guide will help you set up CodeWiki locally, understand its architecture, and make your first contribution. You'll go from clone to running the system in about 15 minutes.

## Prerequisites

- Node.js v18+ installed (check with `node --version`)
- Git installed and configured
- A GitHub account (if you want to contribute)
- Basic TypeScript/JavaScript knowledge
- Terminal/command line familiarity
- A code editor (VS Code recommended)

## Setup

1. **Clone the repository**
2. **Install dependencies**
3. **Build the project**
4. **Verify setup - Run CodeWiki on itself**
5. **Run tests (optional but recommended)**

## Project Structure

```
codewiki/
├── src/
│   ├── agents/          # AI agents that generate different types of documentation
│   ├── git/            # Git repository interaction and commit analysis
│   ├── wiki/           # Wiki page management and storage
│   ├── orchestration/  # Coordinates agents and wiki generation process
│   └── cli/            # Command-line interface entry point
├── docs/               # Generated wiki documentation (when run on itself)
└── tests/              # Test suites
```

The system works by: (1) analyzing Git commits, (2) running specialized AI agents on those commits, (3) generating/updating wiki pages with insights about architecture, decisions, and patterns.

## Key Files to Understand

- **`src/cli/index.ts`**: Entry point - start here to understand command-line arguments and how the system boots up
- **`src/orchestration/orchestrator.ts`**: Core orchestration logic - shows how commits are processed and agents are coordinated (NOTE: identified as potential "god class" in anti-patterns - review carefully)
- **`src/agents/WriterAgent.ts`**: Example agent implementation - demonstrates how agents analyze commits and generate documentation
- **`src/wiki/Wiki.ts`**: Wiki page management - how documentation is stored and organized
- **`conventions/coding-standards.md`**: Read this to understand naming conventions (agents use `*Agent` suffix, type field matches class name)

## Suggested First Tasks

- **Explore the self-generated wiki**: Open `./test-wiki` (or wherever you output docs in step 4) and read the generated pages. This shows you what CodeWiki produces.
- **Read a commit analysis**: Pick a recent commit in the repository and find its corresponding documentation page. Understand how commit content translates to documentation.
- **Follow an agent execution**: Add console.log statements to `WriterAgent.ts` and re-run to see how it processes commits in real-time.
- **Try a different repository**: Run CodeWiki on a small personal project: `npm start -- --repo /path/to/your/repo --output ./my-project-wiki`
- **Fix a simple bug**: Check the issues list for "good first issue" tags, or tackle a known anti-pattern from `patterns/anti-patterns.md`

## Common Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start -- --repo <path> --output <path>` | Run CodeWiki on a repository |
| `npm test` | Run the test suite |
| `npm run lint` | Check code style (if configured) |
| `npm run watch` | Build in watch mode during development (if configured) |

## Next Steps

After completing this guide:
1. Read `architecture/overview.md` for a complete system architecture understanding
2. Review `conventions/coding-standards.md` before making code changes
3. Study `patterns/anti-patterns.md` to learn what to avoid
4. Explore individual agent implementations in `src/agents/` to understand specialization
5. Join discussions or check issues to find areas needing contribution

Pro tip: The best way to understand CodeWiki is to run it on repositories you already know well - you'll immediately see how it captures architectural insights you recognize.