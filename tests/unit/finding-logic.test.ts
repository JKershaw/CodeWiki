/**
 * Unit tests for finding-logic domain module.
 * Tests pure business logic for grouping findings.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateHighestSeverity,
  collectAffectedPaths,
  groupBySharedPaths,
  groupFindings,
} from '../../src/domain/finding-logic.js';
import { createFinding, type Finding } from '../../src/domain/finding.js';
import { v4 as uuid } from 'uuid';

function makeTestFinding(overrides: Partial<Finding> & { type: Finding['type'] }): Finding {
  return createFinding({
    id: uuid(),
    wikiId: 'wiki-1',
    repoId: 'repo-1',
    sourceAgentRunId: 'run-1',
    description: 'Test finding',
    affectedPaths: ['path/a'],
    severity: 'medium',
    ...overrides,
  });
}

describe('Finding Logic', () => {
  describe('calculateHighestSeverity', () => {
    it('returns low when all findings are low severity', () => {
      const findings = [
        makeTestFinding({ type: 'broken_link', severity: 'low' }),
        makeTestFinding({ type: 'broken_link', severity: 'low' }),
      ];
      assert.strictEqual(calculateHighestSeverity(findings), 'low');
    });

    it('returns medium when highest is medium', () => {
      const findings = [
        makeTestFinding({ type: 'broken_link', severity: 'low' }),
        makeTestFinding({ type: 'broken_link', severity: 'medium' }),
      ];
      assert.strictEqual(calculateHighestSeverity(findings), 'medium');
    });

    it('returns high when any finding is high', () => {
      const findings = [
        makeTestFinding({ type: 'broken_link', severity: 'low' }),
        makeTestFinding({ type: 'broken_link', severity: 'high' }),
        makeTestFinding({ type: 'broken_link', severity: 'medium' }),
      ];
      assert.strictEqual(calculateHighestSeverity(findings), 'high');
    });

    it('returns low for empty array', () => {
      assert.strictEqual(calculateHighestSeverity([]), 'low');
    });
  });

  describe('collectAffectedPaths', () => {
    it('collects unique paths from all findings', () => {
      const findings = [
        makeTestFinding({ type: 'broken_link', affectedPaths: ['a', 'b'] }),
        makeTestFinding({ type: 'broken_link', affectedPaths: ['b', 'c'] }),
      ];
      const paths = collectAffectedPaths(findings);
      assert.strictEqual(paths.length, 3);
      assert.ok(paths.includes('a'));
      assert.ok(paths.includes('b'));
      assert.ok(paths.includes('c'));
    });

    it('returns empty array for empty input', () => {
      const paths = collectAffectedPaths([]);
      assert.strictEqual(paths.length, 0);
    });
  });

  describe('groupBySharedPaths', () => {
    it('returns empty array for empty input', () => {
      const groups = groupBySharedPaths([]);
      assert.strictEqual(groups.length, 0);
    });

    it('returns single group for single finding', () => {
      const findings = [makeTestFinding({ type: 'duplicate_title', affectedPaths: ['a', 'b'] })];
      const groups = groupBySharedPaths(findings);
      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0]!.length, 1);
    });

    it('groups findings with overlapping paths', () => {
      const findings = [
        makeTestFinding({ type: 'duplicate_title', affectedPaths: ['a', 'b'] }),
        makeTestFinding({ type: 'duplicate_title', affectedPaths: ['b', 'c'] }),
      ];
      const groups = groupBySharedPaths(findings);
      // Should be one group because 'b' is shared
      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0]!.length, 2);
    });

    it('keeps findings with disjoint paths in separate groups', () => {
      const findings = [
        makeTestFinding({ type: 'duplicate_title', affectedPaths: ['a', 'b'] }),
        makeTestFinding({ type: 'duplicate_title', affectedPaths: ['c', 'd'] }),
      ];
      const groups = groupBySharedPaths(findings);
      // Should be two groups because no paths overlap
      assert.strictEqual(groups.length, 2);
    });

    it('handles transitive path relationships', () => {
      const findings = [
        makeTestFinding({ type: 'duplicate_title', affectedPaths: ['a', 'b'] }),
        makeTestFinding({ type: 'duplicate_title', affectedPaths: ['b', 'c'] }),
        makeTestFinding({ type: 'duplicate_title', affectedPaths: ['c', 'd'] }),
      ];
      const groups = groupBySharedPaths(findings);
      // Should be one group because of transitive relationship a-b-c-d
      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0]!.length, 3);
    });

    it('skips findings with no affected paths', () => {
      const findings = [
        makeTestFinding({ type: 'duplicate_title', affectedPaths: [] }),
        makeTestFinding({ type: 'duplicate_title', affectedPaths: ['a', 'b'] }),
      ];
      const groups = groupBySharedPaths(findings);
      // Empty path finding is skipped
      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0]!.length, 1);
    });
  });

  describe('groupFindings', () => {
    it('returns empty array for empty input', () => {
      const groups = groupFindings([]);
      assert.strictEqual(groups.length, 0);
    });

    it('groups findings by type', () => {
      const findings = [
        makeTestFinding({ type: 'broken_link', affectedPaths: ['a'] }),
        makeTestFinding({ type: 'broken_link', affectedPaths: ['b'] }),
        makeTestFinding({ type: 'terminology', affectedPaths: ['c'] }),
      ];
      const groups = groupFindings(findings);

      // Should have 2 groups (broken_link and terminology)
      assert.strictEqual(groups.length, 2);

      // broken_link has higher priority than terminology
      assert.strictEqual(groups[0]!.type, 'broken_link');
      assert.strictEqual(groups[0]!.findings.length, 2);
    });

    it('sub-groups duplicate_title findings by shared paths', () => {
      const findings = [
        makeTestFinding({ type: 'duplicate_title', affectedPaths: ['a', 'b'] }),
        makeTestFinding({ type: 'duplicate_title', affectedPaths: ['c', 'd'] }),
      ];
      const groups = groupFindings(findings);

      // Should have 2 groups because paths are disjoint
      assert.strictEqual(groups.length, 2);
      assert.strictEqual(groups[0]!.type, 'duplicate_title');
      assert.strictEqual(groups[1]!.type, 'duplicate_title');
    });

    it('sub-groups similar_content findings by shared paths', () => {
      const findings = [
        makeTestFinding({ type: 'similar_content', affectedPaths: ['a', 'b'] }),
        makeTestFinding({ type: 'similar_content', affectedPaths: ['b', 'c'] }),
      ];
      const groups = groupFindings(findings);

      // Should have 1 group because path 'b' is shared
      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0]!.findings.length, 2);
    });

    it('sorts groups by priority (highest first)', () => {
      const findings = [
        makeTestFinding({ type: 'low_quality', affectedPaths: ['a'] }),     // priority 20
        makeTestFinding({ type: 'contradiction', affectedPaths: ['b'] }),   // priority 100
        makeTestFinding({ type: 'broken_link', affectedPaths: ['c'] }),     // priority 90
      ];
      const groups = groupFindings(findings);

      assert.strictEqual(groups[0]!.type, 'contradiction');  // highest priority
      assert.strictEqual(groups[1]!.type, 'broken_link');
      assert.strictEqual(groups[2]!.type, 'low_quality');    // lowest priority
    });

    it('uses severity as secondary sort', () => {
      // Create two groups of same type with different severities
      const findings = [
        makeTestFinding({ type: 'duplicate_title', affectedPaths: ['a'], severity: 'low' }),
        makeTestFinding({ type: 'duplicate_title', affectedPaths: ['b'], severity: 'high' }),
      ];
      const groups = groupFindings(findings);

      // Both findings should create separate groups (disjoint paths)
      assert.strictEqual(groups.length, 2);
      // High severity group should come first
      assert.strictEqual(groups[0]!.severity, 'high');
      assert.strictEqual(groups[1]!.severity, 'low');
    });

    it('calculates correct affectedPaths for groups', () => {
      const findings = [
        makeTestFinding({ type: 'broken_link', affectedPaths: ['a', 'b'] }),
        makeTestFinding({ type: 'broken_link', affectedPaths: ['c'] }),
      ];
      const groups = groupFindings(findings);

      assert.strictEqual(groups[0]!.affectedPaths.length, 3);
      assert.ok(groups[0]!.affectedPaths.includes('a'));
      assert.ok(groups[0]!.affectedPaths.includes('b'));
      assert.ok(groups[0]!.affectedPaths.includes('c'));
    });

    it('calculates correct severity for groups', () => {
      const findings = [
        makeTestFinding({ type: 'broken_link', affectedPaths: ['a'], severity: 'low' }),
        makeTestFinding({ type: 'broken_link', affectedPaths: ['b'], severity: 'high' }),
      ];
      const groups = groupFindings(findings);

      assert.strictEqual(groups[0]!.severity, 'high');
    });
  });
});
