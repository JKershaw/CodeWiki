---
title: "Getting Started"
confidence: 0.55
created: 2025-11-26T16:22:17.461Z
updated: 2025-11-26T16:27:25.194Z
commits: []
---
# Getting Started

This guide will help you set up the Synthesis Agent System - a wiki documentation tool that uses specialized AI agents to automatically generate and maintain project documentation. You'll learn how to get the system running locally and understand how the agents work together.

## Prerequisites

- Node.js 18+ and npm installed
- Git installed
- API access credentials (likely Anthropic API key for Claude, based on agent architecture)
- A text editor or IDE (VS Code recommended)
- Basic familiarity with TypeScript and async/await patterns
- Command line experience

## Setup

1. **Clone the repository**
2. **Install dependencies**
3. **Configure environment variables**
4. **Build the TypeScript code**
5. **Verify the setup**
6. **Run the system**

## Project Structure

```
/
├── src/
│   ├── agents/           # Specialized documentation agents
│   │   ├── writer.ts     # Agent that writes wiki pages
│   │   ├── overview.ts   # Project Overview Agent (triggers at 10+ pages)
│   │   ├── getting-started.ts  # Getting Started Agent
│   │   └── orchestrator.ts     # Coordinates agent work (lines 266-300 contain work generation logic)
│   ├── types/            # TypeScript type definitions
│   └── utils/            # Helper functions
├── wiki/                 # Generated wiki content
│   ├── architecture/
│   │   └── overview.md   # Auto-generated project overview
│   ├── conventions/
│   │   └── coding-standards.md
│   └── patterns/
│       └── anti-patterns.md
└── commits/              # Commit-based documentation storage
```

The system watches for changes and triggers agents to create/update documentation automatically.

## Key Files to Understand

- **`src/agents/writer.ts`**: Example of agent implementation pattern. All agents follow this structure with `readonly type: AgentType` and private methods like `findPagesNeedingRewrite()`, `needsRewrite()`, `buildPrompt()`, `parseResponse()`.
- **`src/agents/overview.ts`**: The Project Overview Agent that triggers at 10+ wiki pages. Good example of threshold-based agent activation.
- **`src/agents/getting-started.ts`**: The Getting Started Agent. Check this to understand how synthesis agents work.
- **`wiki/conventions/coding-standards.md`**: Review this to understand the codebase conventions (readonly types, private method prefixes, early return guards).
- **`wiki/patterns/anti-patterns.md`**: Known issues to avoid when contributing.

## Suggested First Tasks

- **Read through the coding standards**: Open `wiki/conventions/coding-standards.md` to understand the patterns used throughout the codebase (readonly types, private methods, early returns).
- **Trace an agent execution**: Set a breakpoint in `src/agents/writer.ts` at the `needsRewrite()` method and run in debug mode to see how agents evaluate content.
- **Trigger the overview agent**: If your wiki has fewer than 10 pages, add dummy pages to reach the threshold and watch the Overview Agent generate `architecture/overview.md`.
- **Create a simple test agent**: Copy the structure from `writer.ts` to create a minimal agent that adds a timestamp to a wiki page. This will teach you the agent lifecycle.
- **Fix a known issue**: Review `wiki/patterns/anti-patterns.md` and attempt to refactor the orchestrator's nested logic (lines 266-300) to reduce complexity.

## Common Commands

| Command | Description |
|---------|-------------|
| `npm start` | Run the agent system in production mode |
| `npm run dev` | Run in development mode with hot reload (if available) |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm test` | Run the test suite |
| `npm run lint` | Check code style and conventions |
| `npm run type-check` | Run TypeScript type checking without building |

## Next Steps

After completing this guide:
1. Read the **Project Overview** at `wiki/architecture/overview.md` for high-level architecture understanding (note: current version indicates insufficient documentation - this will improve as the wiki grows)
2. Study the **Coding Standards** at `wiki/conventions/coding-standards.md` before making changes
3. Review **Anti-Patterns** at `wiki/patterns/anti-patterns.md` to avoid known issues
4. Explore agent-specific documentation (when available) to understand specialized behaviors
5. Check the `commits/` directory to see how documentation is versioned and stored

---



## Related Pages

- [Synthesis Agent System - Project Overview and Getting Started](commits/7b58314c.md) - Getting Started Agent generates this guide page
- [Wiki Quality Orchestration System](commits/64a8801e.md) - Page-count orchestration triggers getting started guide creation
- [[Unknown Project - Insufficient Documentation] - Project Overview](architecture/overview) - Getting started guide relates to project overview