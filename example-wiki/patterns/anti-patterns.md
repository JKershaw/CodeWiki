---
title: "Anti-Patterns to Avoid"
confidence: 1.00
created: 2025-11-26T17:41:49.772Z
updated: 2025-11-26T17:46:40.707Z
commits: undefined
---
# Anti-Patterns to Avoid

These patterns have been identified as problematic in the codebase:

## **MAGIC_PATH_STRINGS** [LOW_SEVERITY] Multiple hardcoded path variations checked (e.g., 'guides/getting-started', 'guides/quickstart', 'guides/index'). Should centralize path aliases in configuration. [src/agents/orchestrator/context-gatherer.ts

**MAGIC_PATH_STRINGS** [LOW_SEVERITY] Multiple hardcoded path variations checked (e.g., 'guides/getting-started', 'guides/quickstart', 'guides/index'). Should centralize path aliases in configuration. [src/agents/orchestrator/context-gatherer.ts:161-164]

## **DUPLICATE_VALIDATION_LOGIC** Both GettingStartedAgent and ProjectOverviewAgent have identical pattern for checking page count and existence. Could extract to shared validator utility. [src/agents/synthesis/getting-started-agent.ts

**DUPLICATE_VALIDATION_LOGIC** Both GettingStartedAgent and ProjectOverviewAgent have identical pattern for checking page count and existence. Could extract to shared validator utility. [src/agents/synthesis/getting-started-agent.ts:31-49]

## **ARRAY_IN_ARRAY_UPDATE** `SYNTHESIS_AGENTS = [...ANALYSIS_AGENTS, ...META_AGENTS, ...SYNTHESIS_AGENTS]` - confusing to have SYNTHESIS_AGENTS reference itself. Should use clearer naming (e.g., SYNTHESIS_AGENT_TYPES). [src/agents/orchestrator/prompts.ts

**ARRAY_IN_ARRAY_UPDATE** `SYNTHESIS_AGENTS = [...ANALYSIS_AGENTS, ...META_AGENTS, ...SYNTHESIS_AGENTS]` - confusing to have SYNTHESIS_AGENTS reference itself. Should use clearer naming (e.g., SYNTHESIS_AGENT_TYPES). [src/agents/orchestrator/prompts.ts:130]

## **INCOMPLETE_ERROR_HANDLING** No try-catch around LLM completion calls. If LLM fails, entire agent run fails. Should handle gracefully with partial results. [src/agents/synthesis/getting-started-agent.ts

**INCOMPLETE_ERROR_HANDLING** No try-catch around LLM completion calls. If LLM fails, entire agent run fails. Should handle gracefully with partial results. [src/agents/synthesis/getting-started-agent.ts:67]

## **IMPLICIT_BOOLEAN_CONVERSION** Using `.some()` to check existence returns boolean directly. Clear, but relying on implicit truthiness in orchestrator could be fragile if requirements change. [src/agents/orchestrator/context-gatherer.ts

**IMPLICIT_BOOLEAN_CONVERSION** Using `.some()` to check existence returns boolean directly. Clear, but relying on implicit truthiness in orchestrator could be fragile if requirements change. [src/agents/orchestrator/context-gatherer.ts:157]


---
*Updated from commit 7b58314c*
