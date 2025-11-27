---
title: "Anti-Patterns to Avoid"
confidence: 1
path: patterns/anti-patterns
---

# Anti-Patterns to Avoid

These patterns have been identified as problematic in the codebase:

## [Magic Number

[Magic Number: 12000] While there's a comment explaining the diff truncation limit, 12000 should be extracted as a named constant (e.g., MAX_DIFF_LENGTH) for maintainability [src/agents/analysis/technical-debt-agent.ts:67]

## [Long Method

[Long Method: parseResponse] The parseResponse method is ~95 lines with repetitive regex parsing logic. Consider extracting helper methods like parseSectionList(response, sectionName) to reduce duplication [src/agents/analysis/technical-debt-agent.ts:126-220]

## [String-Based Section Parsing] Using regex to parse structured LLM output is fragile. Consider requesting JSON-formatted responses for more reliable parsing, or implement a parser combinator pattern [src/agents/analysis/technical-debt-agent.ts

[String-Based Section Parsing] Using regex to parse structured LLM output is fragile. Consider requesting JSON-formatted responses for more reliable parsing, or implement a parser combinator pattern [src/agents/analysis/technical-debt-agent.ts:126-220]


---
*Updated from commit a286af4b*
