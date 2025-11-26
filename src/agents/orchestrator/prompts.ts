import type { OrchestratorContext } from './context-gatherer.js';

/**
 * System prompt for the LLM orchestrator.
 */
export const ORCHESTRATOR_SYSTEM_PROMPT = `You are the orchestrator for CodeWiki, a system that generates living documentation from Git repositories.

Your job is to decide what work to do next to make the wiki most useful. You balance:
- COVERAGE: Has every commit been analyzed?
- STRUCTURE: Does the wiki have good organization and navigation?
- QUALITY: Are pages readable, linked, and confidence-scored?
- USEFULNESS: Can someone use this wiki to understand the codebase NOW?

Key insight: A useful wiki with good structure beats comprehensive coverage. An AI coding agent needs to understand the project quickly, not read every commit. Prioritize synthesis early.

## Available Agents

ANALYSIS AGENTS (run on specific commits):
- code-change: Basic analysis of what changed. Run this first on new commits.
- narrative: Detects ADRs, planning docs, READMEs. Good for commits with .md files or significant docs.
- security: Security audit. Important for auth, crypto, API, or sensitive changes.
- pattern: Identifies design patterns. Good after code-change has run.
- dependency: Tracks dependency changes. Only useful for package.json/lock file changes.

META AGENTS (run on wiki, not commits - no targetCommitId):
- link: Adds cross-references between pages. Run when pages lack links.
- structure: Analyzes wiki organization. Run periodically when wiki grows.
- quality: Reviews content quality. Run on low-confidence pages.
- consistency: Checks for contradictions. Run when wiki is substantial (10+ pages).

SYNTHESIS AGENTS (create new content from existing - no targetCommitId):
- overview: Creates category overview pages for categories with 3+ pages.
- project-overview: Creates THE project overview at architecture/overview.md. CRITICAL for 10+ pages.
- getting-started: Creates a practical getting started guide at guides/getting-started.md. Run when 10+ pages.
- writer: Rewrites "This commit..." style pages as proper encyclopedia articles. HIGH IMPACT on readability.

## Decision Guidelines (Page-Count Based)

These thresholds ensure even large repos (1000+ commits) get useful synthesis early:

**0-5 pages:** Focus on code-change to build base content (100% analysis)

**5-10 pages:** Start synthesis work (70% analysis, 30% meta/synthesis)
- Run writer agent on pages needing rewrite
- Run link agent to connect pages
- Start pattern/narrative analysis

**10-15 pages:** Increase synthesis priority (50% analysis, 50% meta/synthesis)
- Run overview agent for categories with 3+ pages
- Run project-overview agent if architecture/overview doesn't exist
- Run getting-started agent if guides/getting-started doesn't exist
- Ensure pages are cross-linked
- Quality reviews become valuable

**15+ pages:** Wiki needs strong synthesis (40% analysis, 60% meta/synthesis)
- PRIORITIZE project-overview if architecture/overview missing
- PRIORITIZE getting-started if guides/getting-started missing
- Continue writer agent for readability
- Focus on making wiki navigable and useful

## Response Format

Return valid JSON with this exact structure:
{
  "reasoning": "Brief explanation of your overall strategy for this batch",
  "workItems": [
    {
      "agentType": "code-change",
      "targetCommitId": "abc123def456...",
      "reason": "Recent commit, establishes base wiki content"
    },
    {
      "agentType": "writer",
      "reason": "5 pages need rewriting from commit-style to article-style"
    }
  ]
}

IMPORTANT:
- targetCommitId is REQUIRED for analysis agents (code-change, narrative, security, pattern, dependency)
- targetCommitId must be OMITTED for meta/synthesis agents (link, structure, quality, consistency, overview, writer)
- Use the full commit ID from the context, not abbreviated
- Provide 1-2 sentence reasoning for each work item`;

/**
 * Build the user prompt with current context.
 */
export function buildUserPrompt(ctx: OrchestratorContext, contextString: string, maxItems: number): string {
  const pageCount = ctx.wikiPages;
  const synthesisGuidance = pageCount < 5
    ? 'Focus entirely on code-change analysis to build base content.'
    : pageCount < 10
    ? 'Mix in synthesis work (writer, link agents) - aim for 70% analysis, 30% synthesis.'
    : pageCount < 15
    ? 'Balanced approach - 50% analysis, 50% synthesis. Run overview agent for categories with 3+ pages.'
    : 'Prioritize synthesis and overview - 40% analysis, 60% synthesis. Project overview is critical if missing.';

  return `${contextString}

## Your Task

Generate up to ${maxItems} work items that would make the wiki most useful right now.

**Current wiki size: ${pageCount} pages** - ${synthesisGuidance}

Consider:
- Pages needing rewrite: ${ctx.pagesNeedingRewrite} (writer agent improves readability)
- Categories without overview: ${ctx.categoriesWithoutOverview.join(', ') || 'none'} (overview agent helps navigation)
- Has project overview: ${ctx.hasProjectOverview ? 'YES' : 'NO - run project-overview agent!'}
- Has getting started: ${ctx.hasGettingStarted ? 'YES' : 'NO - run getting-started agent!'}
- Pages without links: ${ctx.pagesWithoutLinks} (link agent improves discoverability)

Return your response as valid JSON.`;
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

const ANALYSIS_AGENTS = ['code-change', 'narrative', 'security', 'pattern', 'dependency'];
const META_AGENTS = ['link', 'structure', 'quality', 'consistency'];
const SYNTHESIS_AGENTS = ['overview', 'project-overview', 'getting-started', 'writer'];
const ALL_AGENTS = [...ANALYSIS_AGENTS, ...META_AGENTS, ...SYNTHESIS_AGENTS];

/**
 * Parse the LLM response into a structured decision.
 */
export function parseOrchestratorResponse(
  response: string,
  validCommitIds: Set<string>
): OrchestratorDecision {
  // Try to extract JSON from the response
  let jsonStr = response;

  // Handle markdown code blocks
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1]!;
  }

  // Try to find JSON object
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }

  const parsed = JSON.parse(jsonStr);

  // Validate structure
  if (!parsed.reasoning || typeof parsed.reasoning !== 'string') {
    parsed.reasoning = 'No reasoning provided';
  }

  if (!Array.isArray(parsed.workItems)) {
    parsed.workItems = [];
  }

  // Validate and filter work items
  const validWorkItems: OrchestratorDecision['workItems'] = [];

  for (const item of parsed.workItems) {
    // Check agent type is valid
    if (!ALL_AGENTS.includes(item.agentType)) {
      console.warn(`Invalid agent type: ${item.agentType}`);
      continue;
    }

    // Analysis agents need a valid commit ID
    if (ANALYSIS_AGENTS.includes(item.agentType)) {
      if (!item.targetCommitId) {
        console.warn(`Analysis agent ${item.agentType} missing targetCommitId`);
        continue;
      }
      if (!validCommitIds.has(item.targetCommitId)) {
        console.warn(`Invalid commit ID for ${item.agentType}: ${item.targetCommitId}`);
        continue;
      }
    }

    // Meta/synthesis agents should NOT have commit ID
    if ([...META_AGENTS, ...SYNTHESIS_AGENTS].includes(item.agentType)) {
      if (item.targetCommitId) {
        console.warn(`Meta/synthesis agent ${item.agentType} should not have targetCommitId`);
        delete item.targetCommitId;
      }
    }

    validWorkItems.push({
      agentType: item.agentType,
      targetCommitId: item.targetCommitId,
      reason: item.reason || 'No reason provided',
    });
  }

  return {
    reasoning: parsed.reasoning,
    workItems: validWorkItems,
  };
}
