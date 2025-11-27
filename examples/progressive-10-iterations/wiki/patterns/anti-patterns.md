---
title: "Anti-Patterns to Avoid"
confidence: 0.5
path: patterns/anti-patterns
---

# Anti-Patterns to Avoid

These patterns have been identified as problematic in the codebase:

## **Magic Numbers** [SEVERITY

**Magic Numbers** [SEVERITY:medium] Hardcoded values in prompt building (12000 for diff truncation) and token limits (2500) without named constants. Makes tuning difficult and obscures intent. Consider extracting to configuration constants: `private readonly MAX_DIFF_LENGTH = 12000; private readonly MAX_TOKENS = 2500;` [src/agents/analysis/technical-debt-agent.ts:67, 30]

## **Potential God Class** [SEVERITY

**Potential God Class** [SEVERITY:low] TechnicalDebtAgent has 417 lines with multiple responsibilities: prompt building, response parsing, wiki generation, and analysis orchestration. While not severe yet, consider extracting PromptBuilder and ResponseParser classes if complexity grows. [src/agents/analysis/technical-debt-agent.ts]

## **Fragile Parsing Logic** [SEVERITY

**Fragile Parsing Logic** [SEVERITY:medium] Response parsing uses multiple regex patterns assuming specific output format from LLM. Brittle to prompt changes or LLM output variations. No validation of parsed results. Consider structured output (JSON) or more robust parsing with error recovery. [src/agents/analysis/technical-debt-agent.ts:128-224]

## **String-Based Pattern Matching** [SEVERITY

**String-Based Pattern Matching** [SEVERITY:low] Uses string matching with `.startsWith('-')` and `.includes('none')` for parsing lists, vulnerable to formatting changes. Consider more structured approach or schema validation. [src/agents/analysis/technical-debt-agent.ts:150-211]

## **Long Method** [SEVERITY

**Long Method** [SEVERITY:low] generateUpdates method (lines 226-304) handles multiple concerns: filtering, content generation, and update object creation. Consider extracting content generation to separate methods. [src/agents/analysis/technical-debt-agent.ts:226-304]

## **Implicit Null Handling** [SEVERITY

**Implicit Null Handling** [SEVERITY:low] Uses optional chaining and nullish coalescing (`match[4]?.split(',') ?? []`) but doesn't explicitly validate all parsing edge cases. Silent failures possible if LLM output format changes. [src/agents/analysis/technical-debt-agent.ts:158]


---
*Updated from commit a286af4b*
