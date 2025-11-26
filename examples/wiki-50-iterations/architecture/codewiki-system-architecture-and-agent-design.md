---
title: "CodeWiki System Architecture and Agent Design"
confidence: 0.70
created: 2025-11-26T16:37:32.891Z
updated: 2025-11-26T16:41:32.636Z
commits: [4101e622469a5d339bf5eb0698bdbf008a726454]
---
# CodeWiki System Architecture

CodeWiki is a documentation system that automatically generates and maintains wiki-style documentation from code repository analysis. The system employs a sophisticated multi-agent architecture that balances reliability with intelligent decision-making, transforming raw commit data into polished encyclopedia-style articles.

## Overview

The architecture separates concerns into distinct tiers: commit analysis, content synthesis, and orchestration. This separation enables the system to process code changes systematically while maintaining high-quality documentation output. The design prioritizes reliability and maintainability while incorporating AI-powered optimization capabilities.

## Orchestrator Architecture

The orchestration layer coordinates all documentation generation activities through a dual-mode design that adapts to different operational requirements.

### Dual-Mode Operation

The orchestrator operates in two distinct modes:

**Deterministic Mode** (default): Provides fast, predictable behavior using rule-based decision-making. This mode ensures production stability and consistent results without dependency on external AI services.

**LLM-Powered Mode**: Enables context-aware intelligent decision-making using Claude Haiku 4.5 as the default model. This mode analyzes wiki state, commit coverage, and quality metrics to make optimized orchestration decisions.

The dual-mode design balances competing priorities: deterministic mode guarantees reliability, while LLM-powered mode enables sophisticated optimization based on comprehensive context analysis.

### Fallback Pattern

The system implements a three-tier fallback strategy:

1. LLM orchestration attempts intelligent, context-aware decisions
2. On failure, the system gracefully degrades to deterministic strategy
3. Work continues regardless of AI component availability

This pattern prioritizes reliability over intelligence, ensuring the system remains operational even when AI services are unavailable or fail.

### Context Gathering

Before making orchestration decisions, the system assembles a comprehensive snapshot of wiki state including:

- **Commit coverage metrics**: Which commits have been processed and documented
- **Category organization**: How content is structured across the wiki
- **Page quality indicators**: Metrics identifying pages that need improvement
- **Agent activity history**: Recent work performed by different agents

This context enables data-driven decision-making about which agents to invoke and what content to prioritize.

## Agent Architecture

The system distinguishes between two fundamental agent types, each serving different purposes in the documentation pipeline.

### Analysis Agents

Analysis agents process individual commits to extract information about code changes. These agents:

- Parse commit diffs and metadata
- Identify significant changes and patterns
- Generate initial documentation content
- Create commit-specific pages

Analysis agents operate at the extraction tier, transforming raw code changes into structured information.

### Meta Agents

Meta agents synthesize and improve existing wiki content. Rather than processing commits directly, these agents:

- Review and enhance existing documentation
- Identify quality issues and improvement opportunities
- Transform content presentation and organization
- Create cross-cutting documentation like overviews and guides

This architectural separation enables targeted orchestration strategies and clearer system boundaries.

### Writer Agent

The Writer Agent operates as a specialized meta agent at the synthesis tier. Its purpose is to transform raw, commit-focused content into polished encyclopedia articles.

**Input**: Pages containing commit-style language ("this commit adds", "this PR implements")

**Output**: Encyclopedia-style documentation that explains concepts in present tense, third person

**Detection**: The agent identifies content needing transformation using heuristics that match commit-style phrases and patterns

The Writer Agent reinforces the architectural principle that content generation (analysis) and content presentation (synthesis) are separate concerns.

## Quality Tracking

The system maintains quality indicators to inform orchestration decisions:

- Pages containing commit-style language requiring transformation
- Pages lacking internal links to related content
- Pages with low confidence scores indicating uncertain information
- Categories missing overview pages for navigation

These indicators enable data-driven prioritization of improvement work.

## Documentation Philosophy

CodeWiki enforces an encyclopedia-style writing philosophy throughout the system. Documentation should explain concepts as they exist, not describe the history of how they were added.

**Good**: "The repository pattern provides an abstraction layer between business logic and data persistence."

**Bad**: "This commit adds the repository pattern to abstract data access."

This philosophy is embedded in agent prompts, quality metrics, and the Writer Agent's transformation rules.

## Audit Trail

Every orchestration execution is tracked with comprehensive metadata:

- Complete context snapshot at decision time
- Decisions made and their rationale
- Agent execution results and outputs
- Timestamps and performance metrics

This audit trail enables analysis of orchestration patterns and ongoing system optimization.

## Model Selection

The system uses Claude Haiku 4.5 as the default model for LLM-powered orchestration, chosen for its balance of cost, speed, and capability. This selection optimizes for production usage where orchestration decisions happen frequently.

## Related Documentation

- [Writer Agent Design](writer-agent-design.md) - Detailed specification of content transformation
- [LLM-Powered Orchestrator Architecture](llm-powered-orchestrator-architecture.md) - Deep dive into orchestration logic
- [Wiki Documentation Philosophy and Architecture](../philosophy/wiki-documentation-philosophy-and-architecture.md) - Core principles and guidelines