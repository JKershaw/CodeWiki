---
title: "LLM-Powered Orchestration Architecture"
confidence: 0.70
created: 2025-11-26T15:03:43.572Z
updated: 2025-11-26T15:08:33.009Z
commits: [fdcf054cda36dcc5761c1e6643612ac701335d75]
---
# LLM-Powered Orchestration Architecture

The LLM-Powered Orchestration Architecture enables CodeWiki to make intelligent decisions about work prioritization through an AI-assisted planning system. This architecture allows the orchestrator to analyze the current state of the wiki, identify quality gaps, and strategically sequence agent work based on contextual understanding rather than fixed rules.

## Overview

The orchestrator operates as CodeWiki's central planning system, coordinating specialized agents to maintain and improve wiki content. Unlike traditional task schedulers that follow predetermined patterns, this architecture incorporates large language models to understand context and make nuanced prioritization decisions based on the current state of the documentation.

## Dual-Mode Architecture

The system implements a dual-mode design that balances intelligence with reliability:

**Deterministic Mode** (default): Uses fixed prioritization strategies for predictable, fast operation. This mode follows explicit rules about agent sequencing and work selection, making it suitable for routine operations where speed and consistency matter most.

**LLM-Assisted Mode**: Leverages language models to analyze wiki state and make context-aware decisions. The LLM evaluates factors like content quality, structural gaps, and agent dependencies to determine optimal work ordering. This mode provides adaptability for complex scenarios where rule-based logic would be insufficient.

The architecture includes automatic fallback mechanisms—if LLM-assisted mode fails due to API issues or response parsing errors, the system seamlessly reverts to deterministic mode, ensuring continuous operation.

## Context Gathering System

Decision-making quality depends on comprehensive state awareness. The `ContextGatherer` service produces structured snapshots of the wiki's current condition through the `OrchestratorContext` abstraction:

- **Commit Coverage**: Which code changes have been analyzed, which remain unprocessed
- **Wiki Structure**: Existing pages, their categorization, and interconnections
- **Quality Indicators**: Pages lacking links, low-confidence content, categories without overview pages
- **Agent Activity**: Recent agent runs, their outcomes, and pending work

This separation between context collection and decision-making allows the orchestrator to reason about wiki state without coupling to specific data structures or repositories.

## Agent Type Classification

The architecture defines two fundamental categories of agents:

**Analysis Agents**: Process code commits to extract documentation
- Code Change Agent: Structural modifications and API changes
- Narrative Agent: Feature development and user-facing changes
- Security Agent: Security implications and vulnerabilities
- Pattern Agent: Design patterns and architectural decisions
- Dependency Agent: External dependencies and integration points

**Meta Agents**: Improve wiki structure and quality
- Overview Agent: Generates category overview pages
- [Rewrite Agent](../writer-agent-content-transformation-architecture.md): Transforms commit-focused content into encyclopedia articles
- Link Agent: Establishes connections between related pages
- Consistency Agent: Ensures uniform voice and structure

This classification helps the orchestrator understand agent capabilities and dependencies—for example, meta agents typically require analysis agents to complete their work first.

## Prompt Engineering Structure

The LLM-assisted mode uses carefully structured prompts defined in `prompts.ts`:

The `ORCHESTRATOR_SYSTEM_PROMPT` establishes the orchestrator's role and provides guidelines for decision-making. User prompts include the full `OrchestratorContext` along with specific questions about work prioritization.

The `parseOrchestratorResponse` function handles structured response parsing, extracting agent selections, rationales, and confidence scores from LLM outputs. This structured approach ensures consistent, actionable decisions.

## Audit Trail and Learning

Every orchestrator decision generates an `OrchestratorRun` domain object that serves as an audit trail:

- **Decision Record**: Which agent was selected and why
- **Rationale**: The orchestrator's reasoning for the choice
- **Confidence Score**: How certain the orchestrator was about the decision
- **Actual Outcome**: Whether the predicted work actually occurred

These records enable analysis of orchestrator effectiveness over time. By comparing predicted work with actual outcomes, the system can identify patterns in successful and unsuccessful prioritization decisions.

## Model Selection

The default model for orchestration decisions is `claude-haiku-4-5-20250929`, selected for its balance of:
- **Cost Efficiency**: Orchestration runs frequently; model costs matter
- **Capability**: Sufficient reasoning ability for prioritization tasks
- **Speed**: Fast responses keep the orchestration loop responsive

The model choice can be overridden for scenarios requiring more sophisticated reasoning.

## Quality Indicators

The orchestrator tracks several quality metrics to identify improvement opportunities:

- Pages requiring rewriting (commit-focused language detected)
- Pages lacking outbound links (potential isolation issues)
- Low-confidence content (flagged by analysis agents)
- Categories missing overview pages (structural gaps)

These indicators help the orchestrator focus meta-agent work where it provides the most value.

## Related Concepts

- [Intelligent LLM-Powered Orchestration Architecture](intelligent-llm-powered-orchestration-architecture.md): Evolution of orchestration capabilities
- [Writer Agent Content Transformation Architecture](writer-agent-content-transformation-architecture.md): How the rewrite agent transforms content
- [Writer Agent Synthesis Architecture](writer-agent-synthesis-architecture.md): Multi-page synthesis capabilities

## Implementation

The orchestration system is implemented across several key modules:

- `context-gatherer.ts`: State snapshot generation
- `orchestrator.ts`: Core decision-making logic
- `prompts.ts`: LLM prompt templates and response parsing
- `orchestrator-run.ts`: Domain model for audit records
- `file-orchestrator-run-repository.ts`: Persistence layer for orchestrator decisions

The orchestrator integrates with the CLI through the main command loop, making decisions between agent invocations to maintain continuous improvement of wiki content.