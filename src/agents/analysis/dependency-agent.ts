import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isCommitTarget, extractToolMetrics } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { createGetCommitQuery, handleGetCommit } from '../../queries/index.js';
import { getCommitDiff, createCodebaseToolExecutor, fetchAffectedFileContents, formatFetchedFilesForContext } from '../agent-helpers.js';
import {
  createParseContext,
  parseSection,
  parseChoice,
  parseListItemsWithFallback,
  parseStringList,
  parseBlocks,
  parseConfidence,
  type ItemPattern,
} from '../parsing/index.js';

/**
 * Dependency Agent - Tracks external dependency changes and their implications.
 *
 * OPTIMIZATION: Pre-fetches affected file contents and includes them directly in
 * the prompt, reducing tool calls. Falls back to tool-based approach only if
 * context would exceed limits.
 *
 * This agent analyzes package.json, lock files, and import statements
 * to understand dependency changes, version updates, and their impact.
 */
export class DependencyAgent implements Agent {
  readonly type: AgentType = 'dependency';

  private readonly MAX_FILE_SIZE = 30000;
  private readonly MAX_TOTAL_SIZE = 80000;

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isCommitTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isCommitTarget(target)) {
      throw new Error(`DependencyAgent cannot handle target type: ${target.type}`);
    }
    const commitId = target.commitId;

    // Get commit via CQRS query
    const query = createGetCommitQuery(commitId);
    const result = await handleGetCommit(query, context.repos);
    if (!result.success || !result.data) {
      throw new Error(`Commit not found: ${commitId}`);
    }
    const commit = result.data;

    // Check if this commit touches dependency files
    const isDependencyRelated = this.hasDependencyChanges(commit.diffSummary.affectedFiles);

    if (!isDependencyRelated) {
      // No dependency changes, return minimal result
      return {
        result: createAgentResult({
          summary: 'No dependency changes in this commit.',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    const diff = await getCommitDiff(context, commit.sha);

    // Try pre-fetch approach first
    if (context.repoAccess && commit.diffSummary.affectedFiles.length > 0) {
      const prefetchResult = await this.runWithPrefetch(commit, diff, context);
      if (prefetchResult) {
        return prefetchResult;
      }
    }

    return this.runWithTools(commit, diff, context);
  }

  private async runWithPrefetch(
    commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } },
    diff: string,
    context: AgentContext
  ): Promise<AgentRunResult | null> {
    const fetchedFiles = await fetchAffectedFileContents(
      context,
      commit.diffSummary.affectedFiles,
      this.MAX_FILE_SIZE,
      this.MAX_TOTAL_SIZE
    );

    const filesWithContent = fetchedFiles.filter(f => f.content !== null);
    if (filesWithContent.length === 0) {
      return null;
    }

    const fileContext = formatFetchedFilesForContext(fetchedFiles, '## Full File Contents');
    const prompt = this.buildPrefetchPrompt(commit, diff, fileContext);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT_PREFETCH,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
      temperature: 0.2,
    });

    const analysis = this.parseResponse(completion.content);
    const updates = this.generateUpdates(commit, analysis);

    return {
      result: createAgentResult({
        summary: analysis.summary,
        findings: analysis.findings.map(f => createFinding({
          type: f.type,
          description: f.description,
          relatedPaths: f.paths,
          importance: f.importance,
        })),
        confidence: analysis.confidence,
      }),
      updates,
      costUsd: completion.costUsd,
      toolMetrics: { toolCallCount: 0, toolsUsed: {}, filesRead: commit.diffSummary.affectedFiles },
    };
  }

  private async runWithTools(
    commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } },
    diff: string,
    context: AgentContext
  ): Promise<AgentRunResult> {
    const prompt = this.buildPrompt(commit, diff);
    const toolExecutor = createCodebaseToolExecutor(context);

    const completion = await context.llm.completeWithTools({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      tools: toolExecutor?.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })) ?? [],
      executeTools: toolExecutor?.executeTools ?? (async () => []),
      maxToolRounds: 3,
      maxTokens: 2000,
      temperature: 0.2,
    });

    const analysis = this.parseResponse(completion.content);
    const updates = this.generateUpdates(commit, analysis);

    return {
      result: createAgentResult({
        summary: analysis.summary,
        findings: analysis.findings.map(f => createFinding({
          type: f.type,
          description: f.description,
          relatedPaths: f.paths,
          importance: f.importance,
        })),
        confidence: analysis.confidence,
      }),
      updates,
      costUsd: completion.costUsd,
      toolMetrics: extractToolMetrics(completion),
    };
  }

  private hasDependencyChanges(files: string[]): boolean {
    const dependencyFiles = [
      'package.json',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'requirements.txt',
      'Pipfile',
      'Pipfile.lock',
      'pyproject.toml',
      'poetry.lock',
      'Gemfile',
      'Gemfile.lock',
      'go.mod',
      'go.sum',
      'Cargo.toml',
      'Cargo.lock',
      'composer.json',
      'composer.lock',
    ];

    return files.some(f => dependencyFiles.some(df => f.endsWith(df)));
  }

  private buildPrompt(commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } }, diff: string): string {
    const truncatedDiff = diff.length > 15000 ? diff.slice(0, 15000) + '\n... (diff truncated)' : diff;

    return `Analyze this commit for dependency changes and their implications.

## Commit Information

**SHA:** ${commit.sha.slice(0, 8)}
**Message:** ${commit.message}
**Author:** ${commit.authorName}
**Date:** ${commit.committedAt.toISOString()}
**Files Changed:** ${commit.diffSummary.affectedFiles.length}

## Affected Files

${commit.diffSummary.affectedFiles.map(f => `- ${f}`).join('\n')}

## Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

## Available Tools

You have access to tools to explore the source code:
- **read_file**: Read package.json, lock files, or import statements
- **search_files**: Find where dependencies are actually used
- **list_directory**: Explore the project structure

**Use these tools to**:
- Read the full package.json to understand the dependency context
- Search for imports of new dependencies to understand how they're used
- Find configuration files related to dependencies
- Verify what the dependency is actually used for in the codebase

Analyze for:
1. New dependencies added (name, version, purpose)
2. Dependencies removed
3. Version updates (major, minor, patch)
4. Breaking change potential
5. Security implications of dependency changes
6. License considerations
7. Bundle size impact
8. Alternative packages that were considered

Format your response as:

SUMMARY:
[Brief summary of dependency changes]

CHANGES:
- action: ADDED | package: express | version: ^4.17.0 | reason: Express web framework
- action: REMOVED | package: lodash | reason: No longer needed
- action: UPDATED | package: typescript | version: 4.9.0 -> 5.0.0 | reason: New features

BREAKING_CHANGES:
- [Description of potential breaking changes, or "None"]

SECURITY_NOTES:
- [Security considerations, or "None"]

IMPACT: minimal/moderate/significant

DEPENDENCY_DETAILS:
=== package: express ===
PURPOSE: [What this dependency does and why it was chosen]
USAGE: [How it's used in the codebase]
CONSIDERATIONS: [Important notes, version constraints, alternatives]
=== END ===

CONFIDENCE: [0-1 value]
`;
  }

  private buildPrefetchPrompt(
    commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } },
    diff: string,
    fileContext: string
  ): string {
    const truncatedDiff = diff.length > 12000 ? diff.slice(0, 12000) + '\n... (diff truncated)' : diff;

    return `Analyze this commit for dependency changes and their implications.

## Commit Information

**SHA:** ${commit.sha.slice(0, 8)}
**Message:** ${commit.message}
**Author:** ${commit.authorName}
**Date:** ${commit.committedAt.toISOString()}
**Files Changed:** ${commit.diffSummary.affectedFiles.length}

## Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

${fileContext}

## Analysis Instructions

The full contents of dependency files (package.json, lock files, etc.) are provided above. Use them to:
- Identify added, removed, and updated dependencies
- Understand version changes and their implications
- Assess security and breaking change potential

Analyze for:
1. New dependencies added (name, version, purpose)
2. Dependencies removed
3. Version updates (major, minor, patch)
4. Breaking change potential
5. Security implications
6. License considerations

Format your response as:

SUMMARY:
[Brief summary of dependency changes]

CHANGES:
- action: ADDED | package: express | version: ^4.17.0 | reason: Express web framework
- action: REMOVED | package: lodash | reason: No longer needed
- action: UPDATED | package: typescript | version: 4.9.0 -> 5.0.0 | reason: New features

BREAKING_CHANGES:
- [Description of potential breaking changes, or "None"]

SECURITY_NOTES:
- [Security considerations, or "None"]

IMPACT: minimal/moderate/significant

DEPENDENCY_DETAILS:
=== package: express ===
PURPOSE: [What this dependency does]
USAGE: [How it's used]
CONSIDERATIONS: [Important notes]
=== END ===

CONFIDENCE: [0-1 value]
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const ctx = createParseContext('dependency', response);

    // Parse summary
    const summary = parseSection(ctx, 'SUMMARY', /SUMMARY:\s*([\s\S]*?)(?=CHANGES:|$)/i) ?? '';

    // Parse changes - pipe-separated format
    const changePatterns: ItemPattern<DependencyChange & { finding: ParsedAnalysis['findings'][0] }>[] = [
      {
        // New format: - action: ADDED | package: express | version: ^4.17.0 | reason: text
        pattern: /^-\s*action:\s*(ADDED|REMOVED|UPDATED)\s*\|\s*package:\s*([^|]+?)(?:\s*\|\s*version:\s*([^|]+))?(?:\s*\|\s*reason:\s*(.+))?$/i,
        mapper: (m) => {
          const action = m[1]!.toLowerCase() as 'added' | 'removed' | 'updated';
          const packageName = m[2]!.trim();
          const versionChange = m[3]?.trim();
          const reason = m[4]?.trim() || '';
          return {
            action,
            packageName,
            versionChange,
            reason,
            finding: {
              type: `dependency-${action}`,
              importance: action === 'removed' ? 'medium' as const : 'low' as const,
              description: `${packageName}${versionChange ? ` (${versionChange})` : ''}: ${reason}`,
              paths: [],
            },
          };
        },
      },
    ];

    const changesWithFindings = parseListItemsWithFallback(
      ctx,
      'CHANGES',
      /CHANGES:\s*([\s\S]*?)(?=BREAKING_CHANGES:|SECURITY_NOTES:|IMPACT:|DEPENDENCY_DETAILS:|WIKI_UPDATES:|CONFIDENCE:|$)/i,
      changePatterns
    );

    const changes: DependencyChange[] = changesWithFindings.map(c => ({
      action: c.action,
      packageName: c.packageName,
      versionChange: c.versionChange,
      reason: c.reason,
    }));

    const findings: ParsedAnalysis['findings'] = changesWithFindings.map(c => c.finding);

    // Parse breaking changes
    const breakingChangesRaw = parseStringList(
      ctx,
      'BREAKING_CHANGES',
      /BREAKING_CHANGES:\s*([\s\S]*?)(?=SECURITY_NOTES:|IMPACT:|DEPENDENCY_DETAILS:|WIKI_UPDATES:|CONFIDENCE:|$)/i
    ).filter(content => content.toLowerCase() !== 'none');

    // Add breaking changes to findings
    for (const content of breakingChangesRaw) {
      findings.push({
        type: 'breaking-change',
        importance: 'high',
        description: content,
        paths: [],
      });
    }

    // Parse security notes
    const securityNotes = parseStringList(
      ctx,
      'SECURITY_NOTES',
      /SECURITY_NOTES:\s*([\s\S]*?)(?=IMPACT:|DEPENDENCY_DETAILS:|WIKI_UPDATES:|CONFIDENCE:|$)/i
    ).filter(content => content.toLowerCase() !== 'none');

    // Parse impact
    const impact = parseChoice(
      ctx,
      'IMPACT',
      /IMPACT:\s*(\w+)/i,
      ['minimal', 'moderate', 'significant'] as const,
      { defaultValue: 'minimal' }
    ) ?? 'minimal';

    // Parse dependency details using block format: === package: name ===
    const dependencyDetails = parseBlocks<DependencyDetail>(
      ctx,
      'DEPENDENCY_DETAILS',
      /DEPENDENCY_DETAILS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      /===\s*package:\s*([^=]+?)\s*===\s*([\s\S]*?)\s*===\s*END\s*===/gi,
      (m) => {
        const packageName = m[1]!.trim();
        const blockContent = m[2]!;

        const purposeMatch = blockContent.match(/PURPOSE:\s*([\s\S]*?)(?=USAGE:|CONSIDERATIONS:|$)/i);
        const usageMatch = blockContent.match(/USAGE:\s*([\s\S]*?)(?=CONSIDERATIONS:|$)/i);
        const considerationsMatch = blockContent.match(/CONSIDERATIONS:\s*([\s\S]*?)$/i);

        return {
          packageName,
          purpose: purposeMatch ? purposeMatch[1]!.trim() : '',
          usage: usageMatch ? usageMatch[1]!.trim() : '',
          considerations: considerationsMatch ? considerationsMatch[1]!.trim() : '',
        };
      }
    );

    // Wiki updates are now generated programmatically, not parsed from LLM output
    const wikiUpdates: ParsedAnalysis['wikiUpdates'] = [];

    // Parse confidence
    const confidence = parseConfidence(ctx, { defaultValue: 0.5 });

    return {
      summary,
      changes,
      breakingChanges: breakingChangesRaw,
      securityNotes,
      impact,
      dependencyDetails,
      findings,
      wikiUpdates,
      confidence,
    };
  }

  private generateUpdates(
    commit: { sha: string; message: string; diffSummary: { affectedFiles: string[] } },
    analysis: ParsedAnalysis
  ): WikiPageUpdate[] {
    const updates: WikiPageUpdate[] = [];

    if (analysis.changes.length === 0) {
      return updates;
    }

    // Update dependencies overview page
    const addedDeps = analysis.changes.filter(c => c.action === 'added');
    const removedDeps = analysis.changes.filter(c => c.action === 'removed');
    const updatedDeps = analysis.changes.filter(c => c.action === 'updated');

    const content = `# Dependencies

## Recent Changes (${commit.sha.slice(0, 8)})

${addedDeps.length > 0 ? `### Added
${addedDeps.map(d => `- **${d.packageName}**${d.versionChange ? ` (${d.versionChange})` : ''}: ${d.reason}`).join('\n')}
` : ''}

${removedDeps.length > 0 ? `### Removed
${removedDeps.map(d => `- **${d.packageName}**: ${d.reason}`).join('\n')}
` : ''}

${updatedDeps.length > 0 ? `### Updated
${updatedDeps.map(d => `- **${d.packageName}**${d.versionChange ? ` (${d.versionChange})` : ''}: ${d.reason}`).join('\n')}
` : ''}

${analysis.breakingChanges.length > 0 ? `## Breaking Changes

${analysis.breakingChanges.map(bc => `- ${bc}`).join('\n')}
` : ''}

${analysis.securityNotes.length > 0 ? `## Security Notes

${analysis.securityNotes.map(sn => `- ${sn}`).join('\n')}
` : ''}

**Impact Level:** ${analysis.impact}

---
*Last updated from commit ${commit.sha.slice(0, 8)}*
`;

    updates.push({
      type: 'update',
      path: 'architecture/dependencies',
      content,
      sourceCommitId: commit.sha,
      agentRunId: '',
      confidenceDelta: 0.2,
    });

    // Create individual pages for significant new dependencies
    for (const dep of addedDeps) {
      if (analysis.impact !== 'minimal') {
        // Look for detailed info from DEPENDENCY_DETAILS
        const detail = analysis.dependencyDetails.find(
          d => d.packageName.toLowerCase() === dep.packageName.toLowerCase()
        );

        let content: string;
        if (detail && (detail.purpose || detail.usage || detail.considerations)) {
          // Use the detailed info from the LLM
          content = `# ${dep.packageName}

## Purpose

${detail.purpose || dep.reason}

## Usage

${detail.usage || '*Usage patterns not yet documented.*'}

## Considerations

${detail.considerations || '*No specific considerations noted.*'}

## Version

${dep.versionChange || 'See package.json'}

---
*Documentation created from commit ${commit.sha.slice(0, 8)}*`;
        } else {
          // Fallback to basic info
          content = `# ${dep.packageName}

## Purpose

${dep.reason}

## Version

${dep.versionChange || 'See package.json'}

---
*Documentation created from commit ${commit.sha.slice(0, 8)}*`;
        }

        updates.push({
          type: 'create',
          path: `dependencies/${slugify(dep.packageName)}`,
          title: dep.packageName,
          content,
          sourceCommitId: commit.sha,
          agentRunId: '',
          confidenceDelta: detail ? 0.25 : 0.15,
        });
      }
    }

    return updates;
  }
}

interface DependencyChange {
  action: 'added' | 'removed' | 'updated';
  packageName: string;
  versionChange: string | undefined;
  reason: string;
}

interface DependencyDetail {
  packageName: string;
  purpose: string;
  usage: string;
  considerations: string;
}

interface ParsedAnalysis {
  summary: string;
  changes: DependencyChange[];
  breakingChanges: string[];
  securityNotes: string[];
  impact: 'minimal' | 'moderate' | 'significant';
  dependencyDetails: DependencyDetail[];
  findings: Array<{
    type: string;
    importance: 'low' | 'medium' | 'high';
    description: string;
    paths: string[];
  }>;
  wikiUpdates: Array<{
    path: string;
    action: 'create' | 'update';
    content: string;
  }>;
  confidence: number;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/@/g, '')
    .replace(/\//g, '-');
}

const SYSTEM_PROMPT = `You are a dependency analysis agent for CodeWiki, a system that generates living documentation from Git repositories.

Your job is to analyze dependency changes and their implications for the project.

## CRITICAL: Verify Before Documenting

You have access to tools (read_file, search_files, list_directory) to explore the source code. USE THEM:

1. **Search for imports** of new dependencies to understand actual usage patterns
2. **Read configuration files** to understand how dependencies are configured
3. **Find usage examples** in the codebase before documenting how something is used
4. **Verify the dependency's purpose** by reading where it's actually imported

If you cannot verify how a dependency is used, note it as "appears to be used for" rather than stating definitively.

## What to Analyze

**For Added Dependencies:**
- What problem does this dependency solve?
- Why was this particular package chosen?
- Are there alternatives that were considered?
- What's the maintenance status of the package?
- License compatibility

**For Removed Dependencies:**
- Why was it removed?
- What replaced it (if anything)?
- Any migration needed?

**For Updated Dependencies:**
- Is this a major/minor/patch update?
- What breaking changes might exist?
- Security vulnerabilities fixed?
- New features enabled?

## Impact Levels

- **minimal**: Patch updates, dev dependencies, no breaking changes
- **moderate**: Minor updates, new runtime dependencies, potential minor breaks
- **significant**: Major updates, core dependency changes, likely breaking changes

## Security Considerations

Always note if:
- A dependency has known CVEs being fixed
- A new dependency has a weak security track record
- Dependencies are being added with broad permissions
- Lock file changes suggest unexpected updates

Your confidence should reflect:
- 0.9+: Clear dependency change with obvious purpose
- 0.7-0.9: Dependency change with reasonable inference of purpose
- 0.5-0.7: Dependency change with unclear purpose
- <0.5: Unable to determine significance`;

const SYSTEM_PROMPT_PREFETCH = `You are a dependency analysis agent for CodeWiki.

The full contents of dependency files (package.json, lock files, etc.) are provided in the prompt - you do not need to use any tools.

## Analysis Focus

Analyze the provided files to:
1. Identify added, removed, and updated dependencies
2. Understand version changes and their implications
3. Assess security and breaking change potential

## What to Analyze

**For Added Dependencies:**
- What problem does this dependency solve?
- Why was this particular package chosen?

**For Removed Dependencies:**
- Why was it removed?
- What replaced it?

**For Updated Dependencies:**
- Major/minor/patch update?
- Breaking changes?
- Security fixes?

## Impact Levels

- **minimal**: Patch updates, dev dependencies, no breaking changes
- **moderate**: Minor updates, new runtime dependencies, potential minor breaks
- **significant**: Major updates, core dependency changes, likely breaking changes

## Confidence Scoring

- 0.9+: Clear dependency change with obvious purpose from provided code
- 0.7-0.9: Reasonable inference of purpose
- 0.5-0.7: Unclear purpose
- <0.5: Unable to determine significance`;
