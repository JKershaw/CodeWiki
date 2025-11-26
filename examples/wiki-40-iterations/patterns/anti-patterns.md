---
title: "Anti-Patterns to Avoid"
confidence: 1.00
created: 2025-11-26T14:51:38.334Z
updated: 2025-11-26T15:08:02.548Z
commits: [fdcf054cda36dcc5761c1e6643612ac701335d75, 659d7dd1c6000904ad6b487a8fd185291854f550, 32b7cb2f4b05e2bc350c284e8be2bb23895bcd0a]
---
# Anti-Patterns to Avoid

These patterns have been identified as problematic in the codebase:

## **Global Mutable State**

**Global Mutable State**: `validPaths` is module-level mutable (let). While used correctly here (set once before use), it's a footgun - any function could modify it. Consider: `const validPaths = new Set()` with explicit initialization function that returns the set, or pass as parameter. Risk: Hard-to-track bugs if accidentally mutated during processing.

## **Magic Configuration Object**

**Magic Configuration Object**: `categoryInfo` hardcodes category metadata with no validation. If code references a category not in this object, fallback is silent (defaults to 📁 and empty string). Risk: Missing categories silently get poor documentation. Consider: Required category registration or TypeScript enum for valid categories.

## **Truncated Diff**

**Truncated Diff**: The diff truncation at 10000 characters is a magic number with no rationale or configuration. Different projects need different limits. Risk: Critical changes lost in large commits. Consider: Configuration-driven with explanation of why this limit.

## **String-Based Protocol**

**String-Based Protocol**: Agent response parsing relies on specific string markers (PAGE_TITLE:, SUMMARY:). Fragile - small prompt changes break parsing. Better: Structured output format like JSON or YAML with schema validation.


---
*Updated from commit b49c7432*
