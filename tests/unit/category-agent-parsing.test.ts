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
    it('parses a single categorization line', () => {
      const response = `- path: auth/login | current: auth | suggested: security | reason: Contains security-sensitive code`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.pagePath, 'auth/login');
      assert.strictEqual(result[0]!.currentCategory, 'auth');
      assert.strictEqual(result[0]!.suggestedCategory, 'security');
      assert.strictEqual(result[0]!.confidence, 0.85); // mismatch confidence
      assert.strictEqual(result[0]!.reason, 'Contains security-sensitive code');
    });

    it('parses multiple categorization lines', () => {
      const response = `- path: auth/login | current: auth | suggested: security | reason: Security content
- path: docs/api | current: docs | suggested: api | reason: API documentation
- path: utils/helpers | current: utils | suggested: utils | reason: correct`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 3);
      assert.strictEqual(result[0]!.pagePath, 'auth/login');
      assert.strictEqual(result[1]!.pagePath, 'docs/api');
      assert.strictEqual(result[2]!.pagePath, 'utils/helpers');
    });

    it('sets higher confidence for non-mismatches', () => {
      const response = `- path: security/auth | current: security | suggested: security | reason: correct`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.confidence, 0.95); // no mismatch = higher confidence
      assert.strictEqual(result[0]!.reason, 'Correctly categorized');
    });

    it('ignores invalid lines', () => {
      const response = `- path: auth/login | current: auth | suggested: security | reason: Security code
This is not a valid line
Some random text
- path: api/users | current: api | suggested: api | reason: correct`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 2);
    });

    it('returns empty array for response without categorization lines', () => {
      const response = `Some random text
No categorization lines here`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 0);
    });

    it('handles whitespace variations', () => {
      const response = `-  path:  auth/login  |  current:  auth  |  suggested:  security  |  reason:  Some reason`;

      const result = parseCategorizations(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.pagePath, 'auth/login');
      assert.strictEqual(result[0]!.suggestedCategory, 'security');
    });
  });

  describe('parseCategoryFindings', () => {
    it('extracts mismatches from categorization lines', () => {
      const response = `- path: auth/login | current: auth | suggested: security | reason: Contains security code

CONFIDENCE: 0.85`;

      const result = parseCategoryFindings(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.pagePath, 'auth/login');
      assert.strictEqual(result[0]!.suggestedCategory, 'security');
      assert.strictEqual(result[0]!.reason, 'Contains security code');
    });

    it('parses multiple mismatches', () => {
      const response = `- path: auth/login | current: auth | suggested: security | reason: reason 1
- path: docs/api | current: docs | suggested: api | reason: reason 2
- path: utils/test | current: utils | suggested: testing | reason: reason 3`;

      const result = parseCategoryFindings(response);

      assert.strictEqual(result.length, 3);
    });

    it('all findings default to medium severity', () => {
      const response = `- path: auth/login | current: auth | suggested: security | reason: Some reason`;

      const result = parseCategoryFindings(response);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.severity, 'medium');
    });

    it('returns empty array when no mismatches', () => {
      const response = `- path: security/auth | current: security | suggested: security | reason: correct`;

      const result = parseCategoryFindings(response);

      assert.strictEqual(result.length, 0);
    });

    it('filters out correctly categorized pages', () => {
      const response = `- path: auth/login | current: auth | suggested: security | reason: Security content
- path: api/users | current: api | suggested: api | reason: correct`;

      const result = parseCategoryFindings(response);

      // Should only get the mismatch
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0]!.pagePath, 'auth/login');
    });
  });

  describe('parseConfidence', () => {
    it('parses confidence value', () => {
      const response = `- path: auth/login | current: auth | suggested: security | reason: Test

CONFIDENCE: 0.75`;

      const result = parseConfidence(response);

      assert.strictEqual(result, 0.75);
    });

    it('returns default for missing confidence', () => {
      const response = `- path: auth/login | current: auth | suggested: security | reason: Test`;

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
