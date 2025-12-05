import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isCommitTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { createGetCommitQuery, handleGetCommit } from '../../queries/index.js';
import { getCommitDiff } from '../agent-helpers.js';

/**
 * Narrative Agent - Detects meta-documents and captures project storytelling.
 *
 * This agent looks for planning files, ADRs (Architecture Decision Records),
 * idea docs, changelogs, and other narrative content that explains the "why"
 * behind the codebase.
 */
export class NarrativeAgent implements Agent {
  readonly type: AgentType = 'narrative';

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isCommitTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isCommitTarget(target)) {
      throw new Error(`NarrativeAgent cannot handle target type: ${target.type}`);
    }
    return this.runOnCommit(target.commitId, context);
  }

  async runOnCommit(commitId: string, context: AgentContext): Promise<AgentRunResult> {
    // Get the commit via CQRS query
    const commitQuery = createGetCommitQuery(commitId);
    const commitResult = await handleGetCommit(commitQuery, context.repos);
    if (!commitResult.success || !commitResult.data) {
      throw new Error(`Commit not found: ${commitId}`);
    }
    const commit = commitResult.data;

    const diff = await getCommitDiff(context, commit.sha);
    const prompt = this.buildPrompt(commit, diff);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
      temperature: 0.3,
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

  private buildPrompt(commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } }, diff: string): string {
    const truncatedDiff = diff.length > 10000 ? diff.slice(0, 10000) + '\n... (diff truncated)' : diff;

    return `Analyze this commit for narrative and meta-documentation content.

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

Look for:
1. Planning documents (PLAN.md, roadmap, project plans)
2. Architecture Decision Records (ADRs)
3. Design documents or RFCs
4. Changelogs or release notes
5. Philosophy or principles documents
6. Onboarding or getting-started guides
7. Important README updates that explain "why"
8. Commit messages that tell a story about major decisions

Format your response as:

SUMMARY:
[Brief description of narrative content found, or "No significant narrative content"]

NARRATIVE_TYPE:
[One of: planning, adr, design, changelog, philosophy, guide, readme, decision, none]

PAGE_TITLE:
[Short, descriptive title for this content - 3-6 words like "Web Interface Design" or "Multi-Agent Architecture"]

FINDINGS:
- [TYPE] [IMPORTANCE:low/medium/high] [Description] [Related paths]

KEY_DECISIONS:
- [Decision description with context]

WIKI_UPDATES:
For each additional wiki page that should be created or updated, provide FULL article content.
Write each page as a complete, standalone article (2-4 paragraphs minimum).

=== [PAGE_PATH] [ACTION:create/update] ===
[Write the FULL markdown content for this wiki page here.
Include:
- What decision was made or what concept is being documented
- The reasoning and context behind it
- Implications for developers working in this codebase
- Any alternatives that were considered

Do NOT just write a brief description - write a complete article.]
=== END ===

(Repeat for each page)

CONFIDENCE: [0-1 value]
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const analysis: ParsedAnalysis = {
      summary: '',
      narrativeType: 'none',
      pageTitle: '',
      findings: [],
      keyDecisions: [],
      wikiUpdates: [],
      confidence: 0.5,
    };

    // Parse summary
    const summaryMatch = response.match(/SUMMARY:\s*([\s\S]*?)(?=NARRATIVE_TYPE:|PAGE_TITLE:|FINDINGS:|$)/i);
    if (summaryMatch) {
      analysis.summary = summaryMatch[1]!.trim();
    }

    // Parse narrative type
    const typeMatch = response.match(/NARRATIVE_TYPE:\s*(\w+)/i);
    if (typeMatch) {
      analysis.narrativeType = typeMatch[1]!.toLowerCase() as NarrativeType;
    }

    // Parse page title
    const titleMatch = response.match(/PAGE_TITLE:\s*(.+?)(?=\n|FINDINGS:|KEY_DECISIONS:|$)/i);
    if (titleMatch) {
      analysis.pageTitle = titleMatch[1]!.trim();
    }

    // Parse findings
    const findingsMatch = response.match(/FINDINGS:\s*([\s\S]*?)(?=KEY_DECISIONS:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (findingsMatch) {
      const findingLines = findingsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of findingLines) {
        const match = line.match(/^-\s*\[([^\]]+)\]\s*\[IMPORTANCE:(\w+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i);
        if (match) {
          analysis.findings.push({
            type: match[1]!.trim(),
            importance: match[2]!.toLowerCase() as 'low' | 'medium' | 'high',
            description: match[3]!.trim(),
            paths: match[4]?.split(',').map(p => p.trim()).filter(p => p) ?? [],
          });
        }
      }
    }

    // Parse key decisions
    const decisionsMatch = response.match(/KEY_DECISIONS:\s*([\s\S]*?)(?=WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (decisionsMatch) {
      const decisionLines = decisionsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of decisionLines) {
        analysis.keyDecisions.push(line.replace(/^-\s*/, '').trim());
      }
    }

    // Parse wiki updates - new format with full content blocks
    const updatesSection = response.match(/WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (updatesSection) {
      // Match blocks like: === [path] [action] ===\n[content]\n=== END ===
      const blockRegex = /===\s*\[([^\]]+)\]\s*\[(create|update)\]\s*===\s*([\s\S]*?)\s*===\s*END\s*===/gi;
      let blockMatch;
      while ((blockMatch = blockRegex.exec(updatesSection[1]!)) !== null) {
        const path = blockMatch[1]!.trim();
        const action = blockMatch[2]!.toLowerCase() as 'create' | 'update';
        const content = blockMatch[3]!.trim();

        if (content && content.length > 0) {
          analysis.wikiUpdates.push({
            path,
            action,
            content,
          });
        }
      }

      // Fallback: also try to parse old format for backward compatibility
      if (analysis.wikiUpdates.length === 0) {
        const updateLines = updatesSection[1]!.trim().split('\n').filter(l => l.startsWith('-'));
        for (const line of updateLines) {
          const match = line.match(/^-\s*\[([^\]]+)\]\s*\[(create|update)\]\s*(.+)$/i);
          if (match) {
            analysis.wikiUpdates.push({
              path: match[1]!.trim(),
              action: match[2]!.toLowerCase() as 'create' | 'update',
              content: match[3]!.trim(), // Use description as content for legacy format
            });
          }
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

    // Skip if no narrative content
    if (analysis.narrativeType === 'none' && analysis.keyDecisions.length === 0) {
      return updates;
    }

    // Create a page for significant narrative content
    if (analysis.narrativeType !== 'none') {
      const categoryMap: Record<NarrativeType, string> = {
        planning: 'planning',
        adr: 'decisions',
        design: 'architecture',
        changelog: 'history',
        philosophy: 'philosophy',
        guide: 'guides',
        readme: 'overview',
        decision: 'decisions',
        none: 'misc',
      };

      const category = categoryMap[analysis.narrativeType];
      // Use page title for path if available, otherwise fall back to summary
      const title = analysis.pageTitle || analysis.summary.slice(0, 50);
      const pagePath = `${category}/${slugify(title)}`;

      const content = `# ${title}

${analysis.summary}

## Key Points

${analysis.findings.map(f => `- **${f.type}**: ${f.description}`).join('\n')}

${analysis.keyDecisions.length > 0 ? `## Decisions Made

${analysis.keyDecisions.map(d => `- ${d}`).join('\n')}` : ''}

## Source Files

${commit.diffSummary.affectedFiles.map(f => `- \`${f}\``).join('\n')}

---
*Captured from commit ${commit.sha.slice(0, 8)}*
`;

      updates.push({
        type: 'create',
        path: pagePath,
        content,
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta: 0.3,
      });
    }

    // Add any wiki updates suggested by the LLM
    for (const wikiUpdate of analysis.wikiUpdates) {
      // Use the full content provided by the LLM
      // Add a source footer if not already present
      let content = wikiUpdate.content;
      if (!content.includes('*Updated from commit') && !content.includes('*Source:')) {
        content = `${content}

---
*Updated from commit ${commit.sha.slice(0, 8)}*`;
      }

      // Extract title from content if it starts with a heading, otherwise generate from path
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1]!.trim() : pathToTitle(wikiUpdate.path);

      updates.push({
        type: wikiUpdate.action,
        path: wikiUpdate.path,
        title,
        content,
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta: 0.25,
      });
    }

    return updates;
  }
}

type NarrativeType = 'planning' | 'adr' | 'design' | 'changelog' | 'philosophy' | 'guide' | 'readme' | 'decision' | 'none';

interface ParsedAnalysis {
  summary: string;
  narrativeType: NarrativeType;
  pageTitle: string;
  findings: Array<{
    type: string;
    importance: 'low' | 'medium' | 'high';
    description: string;
    paths: string[];
  }>;
  keyDecisions: string[];
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
    .replace(/^-|-$/g, '');
}

function pathToTitle(path: string): string {
  const lastPart = path.split('/').pop() ?? path;
  return lastPart
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const SYSTEM_PROMPT = `You are a technical writer extracting project knowledge from meta-documentation.

CRITICAL: Write as encyclopedia articles, NOT commit summaries.

BAD: "This commit adds a planning document that describes..."
GOOD: "The project follows a CQRS architecture pattern, chosen because..."

Your specialty is identifying and extracting knowledge from:
- Planning documents (project vision, roadmaps)
- Architecture Decision Records (ADRs)
- Design documents and RFCs
- Philosophy and principles documents
- Important README content

When you find such content:
1. Extract the key decisions and their rationale
2. Write it as standalone documentation (not about the commit)
3. Give it a descriptive title like "CQRS Architecture Decision" not "Commit abc123"
4. Focus on WHAT the decision/plan IS, not that it was committed

Your confidence should reflect:
- 0.9+: Clear narrative document with explicit decisions/rationale
- 0.7-0.9: Good context, clear intent
- 0.5-0.7: Implied decisions from code changes
- <0.5: No significant narrative content`;
