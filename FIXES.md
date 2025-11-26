# Wiki Quality Fixes

Based on analysis of generated wikis, these fixes improve usefulness for AI coding agents.

## Problem Summary

The current wiki:
- Is too commit-focused (10/17 pages are raw commits)
- Lacks project overview ("what is this system?")
- Has no getting started guide
- Index is just a list, not an introduction
- Synthesis triggers too late (60% coverage = hundreds of iterations for large repos)

## Fixes

### Fix 1: Improve Index Generation

The index should explain the project, not just list pages.

**Change:** Update `scripts/export-wiki.ts` to:
- Include project description from wiki content
- Add quick start section
- Show architecture overview link prominently
- Collapse commits into "Recent Changes" section

### Fix 2: Adjust Orchestrator Synthesis Triggers

Replace percentage-based triggers with page-count triggers:
- After **5 pages**: Start interleaving synthesis work (20% of iterations)
- After **10 pages**: Increase synthesis priority (30% of iterations)
- After **15 pages**: Require project overview if missing

This ensures even large repos (1000+ commits) get useful synthesis early.

### Fix 3: Project Overview Agent

Create an agent that synthesizes a single "what is this project" page.

**Trigger:** When wiki has 15+ pages but no `architecture/overview.md`

**Output:** A page explaining:
- What the project is
- Main components and how they connect
- Key abstractions
- Entry points

### Fix 4: Getting Started Agent (from PLAN.md "Guide Agent")

Create an agent for entry point documentation.

**Trigger:** When wiki has 10+ pages but no `guides/getting-started.md`

**Output:**
- How to run the project
- Key commands
- Important files to understand first

## Implementation Order

1. Fix 2: Orchestrator triggers (enables earlier synthesis)
2. Fix 1: Index generation (immediate visual improvement)
3. Fix 3: Project Overview Agent (fills biggest gap)
4. Fix 4: Getting Started Agent (completes the picture)
