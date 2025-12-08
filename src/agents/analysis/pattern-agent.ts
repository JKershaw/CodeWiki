import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isCommitTarget, extractToolMetrics } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { createGetCommitQuery, handleGetCommit } from '../../queries/index.js';
import { getCommitDiff, createCodebaseToolExecutor, fetchAffectedFileContents, formatFetchedFilesForContext } from '../agent-helpers.js';
import {
  createParseContext,
  parseSection,
  parseSectionItems,
  parseListItemsWithFallback,
  parseStringList,
  parseConfidence,
  getParseStats,
  type ParseContext,
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
- Extract actual code snippets that exemplify patterns
- Understand how patterns are implemented in the codebase

Look for:
1. **Design Patterns**: Factory, Singleton, Observer, Strategy, Repository, etc.
2. **Architectural Patterns**: CQRS, Event Sourcing, Layered, etc.
3. **Coding Conventions**: Naming, file structure, error handling
4. **Testing Patterns**: Test organization, mocking approaches
5. **Anti-patterns**: God classes, magic numbers, etc.

Format your response as:

SUMMARY:
[Brief description of patterns observed]

PATTERNS_FOUND:
- [PATTERN_NAME] [CATEGORY:design/architecture/convention/testing/anti-pattern] [Description] [Affected paths]

KEY_FILES:
- [FILE_PATH] [ROLE:PRIMARY/SUPPORTING/RELATED/EXAMPLE] [Description]

CODE_SNIPPETS:
- [SNIPPET_NAME] [FILE_PATH:LINE_RANGE]
\`\`\`language
[Code that exemplifies the pattern]
\`\`\`

IMPLEMENTATION_EXPLANATION:
[How the code implements the pattern]

TRADE_OFFS:
- [TRADE_OFF_NAME] [Analysis]

CONVENTIONS:
- [Convention with example]

ANTI_PATTERNS:
- [Anti-pattern with explanation]

WIKI_UPDATES:
- [PAGE_PATH] [ACTION:create/update] [Content description]

CONFIDENCE: [0-1 value]
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

  // Parse summary (important but not required - agent can still produce useful output without it)
  const summary = parseSection(
    ctx,
    'SUMMARY',
    /SUMMARY:\s*([\s\S]*?)(?=PATTERNS_FOUND:|KEY_FILES:|CODE_SNIPPETS:|IMPLEMENTATION_EXPLANATION:|TRADE_OFFS:|CONVENTIONS:|ANTI_PATTERNS:|WIKI_UPDATES:|CONFIDENCE:|$)/i
  );
  if (summary) {
    analysis.summary = summary;
  }

  // Parse patterns using structured item parsing
  analysis.patterns = parseSectionItems(
    ctx,
    'PATTERNS_FOUND',
    /PATTERNS_FOUND:\s*([\s\S]*?)(?=KEY_FILES:|CODE_SNIPPETS:|IMPLEMENTATION_EXPLANATION:|TRADE_OFFS:|CONVENTIONS:|ANTI_PATTERNS:|WIKI_UPDATES:|CONFIDENCE:|$)/i,
    /^-\s*\[([^\]]+)\]\s*\[CATEGORY:([^\]]+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i,
    (match) => {
      const pattern: Pattern = {
        name: match[1]!.trim(),
        category: match[2]!.toLowerCase().trim() as PatternCategory,
        description: match[3]!.trim(),
        paths: match[4]?.split(',').map(p => p.trim()).filter(p => p) ?? [],
      };
      return pattern;
    }
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

  // Parse key files with custom handling for role variants
  analysis.keyFiles = parseKeyFiles(ctx, response);

  // Parse code snippets (complex nested structure)
  analysis.codeSnippets = parseCodeSnippets(ctx, response);

  // Parse implementation explanation
  const impl = parseSection(
    ctx,
    'IMPLEMENTATION_EXPLANATION',
    /IMPLEMENTATION_EXPLANATION:\s*([\s\S]*?)(?=TRADE_OFFS:|CONVENTIONS:|ANTI_PATTERNS:|WIKI_UPDATES:|CONFIDENCE:|$)/i
  );
  if (impl) {
    analysis.implementationExplanation = impl;
  }

  // Parse trade-offs with custom handling
  analysis.tradeOffs = parseTradeOffs(ctx, response);

  // Parse conventions (simple list extraction)
  analysis.conventions = parseStringList(
    ctx,
    'CONVENTIONS',
    /CONVENTIONS:\s*([\s\S]*?)(?=ANTI_PATTERNS:|WIKI_UPDATES:|CONFIDENCE:|$)/i
  );

  // Parse anti-patterns (simple list extraction)
  analysis.antiPatterns = parseStringList(
    ctx,
    'ANTI_PATTERNS',
    /ANTI_PATTERNS:\s*([\s\S]*?)(?=WIKI_UPDATES:|CONFIDENCE:|$)/i
  );

  // Parse wiki updates
  analysis.wikiUpdates = parseSectionItems(
    ctx,
    'WIKI_UPDATES',
    /WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
    /^-\s*\[([^\]]+)\]\s*\[(create|update)\]\s*(.+)$/i,
    (match) => ({
      path: match[1]!.trim(),
      action: match[2]!.toLowerCase() as 'create' | 'update',
      description: match[3]!.trim(),
    })
  );

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
 * Parse key files with handling for role variants.
 */
function parseKeyFiles(ctx: ParseContext, _response: string): KeyFile[] {
  const keyFilePatterns: ItemPattern<KeyFile>[] = [
    // Format: - [path] [ROLE] description
    {
      pattern: /^-\s*\[([^\]]+)\]\s*\[(PRIMARY|SUPPORTING|RELATED|EXAMPLE)\]\s*(.*)$/i,
      mapper: (m) => ({
        path: m[1]!.trim(),
        role: m[2]!.toUpperCase().trim() as KeyFileRole,
        description: m[3]!.trim(),
      }),
    },
    // Format without role: - [path] description
    {
      pattern: /^-\s*\[([^\]]+)\]\s*(.*)$/i,
      mapper: (m) => ({
        path: m[1]!.trim(),
        role: 'RELATED' as KeyFileRole,
        description: m[2]!.trim(),
      }),
    },
  ];

  return parseListItemsWithFallback(
    ctx,
    'KEY_FILES',
    /KEY_FILES:\s*([\s\S]*?)(?=CODE_SNIPPETS:|IMPLEMENTATION_EXPLANATION:|TRADE_OFFS:|CONVENTIONS:|ANTI_PATTERNS:|WIKI_UPDATES:|CONFIDENCE:|$)/i,
    keyFilePatterns
  );
}

/**
 * Parse code snippets with complex nested structure.
 */
function parseCodeSnippets(ctx: ParseContext, response: string): CodeSnippet[] {
  const snippets: CodeSnippet[] = [];

  const sectionMatch = response.match(
    /CODE_SNIPPETS:\s*([\s\S]*?)(?=IMPLEMENTATION_EXPLANATION:|TRADE_OFFS:|CONVENTIONS:|ANTI_PATTERNS:|WIKI_UPDATES:|CONFIDENCE:|$)/i
  );

  if (!sectionMatch) {
    return snippets;
  }

  ctx.successfulSections.push('CODE_SNIPPETS');
  const snippetContent = sectionMatch[1]!.trim();

  // Match snippet blocks: - [Name] [location]\n```lang\ncode\n```
  const snippetRegex = /^-\s*\[([^\]]+)\](?:\s*\[([^\]]*)\])?\s*\n```(\w*)\n([\s\S]*?)```/gm;
  let snippetMatch;
  while ((snippetMatch = snippetRegex.exec(snippetContent)) !== null) {
    snippets.push({
      name: snippetMatch[1]!.trim(),
      location: snippetMatch[2]?.trim() ?? '',
      code: snippetMatch[4]!.trim(),
    });
  }

  return snippets;
}

/**
 * Parse trade-offs with fallback for entries without names.
 */
function parseTradeOffs(ctx: ParseContext, _response: string): TradeOff[] {
  const tradeOffPatterns: ItemPattern<TradeOff>[] = [
    // Format: - [Name] description
    {
      pattern: /^-\s*\[([^\]]+)\]\s*(.+)$/,
      mapper: (m) => ({
        name: m[1]!.trim(),
        description: m[2]!.trim(),
      }),
    },
    // Fallback: - description (no name)
    {
      pattern: /^-\s*(.+)$/,
      mapper: (m) => ({
        name: 'Trade-off',
        description: m[1]!.trim(),
      }),
    },
  ];

  return parseListItemsWithFallback(
    ctx,
    'TRADE_OFFS',
    /TRADE_OFFS:\s*([\s\S]*?)(?=CONVENTIONS:|ANTI_PATTERNS:|WIKI_UPDATES:|CONFIDENCE:|$)/i,
    tradeOffPatterns
  );
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

## CRITICAL: Verify Before Documenting

You have access to tools (read_file, search_files, list_directory) to explore the codebase. USE THEM to verify your claims:

1. **Before citing line numbers**: Use read_file to get the actual file content and verify exact line ranges
2. **Before claiming a pattern**: Read the full file to confirm the pattern actually exists
3. **Before extracting code snippets**: Use read_file to get the real code, don't reconstruct from diffs
4. **When uncertain**: Search for similar patterns in other files to confirm conventions

If you cannot verify a claim with the tools, explicitly note the uncertainty rather than guessing.

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

const SYSTEM_PROMPT_PREFETCH = `You are a pattern recognition agent for CodeWiki.

Your job is to identify patterns in the code. The full contents of affected files are provided in the prompt - you do not need to use any tools.

## Analysis Focus

Using the provided file contents:
1. Identify design patterns, architectural patterns, and coding conventions
2. Extract actual code snippets that exemplify patterns
3. Understand how patterns are implemented

## What to Look For

**Design Patterns**: Factory, Builder, Singleton, Strategy, Repository, Observer, Command, etc.
**Architectural Patterns**: CQRS, Event Sourcing, Layered Architecture, Clean Architecture
**Coding Conventions**: Naming patterns, file organization, error handling approaches
**Testing Patterns**: Test organization, mocking, fixtures
**Anti-Patterns**: God classes, magic numbers, copy-paste code

## Documentation Requirements

When documenting patterns, provide:
1. **Key Files**: List specific files implementing the pattern with their roles
2. **Code Snippets**: Actual code from the provided files
3. **Implementation Explanation**: How the code implements the pattern
4. **Trade-offs**: Design decisions and their implications

## Confidence Scoring

- 0.9+: Clear, canonical pattern with strong evidence from provided code
- 0.7-0.9: Pattern with some adaptation
- 0.5-0.7: Emerging pattern, may not be intentional
- <0.5: Uncertain pattern identification`;
