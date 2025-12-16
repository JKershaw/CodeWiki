/**
 * File reference validation helpers for LLM tests.
 *
 * Validates file references against an actual source file tree to measure
 * accuracy of LLM-generated file references.
 */

export interface FileReferenceMetrics {
  /** Total number of file references found */
  totalReferences: number;
  /** Number of references that matched actual files */
  validReferences: number;
  /** References that didn't match any actual file */
  brokenReferences: string[];
  /** Accuracy rate (validReferences / totalReferences) */
  accuracyRate: number;
}

/**
 * Validate file references against a source file tree.
 *
 * @param references - Array of file paths referenced by an agent
 * @param sourceFileTree - Set of actual file paths in the repository
 * @returns Metrics about reference validity
 */
export function validateFileReferences(
  references: string[],
  sourceFileTree: Set<string>
): FileReferenceMetrics {
  // Filter out obvious non-file references (directories with trailing slash)
  const fileReferences = references.filter(ref => !ref.endsWith('/'));

  const validRefs: string[] = [];
  const brokenRefs: string[] = [];

  for (const ref of fileReferences) {
    if (sourceFileTree.has(ref)) {
      validRefs.push(ref);
    } else {
      brokenRefs.push(ref);
    }
  }

  const total = fileReferences.length;
  const accuracyRate = total > 0 ? validRefs.length / total : 1;

  return {
    totalReferences: total,
    validReferences: validRefs.length,
    brokenReferences: brokenRefs,
    accuracyRate,
  };
}

/**
 * Format metrics for console output.
 */
export function formatFileReferenceMetrics(
  testName: string,
  metrics: FileReferenceMetrics
): string {
  const lines = [
    `📊 File Reference Accuracy: ${testName}`,
    `   Total references: ${metrics.totalReferences}`,
    `   Valid: ${metrics.validReferences}`,
    `   Broken: ${metrics.brokenReferences.length}`,
    `   Accuracy: ${(metrics.accuracyRate * 100).toFixed(1)}%`,
  ];

  if (metrics.brokenReferences.length > 0) {
    lines.push(`   Broken refs:`);
    for (const ref of metrics.brokenReferences.slice(0, 10)) {
      lines.push(`     - ${ref}`);
    }
    if (metrics.brokenReferences.length > 10) {
      lines.push(`     ... and ${metrics.brokenReferences.length - 10} more`);
    }
  }

  return lines.join('\n');
}

/**
 * Combine file references from multiple sources (filesAccessed, filesReferenced, etc.)
 * into a unique set for validation.
 */
export function collectAllReferences(
  ...sources: (string[] | undefined)[]
): string[] {
  const all = new Set<string>();
  for (const source of sources) {
    if (source) {
      for (const ref of source) {
        all.add(ref);
      }
    }
  }
  return Array.from(all);
}
