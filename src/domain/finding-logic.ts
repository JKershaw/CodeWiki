/**
 * Pure business logic for grouping and organizing findings.
 *
 * Extracted from repository layer to enable reuse across different
 * storage implementations (file-based, MongoDB).
 */

import type { Finding, FindingType, FindingGroup } from './finding.js';
import { FindingPriority } from './finding.js';

/**
 * Calculate the highest severity from a list of findings.
 */
export function calculateHighestSeverity(
  findings: Finding[]
): 'low' | 'medium' | 'high' {
  let highest: 'low' | 'medium' | 'high' = 'low';
  for (const f of findings) {
    if (f.severity === 'high') return 'high';
    if (f.severity === 'medium') highest = 'medium';
  }
  return highest;
}

/**
 * Collect all unique affected paths from a list of findings.
 */
export function collectAffectedPaths(findings: Finding[]): string[] {
  const allPaths = new Set<string>();
  for (const f of findings) {
    f.affectedPaths.forEach(p => allPaths.add(p));
  }
  return Array.from(allPaths);
}

/**
 * Group findings that share common affected paths using Union-Find algorithm.
 *
 * This is useful for finding types like 'duplicate_title' and 'similar_content'
 * where multiple findings might reference overlapping sets of pages.
 */
export function groupBySharedPaths(findings: Finding[]): Finding[][] {
  if (findings.length <= 1) {
    return findings.length === 0 ? [] : [findings];
  }

  // Use Union-Find to group findings with overlapping paths
  const parent = new Map<string, string>();

  const findRoot = (path: string): string => {
    if (!parent.has(path)) {
      parent.set(path, path);
    }
    if (parent.get(path) !== path) {
      parent.set(path, findRoot(parent.get(path)!));
    }
    return parent.get(path)!;
  };

  const union = (path1: string, path2: string): void => {
    const root1 = findRoot(path1);
    const root2 = findRoot(path2);
    if (root1 !== root2) {
      parent.set(root1, root2);
    }
  };

  // Connect all paths within each finding
  for (const finding of findings) {
    if (finding.affectedPaths.length > 1) {
      for (let i = 1; i < finding.affectedPaths.length; i++) {
        union(finding.affectedPaths[0]!, finding.affectedPaths[i]!);
      }
    }
  }

  // Group findings by their root path
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (finding.affectedPaths.length === 0) continue;
    const root = findRoot(finding.affectedPaths[0]!);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root)!.push(finding);
  }

  return Array.from(groups.values());
}

/**
 * Types that should be further grouped by shared paths.
 */
const TYPES_REQUIRING_PATH_GROUPING: FindingType[] = [
  'duplicate_title',
  'similar_content',
];

/**
 * Group findings into FindingGroups organized by type.
 *
 * For certain types (duplicate_title, similar_content), findings are further
 * sub-grouped by shared paths to identify related issues.
 *
 * Groups are sorted by priority (highest first), then by severity.
 */
export function groupFindings(findings: Finding[]): FindingGroup[] {
  if (findings.length === 0) {
    return [];
  }

  // Group by type
  const byType = new Map<FindingType, Finding[]>();
  for (const finding of findings) {
    if (!byType.has(finding.type)) {
      byType.set(finding.type, []);
    }
    byType.get(finding.type)!.push(finding);
  }

  // Create finding groups
  const groups: FindingGroup[] = [];

  for (const [type, typeFindings] of byType) {
    if (TYPES_REQUIRING_PATH_GROUPING.includes(type)) {
      // For duplicate_title and similar_content, further group by affected paths
      const pathGroups = groupBySharedPaths(typeFindings);
      for (const groupFindings of pathGroups) {
        groups.push({
          type,
          findings: groupFindings,
          affectedPaths: collectAffectedPaths(groupFindings),
          severity: calculateHighestSeverity(groupFindings),
        });
      }
    } else {
      // For other types, create one group per type
      groups.push({
        type,
        findings: typeFindings,
        affectedPaths: collectAffectedPaths(typeFindings),
        severity: calculateHighestSeverity(typeFindings),
      });
    }
  }

  // Sort groups by priority, then by severity
  const severityOrder = { high: 3, medium: 2, low: 1 };
  groups.sort((a, b) => {
    const priorityDiff = (FindingPriority[b.type] ?? 0) - (FindingPriority[a.type] ?? 0);
    if (priorityDiff !== 0) return priorityDiff;
    return severityOrder[b.severity] - severityOrder[a.severity];
  });

  return groups;
}
