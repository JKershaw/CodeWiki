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
} from '../../src/agents/meta/category-agent.js';

describe('CategoryAgent Parsing', () => {
  describe('parseCategorizations', () => {
    it('parses a single PAGE line', () => {
      const response = `PAGE: auth/login | CURRENT: auth | SUGGESTED: security | MISMATCH: yes`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.pagePath, 'auth/login');
      assert.strictEqual(result[0]!.currentCategory, 'auth');
      assert.strictEqual(result[0]!.suggestedCategory, 'security');
      assert.strictEqual(result[0]!.confidence, 0.85); // mismatch confidence
    });

    it('parses multiple PAGE lines', () => {
      const response = `PAGE: auth/login | CURRENT: auth | SUGGESTED: security | MISMATCH: yes
PAGE: docs/api | CURRENT: docs | SUGGESTED: api | MISMATCH: yes
PAGE: utils/helpers | CURRENT: utils | SUGGESTED: utils | MISMATCH: no`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0]!.pagePath, 'auth/login');
      assert.strictEqual(result[1]!.pagePath, 'docs/api');
      assert.strictEqual(result[2]!.pagePath, 'utils/helpers');
    });

    it('sets higher confidence for non-mismatches', () => {
      const response = `PAGE: security/auth | CURRENT: security | SUGGESTED: security | MISMATCH: no`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.confidence, 0.95); // no mismatch = higher confidence
    });

    it('ignores invalid lines', () => {
      const response = `PAGE: auth/login | CURRENT: auth | SUGGESTED: security | MISMATCH: yes
This is not a valid line
Some random text
PAGE: api/users | CURRENT: api | SUGGESTED: api | MISMATCH: no`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 2);
    });

    it('returns empty array for response without PAGE lines', () => {
      const response = `Some random text
No PAGE lines here`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 0);
    });

    it('handles whitespace variations', () => {
      const response = `PAGE:  auth/login  |  CURRENT:  auth  |  SUGGESTED:  security  |  MISMATCH:  yes`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.pagePath, 'auth/login');
      assert.strictEqual(result[0]!.suggestedCategory, 'security');
    });
  });

  describe('parseCategoryFindings', () => {
    it('parses MISMATCH finding lines', () => {
      const response = `PAGE: auth/login | CURRENT: auth | SUGGESTED: security | MISMATCH: yes

MISMATCH: auth/login should be in security - it contains security-sensitive code`;

      const result = parseCategoryFindings(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.pagePath, 'auth/login');
      assert.strictEqual(result[0]!.suggestedCategory, 'security');
      assert.ok(result[0]!.reason.includes('security-sensitive'));
    });

    it('parses bullet point format', () => {
      const response = `- auth/login should be in security - reason here`;

      const result = parseCategoryFindings(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.pagePath, 'auth/login');
    });

    it('parses multiple findings', () => {
      const response = `MISMATCH: auth/login should be in security - reason 1
MISMATCH: docs/api should be in api - reason 2
MISMATCH: utils/test should be in testing - reason 3`;

      const result = parseCategoryFindings(response);

      assert.strictEqual(result.length, 3);
    });

    it('all findings default to medium severity', () => {
      const response = `MISMATCH: auth/login should be in security - reason`;

      const result = parseCategoryFindings(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.severity, 'medium');
    });

    it('returns empty array when no findings', () => {
      const response = `PAGE: security/auth | CURRENT: security | SUGGESTED: security | MISMATCH: no`;

      const result = parseCategoryFindings(response);

      assert.strictEqual(result.length, 0);
    });

    it('ignores PAGE lines with MISMATCH field', () => {
      const response = `PAGE: auth/login | CURRENT: auth | SUGGESTED: security | MISMATCH: yes
MISMATCH: auth/login should be in security - real finding`;

      const result = parseCategoryFindings(response);

      // Should only get the real finding, not the PAGE line
      assert.strictEqual(result.length, 1);
      assert.ok(result[0]!.reason.includes('real finding'));
    });
  });

  describe('parseConfidence', () => {
    it('parses confidence value', () => {
      const response = `PAGE: auth/login | CURRENT: auth | SUGGESTED: security | MISMATCH: yes

CONFIDENCE: 0.75`;

      const result = parseConfidence(response);

      assert.strictEqual(result, 0.75);
    });

    it('returns default for missing confidence', () => {
      const response = `PAGE: auth/login | CURRENT: auth | SUGGESTED: security | MISMATCH: yes`;

      const result = parseConfidence(response);

      assert.strictEqual(result, 0.7); // default
    });

    it('handles confidence with different formats', () => {
      assert.strictEqual(parseConfidence('CONFIDENCE:0.9'), 0.9);
      assert.strictEqual(parseConfidence('CONFIDENCE: 0.85'), 0.85);
      assert.strictEqual(parseConfidence('CONFIDENCE:  0.6'), 0.6);
    });
  });
});
