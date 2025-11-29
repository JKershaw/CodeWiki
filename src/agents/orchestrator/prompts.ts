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
- technical-debt: Identifies code smells, TODOs/FIXMEs, SOLID violations, complexity issues. HIGH VALUE for helping developers know where to tread carefully.
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

  // Find agents with 0% coverage that have pending commits
  const coverageGaps = Object.entries(ctx.commitsByAgent)
    .filter(([_, data]) => data.pending > 0 && data.processed === 0)
    .map(([agent]) => agent);

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
` : ''}
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

const ANALYSIS_AGENTS = ['code-change', 'narrative', 'security', 'technical-debt', 'pattern', 'dependency'];
const META_AGENTS = ['link', 'structure', 'quality', 'consistency'];
const SYNTHESIS_AGENTS = ['overview', 'project-overview', 'getting-started', 'testing-guide', 'extension-guide', 'writer'];
const ALL_AGENTS = [...ANALYSIS_AGENTS, ...META_AGENTS, ...SYNTHESIS_AGENTS];

/**
 * Attempt to repair common JSON issues from LLM responses.
 * LLMs frequently produce slightly malformed JSON that can be fixed.
 */
function repairJson(jsonStr: string): string {
  let repaired = jsonStr;

  // Remove trailing commas before ] or } (very common LLM error)
  // This regex handles commas followed by optional whitespace before ] or }
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

  // Remove JavaScript-style comments (some LLMs add them)
  repaired = repaired.replace(/\/\/[^\n]*/g, '');
  repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, '');

  // Fix unescaped control characters in strings
  // Process each string to escape problematic characters
  repaired = repaired.replace(/"([^"\\]|\\.)*"/g, (match) => {
    let fixed = match;
    // Escape literal newlines
    if (fixed.includes('\n')) {
      fixed = fixed.replace(/\n/g, '\\n');
    }
    // Escape literal carriage returns
    if (fixed.includes('\r')) {
      fixed = fixed.replace(/\r/g, '\\r');
    }
    // Escape literal tabs
    if (fixed.includes('\t')) {
      fixed = fixed.replace(/\t/g, '\\t');
    }
    return fixed;
  });

  // Handle truncated JSON - try to close open brackets/braces
  // Count open vs close brackets
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let prevChar = '';

  for (const char of repaired) {
    if (char === '"' && prevChar !== '\\') {
      inString = !inString;
    } else if (!inString) {
      if (char === '{') openBraces++;
      else if (char === '}') openBraces--;
      else if (char === '[') openBrackets++;
      else if (char === ']') openBrackets--;
    }
    prevChar = char;
  }

  // If we have unclosed brackets/braces, the JSON was likely truncated
  if (openBraces > 0 || openBrackets > 0) {
    // Try to find a safe truncation point - last complete object in array
    // Look for the last complete "}" that ends a work item
    const lastCompleteItem = repaired.lastIndexOf('}');
    if (lastCompleteItem > 0) {
      // Check if there's content after this that looks like a truncated item
      const afterLastComplete = repaired.slice(lastCompleteItem + 1).trim();
      if (afterLastComplete.startsWith(',') || afterLastComplete === '') {
        // Truncate to the last complete item and close the structure
        repaired = repaired.slice(0, lastCompleteItem + 1);
        // Remove any trailing comma
        repaired = repaired.replace(/,\s*$/, '');
        // Close the workItems array and main object
        repaired += '\n  ]\n}';
      }
    }
  }

  return repaired;
}

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

  // Try to parse the JSON, with repair attempts on failure
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (firstError) {
    // Try to repair common JSON issues and parse again
    const repairedJson = repairJson(jsonStr);
    try {
      parsed = JSON.parse(repairedJson);
      console.log('🔧 Repaired malformed JSON from LLM response');
    } catch (secondError) {
      // Log details for debugging
      console.error('Failed to parse orchestrator response JSON:');
      console.error('  First error:', firstError instanceof Error ? firstError.message : firstError);
      console.error('  Second error (after repair):', secondError instanceof Error ? secondError.message : secondError);
      console.error('  Response length:', response.length);
      console.error('  Original JSON length:', jsonStr.length);
      console.error('  Repaired JSON length:', repairedJson.length);

      // Try to extract error position and show context
      const errorMsg = secondError instanceof Error ? secondError.message : String(secondError);
      const posMatch = errorMsg.match(/position (\d+)/);
      if (posMatch && posMatch[1]) {
        const pos = parseInt(posMatch[1], 10);
        const start = Math.max(0, pos - 100);
        const end = Math.min(repairedJson.length, pos + 50);
        console.error(`  Context around error position ${pos}:`);
        console.error(`    ...${repairedJson.slice(start, pos)}<<<ERROR>>>${repairedJson.slice(pos, end)}...`);
      }

      // Log the last 200 chars to see how the JSON ends
      console.error('  Last 200 chars of repaired JSON:', repairedJson.slice(-200));

      // Throw error to trigger fallback to deterministic mode in caller
      throw new Error(`Failed to parse orchestrator JSON response: ${firstError instanceof Error ? firstError.message : 'Unknown error'}`);
    }
  }

  // Validate structure and extract with proper types
  const reasoning: string = (typeof parsed.reasoning === 'string')
    ? parsed.reasoning
    : 'No reasoning provided';

  const rawWorkItems: unknown[] = Array.isArray(parsed.workItems)
    ? parsed.workItems
    : [];

  // Validate and filter work items
  const validWorkItems: OrchestratorDecision['workItems'] = [];

  for (const rawItem of rawWorkItems) {
    // Type guard for work item structure
    if (typeof rawItem !== 'object' || rawItem === null) {
      continue;
    }

    const item = rawItem as Record<string, unknown>;

    // Check agent type is valid
    if (typeof item.agentType !== 'string' || !ALL_AGENTS.includes(item.agentType)) {
      console.warn(`Invalid agent type: ${item.agentType}`);
      continue;
    }

    const targetCommitId = typeof item.targetCommitId === 'string' ? item.targetCommitId : undefined;

    // Analysis agents need a valid commit ID
    if (ANALYSIS_AGENTS.includes(item.agentType)) {
      if (!targetCommitId) {
        console.warn(`Analysis agent ${item.agentType} missing targetCommitId`);
        continue;
      }
      if (!validCommitIds.has(targetCommitId)) {
        console.warn(`Invalid commit ID for ${item.agentType}: ${targetCommitId}`);
        continue;
      }
    }

    // Meta/synthesis agents should NOT have commit ID
    let finalCommitId = targetCommitId;
    if ([...META_AGENTS, ...SYNTHESIS_AGENTS].includes(item.agentType)) {
      if (targetCommitId) {
        console.warn(`Meta/synthesis agent ${item.agentType} should not have targetCommitId`);
        finalCommitId = undefined;
      }
    }

    const reason = typeof item.reason === 'string' ? item.reason : 'No reason provided';

    validWorkItems.push({
      agentType: item.agentType,
      ...(finalCommitId ? { targetCommitId: finalCommitId } : {}),
      reason,
    });
  }

  return {
    reasoning,
    workItems: validWorkItems,
  };
}
