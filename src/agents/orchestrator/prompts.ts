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

ANALYSIS AGENTS (run on specific commits - require targetCommitId):
- code-change: Basic analysis of what changed. Run this first on new commits.
- narrative: Detects ADRs, planning docs, READMEs. Good for commits with .md files or significant docs.
- security: Security audit. Important for auth, crypto, API, or sensitive changes.
- technical-debt: Identifies code smells, TODOs/FIXMEs, SOLID violations, complexity issues. HIGH VALUE for helping developers know where to tread carefully.
- pattern: Identifies design patterns. Good after code-change has run.
- dependency: Tracks dependency changes. Only useful for package.json/lock file changes.

EXPLORATION AGENTS (run on directories/files - require targetPath, NOT targetCommitId):
- codebase-explorer: Documents undocumented code directories. Use when Directory Coverage shows < 20% coverage for a directory. This agent explores the actual source code (not commits) and creates wiki pages for parts of the codebase that have never been touched by commits. CRITICAL for fixing coverage plateaus.

META AGENTS (run on wiki, not commits - no targetCommitId, no targetPath):
- link: Adds cross-references between pages. Run when pages lack links.
- structure: Analyzes wiki organization. Run periodically when wiki grows.
- quality: Reviews content quality. Run on low-confidence pages.
- consistency: Checks for contradictions. Run when wiki is substantial (10+ pages).

SYNTHESIS AGENTS (create new content from existing - no targetCommitId, no targetPath):
- overview: Creates category overview pages for categories with 3+ pages.
- project-overview: Creates THE project overview at architecture/overview.md. CRITICAL for 10+ pages.
- getting-started: Creates a practical getting started guide at guides/getting-started.md. Run when 10+ pages.
- testing-guide: Creates a testing guide at guides/testing.md explaining test frameworks, patterns, and how to run tests. Run when 15+ pages.
- extension-guide: Creates an extension patterns guide at guides/extension-patterns.md documenting how to add new features. Run when 15+ pages.
- writer: Rewrites "This commit..." style pages as proper encyclopedia articles. HIGH IMPACT on readability.

## Agent Coverage Balance

When selecting analysis agents for commits, ensure diverse coverage:
- If an agent has 0% coverage, prioritize running it on at least one commit
- Aim for balanced coverage across all analysis agents over time
- Don't run the same agent type 5+ times in a row unless others are complete

Example: If code-change is at 50% and security is at 0%, include security work items.

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
- Run testing-guide if guides/testing missing
- Run extension-guide if guides/extension-patterns missing
- Continue writer agent for readability
- Focus on making wiki navigable and useful

## Response Format

Return your response in this exact markdown format:

# Reasoning
Brief explanation of your overall strategy for this batch (1-2 sentences)

# Work Items
agentType,targetCommitId,targetPath,reason for this work item

Examples:
# Reasoning
Focus on building base wiki content with code-change analysis, document undocumented services, then improve readability.

# Work Items
code-change,abc123def456789..,,Recent commit that establishes base wiki content
code-change,def789abc123456..,,Contains API changes that need documentation
codebase-explorer,,src/services/llm,0% coverage - LLM service needs documentation
writer,,,5 pages need rewriting from commit-style to article-style

IMPORTANT:
- One work item per line in the Work Items section
- Format: agentType,targetCommitId,targetPath,reason (comma-separated, reason can contain commas)
- targetCommitId is REQUIRED for analysis agents (code-change, narrative, security, technical-debt, pattern, dependency)
- targetPath is REQUIRED for exploration agents (codebase-explorer) - use the directory path from Directory Coverage section
- BOTH targetCommitId AND targetPath must be EMPTY for meta/synthesis agents (link, structure, quality, consistency, overview, writer, etc.)
- Use the full commit ID from the context, not abbreviated
- When Directory Coverage shows < 20% for a directory, use codebase-explorer with that directory as targetPath`;

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

  // Find agents with 0% coverage that have pending commits
  const coverageGaps = Object.entries(ctx.commitsByAgent)
    .filter(([_, data]) => data.pending > 0 && data.processed === 0)
    .map(([agent]) => agent);

  // Find directories with very low coverage (candidates for codebase-explorer)
  const undocumentedDirs = ctx.directoryCoverage
    .filter(d => d.coveragePercent < 20)
    .slice(0, 5); // Limit to top 5 most undocumented

  return `${contextString}

## Your Task

Generate up to ${maxItems} work items that would make the wiki most useful right now.

**Current wiki size: ${pageCount} pages** - ${synthesisGuidance}

Consider:
- Pages needing rewrite: ${ctx.pagesNeedingRewrite} (writer agent improves readability)
- Categories without overview: ${ctx.categoriesWithoutOverview.join(', ') || 'none'} (overview agent helps navigation)
- Has project overview: ${ctx.hasProjectOverview ? 'YES' : 'NO - run project-overview agent!'}
- Has getting started: ${ctx.hasGettingStarted ? 'YES' : 'NO - run getting-started agent!'}
- Has testing guide: ${ctx.hasTestingGuide ? 'YES' : (pageCount >= 15 ? 'NO - run testing-guide agent!' : 'NO (need 15+ pages)')}
- Has extension guide: ${ctx.hasExtensionGuide ? 'YES' : (pageCount >= 15 ? 'NO - run extension-guide agent!' : 'NO (need 15+ pages)')}
- Pages without links: ${ctx.pagesWithoutLinks} (link agent improves discoverability)
${coverageGaps.length > 0 ? `
**COVERAGE GAPS - agents with 0% coverage:** ${coverageGaps.join(', ')}
Consider including work for these agents to ensure diverse analysis.
` : ''}${undocumentedDirs.length > 0 ? `
**UNDOCUMENTED CODE - use codebase-explorer:**
${undocumentedDirs.map(d => `- ${d.path}: ${d.coveragePercent}% coverage (${d.fileCount} files)`).join('\n')}
Use codebase-explorer with targetPath set to the directory path to document these.
` : ''}
Return your response using the markdown format specified above.`;
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

const ANALYSIS_AGENTS = ['code-change', 'narrative', 'security', 'technical-debt', 'pattern', 'dependency'];
const EXPLORATION_AGENTS = ['codebase-explorer'];
const META_AGENTS = ['link', 'structure', 'quality', 'consistency'];
const SYNTHESIS_AGENTS = ['overview', 'project-overview', 'getting-started', 'testing-guide', 'extension-guide', 'writer'];
const ALL_AGENTS = [...ANALYSIS_AGENTS, ...EXPLORATION_AGENTS, ...META_AGENTS, ...SYNTHESIS_AGENTS];

/**
 * Parse the LLM response from markdown format into a structured decision.
 *
 * Expected format:
 * # Reasoning
 * Brief explanation...
 *
 * # Work Items
 * agentType,targetCommitId,targetPath,reason
 * agentType,commitId,,reason (for analysis agents)
 * agentType,,path,reason (for exploration agents)
 * agentType,,,reason (for meta/synthesis agents)
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

    // Any other header stops the current section (e.g., "## Some other section")
    if (trimmedLine.startsWith('#')) {
      currentSection = 'none';
      continue;
    }

    // Skip empty lines
    if (!trimmedLine) {
      continue;
    }

    if (currentSection === 'reasoning') {
      // Accumulate reasoning text (can be multiple lines)
      reasoning += (reasoning ? ' ' : '') + trimmedLine;
    } else if (currentSection === 'workItems') {
      // Parse work item line: agentType,targetCommitId,targetPath,reason
      // Split into parts
      const parts = trimmedLine.split(',');

      // Determine if this is the new 4-field format or legacy 3-field format
      // New format: agentType,targetCommitId,targetPath,reason
      // Legacy format: agentType,targetCommitId,reason
      // Key insight: in new format, position 2 is targetPath (starts with src/ or similar)
      // In legacy format, position 2 is the reason (arbitrary text)
      const potentialAgentType = parts[0]?.trim() ?? '';
      const potentialCommitId = parts[1]?.trim() ?? '';
      const position2 = parts[2]?.trim() ?? '';

      // Detect new format: targetPath looks like a path (contains / or starts with known prefixes)
      const looksLikePath = position2.startsWith('src/') ||
                           position2.startsWith('lib/') ||
                           position2.startsWith('./') ||
                           (position2.includes('/') && !position2.includes(' '));

      // Use new 4-field format if position 2 looks like a path or if we have 4+ parts with an empty position 2
      const isNewFormat = parts.length >= 4 && (looksLikePath || position2 === '');

      if (!isNewFormat && parts.length >= 3) {
        // Legacy 3-field format for backwards compatibility
        const agentType = potentialAgentType;
        const targetCommitId = potentialCommitId || undefined;
        // Join all remaining parts as the reason (in case reason contains commas)
        const reason = parts.slice(2).join(',').trim() || 'No reason provided';

        if (ALL_AGENTS.includes(agentType)) {
          // Legacy format - no targetPath
          if (ANALYSIS_AGENTS.includes(agentType)) {
            if (targetCommitId && validCommitIds.has(targetCommitId)) {
              validWorkItems.push({ agentType, targetCommitId, reason });
            } else {
              console.warn(`Invalid or missing commit ID for analysis agent ${agentType}`);
            }
          } else {
            validWorkItems.push({ agentType, reason });
          }
          continue;
        }
        console.warn(`Skipping malformed work item line: ${trimmedLine}`);
        continue;
      }

      if (parts.length < 4) {
        console.warn(`Skipping malformed work item line: ${trimmedLine}`);
        continue;
      }

      const agentType = parts[0]!.trim();
      const targetCommitId = parts[1]!.trim() || undefined;
      const targetPath = parts[2]!.trim() || undefined;
      // Join remaining parts as reason (in case reason contains commas)
      const reason = parts.slice(3).join(',').trim() || 'No reason provided';

      // Validate agent type
      if (!ALL_AGENTS.includes(agentType)) {
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
      }

      // Exploration agents need a targetPath
      if (EXPLORATION_AGENTS.includes(agentType)) {
        if (!targetPath) {
          console.warn(`Exploration agent ${agentType} missing targetPath`);
          continue;
        }
      }

      // Meta/synthesis agents should NOT have commit ID or targetPath
      let finalCommitId = targetCommitId;
      let finalTargetPath = targetPath;
      if ([...META_AGENTS, ...SYNTHESIS_AGENTS].includes(agentType)) {
        if (targetCommitId) {
          console.warn(`Meta/synthesis agent ${agentType} should not have targetCommitId`);
          finalCommitId = undefined;
        }
        if (targetPath) {
          console.warn(`Meta/synthesis agent ${agentType} should not have targetPath`);
          finalTargetPath = undefined;
        }
      }

      validWorkItems.push({
        agentType,
        ...(finalCommitId ? { targetCommitId: finalCommitId } : {}),
        ...(finalTargetPath ? { targetPath: finalTargetPath } : {}),
        reason,
      });
    }
  }

  return {
    reasoning: reasoning || 'No reasoning provided',
    workItems: validWorkItems,
  };
}
