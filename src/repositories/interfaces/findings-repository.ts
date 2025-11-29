import type { Finding, FindingType, FindingStatus, FindingGroup } from '../../domain/finding.js';

/**
 * Repository interface for managing wiki findings.
 * Findings are issues detected by meta agents that need to be addressed.
 */
export interface FindingsRepository {
  /**
   * Find a finding by its ID.
   */
  findById(id: string): Promise<Finding | null>;

  /**
   * Find all findings for a wiki.
   */
  findByWiki(wikiId: string, options?: {
    status?: FindingStatus;
    type?: FindingType;
    limit?: number;
  }): Promise<Finding[]>;

  /**
   * Find all open (unaddressed) findings for a wiki.
   */
  findOpen(wikiId: string): Promise<Finding[]>;

  /**
   * Find findings affecting specific page paths.
   */
  findByPaths(wikiId: string, paths: string[]): Promise<Finding[]>;

  /**
   * Find findings created by a specific agent run.
   */
  findByAgentRun(agentRunId: string): Promise<Finding[]>;

  /**
   * Group open findings by type for consolidation work.
   * Groups findings that should be addressed together.
   */
  groupOpenFindings(wikiId: string): Promise<FindingGroup[]>;

  /**
   * Count open findings by type.
   */
  countOpenByType(wikiId: string): Promise<Record<FindingType, number>>;

  /**
   * Save a finding (create or update).
   */
  save(finding: Finding): Promise<void>;

  /**
   * Save multiple findings at once.
   */
  saveMany(findings: Finding[]): Promise<void>;

  /**
   * Mark a finding as being addressed.
   */
  markInProgress(id: string, agentRunId: string): Promise<void>;

  /**
   * Mark a finding as addressed.
   */
  markAddressed(id: string, agentRunId: string): Promise<void>;

  /**
   * Mark a finding as dismissed.
   */
  markDismissed(id: string): Promise<void>;

  /**
   * Delete a finding by ID.
   */
  delete(id: string): Promise<void>;

  /**
   * Delete all findings for a wiki.
   */
  deleteByWiki(wikiId: string): Promise<void>;

  /**
   * Delete findings for a specific agent run.
   * Used when an agent run is invalidated.
   */
  deleteByAgentRun(agentRunId: string): Promise<void>;

  /**
   * Check if a similar finding already exists (to prevent duplicates).
   */
  existsSimilar(wikiId: string, type: FindingType, affectedPaths: string[]): Promise<boolean>;
}
