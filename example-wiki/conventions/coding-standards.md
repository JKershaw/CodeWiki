---
title: "Coding Standards & Conventions"
confidence: 0.80
created: 2025-11-26T17:41:49.770Z
updated: 2025-11-26T17:46:40.706Z
commits: undefined
---
# Coding Standards & Conventions

## Observed Conventions

- **Agent Naming**: All agents end with `-agent.ts` suffix and export a class with `Agent` suffix (GettingStartedAgent, ProjectOverviewAgent). Type field uses kebab-case matching filename stem.
- **Path Constants**: Important paths stored as readonly class properties (GUIDE_PATH, OVERVIEW_PATH) in SCREAMING_SNAKE_CASE for infrastructure concerns.
- **Threshold Constants**: Minimum thresholds prefixed with MIN_ (MIN_PAGES_FOR_GUIDE, MIN_PAGES_FOR_OVERVIEW). Documents business rules clearly.
- **Boolean Flags**: Existence checks use `has*` prefix (hasProjectOverview, hasGettingStarted). Makes intent explicit in orchestrator logic.
- **Error Messages**: Synthesis agents throw descriptive errors when called with wrong method: "Agent does not run on commits. Use runOnWiki instead." Guides developers to correct usage.
- **Type Safety**: All interfaces explicitly typed (AgentContext, AgentRunResult, WikiPage). TypeScript strict mode enforced with `type` declarations.
- **Confidence Scoring**: All results include confidence score (0-1). Lower confidence when extrapolating from limited data, 1.0 for deterministic checks.
- **Cost Tracking**: LLM costs tracked and returned in AgentRunResult.costUsd. Enables budget monitoring and optimization.
- **Context Objects**: Private methods receive focused context objects (GuideContext, OverviewContext) rather than passing full AgentContext. Better encapsulation.
- **Finding Importance**: Findings categorized by importance ('high', 'medium', 'low'). Enables prioritization in orchestrator.

---
*Updated from commit 7b58314c*
