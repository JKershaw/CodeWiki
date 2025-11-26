---
title: "Anti-Patterns to Avoid"
confidence: 1.00
created: 2025-11-26T15:41:26.979Z
updated: 2025-11-26T15:54:36.785Z
commits: [32b7cb2f4b05e2bc350c284e8be2bb23895bcd0a, 8c4122db9d7409740c297fc6c0f7991838b827d3, 659d7dd1c6000904ad6b487a8fd185291854f550]
---
# Anti-Patterns to Avoid

These patterns have been identified as problematic in the codebase:

## **Large Method Complexity**

**Large Method Complexity**: The runOnWiki methods are becoming substantial (50+ lines of orchestration logic). Consider extracting smaller, testable methods. Moderate severity - still readable but approaching refactoring threshold. Affects: src/agents/meta/consistency-agent.ts, src/agents/meta/quality-agent.ts

## **Magic Threshold Values**

**Magic Threshold Values**: While constants are named, the values (0.6 similarity, 20 max pages) lack justification comments. Why these specific values? Should include rationale or make configurable. Low severity - functional but could be more maintainable. Affects: Class-level constants in both agents

## **Tight Coupling to String Matching**

**Tight Coupling to String Matching**: Keyword-based category detection (securityKeywords array) is brittle and language-specific. Won't work for non-English codebases. Consider more robust approaches. Low-medium severity. Affects: src/agents/meta/consistency-agent.ts (lines 229-255)

## **Response Parsing Fragility**

**Response Parsing Fragility**: parseResponse methods likely depend on LLM output format without error recovery. Single prompt change could break parsing. Should add validation and fallback handling. Medium severity. Affects: parseResponse methods in both agents

## **Hardcoded Prompt Logic**

**Hardcoded Prompt Logic**: System prompts are string constants rather than composable templates. Difficult to version, test, or customize. Consider prompt management system. Low severity - works but not scalable. Affects: SYSTEM_PROMPT constants


---
*Updated from commit addfc9e6*
