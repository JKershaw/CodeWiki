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
 *
 * Enhanced to provide:
 * - Key files and directories identification
 * - Code snippet extraction
 * - Implementation explanations
 * - Trade-off analysis
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
      maxTokens: 3500,
      temperature: 0.3,
    });

    const analysis = parsePatternResponse(completion.content);
    const updates = generatePatternWikiUpdates(commit, analysis);

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

KEY_FILES:
- [FILE_PATH] [ROLE:PRIMARY/SUPPORTING/RELATED/EXAMPLE] [Description of the file's role in implementing the pattern]

CODE_SNIPPETS:
- [SNIPPET_NAME] [FILE_PATH:LINE_RANGE]
\`\`\`language
[Relevant code that exemplifies the pattern implementation]
\`\`\`

IMPLEMENTATION_EXPLANATION:
[Explain how the code implements the pattern/concept. Describe the mechanics and how components interact.]

TRADE_OFFS:
- [TRADE_OFF_NAME] [Analysis of implicit design decisions, e.g., "This design prioritizes X over Y because of Z implementation details"]

CONVENTIONS:
- [Convention description with example]

ANTI_PATTERNS:
- [Anti-pattern with explanation of why it's problematic]

WIKI_UPDATES:
- [PAGE_PATH] [ACTION:create/update] [Content description]

CONFIDENCE: [0-1 value]
`;
  }

}

/**
 * Parse the LLM response into a structured analysis object.
 * Exported for testing purposes.
 */
export function parsePatternResponse(response: string): ParsedPatternAnalysis {
  const analysis: ParsedPatternAnalysis = {
    summary: '',
    patterns: [],
    keyFiles: [],
    codeSnippets: [],
    implementationExplanation: '',
    tradeOffs: [],
    conventions: [],
    antiPatterns: [],
    findings: [],
    wikiUpdates: [],
    confidence: 0.5,
  };

  if (!response) {
    return analysis;
  }

  // Parse summary
  const summaryMatch = response.match(/SUMMARY:\s*([\s\S]*?)(?=PATTERNS_FOUND:|KEY_FILES:|CODE_SNIPPETS:|IMPLEMENTATION_EXPLANATION:|TRADE_OFFS:|CONVENTIONS:|ANTI_PATTERNS:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
  if (summaryMatch) {
    analysis.summary = summaryMatch[1]!.trim();
  }

  // Parse patterns
  const patternsMatch = response.match(/PATTERNS_FOUND:\s*([\s\S]*?)(?=KEY_FILES:|CODE_SNIPPETS:|IMPLEMENTATION_EXPLANATION:|TRADE_OFFS:|CONVENTIONS:|ANTI_PATTERNS:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
  if (patternsMatch) {
    const patternLines = patternsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
    for (const line of patternLines) {
      const match = line.match(/^-\s*\[([^\]]+)\]\s*\[CATEGORY:([^\]]+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i);
      if (match) {
        const pattern = {
          name: match[1]!.trim(),
          category: match[2]!.toLowerCase().trim() as PatternCategory,
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

  // Parse key files
  const keyFilesMatch = response.match(/KEY_FILES:\s*([\s\S]*?)(?=CODE_SNIPPETS:|IMPLEMENTATION_EXPLANATION:|TRADE_OFFS:|CONVENTIONS:|ANTI_PATTERNS:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
  if (keyFilesMatch) {
    const keyFileLines = keyFilesMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
    for (const line of keyFileLines) {
      // Try to match with role: - [path] [ROLE] description
      const matchWithRole = line.match(/^-\s*\[([^\]]+)\]\s*\[(PRIMARY|SUPPORTING|RELATED|EXAMPLE)\]\s*(.*)$/i);
      if (matchWithRole) {
        analysis.keyFiles.push({
          path: matchWithRole[1]!.trim(),
          role: matchWithRole[2]!.toUpperCase().trim() as KeyFileRole,
          description: matchWithRole[3]!.trim(),
        });
      } else {
        // Try to match without role: - [path] description
        const matchWithoutRole = line.match(/^-\s*\[([^\]]+)\]\s*(.*)$/i);
        if (matchWithoutRole) {
          analysis.keyFiles.push({
            path: matchWithoutRole[1]!.trim(),
            role: 'RELATED',
            description: matchWithoutRole[2]!.trim(),
          });
        }
      }
    }
  }

  // Parse code snippets
  const codeSnippetsMatch = response.match(/CODE_SNIPPETS:\s*([\s\S]*?)(?=IMPLEMENTATION_EXPLANATION:|TRADE_OFFS:|CONVENTIONS:|ANTI_PATTERNS:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
  if (codeSnippetsMatch) {
    const snippetContent = codeSnippetsMatch[1]!.trim();
    // Match snippet blocks: - [Name] [location]\n```lang\ncode\n```
    const snippetRegex = /^-\s*\[([^\]]+)\](?:\s*\[([^\]]*)\])?\s*\n```(\w*)\n([\s\S]*?)```/gm;
    let snippetMatch;
    while ((snippetMatch = snippetRegex.exec(snippetContent)) !== null) {
      analysis.codeSnippets.push({
        name: snippetMatch[1]!.trim(),
        location: snippetMatch[2]?.trim() ?? '',
        code: snippetMatch[4]!.trim(),
      });
    }
  }

  // Parse implementation explanation
  const implMatch = response.match(/IMPLEMENTATION_EXPLANATION:\s*([\s\S]*?)(?=TRADE_OFFS:|CONVENTIONS:|ANTI_PATTERNS:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
  if (implMatch) {
    analysis.implementationExplanation = implMatch[1]!.trim();
  }

  // Parse trade-offs
  const tradeOffsMatch = response.match(/TRADE_OFFS:\s*([\s\S]*?)(?=CONVENTIONS:|ANTI_PATTERNS:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
  if (tradeOffsMatch) {
    const tradeOffLines = tradeOffsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
    for (const line of tradeOffLines) {
      // Try to match with name: - [Name] description
      const matchWithName = line.match(/^-\s*\[([^\]]+)\]\s*(.+)$/);
      if (matchWithName) {
        analysis.tradeOffs.push({
          name: matchWithName[1]!.trim(),
          description: matchWithName[2]!.trim(),
        });
      } else {
        // Match without name
        const desc = line.replace(/^-\s*/, '').trim();
        if (desc) {
          analysis.tradeOffs.push({
            name: 'Trade-off',
            description: desc,
          });
        }
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
    const parsed = parseFloat(confidenceMatch[1]!);
    if (!isNaN(parsed)) {
      analysis.confidence = parsed;
    }
  }

  return analysis;
}

/**
 * Generate wiki page updates from the parsed analysis.
 * Exported for testing purposes.
 */
export function generatePatternWikiUpdates(
  commit: { sha: string; message: string; diffSummary: { affectedFiles: string[] } },
  analysis: ParsedPatternAnalysis
): WikiPageUpdate[] {
  const updates: WikiPageUpdate[] = [];

  // Create pages for significant design patterns (not anti-patterns)
  for (const pattern of analysis.patterns) {
    if (pattern.category !== 'anti-pattern') {
      const pagePath = `patterns/${slugify(pattern.name)}`;

      // Build content sections conditionally
      const sections: string[] = [];

      sections.push(`# ${pattern.name}`);
      sections.push(`\n**Category:** ${pattern.category}\n`);

      // Description section
      sections.push(`## Description\n\n${pattern.description}\n`);

      // Key Files section (if we have any)
      if (analysis.keyFiles.length > 0) {
        sections.push(`## Key Files\n`);
        for (const file of analysis.keyFiles) {
          sections.push(`- \`${file.path}\` **(${file.role})** - ${file.description}`);
        }
        sections.push('');
      }

      // Code Examples section (if we have snippets)
      if (analysis.codeSnippets.length > 0) {
        sections.push(`## Code Examples\n`);
        for (const snippet of analysis.codeSnippets) {
          sections.push(`### ${snippet.name}`);
          if (snippet.location) {
            sections.push(`*Location: \`${snippet.location}\`*\n`);
          }
          sections.push('```typescript');
          sections.push(snippet.code);
          sections.push('```\n');
        }
      }

      // How It Works section (implementation explanation)
      if (analysis.implementationExplanation) {
        sections.push(`## How It Works\n\n${analysis.implementationExplanation}\n`);
      }

      // Trade-offs section
      if (analysis.tradeOffs.length > 0) {
        sections.push(`## Design Trade-offs\n`);
        for (const tradeOff of analysis.tradeOffs) {
          sections.push(`### ${tradeOff.name}\n\n${tradeOff.description}\n`);
        }
      }

      // Usage section (legacy support)
      if (pattern.paths.length > 0) {
        sections.push(`## Usage in This Codebase\n\nFound in: ${pattern.paths.map(p => `\`${p}\``).join(', ')}\n`);
      }

      // Footer
      sections.push(`---\n*Last updated from commit ${commit.sha.slice(0, 8)}*`);

      // Calculate confidence delta based on content richness
      let confidenceDelta = 0.2; // Base confidence
      if (analysis.keyFiles.length > 0) confidenceDelta += 0.05;
      if (analysis.codeSnippets.length > 0) confidenceDelta += 0.05;
      if (analysis.implementationExplanation) confidenceDelta += 0.05;
      if (analysis.tradeOffs.length > 0) confidenceDelta += 0.05;

      updates.push({
        type: 'update',
        path: pagePath,
        content: sections.join('\n'),
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta,
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

type PatternCategory = 'design' | 'architecture' | 'convention' | 'testing' | 'anti-pattern';
type KeyFileRole = 'PRIMARY' | 'SUPPORTING' | 'RELATED' | 'EXAMPLE';

interface Pattern {
  name: string;
  category: PatternCategory;
  description: string;
  paths: string[];
}

interface KeyFile {
  path: string;
  role: KeyFileRole;
  description: string;
}

interface CodeSnippet {
  name: string;
  location: string;
  code: string;
}

interface TradeOff {
  name: string;
  description: string;
}

/**
 * Parsed analysis result from the pattern agent.
 * Exported for use in tests.
 */
export interface ParsedPatternAnalysis {
  summary: string;
  patterns: Pattern[];
  keyFiles: KeyFile[];
  codeSnippets: CodeSnippet[];
  implementationExplanation: string;
  tradeOffs: TradeOff[];
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

Your job is to identify patterns in the code: both intentional design patterns and emergent conventions. Your documentation is intended for developers who may not have direct access to the source code, so be thorough and explicit.

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

## Documentation Requirements

When documenting patterns, you MUST provide:

1. **Identify Key Files and Directories**: List the specific files and directories that implement or relate to the pattern. Categorize them by role:
   - PRIMARY: Core implementation files
   - SUPPORTING: Helper classes, utilities, base classes
   - RELATED: Files that use or depend on the pattern
   - EXAMPLE: Good examples of the pattern in use

2. **Extract Code Snippets**: Include relevant code snippets that exemplify the implementation. Choose snippets that:
   - Show the essential structure of the pattern
   - Demonstrate key interfaces or contracts
   - Illustrate how components interact

3. **Explain the Implementation**: Describe HOW the code implements the concept:
   - What are the key components and their responsibilities?
   - How do the components interact?
   - What is the flow of data or control?
   - How does this implementation compare to the canonical pattern?

4. **Analyze Design Trade-offs**: Identify implicit decisions and trade-offs:
   - "This design choice likely prioritizes X over Y because of Z implementation details"
   - Consider: performance vs. readability, flexibility vs. simplicity, consistency vs. optimization
   - Note any constraints or limitations implied by the design

## Confidence Scoring

Your confidence should reflect:
- 0.9+: Clear, canonical pattern implementation with strong evidence
- 0.7-0.9: Pattern with some adaptation or variation
- 0.5-0.7: Emerging pattern, may not be intentional
- <0.5: Uncertain pattern identification`;
