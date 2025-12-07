/**
 * Unit tests for the response parsing infrastructure.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  createParseContext,
  parseSection,
  parseSectionItems,
  parseConfidence,
  hasRequiredFailures,
  getFailureSummary,
  getParseStats,
  validateMinLength,
} from '../../src/agents/parsing/index.js';

describe('Response Parser', () => {
  describe('createParseContext', () => {
    it('should create a context with empty failures', () => {
      const ctx = createParseContext('test', 'some response');

      assert.strictEqual(ctx.agentType, 'test');
      assert.strictEqual(ctx.response, 'some response');
      assert.deepStrictEqual(ctx.failures, []);
      assert.deepStrictEqual(ctx.successfulSections, []);
    });
  });

  describe('parseSection', () => {
    it('should parse a simple section successfully', () => {
      const ctx = createParseContext('test', 'TITLE: My Title\nCONTENT: Some content');

      const result = parseSection(ctx, 'TITLE', /TITLE:\s*(.+?)(?=\n|$)/i);

      assert.strictEqual(result, 'My Title');
      assert.ok(ctx.successfulSections.includes('TITLE'));
      assert.strictEqual(ctx.failures.length, 0);
    });

    it('should return null and log failure for missing required section', () => {
      const ctx = createParseContext('test', 'OTHER: stuff');

      const result = parseSection(ctx, 'TITLE', /TITLE:\s*(.+?)(?=\n|$)/i, { required: true });

      assert.strictEqual(result, null);
      assert.strictEqual(ctx.failures.length, 1);
      assert.strictEqual(ctx.failures[0]!.section, 'TITLE');
      assert.strictEqual(ctx.failures[0]!.required, true);
    });

    it('should return default value for missing optional section', () => {
      const ctx = createParseContext('test', 'OTHER: stuff');

      const result = parseSection(ctx, 'TITLE', /TITLE:\s*(.+?)(?=\n|$)/i, {
        required: false,
        defaultValue: 'Default Title',
      });

      assert.strictEqual(result, 'Default Title');
      assert.strictEqual(ctx.failures.length, 1);
      assert.strictEqual(ctx.failures[0]!.required, false);
    });

    it('should handle multiline section content', () => {
      const response = `CONTENT:
This is line 1.
This is line 2.

This is after blank line.
CONFIDENCE: 0.8`;

      const ctx = createParseContext('test', response);

      const result = parseSection(ctx, 'CONTENT', /CONTENT:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);

      assert.ok(result);
      assert.ok(result.includes('line 1'));
      assert.ok(result.includes('line 2'));
      assert.ok(result.includes('after blank line'));
    });

    it('should be case insensitive', () => {
      const ctx = createParseContext('test', 'title: My Title');

      const result = parseSection(ctx, 'TITLE', /TITLE:\s*(.+?)(?=\n|$)/i);

      assert.strictEqual(result, 'My Title');
    });
  });

  describe('parseSectionItems', () => {
    it('should parse multiple items from a section', () => {
      const response = `PATTERNS_FOUND:
- [Factory] [CATEGORY:design] Creates objects [path/to/file]
- [Singleton] [CATEGORY:design] Single instance [another/path]
CONFIDENCE: 0.8`;

      const ctx = createParseContext('test', response);

      const items = parseSectionItems(
        ctx,
        'PATTERNS_FOUND',
        /PATTERNS_FOUND:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
        /^-\s*\[([^\]]+)\]\s*\[CATEGORY:([^\]]+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i,
        (match) => ({
          name: match[1]!.trim(),
          category: match[2]!.trim(),
        })
      );

      assert.strictEqual(items.length, 2);
      assert.strictEqual(items[0]!.name, 'Factory');
      assert.strictEqual(items[0]!.category, 'design');
      assert.strictEqual(items[1]!.name, 'Singleton');
    });

    it('should return empty array for missing section', () => {
      const ctx = createParseContext('test', 'OTHER: stuff');

      const items = parseSectionItems(
        ctx,
        'PATTERNS_FOUND',
        /PATTERNS_FOUND:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
        /^-\s*\[([^\]]+)\]/i,
        (match) => ({ name: match[1]!.trim() })
      );

      assert.deepStrictEqual(items, []);
    });

    it('should handle items that don\'t match the pattern', () => {
      const response = `ITEMS:
- [Valid item] some data
- Invalid item without brackets
- [Another valid] more data
CONFIDENCE: 0.8`;

      const ctx = createParseContext('test', response);

      const items = parseSectionItems(
        ctx,
        'ITEMS',
        /ITEMS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
        /^-\s*\[([^\]]+)\]/i,
        (match) => ({ name: match[1]!.trim() })
      );

      // Should only get the two valid items (ones with [brackets])
      assert.strictEqual(items.length, 2);
      assert.strictEqual(items[0]!.name, 'Valid item');
      assert.strictEqual(items[1]!.name, 'Another valid');
    });
  });

  describe('parseConfidence', () => {
    it('should parse a valid confidence value', () => {
      const ctx = createParseContext('test', 'SUMMARY: foo\nCONFIDENCE: 0.85');

      const result = parseConfidence(ctx);

      assert.strictEqual(result, 0.85);
      assert.ok(ctx.successfulSections.includes('CONFIDENCE'));
    });

    it('should return default for missing confidence', () => {
      const ctx = createParseContext('test', 'SUMMARY: foo');

      const result = parseConfidence(ctx, { defaultValue: 0.7 });

      assert.strictEqual(result, 0.7);
      assert.strictEqual(ctx.failures.length, 1);
    });

    it('should handle confidence at the end of response', () => {
      const ctx = createParseContext('test', 'SUMMARY: foo\nCONFIDENCE: 0.9');

      const result = parseConfidence(ctx);

      assert.strictEqual(result, 0.9);
    });

    it('should handle various confidence formats', () => {
      const cases = [
        { response: 'CONFIDENCE: 0.5', expected: 0.5 },
        { response: 'CONFIDENCE:0.75', expected: 0.75 },
        { response: 'CONFIDENCE:  1.0', expected: 1.0 },
        { response: 'confidence: 0.6', expected: 0.6 },
      ];

      for (const { response, expected } of cases) {
        const ctx = createParseContext('test', response);
        const result = parseConfidence(ctx);
        assert.strictEqual(result, expected, `Failed for: ${response}`);
      }
    });

    it('should reject invalid confidence values', () => {
      const ctx = createParseContext('test', 'CONFIDENCE: invalid');

      const result = parseConfidence(ctx, { defaultValue: 0.5 });

      assert.strictEqual(result, 0.5);
      assert.strictEqual(ctx.failures.length, 1);
    });
  });

  describe('hasRequiredFailures', () => {
    it('should return true when required section is missing', () => {
      const ctx = createParseContext('test', 'OTHER: stuff');

      parseSection(ctx, 'REQUIRED', /REQUIRED:\s*(.+)/i, { required: true });

      assert.ok(hasRequiredFailures(ctx));
    });

    it('should return false when only optional sections are missing', () => {
      const ctx = createParseContext('test', 'OTHER: stuff');

      parseSection(ctx, 'OPTIONAL', /OPTIONAL:\s*(.+)/i, { required: false });

      assert.ok(!hasRequiredFailures(ctx));
    });

    it('should return false when no failures', () => {
      const ctx = createParseContext('test', 'TITLE: foo');

      parseSection(ctx, 'TITLE', /TITLE:\s*(.+)/i);

      assert.ok(!hasRequiredFailures(ctx));
    });
  });

  describe('getFailureSummary', () => {
    it('should return "No parsing failures" when none exist', () => {
      const ctx = createParseContext('test', 'TITLE: foo');
      parseSection(ctx, 'TITLE', /TITLE:\s*(.+)/i);

      assert.strictEqual(getFailureSummary(ctx), 'No parsing failures');
    });

    it('should list required failures', () => {
      const ctx = createParseContext('test', 'OTHER: stuff');
      parseSection(ctx, 'TITLE', /TITLE:\s*(.+)/i, { required: true });
      parseSection(ctx, 'CONTENT', /CONTENT:\s*(.+)/i, { required: true });

      const summary = getFailureSummary(ctx);

      assert.ok(summary.includes('Required sections missing'));
      assert.ok(summary.includes('TITLE'));
      assert.ok(summary.includes('CONTENT'));
    });

    it('should list optional failures separately', () => {
      const ctx = createParseContext('test', 'OTHER: stuff');
      parseSection(ctx, 'OPTIONAL', /OPTIONAL:\s*(.+)/i, { required: false });

      const summary = getFailureSummary(ctx);

      assert.ok(summary.includes('Optional sections missing'));
      assert.ok(summary.includes('OPTIONAL'));
    });
  });

  describe('getParseStats', () => {
    it('should track successful and failed sections', () => {
      const ctx = createParseContext('test', 'TITLE: foo\nOTHER: bar');

      parseSection(ctx, 'TITLE', /TITLE:\s*(.+)/i);
      parseSection(ctx, 'MISSING', /MISSING:\s*(.+)/i, { required: true });
      parseSection(ctx, 'OPTIONAL', /OPTIONAL:\s*(.+)/i, { required: false });

      const stats = getParseStats(ctx);

      assert.strictEqual(stats.agentType, 'test');
      assert.strictEqual(stats.successfulSections, 1);
      assert.strictEqual(stats.failedSections, 2);
      assert.strictEqual(stats.requiredFailures, 1);
      assert.strictEqual(stats.optionalFailures, 1);
      assert.ok(stats.sections.successful.includes('TITLE'));
      assert.ok(stats.sections.failed.includes('MISSING'));
      assert.ok(stats.sections.failed.includes('OPTIONAL'));
    });
  });

  describe('validateMinLength', () => {
    it('should return true for content meeting minimum length', () => {
      const ctx = createParseContext('test', '');

      const result = validateMinLength(ctx, 'CONTENT', 'This is long enough content', 10);

      assert.ok(result);
    });

    it('should return false for content below minimum length', () => {
      const ctx = createParseContext('test', '');

      const result = validateMinLength(ctx, 'CONTENT', 'Short', 100);

      assert.ok(!result);
    });

    it('should return false for null content', () => {
      const ctx = createParseContext('test', '');

      const result = validateMinLength(ctx, 'CONTENT', null, 10);

      assert.ok(!result);
    });
  });
});

describe('Real-world parsing scenarios', () => {
  it('should handle a complete WriterAgent response', () => {
    const response = `TITLE: Repository Pattern Implementation

CONTENT:
# Repository Pattern Implementation

The Repository Pattern provides an abstraction layer between the domain and data mapping layers.

## How It Works

The repository interface defines methods for CRUD operations:
- findById: Retrieves an entity by its unique identifier
- save: Persists an entity
- delete: Removes an entity

## Usage

\`\`\`typescript
const user = await userRepository.findById(id);
\`\`\`

CONFIDENCE: 0.85`;

    const ctx = createParseContext('writer', response);

    const title = parseSection(ctx, 'TITLE', /TITLE:\s*(.+?)(?=\n|CONTENT:|$)/i);
    const content = parseSection(ctx, 'CONTENT', /CONTENT:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i, { required: true });
    const confidence = parseConfidence(ctx);

    assert.strictEqual(title, 'Repository Pattern Implementation');
    assert.ok(content);
    assert.ok(content.includes('Repository Pattern'));
    assert.ok(content.includes('findById'));
    assert.strictEqual(confidence, 0.85);
    assert.ok(!hasRequiredFailures(ctx));
  });

  it('should handle malformed response gracefully', () => {
    const response = `This response doesn't follow the expected format at all.
It's just free-form text without any sections.`;

    const ctx = createParseContext('writer', response);

    const title = parseSection(ctx, 'TITLE', /TITLE:\s*(.+?)(?=\n|CONTENT:|$)/i, { required: false });
    const content = parseSection(ctx, 'CONTENT', /CONTENT:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i, { required: true });

    assert.strictEqual(title, null);
    assert.strictEqual(content, null);
    assert.ok(hasRequiredFailures(ctx));

    const summary = getFailureSummary(ctx);
    assert.ok(summary.includes('Required sections missing'));
    assert.ok(summary.includes('CONTENT'));
  });

  it('should handle response with wrong casing', () => {
    // The /i flag should handle case insensitivity
    const response = `title: My Article
content: This is the content.
confidence: 0.7`;

    const ctx = createParseContext('test', response);

    const title = parseSection(ctx, 'TITLE', /TITLE:\s*(.+?)(?=\n|content:|$)/i);
    const content = parseSection(ctx, 'CONTENT', /CONTENT:\s*(.+?)(?=\n|confidence:|$)/i);
    const confidence = parseConfidence(ctx);

    assert.strictEqual(title, 'My Article');
    assert.strictEqual(content, 'This is the content.');
    assert.strictEqual(confidence, 0.7);
  });

  it('should handle sections with whitespace-only content', () => {
    // Note: Empty sections are tricky with regex parsing.
    // Using [ \t]* instead of \s* prevents consuming newlines,
    // so an empty line won't accidentally match the next section.
    const response = `TITLE:
CONTENT:
Some actual content here.
CONFIDENCE: 0.6`;

    const ctx = createParseContext('test', response);

    // Pattern uses [ \t]* for horizontal whitespace only (not newlines)
    // This prevents matching across line boundaries
    const title = parseSection(ctx, 'TITLE', /TITLE:[ \t]*([^\n]+)/i);
    const content = parseSection(ctx, 'CONTENT', /CONTENT:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);

    // TITLE with no content on its line should not match
    assert.strictEqual(title, null);
    assert.ok(content);
    assert.ok(content.includes('actual content'));
  });
});
