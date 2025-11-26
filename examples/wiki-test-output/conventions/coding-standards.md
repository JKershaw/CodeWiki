---
title: "Coding Standards & Conventions"
confidence: 1.00
created: 2025-11-26T15:41:26.978Z
updated: 2025-11-26T15:54:36.783Z
commits: [32b7cb2f4b05e2bc350c284e8be2bb23895bcd0a, 8c4122db9d7409740c297fc6c0f7991838b827d3, 659d7dd1c6000904ad6b487a8fd185291854f550]
---
# Coding Standards & Conventions

## Observed Conventions

- **Naming Convention**: Agents named with `-agent` suffix (consistency-agent.ts, quality-agent.ts). Clear, domain-driven naming throughout (WikiPage, AgentRunResult, createFinding).
- **Error Handling**: Explicit Error throwing for unsupported operations (runOnCommit in meta-agents). Clear error messages explaining constraints.
- **Type Safety**: Strong TypeScript usage with explicit types (AgentType, AgentContext, WikiPageUpdate). Readonly properties for configuration (MIN_PAGES_FOR_ANALYSIS).
- **Configuration Constants**: Magic numbers extracted to named constants at class level (SIMILARITY_THRESHOLD = 0.6, MAX_PAGES_TO_COMPARE = 20). Self-documenting thresholds.
- **File Organization**: Meta-agents grouped in src/agents/meta/ directory. Index file provides clean public API. Tests mirror source structure (tests/unit/consistency-agent.test.ts).
- **Documentation**: Comprehensive JSDoc comments explaining agent purpose and behavior. System prompts separated as constants with clear instructions.
- **Import Patterns**: Explicit .js extensions for ESM compatibility. Type-only imports distinguished (import type).
- **Test Organization**: Describe blocks grouped by functionality. Setup/teardown in beforeEach/afterEach. Mock factories for test data.
- **Confidence Scoring**: Explicit confidence values returned (0.9 for high confidence, varies by analysis quality). Transparent uncertainty communication.
- **Cost Tracking**: Every LLM call tracked with costUsd field. Enables budget monitoring and optimization.

---
*Updated from commit addfc9e6*
