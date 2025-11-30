import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { createGetCommitQuery, handleGetCommit } from '../../queries/index.js';

/**
 * Pattern Agent - Recognizes recurring patterns across commits.
 *
 * This agent identifies design patterns, architectural patterns,
 * coding conventions, and anti-patterns in the codebase.
 */
export class PatternAgent implements Agent {
  readonly type: AgentType = 'pattern';

  async runOnCommit(commitId: string, context: AgentContext): Promise<AgentRunResult> {
    // Get the commit via CQRS query
    const commitQuery = createGetCommitQuery(commitId);
    const commitResult = await handleGetCommit(commitQuery, context.repos);
    if (!commitResult.success || !commitResult.data) {
      throw new Error(`Commit not found: ${commitId}`);
    }
    const commit = commitResult.data;

    const diff = await context.git.getCommitDiff(context.repoId, commit.sha);
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

    return `Analyze this commit for design patterns, architectural patterns, and coding conventions.

## Commit Information

**SHA:** ${commit.sha.slice(0, 8)}
**Message:** ${commit.message}
**Author:** ${commit.authorName}
**Date:** ${commit.committedAt.toISOString()}
**Files Changed:** ${commit.diffSummary.affectedFiles.length}
**Lines:** +${commit.diffSummary.linesAdded} / -${commit.diffSummary.linesDeleted}

## Affected Files

${commit.diffSummary.affectedFiles.map(f => `- ${f}`).join('\n')}

## Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

Look for:
1. **Design Patterns**: Factory, Singleton, Observer, Strategy, Repository, etc.
2. **Architectural Patterns**: CQRS, Event Sourcing, Layered, Microservices, etc.
3. **Coding Conventions**: Naming, file structure, error handling, logging
4. **Testing Patterns**: Test organization, mocking approaches, test utilities
5. **Anti-patterns**: God classes, spaghetti code, magic numbers, etc.
6. **Emerging Patterns**: Recurring structures that could become conventions

Format your response as:

SUMMARY:
[Brief description of patterns observed]

PATTERNS_FOUND:
- [PATTERN_NAME] [CATEGORY:design/architecture/convention/testing/anti-pattern] [Description] [Affected paths]

CONVENTIONS:
- [Convention description with example]

ANTI_PATTERNS:
- [Anti-pattern with explanation of why it's problematic]

WIKI_UPDATES:
- [PAGE_PATH] [ACTION:create/update] [Content description]

CONFIDENCE: [0-1 value]
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const analysis: ParsedAnalysis = {
      summary: '',
      patterns: [],
      conventions: [],
      antiPatterns: [],
      findings: [],
      wikiUpdates: [],
      confidence: 0.5,
    };

    // Parse summary
    const summaryMatch = response.match(/SUMMARY:\s*([\s\S]*?)(?=PATTERNS_FOUND:|CONVENTIONS:|$)/i);
    if (summaryMatch) {
      analysis.summary = summaryMatch[1]!.trim();
    }

    // Parse patterns
    const patternsMatch = response.match(/PATTERNS_FOUND:\s*([\s\S]*?)(?=CONVENTIONS:|ANTI_PATTERNS:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (patternsMatch) {
      const patternLines = patternsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of patternLines) {
        const match = line.match(/^-\s*\[([^\]]+)\]\s*\[CATEGORY:([^\]]+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i);
        if (match) {
          const pattern = {
            name: match[1]!.trim(),
            category: match[2]!.toLowerCase() as PatternCategory,
            description: match[3]!.trim(),
            paths: match[4]?.split(',').map(p => p.trim()).filter(p => p) ?? [],
          };
          analysis.patterns.push(pattern);

          // Convert to finding
          analysis.findings.push({
            type: `${pattern.category}-pattern`,
            importance: pattern.category === 'anti-pattern' ? 'high' : 'medium',
            description: `${pattern.name}: ${pattern.description}`,
            paths: pattern.paths,
          });
        }
      }
    }

    // Parse conventions
    const convMatch = response.match(/CONVENTIONS:\s*([\s\S]*?)(?=ANTI_PATTERNS:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (convMatch) {
      const convLines = convMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of convLines) {
        analysis.conventions.push(line.replace(/^-\s*/, '').trim());
      }
    }

    // Parse anti-patterns
    const antiMatch = response.match(/ANTI_PATTERNS:\s*([\s\S]*?)(?=WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (antiMatch) {
      const antiLines = antiMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of antiLines) {
        analysis.antiPatterns.push(line.replace(/^-\s*/, '').trim());
      }
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

    // Create pages for significant design patterns
    for (const pattern of analysis.patterns) {
      if (pattern.category !== 'anti-pattern') {
        const pagePath = `patterns/${slugify(pattern.name)}`;

        updates.push({
          type: 'update',
          path: pagePath,
          content: `# ${pattern.name}

**Category:** ${pattern.category}

## Description

${pattern.description}

## Usage in This Codebase

${pattern.paths.length > 0 ? `Found in: ${pattern.paths.map(p => `\`${p}\``).join(', ')}` : 'See commit details below.'}

## Examples

*See commit ${commit.sha.slice(0, 8)} for implementation example.*

---
*Last updated from commit ${commit.sha.slice(0, 8)}*
`,
          sourceCommitId: commit.sha,
          agentRunId: '',
          confidenceDelta: 0.2,
        });
      }
    }

    // Document conventions
    if (analysis.conventions.length > 0) {
      updates.push({
        type: 'update',
        path: 'conventions/coding-standards',
        content: `# Coding Standards & Conventions

## Observed Conventions

${analysis.conventions.map(c => `- ${c}`).join('\n')}

---
*Updated from commit ${commit.sha.slice(0, 8)}*
`,
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta: 0.15,
      });
    }

    // Document anti-patterns to avoid
    if (analysis.antiPatterns.length > 0) {
      updates.push({
        type: 'update',
        path: 'patterns/anti-patterns',
        content: `# Anti-Patterns to Avoid

These patterns have been identified as problematic in the codebase:

${analysis.antiPatterns.map(ap => `## ${ap.split(':')[0] || 'Issue'}

${ap}
`).join('\n')}

---
*Updated from commit ${commit.sha.slice(0, 8)}*
`,
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta: 0.25,
      });
    }

    return updates;
  }
}

type PatternCategory = 'design' | 'architecture' | 'convention' | 'testing' | 'anti-pattern';

interface Pattern {
  name: string;
  category: PatternCategory;
  description: string;
  paths: string[];
}

interface ParsedAnalysis {
  summary: string;
  patterns: Pattern[];
  conventions: string[];
  antiPatterns: string[];
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
    .replace(/^-|-$/g, '');
}

const SYSTEM_PROMPT = `You are a pattern recognition agent for CodeWiki, a system that generates living documentation from Git repositories.

Your job is to identify patterns in the code: both intentional design patterns and emergent conventions.

## What to Look For

**Design Patterns**: Classic GoF patterns and modern variants
- Creational: Factory, Builder, Singleton, Prototype
- Structural: Adapter, Decorator, Facade, Repository
- Behavioral: Strategy, Observer, Command, State

**Architectural Patterns**:
- CQRS (Command Query Responsibility Segregation)
- Event Sourcing, Event-Driven
- Layered Architecture, Clean Architecture
- Dependency Injection, Inversion of Control

**Coding Conventions**:
- Naming patterns (prefixes, suffixes, casing)
- File organization and module structure
- Error handling approaches
- Logging and observability patterns

**Testing Patterns**:
- Test organization (describe blocks, test fixtures)
- Mocking and stubbing approaches
- Integration test patterns

**Anti-Patterns** (flag these!):
- God classes/modules
- Spaghetti code
- Magic numbers/strings
- Copy-paste programming
- Leaky abstractions

When documenting patterns:
1. Name the pattern clearly
2. Describe how it's implemented here
3. Note any deviations from canonical implementations
4. Link to concrete examples

Your confidence should reflect:
- 0.9+: Clear, canonical pattern implementation
- 0.7-0.9: Pattern with some adaptation
- 0.5-0.7: Emerging pattern, may not be intentional
- <0.5: Uncertain pattern identification`;
