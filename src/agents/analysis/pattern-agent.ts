import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isCommitTarget, extractToolMetrics } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { createGetCommitQuery, handleGetCommit } from '../../queries/index.js';
import { getCommitDiff, createCodebaseToolExecutor, fetchAffectedFileContents, formatFetchedFilesForContext } from '../agent-helpers.js';
import {
  createParseContext,
  parseSection,
  parseListItemsWithFallback,
  parseStringList,
  parseConfidence,
  getParseStats,
  type ItemPattern,
} from '../parsing/index.js';

/**
 * Pattern Agent - Recognizes recurring patterns across commits.
 *
 * OPTIMIZATION: Pre-fetches affected file contents and includes them directly in
 * the prompt, reducing tool calls. Falls back to tool-based approach only if
 * context would exceed limits.
 *
 * This agent identifies design patterns, architectural patterns,
 * coding conventions, and anti-patterns in the codebase.
 */
export class PatternAgent implements Agent {
  readonly type: AgentType = 'pattern';

  private readonly MAX_FILE_SIZE = 20000;
  private readonly MAX_TOTAL_SIZE = 60000;

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isCommitTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isCommitTarget(target)) {
      throw new Error(`PatternAgent cannot handle target type: ${target.type}`);
    }
    const commitId = target.commitId;

    const commitQuery = createGetCommitQuery(commitId);
    const commitResult = await handleGetCommit(commitQuery, context.repos);
    if (!commitResult.success || !commitResult.data) {
      throw new Error(`Commit not found: ${commitId}`);
    }
    const commit = commitResult.data;
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
      maxTokens: 4000,
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
      maxToolRounds: 5,
      maxTokens: 4000,
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
      toolMetrics: extractToolMetrics(completion),
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

## Available Tools

You have access to tools to explore the codebase:
- **read_file**: Read full file contents to understand context beyond the diff
- **search_files**: Find related files by pattern (e.g., "*.test.ts", "src/**/*.ts")
- **list_directory**: Explore directory structure

**IMPORTANT**: Use these tools to VERIFY your pattern claims:
- Before documenting line ranges, use read_file to confirm the exact lines
- Before claiming a pattern exists, read the full file to verify
- Use search_files to find other examples of the pattern

Look for:
1. **Design Patterns**: Factory, Singleton, Observer, Strategy, Repository, etc.
2. **Architectural Patterns**: CQRS, Event Sourcing, Layered, etc.
3. **Coding Conventions**: Naming, file structure, error handling
4. **Anti-patterns**: God classes, spaghetti code, magic numbers

Format your response as:

SUMMARY:
[Brief description of patterns observed]

PATTERNS:
- name: [pattern name] | category: [design/architecture/convention/testing/anti-pattern] | description: [what it does] | paths: [file1.ts, file2.ts]

KEY_FILES:
- path: [file path] | role: [primary/supporting/related] | description: [file's role]

IMPLEMENTATION:
[How the pattern works - explain mechanics and component interaction]

TRADE_OFFS:
- [Trade-off description]

CONVENTIONS:
- [Convention with example]

ANTI_PATTERNS:
- [Anti-pattern with explanation]

CONFIDENCE: [0-1]

Example:

SUMMARY:
This commit implements the Repository pattern for database access.

PATTERNS:
- name: Repository Pattern | category: design | description: Abstracts data access behind interfaces | paths: src/repos/user-repo.ts

KEY_FILES:
- path: src/repos/user-repo.ts | role: primary | description: Main repository implementation
- path: src/repos/interfaces.ts | role: supporting | description: Repository interfaces

IMPLEMENTATION:
The repository pattern is implemented using TypeScript interfaces. Each entity has a corresponding repository interface that defines CRUD operations.

TRADE_OFFS:
- Adds abstraction layer but improves testability

CONVENTIONS:
- Repositories are named with -repo.ts suffix

CONFIDENCE: 0.85
`;
  }

  private buildPrefetchPrompt(
    commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } },
    diff: string,
    fileContext: string
  ): string {
    const truncatedDiff = diff.length > 8000 ? diff.slice(0, 8000) + '\n... (diff truncated)' : diff;

    return `Analyze this commit for design patterns, architectural patterns, and coding conventions.

## Commit Information

**SHA:** ${commit.sha.slice(0, 8)}
**Message:** ${commit.message}
**Author:** ${commit.authorName}
**Date:** ${commit.committedAt.toISOString()}
**Files Changed:** ${commit.diffSummary.affectedFiles.length}
**Lines:** +${commit.diffSummary.linesAdded} / -${commit.diffSummary.linesDeleted}

## Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

${fileContext}

## Analysis Instructions

The full contents of affected files are provided above. Use them to:
- Identify design patterns, architectural patterns, and coding conventions
- Understand how patterns are implemented in the codebase

Look for:
1. **Design Patterns**: Factory, Singleton, Observer, Strategy, Repository, etc.
2. **Architectural Patterns**: CQRS, Event Sourcing, Layered, etc.
3. **Coding Conventions**: Naming, file structure, error handling
4. **Anti-patterns**: God classes, magic numbers, etc.

Format your response as:

SUMMARY:
[Brief description of patterns observed]

PATTERNS:
- name: [pattern name] | category: [design/architecture/convention/testing/anti-pattern] | description: [what it does] | paths: [file1.ts, file2.ts]

KEY_FILES:
- path: [file path] | role: [primary/supporting/related] | description: [file's role]

IMPLEMENTATION:
[How the pattern works - explain mechanics and component interaction]

TRADE_OFFS:
- [Trade-off description]

CONVENTIONS:
- [Convention with example]

ANTI_PATTERNS:
- [Anti-pattern with explanation]

CONFIDENCE: [0-1]

Example:

SUMMARY:
This commit implements the Repository pattern for database access.

PATTERNS:
- name: Repository Pattern | category: design | description: Abstracts data access | paths: src/repos/user-repo.ts

KEY_FILES:
- path: src/repos/user-repo.ts | role: primary | description: Main implementation

IMPLEMENTATION:
The repository pattern uses TypeScript interfaces. Each entity has a corresponding repository.

TRADE_OFFS:
- Adds abstraction but improves testability

CONVENTIONS:
- Repositories use -repo.ts suffix

CONFIDENCE: 0.85
`;
  }

}

/**
 * Parse the LLM response into a structured analysis object.
 * Exported for testing purposes.
 *
 * Uses the centralized parsing infrastructure for logging and error tracking.
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
    console.warn('[pattern] Empty response received');
    return analysis;
  }

  const ctx = createParseContext('pattern', response);

  // Parse summary
  const summary = parseSection(
    ctx,
    'SUMMARY',
    /SUMMARY:\s*([\s\S]*?)(?=PATTERNS:|KEY_FILES:|IMPLEMENTATION:|TRADE_OFFS:|CONVENTIONS:|ANTI_PATTERNS:|CONFIDENCE:|$)/i
  );
  if (summary) {
    analysis.summary = summary;
  }

  // Multiple formats to handle different LLM output styles
  const patternPatterns: ItemPattern<Pattern>[] = [
    {
      // Full format: - name: [name] | category: [cat] | description: [desc] | paths: [paths]
      pattern: /^-\s*name:\s*([^|]+)\s*\|\s*category:\s*([^|]+)\s*\|\s*description:\s*([^|]+)\s*\|\s*paths:\s*(.+)$/i,
      mapper: (m) => ({
        name: m[1]!.trim(),
        category: m[2]!.toLowerCase().trim() as PatternCategory,
        description: m[3]!.trim(),
        paths: m[4]!.split(',').map(p => p.trim()).filter(p => p),
      }),
    },
    {
      // Bold name format: - **Pattern Name**: description
      pattern: /^-\s*\*\*([^*]+)\*\*\s*:\s*(.+)$/i,
      mapper: (m) => ({
        name: m[1]!.trim(),
        category: 'design' as PatternCategory,
        description: m[2]!.trim(),
        paths: [],
      }),
    },
    {
      // Simple format: - Pattern Name - description
      pattern: /^-\s*([^-:]+(?:Pattern|Convention|Architecture)?)\s*[-:]\s*(.+)$/i,
      mapper: (m) => ({
        name: m[1]!.trim(),
        category: 'design' as PatternCategory,
        description: m[2]!.trim(),
        paths: [],
      }),
    },
  ];

  analysis.patterns = parseListItemsWithFallback(
    ctx,
    'PATTERNS',
    /PATTERNS:\s*([\s\S]*?)(?=KEY_FILES:|IMPLEMENTATION:|TRADE_OFFS:|CONVENTIONS:|ANTI_PATTERNS:|CONFIDENCE:|$)/i,
    patternPatterns
  );

  // Convert patterns to findings
  for (const pattern of analysis.patterns) {
    analysis.findings.push({
      type: `${pattern.category}-pattern`,
      importance: pattern.category === 'anti-pattern' ? 'high' : 'medium',
      description: `${pattern.name}: ${pattern.description}`,
      paths: pattern.paths,
    });
  }

  // Simplified format: - path: [path] | role: [role] | description: [desc]
  const keyFilePatterns: ItemPattern<KeyFile>[] = [
    {
      pattern: /^-\s*path:\s*([^|]+)\s*\|\s*role:\s*([^|]+)\s*\|\s*description:\s*(.+)$/i,
      mapper: (m) => ({
        path: m[1]!.trim(),
        role: m[2]!.toUpperCase().trim() as KeyFileRole,
        description: m[3]!.trim(),
      }),
    },
  ];

  analysis.keyFiles = parseListItemsWithFallback(
    ctx,
    'KEY_FILES',
    /KEY_FILES:\s*([\s\S]*?)(?=IMPLEMENTATION:|TRADE_OFFS:|CONVENTIONS:|ANTI_PATTERNS:|CONFIDENCE:|$)/i,
    keyFilePatterns
  );

  // Code snippets are no longer in the output format (too complex for LLMs)
  analysis.codeSnippets = [];

  // Parse implementation explanation
  const impl = parseSection(
    ctx,
    'IMPLEMENTATION',
    /IMPLEMENTATION:\s*([\s\S]*?)(?=TRADE_OFFS:|CONVENTIONS:|ANTI_PATTERNS:|CONFIDENCE:|$)/i
  );
  if (impl) {
    analysis.implementationExplanation = impl;
  }

  // Parse trade-offs as simple string list
  analysis.tradeOffs = parseStringList(
    ctx,
    'TRADE_OFFS',
    /TRADE_OFFS:\s*([\s\S]*?)(?=CONVENTIONS:|ANTI_PATTERNS:|CONFIDENCE:|$)/i
  ).map(t => ({ name: 'Trade-off', description: t }));

  // Parse conventions (simple list extraction)
  analysis.conventions = parseStringList(
    ctx,
    'CONVENTIONS',
    /CONVENTIONS:\s*([\s\S]*?)(?=ANTI_PATTERNS:|CONFIDENCE:|$)/i
  );

  // Parse anti-patterns (simple list extraction)
  analysis.antiPatterns = parseStringList(
    ctx,
    'ANTI_PATTERNS',
    /ANTI_PATTERNS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i
  );

  // Wiki updates are generated programmatically, not from LLM output
  analysis.wikiUpdates = [];

  // Parse confidence
  analysis.confidence = parseConfidence(ctx, { defaultValue: 0.5 });

  // Log parsing statistics
  const stats = getParseStats(ctx);
  if (stats.failedSections > 0) {
    console.info(`[pattern] Parse stats: ${stats.successfulSections} ok, ${stats.failedSections} failed`, {
      failed: stats.sections.failed,
    });
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

const SYSTEM_PROMPT = `You are a pattern recognition agent for CodeWiki.

Your job: Identify design patterns, architectural patterns, and coding conventions in the code.

## Tools

Use read_file, search_files, and list_directory to verify patterns. Read actual files before documenting.

## What to Find

**Design Patterns**: Factory, Builder, Singleton, Strategy, Repository, Observer, Command, Adapter, Decorator
**Architectural Patterns**: CQRS, Event Sourcing, Layered/Clean Architecture, Dependency Injection
**Conventions**: Naming patterns, file organization, error handling, testing approaches
**Anti-Patterns**: God classes, magic numbers, copy-paste code

## Documentation

For each pattern, provide:
1. **Key Files**: Files implementing the pattern (PRIMARY, SUPPORTING, EXAMPLE)
2. **Code Snippets**: Actual code from the files you read
3. **Explanation**: How components interact and the control flow
4. **Trade-offs**: Design decisions and their implications

## Confidence

0.9+: Clear canonical pattern. 0.7-0.9: Pattern with variations. 0.5-0.7: Emerging pattern. <0.5: Uncertain.`;

const SYSTEM_PROMPT_PREFETCH = `You are a pattern recognition agent for CodeWiki. File contents are provided below.

## What to Find

**Design Patterns**: Factory, Builder, Singleton, Strategy, Repository, Observer, Command
**Architectural Patterns**: CQRS, Event Sourcing, Layered/Clean Architecture, Dependency Injection
**Conventions**: Naming patterns, file organization, error handling
**Anti-Patterns**: God classes, magic numbers, copy-paste code

## Documentation

For each pattern:
1. **Key Files**: Files implementing the pattern
2. **Code Snippets**: Actual code from the provided files
3. **Explanation**: How the pattern is implemented
4. **Trade-offs**: Design decisions and implications

## Confidence

0.9+: Clear canonical pattern. 0.7-0.9: Pattern with variations. 0.5-0.7: Emerging pattern. <0.5: Uncertain.`;
