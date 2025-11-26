---
title: "Wiki Export and Distribution Strategy"
confidence: 0.50
created: 2025-11-26T10:18:50.548Z
updated: 2025-11-26T10:18:50.548Z
commits: [fd824f7d59f47b994a77221ff125706c8eaab503]
---
# Wiki Export and Distribution Strategy

This commit introduces a markdown export capability for CodeWiki, making the auto-generated wiki content more accessible and portable. The export script itself represents a meta-documentation decision about how documentation should be consumed and distributed. The commit creates a parallel markdown representation of the existing wiki database content, establishing conventions for file organization and frontmatter structure.

## Key Points

- **DESIGN_DECISION**: Export script (scripts/export-wiki.ts) creates markdown files from wiki database, establishing pattern for documentation portability and human readability. Shows architectural decision to support multiple output formats beyond just database storage.
- **DOCUMENTATION_CONVENTION**: Markdown files organized by category (architecture/, decisions/, planning/, security/, patterns/, conventions/, history/, commits/) mirroring the wiki page categorization scheme. This establishes a canonical taxonomy for documentation types.
- **FRONTMATTER_STANDARD**: Exported files use YAML frontmatter with title, confidence, created/updated dates, and commit references. This makes the markdown files self-documenting and traceable to their source commits.
- **META_DOCUMENTATION**: The exported content includes self-referential documentation - wiki pages about the wiki system itself (agent architecture, iteration quality comparisons). This demonstrates the system's ability to document its own evolution.
- **INDEX_PATTERN**: Presence of index.md suggests navigation/discovery pattern for the exported markdown tree.

## Decisions Made

- Decision to support markdown export as a first-class output format, not just database storage. This enables git-based workflows, static site generation, and offline documentation browsing.
- Decision to preserve wiki metadata (confidence scores, timestamps, commit lineage) in frontmatter rather than just exporting content. This maintains traceability and allows for potential re-import or validation.
- Decision to organize exports by content type (architecture/, decisions/, planning/, etc.) rather than chronologically or by component, establishing a knowledge-centric rather than code-centric organization.
- Decision to include both high-level documentation (architecture, decisions) and low-level artifacts (individual commit pages, security audits) in the export, creating a comprehensive documentation snapshot.
- Implicit decision to make the documentation itself version-controlled and diffable by exporting to markdown in the repo, enabling "documentation as code" practices.

## Source Files

- `examples/real-llm/markdown/architecture/4ec0c546-this-commit-introduces-a-system-of-specialized-ana.md`
- `examples/real-llm/markdown/architecture/a99a4013-this-commit-adds-meta-documentation-comparing-wiki.md`
- `examples/real-llm/markdown/architecture/c69224ba-this-commit-introduces-the-core-processing-pipelin.md`
- `examples/real-llm/markdown/architecture/dependencies.md`
- `examples/real-llm/markdown/commits/15782f7c.md`
- `examples/real-llm/markdown/commits/296d345b.md`
- `examples/real-llm/markdown/commits/2de75bb0.md`
- `examples/real-llm/markdown/commits/4d5def60.md`
- `examples/real-llm/markdown/commits/4ec0c546.md`
- `examples/real-llm/markdown/commits/60a1d836.md`
- `examples/real-llm/markdown/commits/84389967.md`
- `examples/real-llm/markdown/commits/a99a4013.md`
- `examples/real-llm/markdown/commits/adc01766.md`
- `examples/real-llm/markdown/commits/af17f139.md`
- `examples/real-llm/markdown/commits/b908ecb1.md`
- `examples/real-llm/markdown/commits/c69224ba.md`
- `examples/real-llm/markdown/conventions/coding-standards.md`
- `examples/real-llm/markdown/decisions/15782f7c-this-commit-introduces-a-significant-architectural.md`
- `examples/real-llm/markdown/decisions/296d345b-this-commit-documents-a-significant-architectural.md`
- `examples/real-llm/markdown/decisions/60a1d836-this-commit-represents-a-significant-architectural.md`
- `examples/real-llm/markdown/decisions/84389967-this-commit-introduces-a-significant-architectural.md`
- `examples/real-llm/markdown/decisions/af17f139-this-commit-establishes-the-foundational-architect.md`
- `examples/real-llm/markdown/history/adc01766-comprehensive-progress-documentation-update-captur.md`
- `examples/real-llm/markdown/index.md`
- `examples/real-llm/markdown/patterns/anti-patterns.md`
- `examples/real-llm/markdown/planning/4d5def60-this-commit-introduces-comprehensive-meta-document.md`
- `examples/real-llm/markdown/planning/b908ecb1-this-commit-adds-a-comprehensive-project-planning.md`
- `examples/real-llm/markdown/security/audit-15782f7c.md`
- `examples/real-llm/markdown/security/audit-60a1d836.md`
- `examples/real-llm/markdown/security/audit-84389967.md`
- `examples/real-llm/markdown/security/audit-af17f139.md`
- `examples/real-llm/markdown/security/audit-c69224ba.md`
- `examples/real-llm/markdown/security/overview.md`
- `scripts/export-wiki.ts`

---
*Captured from commit fd824f7d*
