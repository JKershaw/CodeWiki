---
title: "Planning and Development Roadmap"
confidence: 0.5
path: planning/overview
---

# Planning and Development Roadmap

The planning category tracks the project's evolution from initial architectural vision to current implementation state. These documents serve as living artifacts that compare what was originally planned against what has been built, helping maintainers understand which features are complete, which are in progress, and what work remains to reach key milestones.

This category centers on roadmap documents that perform gap analysis between the original PLAN.md architectural specification and the current codebase. The pages document completed foundational work (CQRS patterns, two-loop agent model, repository pattern, analysis and meta agents) while identifying missing pieces (web UI, query interface, MCP server integration) and explicitly deferred features (user accounts, payment systems). These roadmaps organize remaining work into phases aimed at reaching a shareable demo state.

While the four pages appear to cover similar ground with varying titles and confidence levels, they collectively represent the project's strategic planning documentation. They provide essential context for understanding project priorities, architectural decisions, and the path forward for development efforts.

## Key Concepts

- ****Gap Analysis****: Systematic comparison between planned architecture (PLAN.md) and actual implementation to identify what's been built versus what remains
- ****Phased Development****: Organization of remaining work into logical phases that progress toward specific milestones (particularly the "shareable demo" state)
- ****Completed Foundations****: Core architectural patterns already implemented including CQRS, two-loop agent model, repository pattern, and agent systems
- ****Deferred Features****: Explicitly postponed capabilities like authentication and payment systems, with rationale for deferral
- ****Missing Components****: Identified gaps including web UI, query interface, and MCP server that are needed for the project vision

## Pages in this Category

- [Implementation Status and Development Roadmap](planning/implementation-status-and-development-roadmap.md) - Roadmap documenting project status with explicit focus on the two-loop model and analysis agents
- [Project Roadmap and Implementation Status](planning/project-roadmap-and-implementation-status.md) - Core roadmap comparing original vision to current state and identifying path to shareable demo
- [CodeWiki Roadmap and Architecture Status](planning/codewiki-roadmap-and-architecture-status.md) - Roadmap document introduced alongside comprehensive wiki structure documentation
- [Project Status and Development Roadmap](planning/project-status-and-development-roadmap.md) - Detailed status document with phased roadmap emphasizing completed CQRS and gaps in UI/MCP integration

## Suggested Reading Order

All four pages cover similar roadmap content with different emphasis areas and confidence levels (all 50%). Start with "planning/project-roadmap-and-implementation-status" as it appears to be the most direct articulation of the core roadmap. Then review "planning/project-status-and-development-roadmap" for additional detail on the phased approach. The other two pages provide alternative perspectives but cover substantially similar ground - review them if you need to cross-reference specific details or understand how the roadmap has been articulated in different contexts.