---
title: "Coding Standards & Conventions"
confidence: 1.00
created: 2025-11-25T22:17:57.659Z
updated: 2025-11-25T22:25:50.905Z
commits: [296d345be67c674f9784914ac65b726cd0c1712d, a99a401366534bbafb9d20d9fb722523feebe507, adc01766a9f6b9e6c1618b04aa21fe0b4223255d]
---
# Coding Standards & Conventions

## Observed Conventions

- **Naming Convention - Agents**: All specialized processing components are suffixed with "Agent" (Code Change Agent, Writer Agent, Research Agent). Clear, consistent naming that immediately identifies component type.
- **Naming Convention - Commands/Queries**: Commands use imperative verbs (StartProcessingRepo, RunAgent, UpdateWikiPage). Queries use Get/Search prefixes (GetWikiPage, SearchWiki). Standard CQRS naming convention.
- **Database as Queue**: Queues implemented as database records with timestamps and status fields rather than separate queue services. Simplicity-first approach that reduces infrastructure complexity.
- **Single Source of Truth**: All state lives in one database. No distributed state, no separate cache layers. Simplifies reasoning about system behavior.
- **Markdown for Documentation**: Wiki content stored as Markdown. Industry-standard, human-readable, tool-friendly format.
- **Confidence Scoring**: Every piece of information includes confidence metadata. Transparency about data quality and completeness.
- **Timestamp-Based Conflict Resolution**: When conflicts occur, most recent commit wins. Simple, deterministic conflict resolution strategy.
- **Self-Documentation**: The codebase documents itself through its own wiki. "The Repo as Its Own Best Example" - dogfooding principle.

---
*Updated from commit b908ecb1*
