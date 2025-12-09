import { v4 as uuid } from 'uuid';
import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage, WikiPageUpdate } from '../../domain/wiki-page.js';
import type { FindingType } from '../../domain/finding.js';
import {
  createListWikiPagesQuery,
  handleListWikiPages,
} from '../../queries/index.js';
import {
  createCreateFindingsCommand,
  handleCreateFindings,
  type CreateFindingInput,
} from '../../commands/index.js';
import {
  createParseContext,
  parseListItemsWithFallback,
  parseStringList,
  parseConfidence,
  type ItemPattern,
} from '../parsing/index.js';

/**
 * Consistency Agent - Detects inconsistencies across wiki pages.
 *
 * This meta-agent examines all wiki pages to find:
 * - Terminology inconsistencies (same concept, different names)
 * - Duplicate or overlapping content
 * - Broken cross-references (links to non-existent pages)
 * - Inconsistent categorization
 * - Contradictory information between pages
 */
export class ConsistencyAgent implements Agent {
  readonly type: AgentType = 'consistency';

  // Thresholds
  private readonly MIN_PAGES_FOR_ANALYSIS = 5;
  private readonly SIMILARITY_THRESHOLD = 0.6;
  private readonly MAX_PAGES_TO_COMPARE = 20;

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isWikiTarget(target)) {
      throw new Error(`ConsistencyAgent cannot handle target type: ${target.type}`);
    }

    // Get wiki pages via CQRS query
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const pages = pagesResult.data || [];

    if (pages.length < this.MIN_PAGES_FOR_ANALYSIS) {
      return {
        result: createAgentResult({
          summary: `Not enough pages for consistency analysis (need ${this.MIN_PAGES_FOR_ANALYSIS}+)`,
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Quick checks (no LLM needed)
    const quickIssues = this.runQuickChecks(pages);

    // If no obvious issues, do LLM-based deep analysis
    const pagesToAnalyze = pages.slice(0, this.MAX_PAGES_TO_COMPARE);
    const prompt = this.buildPrompt(pagesToAnalyze, quickIssues);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 3000,
      temperature: 0.3,
    });

    const analysis = this.parseResponse(completion.content);
    const updates = this.generateUpdates(analysis);

    const allIssues = [...quickIssues, ...analysis.issues];

    // Build all findings: issues + terminology + suggestions
    const allFindings = [
      ...allIssues.map(issue => createFinding({
        type: 'CONSISTENCY',
        description: issue.description,
        relatedPaths: issue.affectedPages,
        importance: issue.severity,
      })),
      ...analysis.terminologyMap.map(term => createFinding({
        type: 'TERMINOLOGY',
        description: `Inconsistent terminology: ${term.terms.join(' / ')} - ${term.description}`,
        relatedPaths: [],
        importance: 'medium',
      })),
      ...analysis.suggestions.map(suggestion => createFinding({
        type: 'SUGGESTION',
        description: suggestion,
        relatedPaths: [],
        importance: 'low',
      })),
    ];

    // Save findings to repository for consolidation agent to address
    await this.saveFindings(allIssues, analysis, context);

    if (allFindings.length === 0) {
      return {
        result: createAgentResult({
          summary: `Wiki is consistent across ${pages.length} pages`,
          findings: [],
          confidence: 0.9,
        }),
        updates: [],
        costUsd: completion.costUsd,
      };
    }

    const issueCount = allIssues.length;
    const termCount = analysis.terminologyMap.length;
    const suggestionCount = analysis.suggestions.length;

    const summaryParts = [];
    if (issueCount > 0) summaryParts.push(`${issueCount} issue${issueCount !== 1 ? 's' : ''}`);
    if (termCount > 0) summaryParts.push(`${termCount} terminology inconsistenc${termCount !== 1 ? 'ies' : 'y'}`);
    if (suggestionCount > 0) summaryParts.push(`${suggestionCount} suggestion${suggestionCount !== 1 ? 's' : ''}`);

    return {
      result: createAgentResult({
        summary: `Found ${summaryParts.join(', ')} across ${pages.length} pages`,
        findings: allFindings,
        confidence: analysis.confidence,
      }),
      updates,
      costUsd: completion.costUsd,
    };
  }

  /**
   * Save detected issues as findings in the repository.
   * These will be processed by the ConsolidationAgent.
   */
  private async saveFindings(
    issues: ConsistencyIssue[],
    analysis: ConsistencyAnalysis,
    context: AgentContext
  ): Promise<void> {
    const findingInputs: CreateFindingInput[] = [];

    // Map issue types to FindingType
    const typeMap: Record<string, FindingType> = {
      broken_link: 'broken_link',
      duplicate_title: 'duplicate_title',
      similar_content: 'similar_content',
      orphaned_page: 'orphaned_page',
      category_mismatch: 'category_mismatch',
      terminology: 'terminology',
      contradiction: 'contradiction',
    };

    // Build finding inputs from issues
    for (const issue of issues) {
      const findingType = typeMap[issue.type] ?? 'low_quality';

      // Build metadata for broken links
      let metadata: { brokenLinkPath: string } | undefined;
      if (issue.type === 'broken_link') {
        const brokenPath = issue.description.match(/non-existent page: (.+)$/)?.[1];
        if (brokenPath) {
          metadata = { brokenLinkPath: brokenPath };
        }
      }

      const input: CreateFindingInput = {
        id: uuid(),
        type: findingType,
        description: issue.description,
        affectedPaths: issue.affectedPages,
        severity: issue.severity,
      };

      if (metadata) {
        findingInputs.push({ ...input, metadata });
      } else {
        findingInputs.push(input);
      }
    }

    // Build finding inputs from terminology issues
    for (const term of analysis.terminologyMap) {
      findingInputs.push({
        id: uuid(),
        type: 'terminology',
        description: `Inconsistent terminology: ${term.terms.join(' / ')} - ${term.description}`,
        affectedPaths: [],
        severity: 'medium',
        metadata: {
          terms: term.terms,
        },
      });
    }

    if (findingInputs.length > 0) {
      // Use CQRS command with skipDuplicates to avoid creating duplicate findings
      const command = createCreateFindingsCommand({
        wikiId: context.wikiId,
        repoId: context.repoId,
        sourceAgentRunId: '', // Will be filled by executor
        findings: findingInputs,
        skipDuplicates: true,
      });
      const result = await handleCreateFindings(command, context.repos);

      if (result.success && result.data) {
        console.log(`📋 ConsistencyAgent: Saved ${result.data.length} findings for consolidation`);
      }
    }
  }

  private runQuickChecks(pages: WikiPage[]): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];

    // Check for broken links
    const brokenLinks = this.findBrokenLinks(pages);
    issues.push(...brokenLinks);

    // Check for potential duplicates (same title or very similar paths)
    const duplicates = this.findPotentialDuplicates(pages);
    issues.push(...duplicates);

    // Check for orphaned pages (no incoming or outgoing links)
    const orphans = this.findOrphanedPages(pages);
    issues.push(...orphans);

    // Check for inconsistent categorization
    const categoryIssues = this.checkCategoryConsistency(pages);
    issues.push(...categoryIssues);

    return issues;
  }

  private findBrokenLinks(pages: WikiPage[]): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];
    const validPaths = new Set(pages.map(p => p.path));

    for (const page of pages) {
      for (const link of page.links) {
        // Normalize link path
        const normalizedLink = link.replace(/\.md$/, '');
        if (!validPaths.has(normalizedLink) && !validPaths.has(link)) {
          issues.push({
            type: 'broken_link',
            description: `Page "${page.title}" links to non-existent page: ${link}`,
            affectedPages: [page.path],
            severity: 'medium',
          });
        }
      }
    }

    return issues;
  }

  private findPotentialDuplicates(pages: WikiPage[]): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];
    const seen = new Map<string, WikiPage>();

    for (const page of pages) {
      // Check for duplicate titles (case-insensitive)
      const normalizedTitle = page.title.toLowerCase().trim();
      const existing = seen.get(normalizedTitle);
      if (existing && existing.path !== page.path) {
        issues.push({
          type: 'duplicate_title',
          description: `Duplicate titles found: "${page.title}" appears in both ${existing.path} and ${page.path}`,
          affectedPages: [existing.path, page.path],
          severity: 'medium',
        });
      }
      seen.set(normalizedTitle, page);

      // Check for similar content in same category
      const category = page.path.split('/')[0];
      const sameCategory = pages.filter(p =>
        p.path !== page.path &&
        p.path.startsWith(category + '/')
      );

      for (const other of sameCategory) {
        const similarity = this.calculateSimpleSimilarity(page.content, other.content);
        if (similarity > this.SIMILARITY_THRESHOLD) {
          // Only report once per pair
          if (page.path < other.path) {
            issues.push({
              type: 'similar_content',
              description: `Pages "${page.title}" and "${other.title}" have ${(similarity * 100).toFixed(0)}% similar content - consider merging`,
              affectedPages: [page.path, other.path],
              severity: 'low',
            });
          }
        }
      }
    }

    return issues;
  }

  private findOrphanedPages(pages: WikiPage[]): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];

    // Build link graph
    const incomingLinks = new Map<string, Set<string>>();
    const outgoingLinks = new Map<string, Set<string>>();

    for (const page of pages) {
      outgoingLinks.set(page.path, new Set(page.links));
      for (const link of page.links) {
        if (!incomingLinks.has(link)) {
          incomingLinks.set(link, new Set());
        }
        incomingLinks.get(link)!.add(page.path);
      }
    }

    // Find orphans (only for non-overview pages)
    for (const page of pages) {
      if (page.path.includes('overview') || page.path.includes('index')) {
        continue;
      }

      const hasIncoming = (incomingLinks.get(page.path)?.size ?? 0) > 0;
      const hasOutgoing = (outgoingLinks.get(page.path)?.size ?? 0) > 0;
      const hasRelatedSection = page.content.includes('## Related');

      if (!hasIncoming && !hasOutgoing && !hasRelatedSection && pages.length > 10) {
        issues.push({
          type: 'orphaned_page',
          description: `Page "${page.title}" has no links to or from other pages`,
          affectedPages: [page.path],
          severity: 'low',
        });
      }
    }

    return issues;
  }

  private checkCategoryConsistency(pages: WikiPage[]): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];
    const categories = new Map<string, WikiPage[]>();

    // Group by category
    for (const page of pages) {
      const category = page.path.split('/')[0] ?? 'uncategorized';
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      categories.get(category)!.push(page);
    }

    // Check for misplaced pages (e.g., security content in architecture)
    const securityKeywords = ['security', 'vulnerability', 'attack', 'exploit', 'CVE', 'injection', 'XSS'];
    const architectureKeywords = ['architecture', 'design', 'pattern', 'structure', 'system'];

    for (const page of pages) {
      const category = page.path.split('/')[0];
      const content = page.content.toLowerCase();
      const title = page.title.toLowerCase();

      // Check if security content is in wrong category
      const hasSecurityContent = securityKeywords.some(kw =>
        content.includes(kw.toLowerCase()) || title.includes(kw.toLowerCase())
      );
      if (hasSecurityContent && category !== 'security' && !page.path.includes('overview')) {
        const securityMentions = securityKeywords.filter(kw => content.includes(kw.toLowerCase()));
        if (securityMentions.length >= 3) {
          issues.push({
            type: 'category_mismatch',
            description: `Page "${page.title}" in ${category}/ contains significant security content - consider moving to security/`,
            affectedPages: [page.path],
            severity: 'low',
          });
        }
      }

      // Check if architecture content is in wrong category
      const hasArchitectureContent = architectureKeywords.some(kw =>
        content.includes(kw.toLowerCase()) || title.includes(kw.toLowerCase())
      );
      if (hasArchitectureContent && category !== 'architecture' && category !== 'decisions' && !page.path.includes('overview')) {
        const archMentions = architectureKeywords.filter(kw => content.includes(kw.toLowerCase()));
        if (archMentions.length >= 3) {
          issues.push({
            type: 'category_mismatch',
            description: `Page "${page.title}" in ${category}/ contains significant architecture content - consider categorization`,
            affectedPages: [page.path],
            severity: 'low',
          });
        }
      }
    }

    return issues;
  }

  private calculateSimpleSimilarity(content1: string, content2: string): number {
    // Simple word-based similarity (Jaccard)
    const words1 = new Set(content1.toLowerCase().split(/\s+/).filter(w => w.length > 4));
    const words2 = new Set(content2.toLowerCase().split(/\s+/).filter(w => w.length > 4));

    if (words1.size === 0 || words2.size === 0) return 0;

    let intersection = 0;
    for (const word of words1) {
      if (words2.has(word)) intersection++;
    }

    const union = words1.size + words2.size - intersection;
    return intersection / union;
  }

  private buildPrompt(pages: WikiPage[], quickIssues: ConsistencyIssue[]): string {
    const categories = new Map<string, WikiPage[]>();
    for (const page of pages) {
      const category = page.path.split('/')[0] ?? 'uncategorized';
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      categories.get(category)!.push(page);
    }

    return `Analyze these wiki pages for consistency issues.

## Wiki Overview

- Total pages: ${pages.length}
- Categories: ${Array.from(categories.keys()).join(', ')}

## Pages by Category

${Array.from(categories.entries()).map(([cat, ps]) => `### ${cat}
${ps.map(p => `- **${p.title}** (${p.path})
  Content preview: ${p.content.slice(0, 300).replace(/\n/g, ' ')}...`).join('\n')}`).join('\n\n')}

## Already Identified Issues

${quickIssues.length > 0 ? quickIssues.map(i => `- [${i.severity}] ${i.type}: ${i.description}`).join('\n') : 'None found in quick check'}

## Your Task

Look for consistency issues:

1. **Terminology**: Are the same concepts called different things in different pages?
2. **Contradictions**: Do any pages contradict each other?
3. **Duplicates**: Is there overlapping content that should be consolidated?
4. **Missing connections**: Are there related pages that should reference each other?
5. **Style**: Are there jarring differences in writing style or formatting?

## Required Output Format

ISSUES:
- severity: high | type: terminology | pages: page1, page2 | Description of the issue

TERMINOLOGY:
- preferred: auth | variants: authentication, authn, login

SUGGESTIONS:
- Specific suggestion for improving consistency

CONFIDENCE: [0-1]

Example:

ISSUES:
- severity: high | type: terminology | pages: auth/overview, api/users | User vs Account inconsistency
- severity: medium | type: duplicate | pages: guides/setup, docs/install | Overlapping installation content

TERMINOLOGY:
- preferred: user | variants: account, member, customer

SUGGESTIONS:
- Standardize on "user" throughout the wiki
- Consolidate setup guides into a single page

CONFIDENCE: 0.8
`;
  }

  private parseResponse(response: string): ConsistencyAnalysis {
    const ctx = createParseContext('consistency', response);

    // Simplified format: - severity: high | type: terminology | pages: page1, page2 | description
    const issuePatterns: ItemPattern<ConsistencyIssue>[] = [
      {
        pattern: /^-\s*severity:\s*(\w+)\s*\|\s*type:\s*(\w+)\s*\|\s*pages:\s*([^|]+)\s*\|\s*(.+)$/i,
        mapper: (m) => ({
          type: m[2]!.toLowerCase(),
          description: m[4]!.trim(),
          affectedPages: m[3]!.split(',').map(p => p.trim()).filter(Boolean),
          severity: m[1]!.toLowerCase() as 'high' | 'medium' | 'low',
        }),
      },
    ];

    const issues = parseListItemsWithFallback(
      ctx,
      'ISSUES',
      /ISSUES:\s*([\s\S]*?)(?=TERMINOLOGY:|SUGGESTIONS:|CONFIDENCE:|$)/i,
      issuePatterns
    );

    // Simplified format: - preferred: auth | variants: authentication, authn, login
    const termPatterns: ItemPattern<{ terms: string[]; description: string }>[] = [
      {
        pattern: /^-\s*preferred:\s*([^|]+)\s*\|\s*variants:\s*(.+)$/i,
        mapper: (m) => ({
          terms: [m[1]!.trim(), ...m[2]!.split(',').map(t => t.trim())],
          description: `Prefer "${m[1]!.trim()}" over: ${m[2]!.trim()}`,
        }),
      },
    ];

    const terminologyMap = parseListItemsWithFallback(
      ctx,
      'TERMINOLOGY',
      /TERMINOLOGY:\s*([\s\S]*?)(?=SUGGESTIONS:|CONFIDENCE:|$)/i,
      termPatterns
    );

    // Parse suggestions
    const suggestions = parseStringList(
      ctx,
      'SUGGESTIONS',
      /SUGGESTIONS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i
    );

    // Parse confidence
    const confidence = parseConfidence(ctx, { defaultValue: 0.7 });

    return {
      issues,
      terminologyMap,
      suggestions,
      confidence,
    };
  }

  private generateUpdates(_analysis: ConsistencyAnalysis): WikiPageUpdate[] {
    // Consistency agent reports issues but doesn't auto-fix
    // Auto-fixing terminology would require careful review
    return [];
  }
}

interface ConsistencyIssue {
  type: string;
  description: string;
  affectedPages: string[];
  severity: 'high' | 'medium' | 'low';
}

interface ConsistencyAnalysis {
  issues: ConsistencyIssue[];
  terminologyMap: Array<{
    terms: string[];
    description: string;
  }>;
  suggestions: string[];
  confidence: number;
}

const SYSTEM_PROMPT = `You are a Consistency Agent for CodeWiki. Your job is to find inconsistencies across wiki pages.

Think like an editor reviewing a multi-author document for consistency. Good documentation:
- Uses consistent terminology (same words for same concepts)
- Doesn't contradict itself between pages
- Consolidates duplicate content
- Has consistent style and tone
- Links related content together

When analyzing:
- Look for the same concept described differently in different places
- Find pages that say contradictory things
- Identify content that appears in multiple places (should be consolidated)
- Note style differences that hurt readability

Focus on cross-page consistency, not individual page quality (that's the Quality Agent's job).`;
