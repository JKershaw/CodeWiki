import type { AgentContext, AgentRunResult } from '../base-agent.js';
import type { FindingGroup, FindingType } from '../../domain/finding.js';
import type { WikiPage, WikiPageUpdate } from '../../domain/wiki-page.js';
import { createGetWikiPageQuery, handleGetWikiPage } from '../../queries/index.js';

/**
 * Result from processing a finding group.
 */
export interface FindingHandlerResult extends AgentRunResult {
  /** ID of the agent run (for marking findings as addressed) */
  agentRunId?: string;
}

/**
 * Interface for finding handlers that process specific types of findings.
 * Implements the Strategy Pattern to allow different handling logic for each finding type.
 */
export interface FindingHandler {
  /**
   * The finding types this handler can process.
   * A handler may support multiple related types (e.g., duplicate_title and similar_content).
   */
  readonly supportedTypes: readonly FindingType[];

  /**
   * Process a group of related findings.
   *
   * @param group - The finding group to process
   * @param context - Agent execution context
   * @returns Processing result with updates and findings
   */
  handle(group: FindingGroup, context: AgentContext): Promise<FindingHandlerResult>;
}

/**
 * Shared utilities for finding handlers.
 */
export const HandlerUtils = {
  /**
   * Load wiki pages by their paths via CQRS queries.
   */
  async loadPages(paths: string[], context: AgentContext): Promise<WikiPage[]> {
    const pages: WikiPage[] = [];
    for (const path of paths) {
      const pageQuery = createGetWikiPageQuery(context.wikiId, path);
      const pageResult = await handleGetWikiPage(pageQuery, context.repos);
      if (pageResult.success && pageResult.data) {
        pages.push(pageResult.data);
      }
    }
    return pages;
  },

  /**
   * Escape special regex characters in a string.
   */
  escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  /**
   * Create a standard empty result when no processing is needed.
   */
  createEmptyResult(summary: string): FindingHandlerResult {
    return {
      result: {
        summary,
        findings: [],
        confidence: 1.0,
      },
      updates: [],
      costUsd: 0,
    };
  },
};
