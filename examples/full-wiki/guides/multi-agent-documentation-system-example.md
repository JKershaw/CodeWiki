---
title: "Multi-Agent Documentation System Example"
confidence: 0.50
created: 2025-11-26T12:31:27.441Z
updated: 2025-11-26T12:31:27.441Z
commits: [82193f9f7b498e2cc88343292d554153c757775f]
---
# Multi-Agent Documentation System Example

This commit adds a comprehensive example wiki that demonstrates the complete multi-agent documentation system in action. The example itself IS the meta-documentation - it shows how the tool works by example, includes detailed statistics about agent usage, and documents the architecture through the generated wiki content. The SUMMARY.md provides a complete overview of the system's capabilities and design.

## Key Points

- **EXAMPLE**: Complete working example demonstrating 9-agent architecture (5 analysis agents: code-change, narrative, security, pattern, dependency; 4 meta agents: link, structure, quality, consistency) processing 16 commits to generate 41 wiki pages. Shows the full pipeline from commit analysis to wiki generation.
- **ARCHITECTURE**: System uses two-phase architecture: Phase 1 (analysis agents process commits individually), Phase 2 (meta agents process the generated wiki for cross-references, structure, quality, consistency). Demonstrates separation of concerns between content generation and wiki refinement.
- **METRICS**: Performance metrics documented: 16 commits analyzed, 41 pages generated, 56.1% average confidence, ~$2.50 total cost. Link agent ran 17 times (once per commit + once for meta), other meta agents ran once each. Provides real-world cost and performance expectations.
- **DESIGN_PATTERN**: Wiki organization follows category-based structure: architecture/, commits/, conventions/, decisions/, guides/, history/, patterns/, planning/, security/. Each category serves specific documentation purpose. Commits get individual pages, synthesized content goes in thematic categories.
- **FEATURE**: Link agent adds "Related Pages" sections for cross-references, security findings get aggregated into overview page, patterns extracted into dedicated pages, consistency checks identify 75 issues (mostly orphaned pages needing links). Demonstrates meta-agent value.

## Decisions Made

- Decision to use 9 specialized agents rather than fewer general-purpose ones, enabling focused expertise (5 for commit analysis, 4 for wiki meta-processing)
- Decision to run analysis agents on every commit but meta agents only once or strategically (link agent per commit + final, others final only)
- Decision to organize wiki by content type (architecture, decisions, security, etc.) rather than chronologically or by component
- Decision to track confidence scores and costs, making system transparency and economics visible
- Decision to auto-generate commit pages at commits/{sha} while synthesizing higher-level docs in thematic categories
- Decision to include working example as primary documentation/validation of the system itself

## Source Files

- `examples/full-wiki/SUMMARY.md`
- `examples/full-wiki/architecture/core-processing-pipeline-architecture.md`
- `examples/full-wiki/architecture/dependencies.md`
- `examples/full-wiki/architecture/multi-agent-analysis-architecture.md`
- `examples/full-wiki/architecture/web-interface-and-e2e-testing-architecture.md`
- `examples/full-wiki/architecture/wiki-export-and-distribution-strategy.md`
- `examples/full-wiki/commits/15782f7c.md`
- `examples/full-wiki/commits/296d345b.md`
- `examples/full-wiki/commits/2de75bb0.md`
- `examples/full-wiki/commits/4d2e0c45.md`
- `examples/full-wiki/commits/4d5def60.md`
- `examples/full-wiki/commits/4ec0c546.md`
- `examples/full-wiki/commits/60a1d836.md`
- `examples/full-wiki/commits/82525543.md`
- `examples/full-wiki/commits/84389967.md`
- `examples/full-wiki/commits/a99a4013.md`
- `examples/full-wiki/commits/adc01766.md`
- `examples/full-wiki/commits/af17f139.md`
- `examples/full-wiki/commits/b908ecb1.md`
- `examples/full-wiki/commits/c69224ba.md`
- `examples/full-wiki/commits/cd3ba217.md`
- `examples/full-wiki/commits/fd824f7d.md`
- `examples/full-wiki/conventions/coding-standards.md`
- `examples/full-wiki/decisions/anthropic-claude-llm-integration-decision.md`
- `examples/full-wiki/decisions/cqrs-architecture-decision.md`
- `examples/full-wiki/decisions/meta-agent-architecture-link-agent.md`
- `examples/full-wiki/decisions/multi-agent-processing-architecture.md`
- `examples/full-wiki/decisions/research-agent-and-mcp-integration.md`
- `examples/full-wiki/decisions/structure-agent-and-page-naming.md`
- `examples/full-wiki/guides/wiki-iteration-quality-examples.md`
- `examples/full-wiki/history/multi-agent-processing-examples.md`
- `examples/full-wiki/history/project-progress-and-architectural-decisions.md`
- `examples/full-wiki/index.md`
- `examples/full-wiki/patterns/anti-patterns.md`
- `examples/full-wiki/planning/codewiki-project-plan-and-architecture.md`
- `examples/full-wiki/planning/project-status-and-browser-testing-decisions.md`
- `examples/full-wiki/security/audit-15782f7c.md`
- `examples/full-wiki/security/audit-60a1d836.md`
- `examples/full-wiki/security/audit-84389967.md`
- `examples/full-wiki/security/audit-af17f139.md`
- `examples/full-wiki/security/audit-c69224ba.md`
- `examples/full-wiki/security/audit-fd824f7d.md`
- `examples/full-wiki/security/overview.md`

---
*Captured from commit 82193f9f*
