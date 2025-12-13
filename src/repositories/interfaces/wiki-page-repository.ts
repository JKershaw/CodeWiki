import type { WikiPage } from '../../domain/wiki-page.js';

/**
 * Repository interface for managing wiki pages.
 */
export interface WikiPageRepository {
  /**
   * Find a page by its ID.
   */
  findById(id: string): Promise<WikiPage | null>;

  /**
   * Find a page by wiki and path.
   */
  findByPath(wikiId: string, path: string): Promise<WikiPage | null>;

  /**
   * Find all pages for a wiki.
   */
  findByWiki(wikiId: string): Promise<WikiPage[]>;

  /**
   * Find pages with low confidence (below threshold).
   */
  findLowConfidence(wikiId: string, threshold: number): Promise<WikiPage[]>;

  /**
   * Find pages updated since a given date.
   */
  findRecentlyUpdated(wikiId: string, since: Date): Promise<WikiPage[]>;

  /**
   * Search pages by content (simple text search).
   */
  search(wikiId: string, query: string): Promise<WikiPage[]>;

  /**
   * Save a page (create or update).
   */
  save(page: WikiPage): Promise<void>;

  /**
   * Delete a page by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all pages for a wiki.
   */
  deleteByWiki(wikiId: string): Promise<void>;

  /**
   * Update a page's content and metadata.
   */
  updateContent(id: string, updates: {
    content: string;
    title?: string;
    confidence?: number;
    sourceCommitId?: string;
    sourceAgentRunId?: string;
    /** Category for the page (e.g., "architecture", "security") */
    category?: string;
    /** Confidence score for the category assignment (0-1) */
    categoryConfidence?: number;
    /** Files that were read by agents during this update (accumulated) */
    filesAccessed?: string[];
    /** Files/folders mentioned in the page content (replaced on update) */
    filesReferenced?: string[];
    /** Files/folders that agents were asked to analyze (accumulated) */
    targetPaths?: string[];
  }): Promise<void>;

  /**
   * Add a backlink to a page.
   */
  addBacklink(pageId: string, linkingPagePath: string): Promise<void>;

  /**
   * Remove a backlink from a page.
   */
  removeBacklink(pageId: string, linkingPagePath: string): Promise<void>;

  /**
   * Update the links array on a page.
   */
  updateLinks(pageId: string, links: string[]): Promise<void>;
}
