---
title: "Anti-Patterns to Avoid"
confidence: 1.00
created: 2025-11-26T16:20:50.207Z
updated: 2025-11-26T16:40:14.876Z
commits: [fdcf054cda36dcc5761c1e6643612ac701335d75, 659d7dd1c6000904ad6b487a8fd185291854f550, 8c4122db9d7409740c297fc6c0f7991838b827d3]
---
# Anti-Patterns to Avoid

These patterns have been identified as problematic in the codebase:

## **SPARSE_PLACEHOLDER_PAGES** [SEVERITY

**SPARSE_PLACEHOLDER_PAGES** [SEVERITY:medium] Multiple pages contain only brief descriptions rather than full articles. Example: `architecture/multi-agent-system.md` has just overview text. This creates incomplete documentation that doesn't fulfill its purpose. Should trigger Writer Agent to flesh out content. (


---
*Updated from commit 3f14bd3e*
