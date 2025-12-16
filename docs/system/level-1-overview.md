# CodeWiki System Overview

> **One-liner**: CodeWiki generates living wikis from Git repositories using AI agents that understand code changes.

## What It Does

CodeWiki watches your Git repository and automatically generates documentation. Every commit is analyzed by specialized AI agents that understand what changed and why. The result is a wiki that stays current with your code.

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  Git Repo   │ ───▶ │   Agents    │ ───▶ │    Wiki     │
│  (commits)  │      │  (analyze)  │      │  (browse)   │
└─────────────┘      └─────────────┘      └─────────────┘
```

## How To Use It

**Command Line**
```bash
codewiki process .          # Generate wiki for current directory
codewiki ask "How does auth work?"   # Query the wiki
```

**Web Interface**
```
http://localhost:3000       # Browse wikis, monitor processing
```

**AI Integration (MCP)**
```
Tools: query_wiki, list_wiki_pages, get_wiki_page
```

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Agents** | AI workers specialized for different analysis types (security, patterns, dependencies) |
| **Wiki Pages** | Generated markdown documentation organized by topic |
| **Work Queue** | Tasks waiting for agents to process |
| **Findings** | Issues discovered that need consolidation (duplicates, broken links) |
| **Orchestrator** | Decides what work to prioritize next |

## System Architecture (Simplified)

```
                         ┌─────────────────────┐
                         │    Entry Points     │
                         │  CLI / Web / MCP    │
                         └──────────┬──────────┘
                                    │
                         ┌──────────▼──────────┐
                         │    Core Engine      │
                         │ Orchestrator ───▶ Executor ───▶ Agents
                         └──────────┬──────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
    ┌─────────▼─────────┐ ┌────────▼────────┐ ┌─────────▼─────────┐
    │    Git Service    │ │   LLM Service   │ │     Database      │
    │  (repo access)    │ │  (AI calls)     │ │  (wiki storage)   │
    └───────────────────┘ └─────────────────┘ └───────────────────┘
```

## Technology Stack

- **Runtime**: Node.js + TypeScript
- **Database**: MongoDB (production) or JSON files (local dev)
- **LLM**: OpenRouter API (Claude, Gemini, Grok, etc.)
- **Web**: Express.js + EJS templates

## Next Level

→ [Level 2: Subsystem Architecture](./level-2-architecture.md) - Detailed component breakdown
