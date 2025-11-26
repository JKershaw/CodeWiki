---
title: "Coding Standards & Conventions"
confidence: 1.00
created: 2025-11-26T12:46:30.235Z
updated: 2025-11-26T13:01:31.750Z
commits: [32b7cb2f4b05e2bc350c284e8be2bb23895bcd0a, b49c7432f6392c048e9a70ffabd2d0000bcd2830, 82193f9f7b498e2cc88343292d554153c757775f]
---
# Coding Standards & Conventions

## Observed Conventions

- **Command/Query Naming**: Commands use imperative verbs (Start, Run, Update, Resolve, Set). Queries use Get/Search prefixes. Clear linguistic distinction between read and write operations.
- **Agent Naming Convention**: All processing components suffixed with "Agent" (Code Change Agent, Pattern Agent, Writer Agent, Research Agent). Establishes consistent vocabulary for system components.
- **Database-as-Queue Pattern**: Work queues implemented as database records with status fields rather than external queue services. Simplicity principle applied - "All state lives in one database."
- **Progressive Enrichment**: System designed to provide value quickly (80% in 20 minutes) then improve over time, rather than batch processing everything upfront. Prioritizes user value over completeness.
- **Confidence Metadata**: Every piece of information carries confidence scores, source attribution, and verification history. Enables calibrated trust and prioritized improvement.
- **Single Responsibility Agents**: Each agent type has one clear lens/concern (security, patterns, technical debt, etc.). Follows SRP from SOLID principles.
- **Write Serialization**: All writes funnel through single Writer Agent to prevent conflicts. Reads are parallelized freely. Classic read-write separation pattern.
- **Conflict Resolution by Recency**: When conflicts detected, most recent commit wins. Simple, deterministic resolution strategy with logging for review.
- **Auto-Environment Detection**: System automatically selects appropriate implementations (MongoDB vs file-based) based on environment configuration. No manual switching required.

---
*Updated from commit b908ecb1*
