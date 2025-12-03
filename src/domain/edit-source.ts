/**
 * EditSource - Polymorphic source information for edit requests.
 *
 * Replaces the commit-specific sourceCommitSha/sourceCommitTimestamp fields
 * with a discriminated union, enabling non-commit sources like stories.
 */

/**
 * Edit originating from a commit analysis.
 */
export interface CommitEditSource {
  type: 'commit';
  /** Git SHA of the source commit */
  commitSha: string;
  /** Timestamp of the source commit (for ordering) */
  commitTimestamp: Date;
}

/**
 * Edit originating from a story-driven workflow.
 * (Future support for demand-driven wiki generation)
 */
export interface StoryEditSource {
  type: 'story';
  /** ID of the story that generated this edit */
  storyId: string;
  /** Phase of the story workflow (e.g., 'write', 'learn') */
  phase: string;
  /** Timestamp for ordering */
  timestamp: Date;
}

/**
 * Edit originating from manual user action.
 */
export interface ManualEditSource {
  type: 'manual';
  /** User or system identifier */
  userId?: string;
  /** Reason for the edit */
  reason?: string;
  /** Timestamp for ordering */
  timestamp: Date;
}

/**
 * All supported edit source types.
 */
export type EditSource = CommitEditSource | StoryEditSource | ManualEditSource;

/**
 * Type guard for CommitEditSource.
 */
export function isCommitEditSource(source: EditSource): source is CommitEditSource {
  return source.type === 'commit';
}

/**
 * Type guard for StoryEditSource.
 */
export function isStoryEditSource(source: EditSource): source is StoryEditSource {
  return source.type === 'story';
}

/**
 * Type guard for ManualEditSource.
 */
export function isManualEditSource(source: EditSource): source is ManualEditSource {
  return source.type === 'manual';
}

/**
 * Create a commit edit source.
 */
export function createCommitEditSource(commitSha: string, commitTimestamp: Date): CommitEditSource {
  return { type: 'commit', commitSha, commitTimestamp };
}

/**
 * Create a story edit source.
 */
export function createStoryEditSource(storyId: string, phase: string, timestamp?: Date): StoryEditSource {
  return { type: 'story', storyId, phase, timestamp: timestamp ?? new Date() };
}

/**
 * Create a manual edit source.
 */
export function createManualEditSource(userId?: string, reason?: string): ManualEditSource {
  return { type: 'manual', userId, reason, timestamp: new Date() };
}

/**
 * Get the ordering timestamp from any edit source.
 */
export function getEditSourceTimestamp(source: EditSource): Date {
  switch (source.type) {
    case 'commit':
      return source.commitTimestamp;
    case 'story':
    case 'manual':
      return source.timestamp;
  }
}

/**
 * Convert legacy commit fields to EditSource.
 */
export function legacyToEditSource(
  sourceCommitSha: string,
  sourceCommitTimestamp: Date
): CommitEditSource {
  return createCommitEditSource(sourceCommitSha, sourceCommitTimestamp);
}

/**
 * Extract legacy commit fields from EditSource (for backward compatibility).
 * Returns null values for non-commit sources.
 */
export function editSourceToLegacy(source: EditSource): {
  sourceCommitSha: string | null;
  sourceCommitTimestamp: Date | null;
} {
  if (isCommitEditSource(source)) {
    return {
      sourceCommitSha: source.commitSha,
      sourceCommitTimestamp: source.commitTimestamp,
    };
  }
  return {
    sourceCommitSha: null,
    sourceCommitTimestamp: null,
  };
}
