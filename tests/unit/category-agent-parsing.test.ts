/**
 * Unit tests for CategoryAgent response parsing.
 *
 * Run with: node --import tsx --test tests/unit/category-agent-parsing.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseCategorizations,
  parseCategoryFindings,
  parseConfidence,
  type Categorization,
  type CategoryFinding,
} from '../../src/agents/meta/category-agent.js';

describe('CategoryAgent Parsing', () => {
  describe('parseCategorizations', () => {
    it('parses a single categorization line', () => {
      const response = `CATEGORIZATIONS:
- [auth/login] | [auth] | [security] | [confidence:0.85] | [Contains authentication logic]

CONFIDENCE: 0.8`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.pagePath, 'auth/login');
      assert.strictEqual(result[0]!.currentCategory, 'auth');
      assert.strictEqual(result[0]!.suggestedCategory, 'security');
      assert.strictEqual(result[0]!.confidence, 0.85);
      assert.strictEqual(result[0]!.reason, 'Contains authentication logic');
    });

    it('parses multiple categorization lines', () => {
      const response = `CATEGORIZATIONS:
- [auth/login] | [auth] | [security] | [confidence:0.85] | [Contains authentication logic]
- [docs/api] | [docs] | [api] | [confidence:0.9] | [API documentation]
- [utils/helpers] | [utils] | [utils] | [confidence:0.95] | [Utility functions]

CONFIDENCE: 0.8`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0]!.pagePath, 'auth/login');
      assert.strictEqual(result[1]!.pagePath, 'docs/api');
      assert.strictEqual(result[2]!.pagePath, 'utils/helpers');
    });

    it('handles missing confidence values with default', () => {
      const response = `CATEGORIZATIONS:
- [auth/login] | [auth] | [security] | [] | [Contains authentication logic]

CONFIDENCE: 0.8`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.confidence, 0.7); // default
    });

    it('handles missing reasons', () => {
      const response = `CATEGORIZATIONS:
- [auth/login] | [auth] | [security] | [confidence:0.85] | []

CONFIDENCE: 0.8`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.reason, '');
    });

    it('ignores invalid lines', () => {
      const response = `CATEGORIZATIONS:
- [auth/login] | [auth] | [security] | [confidence:0.85] | [Valid line]
This is not a valid line
- invalid format here
- [partial/line]

CONFIDENCE: 0.8`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.pagePath, 'auth/login');
    });

    it('returns empty array for missing CATEGORIZATIONS section', () => {
      const response = `Some random text
CONFIDENCE: 0.8`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 0);
    });

    it('handles whitespace variations', () => {
      const response = `CATEGORIZATIONS:
-  [auth/login]  |  [auth]  |  [security]  |  [confidence:0.85]  |  [reason here]

CONFIDENCE: 0.8`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.pagePath, 'auth/login');
      assert.strictEqual(result[0]!.suggestedCategory, 'security');
    });
  });

  describe('parseCategoryFindings', () => {
    it('parses finding lines correctly', () => {
      const response = `CATEGORIZATIONS:
- [auth/login] | [auth] | [security] | [confidence:0.85] | [reason]

FINDINGS:
- [category_mismatch] [SEVERITY:high] [auth/login] should be in [security] because [it contains security-sensitive code]

CONFIDENCE: 0.8`;

      const result = parseCategoryFindings(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.pagePath, 'auth/login');
      assert.strictEqual(result[0]!.suggestedCategory, 'security');
      assert.strictEqual(result[0]!.severity, 'high');
      assert.ok(result[0]!.reason.includes('security-sensitive'));
    });

    it('parses multiple findings', () => {
      const response = `FINDINGS:
- [category_mismatch] [SEVERITY:high] [auth/login] should be in [security] because [reason 1]
- [category_mismatch] [SEVERITY:medium] [docs/api] should be in [api] because [reason 2]
- [category_mismatch] [SEVERITY:low] [utils/test] should be in [testing] because [reason 3]

CONFIDENCE: 0.8`;

      const result = parseCategoryFindings(response);

      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0]!.severity, 'high');
      assert.strictEqual(result[1]!.severity, 'medium');
      assert.strictEqual(result[2]!.severity, 'low');
    });

    it('defaults to medium severity if not specified', () => {
      const response = `FINDINGS:
- [category_mismatch] [auth/login] should be in [security] because [reason]

CONFIDENCE: 0.8`;

      const result = parseCategoryFindings(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.severity, 'medium');
    });

    it('returns empty array for missing FINDINGS section', () => {
      const response = `CATEGORIZATIONS:
- [auth/login] | [auth] | [security] | [confidence:0.85] | [reason]

CONFIDENCE: 0.8`;

      const result = parseCategoryFindings(response);

      assert.strictEqual(result.length, 0);
    });
  });

  describe('parseConfidence', () => {
    it('parses confidence value', () => {
      const response = `CATEGORIZATIONS:
- [auth/login] | [auth] | [security] | [confidence:0.85] | [reason]

CONFIDENCE: 0.75`;

      const result = parseConfidence(response);

      assert.strictEqual(result, 0.75);
    });

    it('returns default for missing confidence', () => {
      const response = `CATEGORIZATIONS:
- [auth/login] | [auth] | [security] | [confidence:0.85] | [reason]`;

      const result = parseConfidence(response);

      assert.strictEqual(result, 0.7); // default
    });

    it('handles confidence with different formats', () => {
      const response = `CONFIDENCE:0.9`;
      assert.strictEqual(parseConfidence(response), 0.9);

      const response2 = `CONFIDENCE: 0.85`;
      assert.strictEqual(parseConfidence(response2), 0.85);

      const response3 = `CONFIDENCE:  0.6`;
      assert.strictEqual(parseConfidence(response3), 0.6);
    });
  });
});
