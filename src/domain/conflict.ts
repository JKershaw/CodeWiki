/**
 * Represents a detected conflict when multiple sources assert different information.
 */
export interface Conflict {
  id: string;
  /** Reference to the wiki */
  wikiId: string;
  /** Wiki page where the conflict was detected */
  pagePathaffected: string;
  /** Type of conflict */
  type: ConflictType;
  /** Description of the conflict */
  description: string;
  /** The conflicting assertions */
  assertions: ConflictingAssertion[];
  /** How the conflict was resolved */
  resolution: ConflictResolution | null;
  /** Current status */
  status: ConflictStatus;
  /** When the conflict was detected */
  detectedAt: Date;
  /** When the conflict was resolved */
  resolvedAt: Date | null;
}

export type ConflictType =
  | 'factual'       // Two commits assert different facts
  | 'structural'    // Disagreement about how to organize content
  | 'naming'        // Inconsistent terminology
  | 'outdated';     // Old information contradicts new

export type ConflictStatus =
  | 'open'          // Not yet resolved
  | 'auto-resolved' // Automatically resolved by timestamp
  | 'manual'        // Manually resolved by user
  | 'deferred';     // Intentionally left unresolved

export interface ConflictingAssertion {
  /** The asserted content */
  content: string;
  /** Commit that made this assertion */
  sourceCommitId: string;
  /** When this assertion was made */
  assertedAt: Date;
  /** Agent run that detected this */
  agentRunId: string;
}

export interface ConflictResolution {
  /** Which assertion won */
  winningAssertionIndex: number;
  /** Why this resolution was chosen */
  reason: string;
  /** Resolution method */
  method: 'timestamp' | 'confidence' | 'manual';
}

export function createConflict(params: {
  id: string;
  wikiId: string;
  pagePath: string;
  type: ConflictType;
  description: string;
  assertions: ConflictingAssertion[];
}): Conflict {
  return {
    id: params.id,
    wikiId: params.wikiId,
    pagePathaffected: params.pagePath,
    type: params.type,
    description: params.description,
    assertions: params.assertions,
    resolution: null,
    status: 'open',
    detectedAt: new Date(),
    resolvedAt: null,
  };
}

/**
 * Resolve a conflict using timestamp (most recent wins).
 */
export function resolveByTimestamp(conflict: Conflict): Conflict {
  if (conflict.assertions.length === 0) {
    return conflict;
  }

  let winningIndex = 0;
  let latestDate = conflict.assertions[0]!.assertedAt;

  for (let i = 1; i < conflict.assertions.length; i++) {
    const assertion = conflict.assertions[i]!;
    if (assertion.assertedAt > latestDate) {
      latestDate = assertion.assertedAt;
      winningIndex = i;
    }
  }

  return {
    ...conflict,
    resolution: {
      winningAssertionIndex: winningIndex,
      reason: 'Most recent commit wins',
      method: 'timestamp',
    },
    status: 'auto-resolved',
    resolvedAt: new Date(),
  };
}
