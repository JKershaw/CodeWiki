import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage, WikiPageUpdate } from '../../domain/wiki-page.js';

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

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('ConsistencyAgent does not run on commits. Use runOnWiki instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    const pages = await context.repos.wikiPages.findByWiki(context.wikiId);

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
- [SEVERITY:high/medium/low] | [TYPE:terminology/contradiction/duplicate/style] | [affected-paths] | Description

TERMINOLOGY_MAP:
- [term1] = [term2] = [term3]: These all refer to the same concept

SUGGESTIONS:
- Specific suggestion for improving consistency

CONFIDENCE: [0-1]
`;
  }

  private parseResponse(response: string): ConsistencyAnalysis {
    const analysis: ConsistencyAnalysis = {
      issues: [],
      terminologyMap: [],
      suggestions: [],
      confidence: 0.7,
    };

    // Parse issues
    const issuesMatch = response.match(/ISSUES:\s*([\s\S]*?)(?=TERMINOLOGY_MAP:|SUGGESTIONS:|CONFIDENCE:|$)/i);
    if (issuesMatch) {
      const lines = issuesMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\[SEVERITY:(\w+)\]\s*\|\s*\[TYPE:(\w+)\]\s*\|\s*\[([^\]]*)\]\s*\|\s*(.+)$/i);
        if (match) {
          analysis.issues.push({
            type: match[2]!.toLowerCase(),
            description: match[4]!.trim(),
            affectedPages: match[3]!.split(',').map(p => p.trim()).filter(Boolean),
            severity: match[1]!.toLowerCase() as 'high' | 'medium' | 'low',
          });
        }
      }
    }

    // Parse terminology map
    const termMatch = response.match(/TERMINOLOGY_MAP:\s*([\s\S]*?)(?=SUGGESTIONS:|CONFIDENCE:|$)/i);
    if (termMatch) {
      const lines = termMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*(.+?):\s*(.+)$/);
        if (match) {
          const terms = match[1]!.split('=').map(t => t.trim());
          analysis.terminologyMap.push({
            terms,
            description: match[2]!.trim(),
          });
        }
      }
    }

    // Parse suggestions
    const suggestionsMatch = response.match(/SUGGESTIONS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (suggestionsMatch) {
      const lines = suggestionsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        analysis.suggestions.push(line.replace(/^-\s*/, '').trim());
      }
    }

    // Parse confidence
    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    if (confidenceMatch) {
      analysis.confidence = parseFloat(confidenceMatch[1]!);
    }

    return analysis;
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
