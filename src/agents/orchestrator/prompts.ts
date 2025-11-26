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

Key insight: A wiki with good structure and 60% coverage is MORE useful than a wiki with 100% coverage but no structure. Interleave structural work early.

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
- overview: Creates category overview pages. Run when a category has 3+ pages but no overview.
- writer: Rewrites "This commit..." style pages as proper encyclopedia articles. HIGH IMPACT on readability.

## Decision Guidelines

1. First few iterations: Focus on code-change for recent commits to establish base content
2. After 5+ pages exist: Start interleaving meta/synthesis work (20-30% of work)
3. Prefer recent commits over old ones (more relevant to users)
4. Don't run the same meta/synthesis agent twice in a row (diminishing returns)
5. Writer agent has high impact - if pages need rewriting, prioritize it
6. Overview agent makes categories navigable - prioritize when categories have 3+ pages
7. Link agent should run when many pages lack cross-references
8. Only use dependency agent when there are actual dependency file changes

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
  return `${contextString}

## Your Task

Generate up to ${maxItems} work items that would make the wiki most useful right now.

Consider the current state carefully:
- If code-change coverage is low, prioritize getting base content first
- If there are pages needing rewrite (${ctx.pagesNeedingRewrite}), the writer agent will improve readability significantly
- If categories need overviews (${ctx.categoriesWithoutOverview.join(', ') || 'none'}), overview agent helps navigation
- If pages lack links (${ctx.pagesWithoutLinks}), link agent improves discoverability
- Balance: aim for roughly 60-70% analysis work, 30-40% meta/synthesis work once base content exists

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
const SYNTHESIS_AGENTS = ['overview', 'writer'];
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
