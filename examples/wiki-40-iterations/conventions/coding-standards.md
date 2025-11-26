---
title: "Coding Standards & Conventions"
confidence: 1.00
created: 2025-11-26T14:51:38.332Z
updated: 2025-11-26T15:08:02.547Z
commits: [fdcf054cda36dcc5761c1e6643612ac701335d75, 659d7dd1c6000904ad6b487a8fd185291854f550, 32b7cb2f4b05e2bc350c284e8be2bb23895bcd0a]
---
# Coding Standards & Conventions

## Observed Conventions

- **Pure Function Convention**: All transformation functions are pure (no side effects). `fixInternalLinks` and `generateIndex` return new data without mutating inputs. This makes code predictable and testable.
- **Module-Level State for Caching**: `validPaths` declared at module level acts as initialization cache. Set once, read many times. Common Node.js pattern for performance optimization.
- **Type Guard Pattern**: URL validation uses explicit checks (`startsWith('http')`, `endsWith('.md')`). Clear, readable conditions rather than complex regex.
- **Array-Based String Building**: Using array + `join('\n')` instead of string concatenation. More performant and readable for multi-line content generation.
- **Emoji-Driven UI**: Confidence indicators (🟢🟡🔴) and category icons (🏗️📋🔒) provide visual scanning. Modern documentation convention for quick comprehension.
- **Explicit Boolean Filtering**: `filter(Boolean)` removes empty strings from arrays. Concise JavaScript idiom for cleaning optional content.
- **Descriptive Helper Functions**: Single-purpose functions with clear names (`capitalize`, `fixInternalLinks`). Each does one thing well.
- **Stats Aggregation Pattern**: Calculate metrics (average confidence) once, use multiple times. Efficient and maintains single source of truth.
- **Narrative Prompt Engineering**: Agent prompts shifted from "analyze and provide" to "write documentation as...". Focus on output format rather than process. More declarative, better results.

---
*Updated from commit b49c7432*
