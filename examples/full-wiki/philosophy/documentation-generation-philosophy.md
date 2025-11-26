---
title: "Documentation Generation Philosophy"
confidence: 0.50
created: 2025-11-26T12:31:02.663Z
updated: 2025-11-26T12:31:02.663Z
commits: [b49c7432f6392c048e9a70ffabd2d0000bcd2830]
---
# Documentation Generation Philosophy

This commit modifies agent prompts and wiki export functionality to improve output quality. It contains meta-documentation about how the system should generate documentation - essentially documentation about documentation generation. The changes to agent prompts reveal the system's philosophy: write as encyclopedia articles rather than commit summaries.

## Key Points

- **PRINCIPLE**: The system enforces a "write as encyclopedia articles, not commit summaries" philosophy in agent prompts. This is a core design principle about how AI agents should generate documentation.
- **PATTERN**: Agent prompts now explicitly discourage writing "This commit adds..." style summaries and instead encourage "The system implements..." encyclopedia-style articles.
- **FEATURE**: Wiki export now includes link fixing to ensure internal references work correctly (adding .md extensions) and improved index generation with categorized content.
- **UX**: Index generation enhanced with category icons, descriptions, confidence indicators, and better visual hierarchy to make wiki more navigable.

## Decisions Made

- Documentation should be written as standalone encyclopedia articles describing what exists and why, not as summaries of changes or commits
- Agent prompts should explicitly guide toward encyclopedic writing style with "BAD/GOOD" examples
- Wiki pages should focus on "what capability exists" rather than "what was added"
- Internal wiki links should be automatically fixed to include .md extensions for proper GitHub wiki compatibility
- Index pages should provide rich categorization with icons, descriptions, and confidence indicators rather than simple file listings

## Source Files

- `scripts/export-wiki.ts`
- `src/agents/analysis/code-change-agent.ts`
- `src/agents/analysis/narrative-agent.ts`
- `src/domain/wiki-page.ts`

---
*Captured from commit b49c7432*
