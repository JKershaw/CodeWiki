---
title: "Wiki Documentation Philosophy and Architecture"
confidence: 0.50
created: 2025-11-26T15:51:38.290Z
updated: 2025-11-26T15:51:38.290Z
commits: [b49c7432f6392c048e9a70ffabd2d0000bcd2830]
---
# Wiki Documentation Philosophy and Architecture

This commit improves the system's ability to generate high-quality wiki documentation by enhancing both the export functionality and the AI agent prompts. The changes shift the documentation approach from "commit summaries" to "encyclopedia articles," with better link handling, improved index organization, and agent prompts that explicitly discourage commit-centric writing.

## Key Points

- **DESIGN**: The system adopts an "encyclopedia article" approach to documentation rather than commit summaries. Agent prompts now explicitly instruct: "Write as encyclopedia articles, NOT commit summaries" with examples of bad vs. good writing styles.
- **PATTERN**: Wiki export system implements intelligent internal link resolution, automatically adding .md extensions to internal wiki links while preserving external links unchanged. Uses a validation set to distinguish between internal and external references.
- **UX**: Index generation refactored to provide a more user-friendly structure with category descriptions, icons, confidence indicators, and a focus on high-value content rather than exhaustive listings. Commits are de-emphasized and shown last.
- **ARCHITECTURE**: The system separates primary documentation categories (architecture, decisions, security, guides) from low-level commit documentation, establishing a clear hierarchy of documentation value.

## Decisions Made

- Documentation should read as timeless reference material, not historical narratives about commits. Titles should be "CQRS Architecture Decision" not "Commit abc123"
- Internal wiki links need proper .md extensions for GitHub wiki compatibility, requiring intelligent link resolution during export
- Wiki index should prioritize high-confidence, high-value content and provide context/descriptions for categories rather than just listing all pages
- Commits form a separate, lower-priority documentation category since they're typically lower confidence and more granular than curated documentation

## Source Files

- `scripts/export-wiki.ts`
- `src/agents/analysis/code-change-agent.ts`
- `src/agents/analysis/narrative-agent.ts`
- `src/domain/wiki-page.ts`

---
*Captured from commit b49c7432*
