/**
 * Unit tests for TechnicalDebtAgent response parsing.
 * Tests the parsing logic in isolation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TechnicalDebtAgent } from '../../src/agents/analysis/technical-debt-agent.js';

describe('TechnicalDebtAgent', () => {
  describe('response parsing', () => {
    // Access the private parseResponse method for testing
    const agent = new TechnicalDebtAgent();
    const parseResponse = (response: string) => {
      // @ts-expect-error - accessing private method for testing
      return agent.parseResponse(response);
    };

    it('parses a complete response with all fields', () => {
      const response = `SUMMARY:
This commit introduces some technical debt through a long function and magic numbers.

DEBT_LEVEL:
medium

ISSUES:
- [Complexity] [SEVERITY:medium] Function exceeds 50 lines [src/utils.ts]
- [Magic Numbers] [SEVERITY:low] Hardcoded timeout value of 5000 [src/api.ts]

DEBT_ADDED:
- Long function in processData() needs refactoring
- Magic number for timeout should be configurable

DEBT_REMOVED:
- None

RECOMMENDATIONS:
- Extract helper functions from processData()
- Move timeout to configuration

HOTSPOTS:
- src/utils.ts
- src/api.ts

CONFIDENCE: 0.85`;

      const result = parseResponse(response);

      assert.strictEqual(result.summary, 'This commit introduces some technical debt through a long function and magic numbers.');
      assert.strictEqual(result.debtLevel, 'medium');
      assert.strictEqual(result.findings.length, 2);
      assert.strictEqual(result.findings[0]!.type, 'Complexity');
      assert.strictEqual(result.findings[0]!.importance, 'medium');
      assert.strictEqual(result.findings[1]!.type, 'Magic Numbers');
      assert.strictEqual(result.findings[1]!.importance, 'low');
      assert.strictEqual(result.debtAdded.length, 2);
      assert.strictEqual(result.debtRemoved.length, 0); // "None" should be filtered
      assert.strictEqual(result.recommendations.length, 2);
      assert.strictEqual(result.hotspots.length, 2);
      assert.strictEqual(result.confidence, 0.85);
    });

    it('parses critical debt level correctly', () => {
      const response = `SUMMARY:
Critical technical debt detected.

DEBT_LEVEL:
critical

ISSUES:
- [God Class] [SEVERITY:critical] Class has 1500 lines and 50 methods [src/monolith.ts]

DEBT_ADDED:
- Massive class needs to be split

DEBT_REMOVED:
- N/A

RECOMMENDATIONS:
- Split into smaller, focused classes

HOTSPOTS:
- src/monolith.ts

CONFIDENCE: 0.95`;

      const result = parseResponse(response);

      assert.strictEqual(result.debtLevel, 'critical');
      assert.strictEqual(result.findings[0]!.importance, 'high');
      assert.strictEqual(result.debtRemoved.length, 0); // "N/A" should be filtered
    });

    it('parses debt removal correctly', () => {
      const response = `SUMMARY:
Good refactoring commit that reduces technical debt.

DEBT_LEVEL:
none

ISSUES:
- None identified

DEBT_ADDED:
- None

DEBT_REMOVED:
- Extracted duplicated validation logic into shared helper
- Replaced magic numbers with named constants
- Simplified nested conditionals

RECOMMENDATIONS:
- Consider adding unit tests for new helper

HOTSPOTS:
- None

CONFIDENCE: 0.9`;

      const result = parseResponse(response);

      assert.strictEqual(result.debtLevel, 'none');
      assert.strictEqual(result.debtAdded.length, 0);
      assert.strictEqual(result.debtRemoved.length, 3);
      assert.ok(result.debtRemoved[0]!.includes('duplicated validation'));
      assert.strictEqual(result.hotspots.length, 0);
    });

    it('handles findings with multiple paths', () => {
      const response = `SUMMARY:
Code duplication found.

DEBT_LEVEL:
medium

ISSUES:
- [Duplication] [SEVERITY:medium] Similar validation logic repeated [src/user.ts, src/admin.ts, src/guest.ts]

DEBT_ADDED:
- Repeated validation logic

DEBT_REMOVED:
- None

RECOMMENDATIONS:
- Extract to shared validator

HOTSPOTS:
- src/user.ts

CONFIDENCE: 0.8`;

      const result = parseResponse(response);

      assert.strictEqual(result.findings[0]!.paths.length, 3);
      assert.ok(result.findings[0]!.paths.includes('src/user.ts'));
      assert.ok(result.findings[0]!.paths.includes('src/admin.ts'));
      assert.ok(result.findings[0]!.paths.includes('src/guest.ts'));
    });

    it('maps severity levels to importance correctly', () => {
      const response = `SUMMARY:
Various severity levels.

DEBT_LEVEL:
high

ISSUES:
- [Issue1] [SEVERITY:critical] Critical issue [file1.ts]
- [Issue2] [SEVERITY:high] High issue [file2.ts]
- [Issue3] [SEVERITY:medium] Medium issue [file3.ts]
- [Issue4] [SEVERITY:low] Low issue [file4.ts]

DEBT_ADDED:
- Some debt

DEBT_REMOVED:
- None

RECOMMENDATIONS:
- Fix issues

HOTSPOTS:
- file1.ts

CONFIDENCE: 0.75`;

      const result = parseResponse(response);

      assert.strictEqual(result.findings[0]!.importance, 'high'); // critical -> high
      assert.strictEqual(result.findings[1]!.importance, 'high'); // high -> high
      assert.strictEqual(result.findings[2]!.importance, 'medium'); // medium -> medium
      assert.strictEqual(result.findings[3]!.importance, 'low'); // low -> low
    });

    it('handles empty or minimal response', () => {
      const response = `SUMMARY:
Clean commit with no issues.

DEBT_LEVEL:
none

ISSUES:
- None

DEBT_ADDED:
- None

DEBT_REMOVED:
- None

RECOMMENDATIONS:
- None

HOTSPOTS:
- None

CONFIDENCE: 0.95`;

      const result = parseResponse(response);

      assert.strictEqual(result.debtLevel, 'none');
      assert.strictEqual(result.findings.length, 0);
      assert.strictEqual(result.debtAdded.length, 0);
      assert.strictEqual(result.debtRemoved.length, 0);
      assert.strictEqual(result.recommendations.length, 0);
      assert.strictEqual(result.hotspots.length, 0);
      assert.strictEqual(result.confidence, 0.95);
    });

    it('parses TODO/FIXME detection', () => {
      const response = `SUMMARY:
Commit adds TODO comments indicating incomplete work.

DEBT_LEVEL:
low

ISSUES:
- [Technical Shortcut] [SEVERITY:low] TODO comment added: "TODO: implement proper error handling" [src/handler.ts]
- [Technical Shortcut] [SEVERITY:low] FIXME comment: "FIXME: race condition here" [src/async.ts]

DEBT_ADDED:
- Incomplete error handling marked with TODO
- Known race condition marked with FIXME

DEBT_REMOVED:
- None

RECOMMENDATIONS:
- Address TODO in error handling
- Fix race condition before release

HOTSPOTS:
- src/handler.ts
- src/async.ts

CONFIDENCE: 0.9`;

      const result = parseResponse(response);

      assert.strictEqual(result.debtLevel, 'low');
      assert.strictEqual(result.findings.length, 2);
      assert.ok(result.findings[0]!.description.includes('TODO'));
      assert.ok(result.findings[1]!.description.includes('FIXME'));
    });
  });

  describe('wiki update generation', () => {
    const agent = new TechnicalDebtAgent();
    const generateUpdates = (
      commit: { sha: string; message: string; diffSummary: { affectedFiles: string[] } },
      analysis: {
        summary: string;
        debtLevel: 'critical' | 'high' | 'medium' | 'low' | 'none';
        findings: Array<{ type: string; importance: 'low' | 'medium' | 'high'; description: string; paths: string[] }>;
        debtAdded: string[];
        debtRemoved: string[];
        recommendations: string[];
        hotspots: string[];
        confidence: number;
      }
    ) => {
      // @ts-expect-error - accessing private method for testing
      return agent.generateUpdates(commit, analysis);
    };

    it('creates no updates for debt-free commits', () => {
      const commit = {
        sha: 'abc12345',
        message: 'Clean refactoring',
        diffSummary: { affectedFiles: ['src/clean.ts'] },
      };

      const analysis = {
        summary: 'No debt detected',
        debtLevel: 'none' as const,
        findings: [],
        debtAdded: [],
        debtRemoved: [],
        recommendations: [],
        hotspots: [],
        confidence: 0.9,
      };

      const updates = generateUpdates(commit, analysis);
      assert.strictEqual(updates.length, 0);
    });

    it('creates report page for high debt level', () => {
      const commit = {
        sha: 'abc12345',
        message: 'Add complex feature',
        diffSummary: { affectedFiles: ['src/complex.ts'] },
      };

      const analysis = {
        summary: 'High complexity introduced',
        debtLevel: 'high' as const,
        findings: [{
          type: 'Complexity',
          importance: 'high' as const,
          description: 'Function too long',
          paths: ['src/complex.ts'],
        }],
        debtAdded: ['Long function'],
        debtRemoved: [],
        recommendations: ['Split function'],
        hotspots: ['src/complex.ts'],
        confidence: 0.85,
      };

      const updates = generateUpdates(commit, analysis);

      // Should create report page and overview update
      assert.ok(updates.length >= 1);
      const reportUpdate = updates.find(u => u.path.startsWith('technical-debt/report-'));
      assert.ok(reportUpdate);
      assert.ok(reportUpdate.content.includes('HIGH'));
      assert.ok(reportUpdate.content.includes('Function too long'));
    });

    it('creates report page for critical debt level', () => {
      const commit = {
        sha: 'def67890',
        message: 'Add monolith',
        diffSummary: { affectedFiles: ['src/monolith.ts'] },
      };

      const analysis = {
        summary: 'Critical debt introduced',
        debtLevel: 'critical' as const,
        findings: [{
          type: 'God Class',
          importance: 'high' as const,
          description: 'Massive class',
          paths: ['src/monolith.ts'],
        }],
        debtAdded: ['God class'],
        debtRemoved: [],
        recommendations: ['Split class'],
        hotspots: ['src/monolith.ts'],
        confidence: 0.95,
      };

      const updates = generateUpdates(commit, analysis);

      const reportUpdate = updates.find(u => u.path.startsWith('technical-debt/report-'));
      assert.ok(reportUpdate);
      assert.strictEqual(reportUpdate.confidenceDelta, 0.5); // Higher for critical
    });

    it('updates overview page when findings exist', () => {
      const commit = {
        sha: 'ghi11111',
        message: 'Minor changes',
        diffSummary: { affectedFiles: ['src/file.ts'] },
      };

      const analysis = {
        summary: 'Minor debt detected',
        debtLevel: 'medium' as const,
        findings: [{
          type: 'Magic Number',
          importance: 'low' as const,
          description: 'Hardcoded value',
          paths: ['src/file.ts'],
        }],
        debtAdded: ['Hardcoded value'],
        debtRemoved: [],
        recommendations: ['Use constant'],
        hotspots: [],
        confidence: 0.8,
      };

      const updates = generateUpdates(commit, analysis);

      const overviewUpdate = updates.find(u => u.path === 'technical-debt/overview');
      assert.ok(overviewUpdate);
      assert.ok(overviewUpdate.content.includes('medium'));
    });
  });

  describe('agent type', () => {
    it('has correct type', () => {
      const agent = new TechnicalDebtAgent();
      assert.strictEqual(agent.type, 'technical-debt');
    });
  });
});
