/**
 * Unit tests for the response parsing infrastructure.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  createParseContext,
  parseSection,
  parseSectionFlexible,
  parseSectionItems,
  parseConfidence,
  hasRequiredFailures,
  getFailureSummary,
  getParseStats,
  validateMinLength,
  parseChoice,
  parseListItemsWithFallback,
  parseStringList,
  parseBlocks,
  mapSeverity,
  mapPriority,
  extractProseContent,
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

describe('parseChoice', () => {
  const validDecisions = ['merge', 'keep-separate'] as const;
  const validTrends = ['adding_debt', 'reducing_debt', 'neutral', 'mixed'] as const;

  it('should parse a valid choice value', () => {
    const ctx = createParseContext('test', 'DECISION: merge\nCONFIDENCE: 0.8');

    const result = parseChoice(ctx, 'DECISION', /DECISION:\s*(\S+)/i, validDecisions);

    assert.strictEqual(result, 'merge');
    assert.ok(ctx.successfulSections.includes('DECISION'));
  });

  it('should be case-insensitive', () => {
    const ctx = createParseContext('test', 'DECISION: MERGE\nCONFIDENCE: 0.8');

    const result = parseChoice(ctx, 'DECISION', /DECISION:\s*(\S+)/i, validDecisions);

    assert.strictEqual(result, 'merge');
  });

  it('should handle hyphen/underscore variations', () => {
    const ctx = createParseContext('test', 'DECISION: keep_separate');

    const result = parseChoice(ctx, 'DECISION', /DECISION:\s*(\S+)/i, validDecisions);

    assert.strictEqual(result, 'keep-separate');
  });

  it('should handle debt trends with underscore normalization', () => {
    const ctx = createParseContext('test', 'DEBT_TREND: adding-debt');

    const result = parseChoice(ctx, 'DEBT_TREND', /DEBT_TREND:\s*(\S+)/i, validTrends);

    assert.strictEqual(result, 'adding_debt');
  });

  it('should return default value for invalid choice', () => {
    const ctx = createParseContext('test', 'DECISION: invalid');

    const result = parseChoice(ctx, 'DECISION', /DECISION:\s*(\S+)/i, validDecisions, {
      defaultValue: 'keep-separate',
    });

    assert.strictEqual(result, 'keep-separate');
    assert.strictEqual(ctx.failures.length, 1);
  });

  it('should return null for missing choice without default', () => {
    const ctx = createParseContext('test', 'OTHER: stuff');

    const result = parseChoice(ctx, 'DECISION', /DECISION:\s*(\S+)/i, validDecisions);

    assert.strictEqual(result, null);
    assert.strictEqual(ctx.failures.length, 1);
  });

  it('should mark required failures correctly', () => {
    const ctx = createParseContext('test', 'OTHER: stuff');

    parseChoice(ctx, 'DECISION', /DECISION:\s*(\S+)/i, validDecisions, { required: true });

    assert.ok(hasRequiredFailures(ctx));
  });
});

describe('parseListItemsWithFallback', () => {
  interface Finding {
    type: string;
    severity: string;
    description: string;
    paths: string[];
  }

  const findingPatterns = [
    {
      // Format: - [TYPE] [SEVERITY:level] Description [paths]
      pattern: /^-\s*\[([^\]]+)\]\s*\[SEVERITY:(\w+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i,
      mapper: (m: RegExpMatchArray): Finding => ({
        type: m[1]!.trim(),
        severity: m[2]!.toLowerCase(),
        description: m[3]!.trim(),
        paths: m[4]?.split(',').map(p => p.trim()).filter(p => p) ?? [],
      }),
    },
    {
      // Format: - [TYPE] (severity) Description
      pattern: /^-\s*\[([^\]]+)\]\s*\((\w+)\)\s*(.+)$/i,
      mapper: (m: RegExpMatchArray): Finding => ({
        type: m[1]!.trim(),
        severity: m[2]!.toLowerCase(),
        description: m[3]!.trim(),
        paths: [],
      }),
    },
    {
      // Format: - **TYPE** (severity): Description
      pattern: /^-\s*\*\*([^*]+)\*\*\s*\((\w+)\)[:\s]*(.+)$/i,
      mapper: (m: RegExpMatchArray): Finding => ({
        type: m[1]!.trim(),
        severity: m[2]!.toLowerCase(),
        description: m[3]!.trim(),
        paths: [],
      }),
    },
  ];

  it('should parse items with first matching pattern', () => {
    const response = `FINDINGS:
- [Code Smell] [SEVERITY:high] Long method detected [src/main.ts]
- [Dead Code] [SEVERITY:low] Unused variable [src/utils.ts]
CONFIDENCE: 0.8`;

    const ctx = createParseContext('test', response);

    const items = parseListItemsWithFallback(
      ctx,
      'FINDINGS',
      /FINDINGS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      findingPatterns
    );

    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0]!.type, 'Code Smell');
    assert.strictEqual(items[0]!.severity, 'high');
    assert.deepStrictEqual(items[0]!.paths, ['src/main.ts']);
    assert.strictEqual(items[1]!.type, 'Dead Code');
  });

  it('should try fallback patterns when first fails', () => {
    const response = `FINDINGS:
- [Code Smell] (high) Long method detected
- **Dead Code** (low): Unused variable
CONFIDENCE: 0.8`;

    const ctx = createParseContext('test', response);

    const items = parseListItemsWithFallback(
      ctx,
      'FINDINGS',
      /FINDINGS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      findingPatterns
    );

    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0]!.type, 'Code Smell');
    assert.strictEqual(items[0]!.severity, 'high');
    assert.strictEqual(items[1]!.type, 'Dead Code');
    assert.strictEqual(items[1]!.severity, 'low');
  });

  it('should handle mixed formats in same section', () => {
    const response = `FINDINGS:
- [Code Smell] [SEVERITY:high] First finding [path1]
- [Dead Code] (medium) Second finding
- **Complexity** (low): Third finding
CONFIDENCE: 0.8`;

    const ctx = createParseContext('test', response);

    const items = parseListItemsWithFallback(
      ctx,
      'FINDINGS',
      /FINDINGS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      findingPatterns
    );

    assert.strictEqual(items.length, 3);
  });

  it('should return empty array for missing section', () => {
    const ctx = createParseContext('test', 'OTHER: stuff');

    const items = parseListItemsWithFallback(
      ctx,
      'FINDINGS',
      /FINDINGS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      findingPatterns
    );

    assert.deepStrictEqual(items, []);
  });

  it('should skip lines that match no pattern', () => {
    const response = `FINDINGS:
- [Code Smell] [SEVERITY:high] Valid finding
- This line has no valid format
- [Another] [SEVERITY:low] Also valid
CONFIDENCE: 0.8`;

    const ctx = createParseContext('test', response);

    const items = parseListItemsWithFallback(
      ctx,
      'FINDINGS',
      /FINDINGS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      findingPatterns
    );

    assert.strictEqual(items.length, 2);
  });
});

describe('parseStringList', () => {
  it('should parse a simple string list', () => {
    const response = `RECOMMENDATIONS:
- First recommendation
- Second recommendation
- Third recommendation
CONFIDENCE: 0.8`;

    const ctx = createParseContext('test', response);

    const items = parseStringList(
      ctx,
      'RECOMMENDATIONS',
      /RECOMMENDATIONS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i
    );

    assert.strictEqual(items.length, 3);
    assert.strictEqual(items[0], 'First recommendation');
    assert.strictEqual(items[1], 'Second recommendation');
    assert.strictEqual(items[2], 'Third recommendation');
  });

  it('should trim whitespace from items', () => {
    const response = `ITEMS:
-   Item with leading spaces
-	Item with tabs
- Normal item
CONFIDENCE: 0.8`;

    const ctx = createParseContext('test', response);

    const items = parseStringList(
      ctx,
      'ITEMS',
      /ITEMS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i
    );

    assert.strictEqual(items.length, 3);
    assert.strictEqual(items[0], 'Item with leading spaces');
    assert.strictEqual(items[1], 'Item with tabs');
    assert.strictEqual(items[2], 'Normal item');
  });

  it('should filter empty lines', () => {
    const response = `ITEMS:
- First
-
- Second
-
- Third
CONFIDENCE: 0.8`;

    const ctx = createParseContext('test', response);

    const items = parseStringList(
      ctx,
      'ITEMS',
      /ITEMS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i
    );

    assert.strictEqual(items.length, 3);
  });

  it('should return empty array for missing section', () => {
    const ctx = createParseContext('test', 'OTHER: stuff');

    const items = parseStringList(
      ctx,
      'ITEMS',
      /ITEMS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i
    );

    assert.deepStrictEqual(items, []);
  });
});

describe('parseBlocks', () => {
  interface WikiUpdate {
    path: string;
    action: string;
    content: string;
  }

  const blockPattern = /===\s*\[([^\]]+)\]\s*\[(create|update|merge)\]\s*===\s*([\s\S]*?)\s*===\s*END\s*===/gi;

  it('should parse block-delimited content', () => {
    const response = `WIKI_UPDATES:
=== [architecture/overview] [create] ===
# Architecture Overview

The system uses a multi-agent architecture.
=== END ===

=== [guides/setup] [update] ===
# Setup Guide

Follow these steps to set up the project.
=== END ===

CONFIDENCE: 0.8`;

    const ctx = createParseContext('test', response);

    const items = parseBlocks<WikiUpdate>(
      ctx,
      'WIKI_UPDATES',
      /WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      blockPattern,
      (m) => ({
        path: m[1]!.trim(),
        action: m[2]!.toLowerCase(),
        content: m[3]!.trim(),
      })
    );

    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0]!.path, 'architecture/overview');
    assert.strictEqual(items[0]!.action, 'create');
    assert.ok(items[0]!.content.includes('Architecture Overview'));
    assert.strictEqual(items[1]!.path, 'guides/setup');
    assert.strictEqual(items[1]!.action, 'update');
  });

  it('should handle blocks with various whitespace', () => {
    const response = `WIKI_UPDATES:
===  [path/one]  [create]  ===
Content one
===  END  ===
CONFIDENCE: 0.8`;

    const ctx = createParseContext('test', response);

    const items = parseBlocks<WikiUpdate>(
      ctx,
      'WIKI_UPDATES',
      /WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      blockPattern,
      (m) => ({
        path: m[1]!.trim(),
        action: m[2]!.toLowerCase(),
        content: m[3]!.trim(),
      })
    );

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0]!.path, 'path/one');
  });

  it('should return empty array for missing section', () => {
    const ctx = createParseContext('test', 'OTHER: stuff');

    const items = parseBlocks<WikiUpdate>(
      ctx,
      'WIKI_UPDATES',
      /WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      blockPattern,
      (m) => ({
        path: m[1]!.trim(),
        action: m[2]!.toLowerCase(),
        content: m[3]!.trim(),
      })
    );

    assert.deepStrictEqual(items, []);
  });

  it('should handle pattern without global flag', () => {
    const response = `WIKI_UPDATES:
=== [path/one] [create] ===
Content
=== END ===
CONFIDENCE: 0.8`;

    const ctx = createParseContext('test', response);
    const nonGlobalPattern = /===\s*\[([^\]]+)\]\s*\[(create|update|merge)\]\s*===\s*([\s\S]*?)\s*===\s*END\s*===/i;

    const items = parseBlocks<WikiUpdate>(
      ctx,
      'WIKI_UPDATES',
      /WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      nonGlobalPattern,
      (m) => ({
        path: m[1]!.trim(),
        action: m[2]!.toLowerCase(),
        content: m[3]!.trim(),
      })
    );

    // Should still find items by adding global flag internally
    assert.strictEqual(items.length, 1);
  });
});

describe('mapSeverity', () => {
  it('should map critical and high to high importance', () => {
    assert.strictEqual(mapSeverity('critical'), 'high');
    assert.strictEqual(mapSeverity('high'), 'high');
    assert.strictEqual(mapSeverity('urgent'), 'high');
    assert.strictEqual(mapSeverity('CRITICAL'), 'high');
    assert.strictEqual(mapSeverity('HIGH'), 'high');
  });

  it('should map medium variants to medium importance', () => {
    assert.strictEqual(mapSeverity('medium'), 'medium');
    assert.strictEqual(mapSeverity('normal'), 'medium');
    assert.strictEqual(mapSeverity('moderate'), 'medium');
    assert.strictEqual(mapSeverity('MEDIUM'), 'medium');
  });

  it('should map low and unknown to low importance', () => {
    assert.strictEqual(mapSeverity('low'), 'low');
    assert.strictEqual(mapSeverity('minor'), 'low');
    assert.strictEqual(mapSeverity('info'), 'low');
    assert.strictEqual(mapSeverity('unknown'), 'low');
    assert.strictEqual(mapSeverity(''), 'low');
  });

  it('should handle whitespace', () => {
    assert.strictEqual(mapSeverity('  high  '), 'high');
    assert.strictEqual(mapSeverity('\tmedium\t'), 'medium');
  });

  it('should use custom mapping when provided', () => {
    const customMapping = {
      'p0': 'high' as const,
      'p1': 'medium' as const,
      'p2': 'low' as const,
    };

    assert.strictEqual(mapSeverity('p0', customMapping), 'high');
    assert.strictEqual(mapSeverity('p1', customMapping), 'medium');
    assert.strictEqual(mapSeverity('p2', customMapping), 'low');
    // Should fall back to default for unmapped values
    assert.strictEqual(mapSeverity('critical', customMapping), 'high');
  });
});

describe('mapPriority', () => {
  it('should map high priority values', () => {
    assert.strictEqual(mapPriority('critical'), 'high');
    assert.strictEqual(mapPriority('high'), 'high');
    assert.strictEqual(mapPriority('urgent'), 'high');
    assert.strictEqual(mapPriority('p0'), 'high');
    assert.strictEqual(mapPriority('p1'), 'high');
  });

  it('should map medium priority values', () => {
    assert.strictEqual(mapPriority('medium'), 'medium');
    assert.strictEqual(mapPriority('normal'), 'medium');
    assert.strictEqual(mapPriority('p2'), 'medium');
  });

  it('should map low and unknown to low', () => {
    assert.strictEqual(mapPriority('low'), 'low');
    assert.strictEqual(mapPriority('p3'), 'low');
    assert.strictEqual(mapPriority('unknown'), 'low');
  });
});

describe('Integration: Complete agent response parsing', () => {
  it('should parse a complex TechnicalDebtAgent-style response', () => {
    const response = `SUMMARY:
This commit introduces some technical debt through complex nested conditionals.

DEBT_TREND: adding_debt

FINDINGS:
- [Code Smell] [SEVERITY:high] Complex nested conditional in main function [src/main.ts]
- [Dead Code] [SEVERITY:low] Unused import statements [src/utils.ts, src/helpers.ts]

TODO_ITEMS:
- [src/main.ts:45] [TODO] Refactor this function
- [src/utils.ts:12] [FIXME] Handle edge case

REMEDIATION:
- Extract complex conditional into separate function
- Remove unused imports

CONFIDENCE: 0.85`;

    const ctx = createParseContext('technical-debt', response);

    // Parse summary
    const summary = parseSection(ctx, 'SUMMARY', /SUMMARY:\s*([\s\S]*?)(?=DEBT_TREND:|FINDINGS:|$)/i);
    assert.ok(summary);
    assert.ok(summary.includes('technical debt'));

    // Parse debt trend
    const trend = parseChoice(ctx, 'DEBT_TREND', /DEBT_TREND:\s*(\S+)/i,
      ['adding_debt', 'reducing_debt', 'neutral', 'mixed'] as const);
    assert.strictEqual(trend, 'adding_debt');

    // Parse findings with fallback
    const findings = parseListItemsWithFallback(
      ctx,
      'FINDINGS',
      /FINDINGS:\s*([\s\S]*?)(?=TODO_ITEMS:|REMEDIATION:|CONFIDENCE:|$)/i,
      [
        {
          pattern: /^-\s*\[([^\]]+)\]\s*\[SEVERITY:(\w+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i,
          mapper: (m) => ({
            type: m[1]!.trim(),
            severity: mapSeverity(m[2]!),
            description: m[3]!.trim(),
            paths: m[4]?.split(',').map(p => p.trim()).filter(p => p) ?? [],
          }),
        },
      ]
    );
    assert.strictEqual(findings.length, 2);
    assert.strictEqual(findings[0]!.type, 'Code Smell');
    assert.strictEqual(findings[0]!.severity, 'high');

    // Parse remediation as string list
    const remediations = parseStringList(
      ctx,
      'REMEDIATION',
      /REMEDIATION:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i
    );
    assert.strictEqual(remediations.length, 2);
    assert.ok(remediations[0]!.includes('complex conditional'));

    // Parse confidence
    const confidence = parseConfidence(ctx);
    assert.strictEqual(confidence, 0.85);

    // Should have no required failures
    assert.ok(!hasRequiredFailures(ctx));
  });

  it('should parse a DuplicateHandler-style response', () => {
    const response = `DECISION: merge
REASON: Both pages cover the same topic with overlapping content.
PRIMARY_PAGE: architecture/overview
MERGED_CONTENT:
# Architecture Overview

This is the merged content from both pages.
DELETE_PAGES: architecture/intro, architecture/summary
CONFIDENCE: 0.9`;

    const ctx = createParseContext('duplicate-handler', response);

    const decision = parseChoice(ctx, 'DECISION', /DECISION:\s*(\S+)/i,
      ['merge', 'keep-separate'] as const);
    assert.strictEqual(decision, 'merge');

    const reason = parseSection(ctx, 'REASON', /REASON:\s*(.+?)(?=PRIMARY_PAGE:|$)/is);
    assert.ok(reason);
    assert.ok(reason.includes('overlapping content'));

    const primaryPage = parseSection(ctx, 'PRIMARY_PAGE', /PRIMARY_PAGE:\s*(.+?)(?=MERGED_CONTENT:|DELETE_PAGES:|$)/is);
    assert.strictEqual(primaryPage, 'architecture/overview');

    const content = parseSection(ctx, 'MERGED_CONTENT', /MERGED_CONTENT:\s*([\s\S]*?)(?=DELETE_PAGES:|CONFIDENCE:|$)/i);
    assert.ok(content);
    assert.ok(content.includes('Architecture Overview'));

    const confidence = parseConfidence(ctx);
    assert.strictEqual(confidence, 0.9);
  });

  it('should parse a CodeChangeAgent-style response with blocks', () => {
    const response = `PAGE_TITLE: Multi-Agent Architecture Implementation

SUMMARY:
The codebase implements a multi-agent architecture for processing code changes.

FINDINGS:
- [ARCHITECTURE] [IMPORTANCE:high] New agent system implemented [src/agents/]

WIKI_UPDATES:
=== [architecture/agents] [create] ===
# Agent System

The agent system provides specialized processors for different aspects of code analysis.

## Available Agents

- CodeChangeAgent: Analyzes code changes
- SecurityAgent: Security auditing
=== END ===

=== [guides/contributing] [update] ===
# Contributing Guide

When adding new agents, follow the established patterns.
=== END ===

CONFIDENCE: 0.85`;

    const ctx = createParseContext('code-change', response);

    const title = parseSection(ctx, 'PAGE_TITLE', /PAGE_TITLE:\s*(.+?)(?=\n|SUMMARY:|$)/i);
    assert.strictEqual(title, 'Multi-Agent Architecture Implementation');

    const summary = parseSection(ctx, 'SUMMARY', /SUMMARY:\s*([\s\S]*?)(?=FINDINGS:|$)/i);
    assert.ok(summary);

    const updates = parseBlocks(
      ctx,
      'WIKI_UPDATES',
      /WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      /===\s*\[([^\]]+)\]\s*\[(create|update|merge)\]\s*===\s*([\s\S]*?)\s*===\s*END\s*===/gi,
      (m) => ({
        path: m[1]!.trim(),
        action: m[2]!.toLowerCase() as 'create' | 'update' | 'merge',
        content: m[3]!.trim(),
      })
    );

    assert.strictEqual(updates.length, 2);
    assert.strictEqual(updates[0]!.path, 'architecture/agents');
    assert.strictEqual(updates[0]!.action, 'create');
    assert.ok(updates[0]!.content.includes('Agent System'));
    assert.strictEqual(updates[1]!.path, 'guides/contributing');
    assert.strictEqual(updates[1]!.action, 'update');

    const confidence = parseConfidence(ctx);
    assert.strictEqual(confidence, 0.85);
  });
});

describe('parseSectionFlexible', () => {
  it('should parse colon format (primary pattern)', () => {
    const response = `SUMMARY: This is the summary content.
CONFIDENCE: 0.8`;

    const ctx = createParseContext('test', response);

    const result = parseSectionFlexible(
      ctx,
      'SUMMARY',
      /SUMMARY:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i
    );

    assert.strictEqual(result, 'This is the summary content.');
    assert.ok(ctx.successfulSections.includes('SUMMARY'));
    assert.strictEqual(ctx.failures.length, 0);
  });

  it('should fallback to ## markdown heading format', () => {
    const response = `## SUMMARY
This is the summary content from markdown heading.

## FINDINGS
Some findings here.`;

    const ctx = createParseContext('test', response);

    const result = parseSectionFlexible(
      ctx,
      'SUMMARY',
      /SUMMARY:\s*([\s\S]*?)(?=FINDINGS:|$)/i
    );

    assert.strictEqual(result, 'This is the summary content from markdown heading.');
    assert.ok(ctx.successfulSections.includes('SUMMARY'));
  });

  it('should fallback to ### markdown heading format', () => {
    const response = `### SUMMARY
This is the summary from h3 heading.

### FINDINGS
Some findings here.`;

    const ctx = createParseContext('test', response);

    const result = parseSectionFlexible(
      ctx,
      'SUMMARY',
      /SUMMARY:\s*([\s\S]*?)(?=FINDINGS:|$)/i
    );

    assert.strictEqual(result, 'This is the summary from h3 heading.');
    assert.ok(ctx.successfulSections.includes('SUMMARY'));
  });

  it('should prefer colon format over markdown when both present', () => {
    const response = `SUMMARY: This is the colon format.

## SUMMARY
This is the markdown format.

CONFIDENCE: 0.8`;

    const ctx = createParseContext('test', response);

    const result = parseSectionFlexible(
      ctx,
      'SUMMARY',
      /SUMMARY:\s*([\s\S]*?)(?=CONFIDENCE:|##|$)/i
    );

    assert.strictEqual(result, 'This is the colon format.');
  });

  it('should handle multiline markdown content', () => {
    const response = `## SUMMARY
This is the first paragraph.

This is the second paragraph with more details.

- Bullet point 1
- Bullet point 2

## FINDINGS
Next section.`;

    const ctx = createParseContext('test', response);

    const result = parseSectionFlexible(
      ctx,
      'SUMMARY',
      /SUMMARY:\s*([\s\S]*?)(?=FINDINGS:|$)/i
    );

    assert.ok(result);
    assert.ok(result.includes('first paragraph'));
    assert.ok(result.includes('second paragraph'));
    assert.ok(result.includes('Bullet point'));
  });

  it('should return default value when all patterns fail', () => {
    const response = `OTHER: stuff
No summary section here.`;

    const ctx = createParseContext('test', response);

    const result = parseSectionFlexible(
      ctx,
      'SUMMARY',
      /SUMMARY:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      { defaultValue: 'Default summary' }
    );

    assert.strictEqual(result, 'Default summary');
    assert.strictEqual(ctx.failures.length, 1);
  });

  it('should return null for required missing section', () => {
    const response = `OTHER: stuff`;

    const ctx = createParseContext('test', response);

    const result = parseSectionFlexible(
      ctx,
      'SUMMARY',
      /SUMMARY:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      { required: true }
    );

    assert.strictEqual(result, null);
    assert.ok(hasRequiredFailures(ctx));
  });

  it('should use custom terminators', () => {
    const response = `## SUMMARY
This is content until custom terminator.

## CUSTOM_END
Next section.`;

    const ctx = createParseContext('test', response);

    const result = parseSectionFlexible(
      ctx,
      'SUMMARY',
      /SUMMARY:\s*([\s\S]*?)(?=CUSTOM_END:|$)/i,
      { terminators: ['CUSTOM_END'] }
    );

    assert.ok(result);
    assert.ok(result.includes('custom terminator'));
    assert.ok(!result.includes('Next section'));
  });

  it('should respect minLength option', () => {
    const response = `SUMMARY: Short

## SUMMARY
This is the longer markdown content that meets minimum length.

CONFIDENCE: 0.8`;

    const ctx = createParseContext('test', response);

    const result = parseSectionFlexible(
      ctx,
      'SUMMARY',
      /SUMMARY:\s*([\s\S]*?)(?=CONFIDENCE:|##|$)/i,
      { minLength: 20 }
    );

    // Should fall back to markdown since colon format is too short
    assert.ok(result);
    assert.ok(result.includes('longer markdown content'));
  });

  it('should handle case-insensitive section names', () => {
    const response = `## summary
This is lowercase heading content.

## FINDINGS
Next.`;

    const ctx = createParseContext('test', response);

    const result = parseSectionFlexible(
      ctx,
      'SUMMARY',
      /SUMMARY:\s*([\s\S]*?)(?=FINDINGS:|$)/i
    );

    assert.ok(result);
    assert.ok(result.includes('lowercase heading content'));
  });

  it('should handle real LLM-style response with mixed formats', () => {
    const response = `### SUMMARY
The code implements a repository pattern for data access.

### DEBT_TREND
adding_debt

### FINDINGS
- category: Long Method | severity: high | description: Method exceeds 50 lines | paths: src/main.ts

### CONFIDENCE
0.85`;

    const ctx = createParseContext('technical-debt', response);

    const summary = parseSectionFlexible(
      ctx,
      'SUMMARY',
      /SUMMARY:\s*([\s\S]*?)(?=DEBT_TREND:|FINDINGS:|$)/i,
      { terminators: ['DEBT_TREND', 'FINDINGS', 'CONFIDENCE'] }
    );

    assert.ok(summary);
    assert.ok(summary.includes('repository pattern'));
    assert.ok(!summary.includes('DEBT_TREND'));
  });
});

describe('extractProseContent - fallback for unstructured responses', () => {
  it('should extract first paragraphs when response has no section markers', () => {
    const response = `The \`analysis\` directory contains several agent implementations, including:

* \`code-change-agent.ts\` - Analyzes code changes from commits
* \`codebase-explorer-agent.ts\` - Explores and documents undocumented directories
* \`dependency-agent.ts\` - Tracks dependency changes

These agents work together to build comprehensive documentation.`;

    const result = extractProseContent(response, { maxParagraphs: 2 });

    assert.ok(result, 'Should extract content');
    assert.ok(result.includes('analysis'), 'Should include first paragraph');
    assert.ok(result.includes('code-change-agent.ts'), 'Should include list content');
  });

  it('should return null for very short responses', () => {
    const response = `Short.`;

    const result = extractProseContent(response, { minLength: 50 });

    assert.strictEqual(result, null, 'Should return null for short content');
  });

  it('should stop at section-like markers', () => {
    const response = `This is the introductory content.

FINDINGS:
- Some finding here

More content after findings.`;

    const result = extractProseContent(response);

    assert.ok(result, 'Should extract content');
    assert.ok(result.includes('introductory content'), 'Should include intro');
    assert.ok(!result.includes('FINDINGS'), 'Should stop at section marker');
    assert.ok(!result.includes('Some finding'), 'Should not include findings content');
  });

  it('should exclude code blocks from prose extraction', () => {
    const response = `Here is an overview.

\`\`\`typescript
const x = 1;
\`\`\`

And here is more explanation.`;

    const result = extractProseContent(response, { excludeCodeBlocks: true });

    assert.ok(result, 'Should extract content');
    assert.ok(result.includes('overview'), 'Should include text');
    assert.ok(!result.includes('const x'), 'Should exclude code block');
    assert.ok(result.includes('more explanation'), 'Should include text after code block');
  });

  it('should handle response that looks like markdown wiki content', () => {
    const response = `# Authentication Module

The authentication module provides secure user authentication.

## Features

- JWT-based tokens
- Refresh token rotation
- Session management

## Usage

\`\`\`typescript
const token = await auth.login(user, password);
\`\`\``;

    const result = extractProseContent(response, { maxParagraphs: 3 });

    assert.ok(result, 'Should extract content');
    assert.ok(result.includes('authentication module'), 'Should include main content');
  });

  // Real LLM output variations observed in production
  it('should handle Llama-style bullet point response', () => {
    const response = `I will document the directory based on my exploration.

The src/agents directory contains the following key components:

* **CodeChangeAgent** - Analyzes code changes from git commits
* **SecurityAgent** - Performs security audits on code
* **PatternAgent** - Identifies design patterns

Each agent implements the BaseAgent interface and follows a consistent structure.`;

    const result = extractProseContent(response);

    assert.ok(result, 'Should extract content');
    assert.ok(result.includes('CodeChangeAgent'), 'Should include bullet content');
    assert.ok(result.includes('key components'), 'Should include intro text');
  });

  it('should handle response with thinking/reasoning prefix', () => {
    const response = `Let me analyze the directory structure.

First, I'll examine the main files...

The orchestrator module coordinates work between multiple agents. It implements a phased approach:

1. Bootstrap phase - Initial setup
2. Skeleton phase - Core structure
3. Breadth phase - Wide coverage

This design allows for incremental documentation.`;

    const result = extractProseContent(response);

    assert.ok(result, 'Should extract content');
    // Should include the substantive content
    assert.ok(result.includes('orchestrator module'), 'Should include main content');
  });

  it('should handle response starting with "## Step" thinking', () => {
    const response = `## Step 1: Explore the Directory

First, I will list the contents of the directory to understand its structure.

## Step 2: Document Findings

The directory contains several TypeScript files implementing a repository pattern.

## Summary

This module provides data access abstractions.`;

    const result = extractProseContent(response);

    assert.ok(result, 'Should extract content');
    // Should get content even with step-by-step format
    assert.ok(result.length > 50, 'Should extract substantial content');
  });

  it('should handle response with mermaid diagrams', () => {
    const response = `Here is the architecture overview:

\`\`\`mermaid
graph LR
    A[Agent] --> B[Executor]
    B --> C[Repository]
\`\`\`

The system uses a multi-agent architecture where each agent processes specific types of work.`;

    const result = extractProseContent(response, { excludeCodeBlocks: true });

    assert.ok(result, 'Should extract content');
    assert.ok(result.includes('architecture overview'), 'Should include text before diagram');
    assert.ok(result.includes('multi-agent'), 'Should include text after diagram');
    assert.ok(!result.includes('graph LR'), 'Should exclude mermaid code');
  });

  it('should handle Chinese/multilingual responses', () => {
    const response = `This module implements authentication functionality.

认证模块提供用户身份验证功能。

The main features include:
- JWT token generation
- Password hashing
- Session management`;

    const result = extractProseContent(response);

    assert.ok(result, 'Should extract content');
    assert.ok(result.includes('authentication'), 'Should include English content');
    // Should handle non-ASCII gracefully
    assert.ok(result.length > 50, 'Should extract substantial content');
  });

  it('should handle response with inline code but no blocks', () => {
    const response = `The \`UserService\` class handles user operations. It uses \`bcrypt\` for password hashing and \`jsonwebtoken\` for JWT generation.

Key methods:
- \`authenticate(email, password)\` - Validates credentials
- \`createToken(user)\` - Generates JWT
- \`refreshToken(token)\` - Refreshes expired tokens`;

    const result = extractProseContent(response);

    assert.ok(result, 'Should extract content');
    assert.ok(result.includes('UserService'), 'Should preserve inline code');
    assert.ok(result.includes('bcrypt'), 'Should preserve inline code references');
  });

  it('should handle response with leading whitespace/newlines', () => {
    const response = `


The codebase implements a clean architecture with separation of concerns.

Domain entities are defined in the domain/ directory.`;

    const result = extractProseContent(response);

    assert.ok(result, 'Should extract content');
    assert.ok(result.includes('clean architecture'), 'Should extract trimmed content');
  });

  it('should handle empty or whitespace-only response', () => {
    const response = `

    `;

    const result = extractProseContent(response);

    assert.strictEqual(result, null, 'Should return null for empty content');
  });

  it('should handle response that is just a numbered list', () => {
    const response = `1. The module uses dependency injection
2. All services implement interfaces
3. Repository pattern for data access
4. Event-driven communication between modules`;

    const result = extractProseContent(response);

    assert.ok(result, 'Should extract numbered list');
    assert.ok(result.includes('dependency injection'), 'Should include list content');
  });

  it('should handle response with XML-style tags', () => {
    const response = `<summary>
The authentication module provides secure login functionality.
</summary>

<details>
Implementation uses JWT tokens with refresh rotation.
</details>`;

    const result = extractProseContent(response);

    assert.ok(result, 'Should extract content');
    // Should get content inside tags
    assert.ok(result.includes('authentication'), 'Should include tag content');
  });

  it('should handle response with table-like content', () => {
    const response = `Module overview:

| Component | Purpose |
|-----------|---------|
| Agent | Process work items |
| Executor | Run agents |
| Repository | Store data |

The table above shows the main components.`;

    const result = extractProseContent(response);

    assert.ok(result, 'Should extract content');
    assert.ok(result.includes('Module overview'), 'Should include text content');
  });
});
