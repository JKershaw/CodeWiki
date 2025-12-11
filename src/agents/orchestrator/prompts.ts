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

## Priority Order

1. **Explore undocumented code first** - Target directories marked ⚠️ in coverage tree with codebase-explorer
2. **Build wiki structure** - Create project-overview, getting-started, then category overviews
3. **Improve existing content** - Run writer on shallow pages, link agent on unlinked pages
4. **Document history last** - Analyze commits only after exploration and synthesis

## Agents

**Exploration** (requires targetPath from coverage tree):
- codebase-explorer: Documents code in a directory

**Synthesis** (no target):
- project-overview, getting-started, testing-guide, extension-guide, overview, writer

**Meta** (no target):
- wiki-editor, link, quality, consistency, structure

**Commit Analysis** (requires targetCommitId from context):
- code-change, narrative, security, technical-debt, pattern, dependency

## Budget

Small wikis (0-15 pages): Spend 50%+ on exploration and synthesis. Limit commit analysis to 20%.
Mature wikis (15+ pages): Balance as needed.

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
codebase-explorer,src/agents/orchestrator,Low coverage directory (12 files)
project-overview,,Missing project overview
writer,,3 shallow pages need improvement
code-change,abc123def456,API changes need documentation`;

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

**Action guidance:** Review the Quality Gaps section above for specific pages to improve. Key actions:
${ctx.pendingEditRequests > 0 ? `- Run wiki-editor agent FIRST (${ctx.pendingEditRequests} pending requests)\n` : ''}\
${!ctx.hasProjectOverview ? '- Run project-overview agent (missing)\n' : ''}\
${!ctx.hasGettingStarted ? '- Run getting-started agent (missing)\n' : ''}\
${!ctx.hasTestingGuide && pageCount >= 15 ? '- Run testing-guide agent (missing, 15+ pages)\n' : ''}\
${!ctx.hasExtensionGuide && pageCount >= 15 ? '- Run extension-guide agent (missing, 15+ pages)\n' : ''}\
${ctx.categoriesWithoutOverview.length > 0 ? `- Run overview agent for: ${ctx.categoriesWithoutOverview.join(', ')}\n` : ''}\
${ctx.shallowPages > 0 || ctx.pagesLackingExamples > 0 ? '- Run writer agent on pages listed in Quality Gaps\n' : ''}\
${ctx.pagesWithoutLinks > 0 && ctx.wikiPages > 0 && (ctx.pagesWithoutLinks / ctx.wikiPages) > 0.3 ? '- CRITICAL: >30% pages unlinked, run link agent!\n' : ''}
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
const META_AGENTS = ['wiki-editor', 'link', 'structure', 'quality', 'consistency', 'source-verification', 'category'];
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
