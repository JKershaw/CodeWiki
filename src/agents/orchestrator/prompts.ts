import type { OrchestratorContext } from './context-gatherer.js';

/**
 * System prompt for the LLM orchestrator.
 *
 * Philosophy: "Useful Wiki First"
 * - Document the CURRENT codebase before analyzing commit history
 * - A wiki that explains how code works TODAY is more useful than a changelog
 * - Historical context (commits) enriches the wiki but shouldn't be the foundation
 */
export const ORCHESTRATOR_SYSTEM_PROMPT = `You are the orchestrator for CodeWiki, generating living documentation from Git repositories.

## Core Philosophy: "Useful Wiki First"

Document the CURRENT codebase before analyzing history:
1. **Foundation** - What code exists today? (exploration)
2. **Structure** - How is it organized? (synthesis)
3. **History** - How did it evolve? (commit analysis - lower priority)

A useful wiki explains HOW code works NOW with examples, not just WHAT changed in commits.

## Work Priority Tiers

### TIER 1: Build Foundation (highest priority)

**EXPLORATION** - Document undocumented code (require targetPath):
- codebase-explorer: Target directories marked ⚠️ in coverage tree. Larger directories = higher priority.

**KEY SYNTHESIS** - Create essential structure (no target):
- project-overview: Creates THE project overview. CRITICAL - run early if missing.
- getting-started: Creates practical onboarding guide. Run when 5+ pages exist.

### TIER 2: Improve Quality (medium priority)

**META AGENTS** - Fix issues in existing content (no target):
- wiki-editor: Processes pending edit requests. Run FIRST if any pending.
- writer: Transforms shallow/commit-style pages into substantive articles. HIGH IMPACT.
- link: Adds cross-references between pages.
- quality: Reviews content quality, flags shallow pages.
- consistency: Checks for contradictions. Run when 10+ pages.
- structure: Analyzes wiki organization.

**CATEGORY SYNTHESIS** (no target):
- overview: Creates category overview pages for categories with 3+ pages.
- testing-guide: Creates testing guide. Run when 15+ pages.
- extension-guide: Creates extension patterns guide. Run when 15+ pages.

### TIER 3: Add Historical Context (lower priority)

**COMMIT ANALYSIS** - Understand evolution (require targetCommitId):
- code-change: Analyzes what changed with implementation details. Run first on new commits.
- narrative: Detects ADRs, planning docs, READMEs. Good for .md file commits.
- security: Security audit for auth, crypto, API changes.
- technical-debt: Identifies code smells, TODOs, complexity issues.
- pattern: Identifies design patterns with usage examples.
- dependency: Tracks dependency changes. Only for package.json/lock file changes.

## Budget Rules (IMPORTANT)

| Wiki Size    | Exploration | Synthesis/Meta | Commit Analysis |
|--------------|-------------|----------------|-----------------|
| 0-5 pages    | ≥50%        | ≥30%           | ≤20%            |
| 5-15 pages   | ≥30%        | ≥40%           | ≤30%            |
| 15+ pages    | As needed   | As needed      | Remainder       |

**Enforcement**: If coverage tree shows directories with ⚠️, you MUST include exploration work items up to the budget before adding commit analysis.

## Agent Diversity

When selecting commit analysis agents:
- If an agent has 0% coverage, include it to ensure diverse analysis
- Don't run the same agent type 5+ times in a row

## Response Format

# Reasoning
Brief explanation of your strategy for this batch (1-2 sentences)

# Work Items
agentType,target,reason

FORMAT RULES:
- One work item per line
- Format: agentType,target,reason (exactly 3 comma-separated fields)
- target is:
  - A PATH for codebase-explorer (e.g., "src/services/llm")
  - A COMMIT ID for analysis agents (full ID from context)
  - EMPTY for meta/synthesis agents
- Use paths exactly as shown in the Directory Coverage tree

EXAMPLES:
codebase-explorer,src/agents/orchestrator,Low coverage critical directory (12 files)
project-overview,,No architecture overview exists yet
writer,,4 pages have commit-style content needing rewrite
code-change,abc123def456789,Recent API change needs documentation`;

/**
 * Build the user prompt with current context.
 */
export function buildUserPrompt(ctx: OrchestratorContext, contextString: string, maxItems: number): string {
  const pageCount = ctx.wikiPages;
  // Phase guidance aligned with tier structure and budget rules
  const synthesisGuidance = pageCount < 5
    ? 'FOUNDATION PHASE: Budget ≥50% exploration, ≥30% synthesis. Prioritize codebase-explorer on ⚠️ directories, then project-overview.'
    : pageCount < 15
    ? 'GROWTH PHASE: Budget ≥30% exploration, ≥40% synthesis. Fill coverage gaps, create key pages, improve quality with writer agent.'
    : 'MATURE PHASE: Exploration as needed, balance synthesis and history. Deepen shallow pages, add historical context from commits.';

  // Find agents with 0% coverage that have pending commits
  const coverageGaps = Object.entries(ctx.commitsByAgent)
    .filter(([_, data]) => data.pending > 0 && data.processed === 0)
    .map(([agent]) => agent);

  return `${contextString}

## Your Task

Generate up to ${maxItems} work items that would make the wiki most useful right now.

**Current wiki size: ${pageCount} pages** - ${synthesisGuidance}

**Exploration priority:** Review the Directory Coverage tree above. Target directories with ⚠️ (low coverage) for codebase-explorer, prioritizing larger directories first.

Consider:
- Pending edit requests: ${ctx.pendingEditRequests}${ctx.pendingEditRequests > 0 ? ' - run wiki-editor agent FIRST!' : ''}
- Pages needing rewrite: ${ctx.pagesNeedingRewrite} (writer agent improves readability)
- Shallow pages (< 500 chars): ${ctx.shallowPages}${ctx.shallowPages > 0 ? ' - run writer agent to add depth!' : ''}
- Pages without code examples: ${ctx.pagesLackingExamples}${ctx.pagesLackingExamples > 0 ? ' - run writer agent to add examples!' : ''}
- Categories without overview: ${ctx.categoriesWithoutOverview.join(', ') || 'none'} (overview agent helps navigation)
- Has project overview: ${ctx.hasProjectOverview ? 'YES' : 'NO - run project-overview agent!'}
- Has getting started: ${ctx.hasGettingStarted ? 'YES' : 'NO - run getting-started agent!'}
- Has testing guide: ${ctx.hasTestingGuide ? 'YES' : (pageCount >= 15 ? 'NO - run testing-guide agent!' : 'NO (need 15+ pages)')}
- Has extension guide: ${ctx.hasExtensionGuide ? 'YES' : (pageCount >= 15 ? 'NO - run extension-guide agent!' : 'NO (need 15+ pages)')}
- Pages without links: ${ctx.pagesWithoutLinks} (link agent improves discoverability)
${coverageGaps.length > 0 ? `
**COVERAGE GAPS - agents with 0% coverage:** ${coverageGaps.join(', ')}
Consider including work for these agents to ensure diverse analysis.
` : ''}
Follow the response format and budget rules in your instructions for ${pageCount} pages.`;
}

/**
 * Parse and validate the LLM response.
 */
export interface OrchestratorDecision {
  reasoning: string;
  workItems: Array<{
    agentType: string;
    targetCommitId?: string;
    targetPath?: string;
    reason: string;
  }>;
}

// Agent types the LLM can output
const EXPLORATION_AGENTS = ['codebase-explorer'];
const ANALYSIS_AGENTS = ['code-change', 'narrative', 'security', 'technical-debt', 'pattern', 'dependency'];
const META_AGENTS = ['wiki-editor', 'link', 'structure', 'quality', 'consistency'];
const SYNTHESIS_AGENTS = ['overview', 'project-overview', 'getting-started', 'testing-guide', 'extension-guide', 'writer', 'wiki-index', 'toc'];
const ALL_AGENTS = [...EXPLORATION_AGENTS, ...ANALYSIS_AGENTS, ...META_AGENTS, ...SYNTHESIS_AGENTS];

/**
 * Parse the LLM response from markdown format into a structured decision.
 *
 * Expected format:
 * # Reasoning
 * Brief explanation...
 *
 * # Work Items
 * agentType,target,reason
 *
 * Examples:
 * - codebase-explorer,src/services/llm,Low coverage directory
 * - code-change,abc123def456,Recent commit with API changes
 * - writer,,5 pages need rewriting for readability
 */
export function parseOrchestratorResponse(
  response: string,
  validCommitIds: Set<string>,
  validPaths?: Set<string>
): OrchestratorDecision {
  const lines = response.split('\n');
  let reasoning = '';
  const validWorkItems: OrchestratorDecision['workItems'] = [];

  let currentSection: 'none' | 'reasoning' | 'workItems' = 'none';

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Detect section headers
    if (/^#\s*Reasoning/i.test(trimmedLine)) {
      currentSection = 'reasoning';
      continue;
    }
    if (/^#\s*Work\s*Items/i.test(trimmedLine)) {
      currentSection = 'workItems';
      continue;
    }

    // Any other header stops the current section
    if (trimmedLine.startsWith('#')) {
      currentSection = 'none';
      continue;
    }

    // Skip empty lines
    if (!trimmedLine) {
      continue;
    }

    if (currentSection === 'reasoning') {
      reasoning += (reasoning ? ' ' : '') + trimmedLine;
    } else if (currentSection === 'workItems') {
      // Parse work item line: agentType,target,reason (3 fields)
      const parts = trimmedLine.split(',');

      if (parts.length < 3) {
        console.warn(`Skipping malformed work item (need 3 fields): ${trimmedLine}`);
        continue;
      }

      const agentType = parts[0]!.trim();
      const target = parts[1]!.trim() || undefined;
      // Join remaining parts as reason (in case reason contains commas)
      const reason = parts.slice(2).join(',').trim() || 'No reason provided';

      // Validate agent type
      if (!ALL_AGENTS.includes(agentType)) {
        console.warn(`Invalid agent type: ${agentType}`);
        continue;
      }

      // Exploration agents need a valid path
      if (EXPLORATION_AGENTS.includes(agentType)) {
        if (!target) {
          console.warn(`Exploration agent ${agentType} missing targetPath`);
          continue;
        }
        // Normalize path: remove trailing slashes for consistent matching
        const normalizedPath = target.replace(/\/+$/, '');
        // Validate path looks like a directory path (basic check)
        if (!normalizedPath.startsWith('src/') && !normalizedPath.startsWith('lib/')) {
          console.warn(`Invalid path for ${agentType}: ${normalizedPath} (must start with src/ or lib/)`);
          continue;
        }
        // If validPaths has entries, check against it
        // Note: We check size > 0 because an empty Set (from null tree) is truthy
        // and would incorrectly reject all paths
        if (validPaths && validPaths.size > 0 && !validPaths.has(normalizedPath)) {
          console.warn(`Path not found in coverage tree for ${agentType}: ${normalizedPath}`);
          continue;
        }
        validWorkItems.push({ agentType, targetPath: normalizedPath, reason });
        continue;
      }

      // Analysis agents need a valid commit ID
      if (ANALYSIS_AGENTS.includes(agentType)) {
        if (!target) {
          console.warn(`Analysis agent ${agentType} missing targetCommitId`);
          continue;
        }
        if (!validCommitIds.has(target)) {
          console.warn(`Invalid commit ID for ${agentType}: ${target}`);
          continue;
        }
        validWorkItems.push({ agentType, targetCommitId: target, reason });
        continue;
      }

      // Meta/synthesis agents should NOT have target
      if (target) {
        console.warn(`Meta/synthesis agent ${agentType} should not have target (ignoring)`);
      }
      validWorkItems.push({ agentType, reason });
    }
  }

  return {
    reasoning: reasoning || 'No reasoning provided',
    workItems: validWorkItems,
  };
}
