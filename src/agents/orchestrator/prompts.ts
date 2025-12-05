import type { OrchestratorContext } from './context-gatherer.js';

/**
 * System prompt for the LLM orchestrator.
 *
 * Note: Codebase exploration is handled AUTOMATICALLY before the LLM runs.
 * The LLM only needs to decide on commit analysis, synthesis, and meta work.
 */
export const ORCHESTRATOR_SYSTEM_PROMPT = `You are the orchestrator for CodeWiki, a system that generates living documentation from Git repositories.

Your job is to decide what work to do next to make the wiki most useful. You balance:
- COVERAGE: Has every commit been analyzed?
- STRUCTURE: Does the wiki have good organization and navigation?
- QUALITY: Are pages readable, linked, and confidence-scored?
- DEPTH: Do pages explain HOW things work with examples, not just WHAT exists?
- USEFULNESS: Can someone use this wiki to understand the codebase NOW?

Key insight: A useful wiki balances structure AND depth. Shallow pages that only describe WHAT exists without explaining HOW are less valuable than substantive pages with examples.

## Automatic Codebase Exploration

NOTE: Codebase exploration (documenting undocumented directories) is handled AUTOMATICALLY.
You do NOT need to schedule codebase-explorer work items - the system handles this based on
directory coverage data. Focus your decisions on commit analysis, synthesis, and meta work.

## Available Agents

ANALYSIS AGENTS (run on specific commits - require targetCommitId):
- code-change: Analyzes what changed with implementation details. Include HOW code works, not just WHAT changed. Run this first on new commits.
- narrative: Detects ADRs, planning docs, READMEs. Good for commits with .md files or significant docs.
- security: Security audit. Important for auth, crypto, API, or sensitive changes.
- technical-debt: Identifies code smells, TODOs/FIXMEs, SOLID violations, complexity issues.
- pattern: Identifies design patterns with usage examples and trade-offs. Good after code-change has run.
- dependency: Tracks dependency changes. Only useful for package.json/lock file changes.

META AGENTS (run on wiki, not commits - no targetCommitId):
- wiki-editor: Processes pending edit requests. Run FIRST when there are pending edits.
- link: Adds cross-references between pages. Run when pages lack links.
- structure: Analyzes wiki organization. Run periodically when wiki grows.
- quality: Reviews content quality and flags shallow pages lacking depth. Run on low-confidence or shallow pages.
- consistency: Checks for contradictions. Run when wiki is substantial (10+ pages).

SYNTHESIS AGENTS (create new content from existing - no targetCommitId):
- overview: Creates category overview pages for categories with 3+ pages.
- project-overview: Creates THE project overview at architecture/overview.md. CRITICAL early.
- getting-started: Creates a practical getting started guide. Run when 5+ pages.
- testing-guide: Creates a testing guide. Run when 15+ pages.
- extension-guide: Creates an extension patterns guide. Run when 15+ pages.
- writer: Transforms shallow or commit-style pages into substantive articles with examples. HIGH IMPACT on depth and readability.

## Agent Coverage Balance

When selecting analysis agents for commits, ensure diverse coverage:
- If an agent has 0% coverage, prioritize running it on at least one commit
- Aim for balanced coverage across all analysis agents over time
- Don't run the same agent type 5+ times in a row unless others are complete

## Decision Guidelines (Page-Count Based)

**0-5 pages (Foundation Phase):** Exploration runs automatically. Add early synthesis.
- Start project-overview early if 3+ pages exist
- Goal: Someone can understand "what this code does" NOW

**5-10 pages (Navigability Phase):** Build structure and start commit analysis.
- Run project-overview if architecture/overview doesn't exist
- Run getting-started agent if guides/getting-started doesn't exist
- Run link agent to connect pages
- Start processing RECENT commits (last week) for context
- Ensure early pages include code examples where relevant
- Goal: Wiki is useful for onboarding

**10-20 pages (Enrichment Phase):** Balance synthesis with DEPTH.
- Run overview agent for categories with 3+ pages
- Prioritize adding depth to shallow pages (< 500 chars)
- Run writer agent on pages lacking code examples
- Run quality agent to identify pages needing improvement
- Process commits to add "why" context to existing pages
- Goal: Wiki has substantive, actionable content with examples

**20+ pages (Depth & Historical Phase):** Deepen existing content while backfilling history.
- Prioritize deepening high-value pages that are shallow
- Run writer agent on pages without code examples
- Process older commits for historical context
- Run narrative agent to find ADRs and planning docs
- Run technical-debt agent to identify code smells
- Continue synthesis (testing-guide, extension-guide)
- Goal: Complete documentation with depth AND full history

## Response Format

# Reasoning
Brief explanation of your overall strategy for this batch (1-2 sentences)

# Work Items
agentType,targetCommitId,reason

Examples:
- Analysis agent: code-change,abc123def456789..,Recent commit with API changes
- Meta/synthesis agent: writer,,5 pages need rewriting for readability

FORMAT RULES:
- One work item per line
- Format: agentType,targetCommitId,reason (3 comma-separated fields)
- targetCommitId is REQUIRED for analysis agents (code-change, narrative, security, technical-debt, pattern, dependency)
- targetCommitId must be EMPTY for meta/synthesis agents (writer, overview, project-overview, link, etc.)
- Use the full commit ID from the context, not abbreviated`;

/**
 * Build the user prompt with current context.
 */
export function buildUserPrompt(ctx: OrchestratorContext, contextString: string, maxItems: number): string {
  const pageCount = ctx.wikiPages;
  const synthesisGuidance = pageCount < 5
    ? 'FOUNDATION PHASE: Exploration runs automatically. Focus on early synthesis (project-overview if 3+ pages).'
    : pageCount < 10
    ? 'NAVIGABILITY PHASE: Create project-overview and getting-started if missing. Start processing recent commits. Ensure early pages have examples.'
    : pageCount < 20
    ? 'ENRICHMENT PHASE: Prioritize DEPTH - add examples to shallow pages. Run writer agent on pages lacking code examples.'
    : 'DEPTH & HISTORICAL PHASE: Deepen shallow pages while backfilling commit history. Prioritize pages without examples.';

  // Find agents with 0% coverage that have pending commits
  const coverageGaps = Object.entries(ctx.commitsByAgent)
    .filter(([_, data]) => data.pending > 0 && data.processed === 0)
    .map(([agent]) => agent);

  return `${contextString}

## Your Task

Generate up to ${maxItems} work items that would make the wiki most useful right now.

NOTE: Codebase exploration is handled automatically - focus on commit analysis, synthesis, and meta work.

**Current wiki size: ${pageCount} pages** - ${synthesisGuidance}

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
Return your response using the format: agentType,targetCommitId,reason`;
}

/**
 * Parse and validate the LLM response.
 */
export interface OrchestratorDecision {
  reasoning: string;
  workItems: Array<{
    agentType: string;
    targetCommitId?: string;
    reason: string;
  }>;
}

// Agent types the LLM can output (codebase-explorer is handled automatically)
const ANALYSIS_AGENTS = ['code-change', 'narrative', 'security', 'technical-debt', 'pattern', 'dependency'];
const META_AGENTS = ['wiki-editor', 'link', 'structure', 'quality', 'consistency'];
const SYNTHESIS_AGENTS = ['overview', 'project-overview', 'getting-started', 'testing-guide', 'extension-guide', 'writer', 'wiki-index', 'toc'];
const ALL_AGENTS = [...ANALYSIS_AGENTS, ...META_AGENTS, ...SYNTHESIS_AGENTS];

/**
 * Parse the LLM response from markdown format into a structured decision.
 *
 * Expected format (simplified - no more codebase-explorer):
 * # Reasoning
 * Brief explanation...
 *
 * # Work Items
 * agentType,targetCommitId,reason
 *
 * Examples:
 * - code-change,abc123def456,Recent commit with API changes
 * - writer,,5 pages need rewriting for readability
 */
export function parseOrchestratorResponse(
  response: string,
  validCommitIds: Set<string>
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
      // Parse work item line: agentType,targetCommitId,reason (3 fields)
      const parts = trimmedLine.split(',');

      if (parts.length < 3) {
        console.warn(`Skipping malformed work item (need 3 fields): ${trimmedLine}`);
        continue;
      }

      const agentType = parts[0]!.trim();
      const targetCommitId = parts[1]!.trim() || undefined;
      // Join remaining parts as reason (in case reason contains commas)
      const reason = parts.slice(2).join(',').trim() || 'No reason provided';

      // Validate agent type
      if (!ALL_AGENTS.includes(agentType)) {
        // Skip codebase-explorer silently - it's handled automatically
        if (agentType === 'codebase-explorer') {
          continue;
        }
        console.warn(`Invalid agent type: ${agentType}`);
        continue;
      }

      // Analysis agents need a valid commit ID
      if (ANALYSIS_AGENTS.includes(agentType)) {
        if (!targetCommitId) {
          console.warn(`Analysis agent ${agentType} missing targetCommitId`);
          continue;
        }
        if (!validCommitIds.has(targetCommitId)) {
          console.warn(`Invalid commit ID for ${agentType}: ${targetCommitId}`);
          continue;
        }
        validWorkItems.push({ agentType, targetCommitId, reason });
        continue;
      }

      // Meta/synthesis agents should NOT have commit ID
      if (targetCommitId) {
        console.warn(`Meta/synthesis agent ${agentType} should not have targetCommitId (ignoring)`);
      }
      validWorkItems.push({ agentType, reason });
    }
  }

  return {
    reasoning: reasoning || 'No reasoning provided',
    workItems: validWorkItems,
  };
}
