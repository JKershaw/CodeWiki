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
   * Find a page by repo and path.
   */
  findByPath(repoId: string, path: string): Promise<WikiPage | null>;

  /**
   * Find all pages for a repo.
   */
  findByRepo(repoId: string): Promise<WikiPage[]>;

  /**
   * Find pages with low confidence (below threshold).
   */
  findLowConfidence(repoId: string, threshold: number): Promise<WikiPage[]>;

  /**
   * Find pages updated since a given date.
   */
  findRecentlyUpdated(repoId: string, since: Date): Promise<WikiPage[]>;

  /**
   * Search pages by content (simple text search).
   */
  search(repoId: string, query: string): Promise<WikiPage[]>;

  /**
   * Save a page (create or update).
   */
  save(page: WikiPage): Promise<void>;

  /**
   * Delete a page by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all pages for a repo.
   */
  deleteByRepo(repoId: string): Promise<void>;

  /**
   * Update a page's content and metadata.
   */
  updateContent(id: string, updates: {
    content: string;
    confidence?: number;
    sourceCommitId?: string;
  }): Promise<void>;

  /**
   * Add a backlink to a page.
   */
  addBacklink(pageId: string, linkingPagePath: string): Promise<void>;

  /**
   * Remove a backlink from a page.
   */
  removeBacklink(pageId: string, linkingPagePath: string): Promise<void>;
}
