---
title: "Coding Standards & Conventions"
confidence: 1.00
created: 2025-11-26T16:20:50.206Z
updated: 2025-11-26T16:40:54.664Z
commits: [fdcf054cda36dcc5761c1e6643612ac701335d75, 659d7dd1c6000904ad6b487a8fd185291854f550, 8c4122db9d7409740c297fc6c0f7991838b827d3]
---
# Coding Standards & Conventions

## Observed Conventions

- **Multi-stage validation in link processing**: First check if external (protocol), then if already processed (extension), then if valid internal path. Each check is explicit and documented.
- **TypeScript const assertions for immutability**: `const validPaths: Set<string>` declared at module level but initialized in function. Clear lifecycle management.
- **Descriptive variable naming with context**: `pageTitles`, `validPaths`, `categoryInfo` - plural for collections, suffix indicates content type.
- **Comment style progression**: Start with what (/** Fix internal wiki links */), then how (// Skip external links), then why when non-obvious. Three-tier documentation approach.
- **Configuration over code**: Category metadata moved to data structure with icons and descriptions. New categories can be added without changing logic.
- **Emoji as visual markers**: Consistent use of emoji in wiki content (🟢🟡🔴 for confidence, category icons). Creates visual hierarchy in plain text.
- **Metadata frontmatter pattern**: Each exported page gets structured metadata header (title, confidence, updated date). Enables tooling integration.
- **Error handling by omission**: No explicit error handling in link fixing - invalid links left unchanged rather than throwing. Graceful degradation.

---
*Updated from commit b49c7432*
