/**
 * WorkTarget - Polymorphic target for work items.
 *
 * Replaces the previous targetCommitId/targetPath nullable fields with a
 * discriminated union, enabling cleaner dispatch logic and future extensibility
 * for story-driven work.
 */

/**
 * Work targeting a specific commit for analysis.
 */
export interface CommitTarget {
  type: 'commit';
  /** Git SHA of the commit to analyze */
  commitId: string;
}

/**
 * Work targeting a file system path (directory or file).
 * Used by exploration agents like codebase-explorer.
 */
export interface PathTarget {
  type: 'path';
  /** File system path relative to repo root */
  path: string;
}

/**
 * Work targeting the wiki as a whole.
 * Used by meta and synthesis agents that operate on wiki state.
 */
export interface WikiTarget {
  type: 'wiki';
}

/**
 * All supported work target types.
 */
export type WorkTarget = CommitTarget | PathTarget | WikiTarget;

/**
 * Type guard for CommitTarget.
 */
export function isCommitTarget(target: WorkTarget): target is CommitTarget {
  return target.type === 'commit';
}

/**
 * Type guard for PathTarget.
 */
export function isPathTarget(target: WorkTarget): target is PathTarget {
  return target.type === 'path';
}

/**
 * Type guard for WikiTarget.
 */
export function isWikiTarget(target: WorkTarget): target is WikiTarget {
  return target.type === 'wiki';
}

/**
 * Create a commit target.
 */
export function createCommitTarget(commitId: string): CommitTarget {
  return { type: 'commit', commitId };
}

/**
 * Create a path target.
 */
export function createPathTarget(path: string): PathTarget {
  return { type: 'path', path };
}

/**
 * Create a wiki target.
 */
export function createWikiTarget(): WikiTarget {
  return { type: 'wiki' };
}

/**
 * Generate a unique key for a work target.
 * Used for deduplication in work queues.
 */
export function getWorkTargetKey(target: WorkTarget): string {
  switch (target.type) {
    case 'commit':
      return `commit:${target.commitId}`;
    case 'path':
      return `path:${target.path}`;
    case 'wiki':
      return 'wiki';
  }
}
