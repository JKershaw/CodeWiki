import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import type { WikiPage } from '../../domain/wiki-page.js';

/**
 * Table of Contents Agent - Adds navigation TOCs to wiki pages.
 *
 * This agent scans wiki pages and adds table of contents sections to pages
 * that have multiple headings but no TOC yet. This improves navigation
 * within long pages.
 *
 * Features:
 * - Identifies pages with 3+ headings that would benefit from a TOC
 * - Generates markdown TOC with proper anchor links
 * - Inserts TOC after the first heading (title)
 * - Skips pages that already have a TOC section
 * - Respects page confidence (only high-confidence pages get TOCs)
 *
 * Trigger: When wiki has 5+ pages and analysis is complete.
 */
export class TableOfContentsAgent implements Agent {
  readonly type: AgentType = 'toc';

  private readonly MIN_PAGES_FOR_TOC = 5;
  private readonly MIN_HEADINGS_FOR_TOC = 3;
  private readonly MIN_CONFIDENCE_FOR_TOC = 0.5;

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('TableOfContentsAgent does not run on commits. Use runOnWiki instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    const pages = await context.repos.wikiPages.findByWiki(context.wikiId);

    // Check if we have enough pages
    if (pages.length < this.MIN_PAGES_FOR_TOC) {
      return {
        result: createAgentResult({
          summary: `Wiki has ${pages.length} pages, need ${this.MIN_PAGES_FOR_TOC}+ for TOC generation`,
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Find pages that need TOC
    const pagesToUpdate: Array<{ page: WikiPage; toc: string; headings: Heading[] }> = [];

    for (const page of pages) {
      // Skip low-confidence pages
      if (page.confidence < this.MIN_CONFIDENCE_FOR_TOC) {
        continue;
      }

      // Skip pages that already have TOC
      if (this.hasToc(page.content)) {
        continue;
      }

      // Skip navigation/index pages (they serve as TOC themselves)
      if (page.path.includes('navigation/') || page.path.endsWith('/index')) {
        continue;
      }

      // Extract headings
      const headings = this.extractHeadings(page.content);

      // Skip if not enough headings
      if (headings.length < this.MIN_HEADINGS_FOR_TOC) {
        continue;
      }

      // Generate TOC
      const toc = this.generateToc(headings);
      pagesToUpdate.push({ page, toc, headings });
    }

    // Limit updates per run to avoid overwhelming the system
    const maxUpdatesPerRun = 5;
    const updatesToProcess = pagesToUpdate.slice(0, maxUpdatesPerRun);

    if (updatesToProcess.length === 0) {
      return {
        result: createAgentResult({
          summary: 'No pages need TOC additions',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Generate wiki updates
    const updates: WikiPageUpdate[] = updatesToProcess.map(({ page, toc }) => ({
      type: 'update' as const,
      path: page.path,
      title: page.title,
      content: this.insertToc(page.content, toc),
      sourceCommitId: page.sourceCommits[0] ?? '',
      agentRunId: '',
      confidenceDelta: 0.05, // Slight confidence boost for better navigation
    }));

    return {
      result: createAgentResult({
        summary: `Added table of contents to ${updatesToProcess.length} pages`,
        findings: updatesToProcess.map(({ page, headings }) =>
          createFinding({
            type: 'NAVIGATION',
            description: `Added TOC with ${headings.length} sections to ${page.path}`,
            relatedPaths: [page.path],
            importance: 'medium',
          })
        ),
        confidence: 0.85,
      }),
      updates,
      costUsd: 0, // No LLM cost - pure computation
    };
  }

  /**
   * Check if page already has a table of contents.
   */
  private hasToc(content: string): boolean {
    const tocIndicators = [
      '## Table of Contents',
      '## Contents',
      '## TOC',
      '## In This Page',
      '## On This Page',
      '<!-- TOC -->',
      '**Table of Contents**',
    ];

    const lowerContent = content.toLowerCase();
    return tocIndicators.some(indicator =>
      lowerContent.includes(indicator.toLowerCase())
    );
  }

  /**
   * Extract headings from markdown content.
   */
  private extractHeadings(content: string): Heading[] {
    const headings: Heading[] = [];
    const lines = content.split('\n');
    let inCodeBlock = false;

    for (const line of lines) {
      // Track code blocks
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }

      // Skip if in code block
      if (inCodeBlock) continue;

      // Match markdown headings
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const level = match[1]!.length;
        const text = match[2]!.trim();

        // Skip the main title (level 1)
        if (level === 1) continue;

        headings.push({
          level,
          text,
          anchor: this.createAnchor(text),
        });
      }
    }

    return headings;
  }

  /**
   * Create anchor from heading text.
   */
  private createAnchor(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special chars except hyphen
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Collapse multiple hyphens
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  }

  /**
   * Generate table of contents markdown.
   */
  private generateToc(headings: Heading[]): string {
    let toc = '## Table of Contents\n\n';

    for (const heading of headings) {
      // Calculate indent based on heading level (h2 = no indent, h3 = 1 indent, etc.)
      const indent = '  '.repeat(heading.level - 2);
      toc += `${indent}- [${heading.text}](#${heading.anchor})\n`;
    }

    return toc;
  }

  /**
   * Insert TOC after the first heading in the content.
   */
  private insertToc(content: string, toc: string): string {
    const lines = content.split('\n');
    let insertIndex = -1;

    // Find the end of the first heading (h1)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.match(/^#\s+/)) {
        // Found h1, insert after it (skip any immediately following empty lines)
        insertIndex = i + 1;
        while (insertIndex < lines.length && lines[insertIndex]!.trim() === '') {
          insertIndex++;
        }
        break;
      }
    }

    // If no h1 found, insert at the beginning
    if (insertIndex === -1) {
      insertIndex = 0;
    }

    // Check if there's an intro paragraph before the first h2
    // If so, insert TOC after the intro
    let firstH2Index = -1;
    for (let i = insertIndex; i < lines.length; i++) {
      if (lines[i]!.match(/^##\s+/)) {
        firstH2Index = i;
        break;
      }
    }

    // If there's content between h1 and first h2, that's the intro
    // Insert TOC right before the first h2
    if (firstH2Index > insertIndex) {
      // Look backwards from h2 to find the right spot (after any blank lines)
      let tocInsertIndex = firstH2Index;
      while (tocInsertIndex > insertIndex && lines[tocInsertIndex - 1]!.trim() === '') {
        tocInsertIndex--;
      }
      insertIndex = tocInsertIndex;
    }

    // Insert the TOC
    lines.splice(insertIndex, 0, '', toc, '---', '');

    return lines.join('\n');
  }
}

interface Heading {
  level: number;
  text: string;
  anchor: string;
}
