# CodeWiki Benchmark Questions

Questions specific to evaluating wiki quality for the CodeWiki repository.

## arch-cqrs

- **Category:** architecture
- **Difficulty:** easy
- **Hints:** src/commands/, src/queries/

What pattern is used for separating read and write operations in this codebase?

## arch-agents

- **Category:** architecture
- **Difficulty:** medium
- **Hints:** src/agents/

How are agents organized and what categories of agents exist in the system?

## arch-executor

- **Category:** architecture
- **Difficulty:** medium
- **Hints:** src/executor/

How does the executor handle concurrent agent execution?

## pattern-repository

- **Category:** patterns
- **Difficulty:** easy
- **Hints:** src/repositories/

What is the repository pattern used for and how are repositories implemented?

## pattern-work-queue

- **Category:** patterns
- **Difficulty:** medium
- **Hints:** src/repositories/interfaces/work-queue-repository.ts, src/commands/

How does the work queue system prevent duplicate work items from being processed?

## pattern-confidence

- **Category:** patterns
- **Difficulty:** hard
- **Hints:** src/domain/wiki-page.ts, src/agents/

How is confidence scoring calculated for wiki pages?

## decision-llm

- **Category:** decisions
- **Difficulty:** medium
- **Hints:** src/services/llm/

What LLM provider is used and how is the LLM service abstracted?

## decision-storage

- **Category:** decisions
- **Difficulty:** medium
- **Hints:** src/repositories/file-based/

How is data persistence handled and what storage options are supported?

## convention-commands

- **Category:** conventions
- **Difficulty:** easy
- **Hints:** src/commands/

What naming conventions are used for CQRS command handlers and factory functions?

## convention-agents

- **Category:** conventions
- **Difficulty:** medium
- **Hints:** src/agents/

How should new agent types be named and structured?

## security-api

- **Category:** security
- **Difficulty:** medium
- **Hints:** src/web/

How are API endpoints protected and what security measures are in place?

## security-config

- **Category:** security
- **Difficulty:** easy
- **Hints:** src/services/llm/openrouter-llm-service.ts, src/cli.ts, src/web/server.ts, .env

How is sensitive configuration like API keys handled?

## howto-agent

- **Category:** howto
- **Difficulty:** hard
- **Hints:** src/agents/, src/commands/

What are the steps to add a new agent type to the system?

## howto-wiki-page

- **Category:** howto
- **Difficulty:** medium
- **Hints:** src/commands/update-wiki-page.ts

How do you create or update a wiki page through the CQRS system?

## howto-processing

- **Category:** howto
- **Difficulty:** medium
- **Hints:** src/executor/, src/commands/processing-run.ts

How do you start processing a repository and what configuration options are available?
