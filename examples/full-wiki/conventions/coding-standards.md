---
title: "Coding Standards & Conventions"
confidence: 1.00
created: 2025-11-26T10:31:41.427Z
updated: 2025-11-26T10:42:11.938Z
commits: [82525543ff9587140a9ad12be99f55a1b41b69f2, fd824f7d59f47b994a77221ff125706c8eaab503, 4d2e0c45078eba61baaed35ac0a8c86472de1c29]
---
# Coding Standards & Conventions

## Observed Conventions

- **Naming Convention - Commands**: Commands use imperative verb phrases (StartProcessingRepo, RunAgent, UpdateWikiPage, ResolveConflict, SetThrottle). Indicates state-changing operations in CQRS pattern.
- **Naming Convention - Queries**: Queries use Get/Search prefixes (GetWikiPage, SearchWiki, GetRepoStatus). Indicates read-only operations in CQRS pattern.
- **Naming Convention - Agents**: All agent types end with "Agent" suffix (Code Change Agent, Narrative Agent, Writer Agent, Research Agent). Clear identification of autonomous components.
- **Agent Categorization**: Agents organized into functional categories: Analysis Agents (examine commits), Meta Agents (examine wiki itself), Synthesis Agents (create higher-order content), plus specialized Writer and Research agents.
- **Collection Naming**: Database collections use PascalCase plural nouns (Repos, Commits, AgentRuns, WikiPages, WorkQueue, Conflicts, Learnings). Consistent schema organization.
- **Status Field Pattern**: Work items include status fields with timestamps for state management (queued, processing, complete). Common pattern across WorkQueue and other collections.
- **Environment-Based Configuration**: Auto-detection of runtime environment drives implementation selection (MongoDB vs file-based). No manual switching required.
- **Documentation Philosophy**: "The Repo as Its Own Best Example" - project documents should explain not just what but why. Emphasis on capturing reasoning and context.
- **Commit Message Quality**: Expectation of meaningful commit messages as primary documentation source. System depends on commits conveying intent.
- **Confidence Over Completeness**: Every piece of information includes confidence metadata. Explicit acknowledgment of uncertainty rather than false precision.

---
*Updated from commit b908ecb1*
