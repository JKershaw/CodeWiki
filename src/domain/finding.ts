/**
 * Represents a detected issue in the wiki that may require consolidation.
 * Findings are detected by meta agents (Consistency, Quality, Structure)
 * and addressed by the ConsolidationAgent.
 */
export interface Finding {
  id: string;
  /** Wiki where this finding was detected */
  wikiId: string;
  /** Repository ID */
  repoId: string;
  /** Agent run that created this finding */
  sourceAgentRunId: string;
  /** Type of finding */
  type: FindingType;
  /** Human-readable description */
  description: string;
  /** Wiki page paths affected by this finding */
  affectedPaths: string[];
  /** Severity/importance of the finding */
  severity: 'low' | 'medium' | 'high';
  /** Current status of the finding */
  status: FindingStatus;
  /** When the finding was detected */
  detectedAt: Date;
  /** When the finding was addressed (if applicable) */
  addressedAt: Date | null;
  /** Agent run that addressed this finding (if applicable) */
  addressedByAgentRunId: string | null;
  /** Additional metadata specific to the finding type */
  metadata?: FindingMetadata;
}

/**
 * Types of findings that can be detected and addressed.
 */
export type FindingType =
  | 'duplicate_title'      // Two pages with same/similar title
  | 'similar_content'      // Pages with overlapping content
  | 'broken_link'          // Link to non-existent page
  | 'orphaned_page'        // Page with no links to/from it
  | 'terminology'          // Inconsistent terminology across pages
  | 'category_mismatch'    // Content in wrong category
  | 'contradiction'        // Contradictory information between pages
  | 'low_quality'          // Page flagged as low quality
  | 'inaccurate';          // Wiki content doesn't match source code

/**
 * Status of a finding.
 */
export type FindingStatus =
  | 'open'       // Detected, not yet addressed
  | 'in_progress' // Being addressed by consolidation agent
  | 'addressed'  // Successfully addressed
  | 'dismissed'; // Manually dismissed or determined to be false positive

/**
 * Metadata specific to finding types.
 */
export interface FindingMetadata {
  /** For duplicate/similar: similarity score */
  similarityScore?: number;
  /** For terminology: the conflicting terms */
  terms?: string[];
  /** For broken_link: the broken link path */
  brokenLinkPath?: string;
  /** For consolidation: suggested action */
  suggestedAction?: 'merge' | 'delete' | 'update' | 'move';
  /** For merge: which page should be kept */
  keepPagePath?: string;
  /** For merge: which page should be removed */
  removePagePath?: string;
  /** For inaccurate: the incorrect claim from the wiki */
  claim?: string;
  /** For inaccurate: the source file that contradicts the claim */
  sourceFile?: string;
  /** For inaccurate: what the code actually does */
  actualBehavior?: string;
  /** For inaccurate: relevant code snippet as evidence */
  codeSnippet?: string;
}

/**
 * Group of related findings that should be addressed together.
 */
export interface FindingGroup {
  /** Primary finding type */
  type: FindingType;
  /** All findings in this group */
  findings: Finding[];
  /** Common affected paths across all findings */
  affectedPaths: string[];
  /** Highest severity in the group */
  severity: 'low' | 'medium' | 'high';
}

/**
 * Create a new finding.
 */
export function createFinding(params: {
  id: string;
  wikiId: string;
  repoId: string;
  sourceAgentRunId: string;
  type: FindingType;
  description: string;
  affectedPaths: string[];
  severity: 'low' | 'medium' | 'high';
  metadata?: FindingMetadata;
}): Finding {
  const finding: Finding = {
    id: params.id,
    wikiId: params.wikiId,
    repoId: params.repoId,
    sourceAgentRunId: params.sourceAgentRunId,
    type: params.type,
    description: params.description,
    affectedPaths: params.affectedPaths,
    severity: params.severity,
    status: 'open',
    detectedAt: new Date(),
    addressedAt: null,
    addressedByAgentRunId: null,
  };

  if (params.metadata) {
    finding.metadata = params.metadata;
  }

  return finding;
}

/**
 * Priority order for finding types (higher = more urgent).
 */
export const FindingPriority: Record<FindingType, number> = {
  contradiction: 100,     // Highest - factual errors between pages
  inaccurate: 95,         // Very high - wiki disagrees with source code
  broken_link: 90,        // High - user experience issue
  duplicate_title: 80,    // High - confusing
  similar_content: 60,    // Medium - maintenance issue
  terminology: 50,        // Medium - consistency
  category_mismatch: 40,  // Low-medium - organization
  orphaned_page: 30,      // Low - discoverability
  low_quality: 20,        // Low - quality improvement
};
