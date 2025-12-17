import type { OrchestratorContext } from './context-gatherer.js';

/**
 * System prompt for the LLM orchestrator.
 *
 * Strategy: "Useful Wiki First"
 * - Document the CURRENT codebase before analyzing commit history
 * - Explore until files are actually documented (not just mentioned)
 * - A wiki that explains how code works TODAY is more useful than a changelog
 */
export const ORCHESTRATOR_SYSTEM_PROMPT = `You are the orchestrator for CodeWiki, generating living documentation from Git repositories.

## Priority Order

1. **Explore undocumented code** - Target directories listed in "Directories Needing Documentation"
2. **Build wiki structure** - Create project-overview, getting-started, then category overviews
3. **Improve existing content** - Run writer on shallow pages, link agent on unlinked pages
4. **Document history last** - Analyze commits only after exploration and synthesis

## Agents

**Exploration** (requires targetPath):
- codebase-explorer: Documents code in a directory

**Synthesis** (no target):
- project-overview, getting-started, testing-guide, extension-guide, overview, writer

**Meta** (no target):
- link, quality, consistency, structure

**Commit Analysis** (requires targetCommitId):
- code-change, narrative, security, technical-debt, pattern, dependency

## Response Format

# Reasoning
One sentence explaining your strategy.

# Work Items
agentType,target,reason

One line per item. Three comma-separated fields:
- agentType: Agent name from lists above
- target: Path for codebase-explorer, commit ID for analysis agents, empty for others
- reason: Brief explanation

Example:
codebase-explorer,src/agents/orchestrator,5/8 files undocumented
project-overview,,Missing project overview
writer,,3 shallow pages need improvement
code-change,abc123def456,API changes need documentation`;

/**
 * Build the user prompt with current context.
 */
export function buildUserPrompt(ctx: OrchestratorContext, contextString: string, maxItems: number): string {
  // Action guidance based on current state
  const actionItems: string[] = [];

  if (ctx.undocumentedDirectories.length > 0) {
    const topDir = ctx.undocumentedDirectories[0]!;
    actionItems.push(`- Explore undocumented directories (${ctx.undocumentedDirectories.length} dirs, top: ${topDir.path})`);
  }
  if (!ctx.hasProjectOverview) {
    actionItems.push('- Run project-overview agent (missing)');
  }
  if (!ctx.hasGettingStarted) {
    actionItems.push('- Run getting-started agent (missing)');
  }
  if (ctx.categoriesWithoutOverview.length > 0) {
    actionItems.push(`- Run overview agent for: ${ctx.categoriesWithoutOverview.join(', ')}`);
  }
  if (ctx.shallowPages > 0 || ctx.pagesLackingExamples > 0) {
    actionItems.push('- Run writer agent on pages listed in Quality Gaps');
  }
  if (ctx.pagesWithoutLinks > 0 && ctx.wikiPages > 0 && (ctx.pagesWithoutLinks / ctx.wikiPages) > 0.3) {
    actionItems.push('- Run link agent (>30% pages unlinked)');
  }

  const actionGuidance = actionItems.length > 0
    ? `**Suggested actions:**\n${actionItems.join('\n')}`
    : '**All key documentation tasks complete.**';

  return `${contextString}

## Your Task

Generate up to ${maxItems} work items that would make the wiki most useful right now.

${actionGuidance}

Prioritize exploration of undocumented code, then synthesis, then quality improvements.
Follow the response format in your instructions.`;
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
const META_AGENTS = ['link', 'structure', 'quality', 'consistency', 'source-verification', 'category'];
const SYNTHESIS_AGENTS = ['overview', 'project-overview', 'getting-started', 'testing-guide', 'extension-guide', 'writer', 'wiki-index', 'toc'];
const ALL_AGENTS = [...EXPLORATION_AGENTS, ...ANALYSIS_AGENTS, ...META_AGENTS, ...SYNTHESIS_AGENTS];

/**
 * Parse the LLM response from markdown format into a structured decision.
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
        const normalizedPath = target.replace(/\/+$/, '');
        if (!normalizedPath.startsWith('src/') && !normalizedPath.startsWith('lib/')) {
          console.warn(`Invalid path for ${agentType}: ${normalizedPath} (must start with src/ or lib/)`);
          continue;
        }
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

/**
 * System prompt for the progress update.
 */
export const PROGRESS_UPDATE_SYSTEM_PROMPT = `You are summarizing progress on wiki documentation generation.

Provide a brief, one-paragraph progress summary that:
1. Estimates overall documentation completeness (as a rough percentage)
2. Identifies the main gaps or areas needing work
3. Forecasts how many more iterations might be needed for comprehensive coverage

Be concise and specific. Focus on actionable insights, not generic statements.`;

/**
 * Build the user prompt for progress update.
 */
export function buildProgressUpdatePrompt(
  ctx: OrchestratorContext,
  workItemsScheduled: number,
  reasoning: string
): string {
  const lines: string[] = [];

  lines.push('## Current Wiki State\n');
  lines.push(`- **Wiki pages:** ${ctx.wikiPages}`);
  lines.push(`- **Average confidence:** ${(ctx.avgConfidence * 100).toFixed(0)}%`);
  lines.push(`- **Total commits:** ${ctx.totalCommits}`);

  // Undocumented directories summary
  if (ctx.undocumentedDirectories.length > 0) {
    const totalUndocumented = ctx.undocumentedDirectories.reduce((sum, d) => sum + d.undocumentedCount, 0);
    lines.push(`- **Undocumented directories:** ${ctx.undocumentedDirectories.length} (${totalUndocumented} files)`);
  }

  // Coverage summary
  const coverageLines: string[] = [];
  for (const [agent, counts] of Object.entries(ctx.commitsByAgent)) {
    if (counts.pending > 0) {
      const pct = ctx.totalCommits > 0
        ? ((counts.processed / ctx.totalCommits) * 100).toFixed(0)
        : '0';
      coverageLines.push(`${agent}: ${pct}% (${counts.pending} pending)`);
    }
  }
  if (coverageLines.length > 0) {
    lines.push(`- **Commit coverage:** ${coverageLines.join(', ')}`);
  }

  // Quality gaps
  const gaps: string[] = [];
  if (!ctx.hasProjectOverview) gaps.push('missing project overview');
  if (!ctx.hasGettingStarted) gaps.push('missing getting started guide');
  if (ctx.shallowPages > 0) gaps.push(`${ctx.shallowPages} shallow pages`);
  if (ctx.pagesWithoutLinks > 0) gaps.push(`${ctx.pagesWithoutLinks} pages without links`);
  if (ctx.categoriesWithoutOverview.length > 0) {
    gaps.push(`${ctx.categoriesWithoutOverview.length} categories without overview`);
  }

  if (gaps.length > 0) {
    lines.push(`- **Quality gaps:** ${gaps.join(', ')}`);
  }

  // What was just scheduled
  lines.push(`\n## Work Just Scheduled`);
  lines.push(`- **Items scheduled:** ${workItemsScheduled}`);
  lines.push(`- **Reasoning:** ${reasoning}`);

  lines.push(`\n## Your Task`);
  lines.push(`Provide a one-paragraph progress summary and forecast. Be specific about what's been accomplished, what gaps remain, and estimate how many more iterations might be needed.`);

  return lines.join('\n');
}
