import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { createGetCommitQuery, handleGetCommit } from '../../queries/index.js';

/**
 * Dependency Agent - Tracks external dependency changes and their implications.
 *
 * This agent analyzes package.json, lock files, and import statements
 * to understand dependency changes, version updates, and their impact.
 */
export class DependencyAgent implements Agent {
  readonly type: AgentType = 'dependency';

  async runOnCommit(commitId: string, context: AgentContext): Promise<AgentRunResult> {
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

    const diff = await context.git.getCommitDiff(context.repoId, commit.sha);
    const prompt = this.buildPrompt(commit, diff);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
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
- [ADDED/REMOVED/UPDATED] [package-name] [old-version -> new-version if applicable] [Purpose/reason]

BREAKING_CHANGES:
- [Description of potential breaking changes]

SECURITY_NOTES:
- [Security considerations for the dependency changes]

IMPACT:
[Overall impact assessment: minimal/moderate/significant]

WIKI_UPDATES:
- [PAGE_PATH] [ACTION:create/update] [Content description]

CONFIDENCE: [0-1 value]
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const analysis: ParsedAnalysis = {
      summary: '',
      changes: [],
      breakingChanges: [],
      securityNotes: [],
      impact: 'minimal',
      findings: [],
      wikiUpdates: [],
      confidence: 0.5,
    };

    // Parse summary
    const summaryMatch = response.match(/SUMMARY:\s*([\s\S]*?)(?=CHANGES:|$)/i);
    if (summaryMatch) {
      analysis.summary = summaryMatch[1]!.trim();
    }

    // Parse changes
    const changesMatch = response.match(/CHANGES:\s*([\s\S]*?)(?=BREAKING_CHANGES:|SECURITY_NOTES:|IMPACT:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (changesMatch) {
      const changeLines = changesMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of changeLines) {
        const match = line.match(/^-\s*\[(ADDED|REMOVED|UPDATED)\]\s*([^\s\[]+)\s*(?:\[([^\]]*)\])?\s*(.*)$/i);
        if (match) {
          const change = {
            action: match[1]!.toLowerCase() as 'added' | 'removed' | 'updated',
            packageName: match[2]!.trim(),
            versionChange: match[3]?.trim(),
            reason: match[4]?.trim() || '',
          };
          analysis.changes.push(change);

          // Convert to finding
          analysis.findings.push({
            type: `dependency-${change.action}`,
            importance: change.action === 'removed' ? 'medium' : 'low',
            description: `${change.packageName}${change.versionChange ? ` (${change.versionChange})` : ''}: ${change.reason}`,
            paths: [],
          });
        }
      }
    }

    // Parse breaking changes
    const breakingMatch = response.match(/BREAKING_CHANGES:\s*([\s\S]*?)(?=SECURITY_NOTES:|IMPACT:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (breakingMatch) {
      const breakingLines = breakingMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of breakingLines) {
        const content = line.replace(/^-\s*/, '').trim();
        if (content && content.toLowerCase() !== 'none') {
          analysis.breakingChanges.push(content);
          analysis.findings.push({
            type: 'breaking-change',
            importance: 'high',
            description: content,
            paths: [],
          });
        }
      }
    }

    // Parse security notes
    const securityMatch = response.match(/SECURITY_NOTES:\s*([\s\S]*?)(?=IMPACT:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (securityMatch) {
      const securityLines = securityMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of securityLines) {
        const content = line.replace(/^-\s*/, '').trim();
        if (content && content.toLowerCase() !== 'none') {
          analysis.securityNotes.push(content);
        }
      }
    }

    // Parse impact
    const impactMatch = response.match(/IMPACT:\s*(\w+)/i);
    if (impactMatch) {
      analysis.impact = impactMatch[1]!.toLowerCase() as 'minimal' | 'moderate' | 'significant';
    }

    // Parse wiki updates
    const updatesMatch = response.match(/WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (updatesMatch) {
      const updateLines = updatesMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of updateLines) {
        const match = line.match(/^-\s*\[([^\]]+)\]\s*\[(create|update)\]\s*(.+)$/i);
        if (match) {
          analysis.wikiUpdates.push({
            path: match[1]!.trim(),
            action: match[2]!.toLowerCase() as 'create' | 'update',
            description: match[3]!.trim(),
          });
        }
      }
    }

    // Parse confidence
    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    if (confidenceMatch) {
      analysis.confidence = parseFloat(confidenceMatch[1]!);
    }

    return analysis;
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
        updates.push({
          type: 'create',
          path: `dependencies/${slugify(dep.packageName)}`,
          content: `# ${dep.packageName}

## Purpose

${dep.reason}

## Version

${dep.versionChange || 'See package.json'}

## Added In

Commit ${commit.sha.slice(0, 8)}

---
*Documentation created from commit ${commit.sha.slice(0, 8)}*
`,
          sourceCommitId: commit.sha,
          agentRunId: '',
          confidenceDelta: 0.15,
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

interface ParsedAnalysis {
  summary: string;
  changes: DependencyChange[];
  breakingChanges: string[];
  securityNotes: string[];
  impact: 'minimal' | 'moderate' | 'significant';
  findings: Array<{
    type: string;
    importance: 'low' | 'medium' | 'high';
    description: string;
    paths: string[];
  }>;
  wikiUpdates: Array<{
    path: string;
    action: 'create' | 'update';
    description: string;
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
