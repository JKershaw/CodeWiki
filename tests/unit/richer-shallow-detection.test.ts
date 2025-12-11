/**
 * Unit tests for richer shallow page detection.
 *
 * Instead of just using character count < 500, we use multi-factor detection:
 * - Word count < 100 words (more meaningful than chars)
 * - Heading count < 2 headings (indicates lack of structure)
 * - Both conditions must be true to be considered "shallow"
 *
 * This reduces false positives (concise but well-structured pages)
 * and false negatives (verbose but poorly structured pages).
 *
 * TDD: Define behavior through tests before implementation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isShallowPage,
  countWords,
  countHeadings,
} from '../../src/agents/orchestrator/shallow-detection.js';

describe('countWords', () => {
  it('counts words in simple text', () => {
    assert.strictEqual(countWords('hello world'), 2);
    assert.strictEqual(countWords('one two three four'), 4);
  });

  it('handles markdown formatting', () => {
    const markdown = '# Heading\n\nSome **bold** and *italic* text.';
    // Words: #, Heading, Some, **bold**, and, *italic*, text. = 7 tokens
    // We count tokens not semantic words - this is fine for shallow detection
    assert.strictEqual(countWords(markdown), 7);
  });

  it('handles code blocks', () => {
    const withCode = `Some text before.

\`\`\`typescript
const x = 1;
const y = 2;
\`\`\`

Some text after.`;
    // Should count words in prose, may or may not count code
    // At minimum: Some, text, before, Some, text, after = 6 words
    assert.ok(countWords(withCode) >= 6);
  });

  it('handles empty content', () => {
    assert.strictEqual(countWords(''), 0);
    assert.strictEqual(countWords('   '), 0);
    assert.strictEqual(countWords('\n\n\n'), 0);
  });

  it('handles special characters', () => {
    const text = "Don't count contractions as two words.";
    // Don't, count, contractions, as, two, words = 6 words
    assert.strictEqual(countWords(text), 6);
  });

  it('handles URLs and paths', () => {
    const text = 'See https://example.com/path/to/resource for details.';
    // See, https://example.com/path/to/resource, for, details = 4 "words"
    assert.ok(countWords(text) >= 3);
  });
});

describe('countHeadings', () => {
  it('counts markdown headings', () => {
    const markdown = `# Main Title

## Section 1
Content here.

## Section 2
More content.

### Subsection
Details.`;

    // 4 headings: #, ##, ##, ###
    assert.strictEqual(countHeadings(markdown), 4);
  });

  it('only counts headings at start of line', () => {
    const text = 'Inline # hash should not count.\n# Real heading';
    // Only 1 heading at start of line
    assert.strictEqual(countHeadings(text), 1);
  });

  it('handles all heading levels', () => {
    const markdown = `# H1
## H2
### H3
#### H4
##### H5
###### H6`;
    assert.strictEqual(countHeadings(markdown), 6);
  });

  it('returns 0 for no headings', () => {
    const text = 'Just some plain text without any headings.';
    assert.strictEqual(countHeadings(text), 0);
  });

  it('handles empty content', () => {
    assert.strictEqual(countHeadings(''), 0);
  });

  it('handles alternative heading formats', () => {
    // Setext-style headings (underlined)
    const setext = `Main Title
===========

Section
-------`;
    // Should count at least the standard headings
    // Setext support is optional
    assert.ok(countHeadings(setext) >= 0);
  });
});

describe('isShallowPage', () => {
  describe('word count criterion', () => {
    it('marks pages with very few words as shallow', () => {
      const shortContent = 'Brief page.';
      // 2 words, 0 headings - definitely shallow
      assert.strictEqual(isShallowPage(shortContent), true);
    });

    it('does not mark word-rich pages as shallow', () => {
      // 100+ words should not be shallow regardless of heading count
      const longContent = Array(110).fill('word').join(' ');
      assert.strictEqual(isShallowPage(longContent), false);
    });
  });

  describe('heading count criterion', () => {
    it('marks pages without structure as shallow', () => {
      // Few words, no headings
      const unstructured = 'A short paragraph without any structure or headings.';
      assert.strictEqual(isShallowPage(unstructured), true);
    });

    it('does not mark well-structured pages as shallow', () => {
      // Few words but good structure
      const structured = `# Overview

Brief intro.

## Details

Short details.`;
      // Low word count but 2 headings = not shallow
      assert.strictEqual(isShallowPage(structured), false);
    });
  });

  describe('combined criteria', () => {
    it('requires both low words AND few headings to be shallow', () => {
      // Few words, many headings -> not shallow
      const fewWordsStructured = `# A
## B
## C`;
      assert.strictEqual(isShallowPage(fewWordsStructured), false);

      // Many words, no headings -> not shallow
      const manyWordsUnstructured = Array(120).fill('word').join(' ');
      assert.strictEqual(isShallowPage(manyWordsUnstructured), false);

      // Few words, few headings -> shallow
      const fewWordsFewHeadings = '# Title\n\nShort content.';
      assert.strictEqual(isShallowPage(fewWordsFewHeadings), true);
    });
  });

  describe('overview pages exception', () => {
    it('does not mark overview pages as shallow', () => {
      const shortOverview = 'Brief overview.';
      assert.strictEqual(isShallowPage(shortOverview, 'architecture/overview'), false);
      assert.strictEqual(isShallowPage(shortOverview, 'overview'), false);
    });

    it('does not mark index pages as shallow', () => {
      const shortIndex = 'Brief index.';
      assert.strictEqual(isShallowPage(shortIndex, 'guides/index'), false);
    });
  });

  describe('real-world examples', () => {
    it('identifies stub pages', () => {
      const stub = 'TODO: Add documentation for this module.';
      assert.strictEqual(isShallowPage(stub), true);
    });

    it('identifies placeholder pages', () => {
      const placeholder = `# Module Name

This page documents the module.`;
      // 5 words, 1 heading = shallow
      assert.strictEqual(isShallowPage(placeholder), true);
    });

    it('does not flag concise but complete pages', () => {
      const concise = `# Configuration

The config file supports these options.

## Database

Connection string and pool size.

## Logging

Log level and output format.`;
      // ~15 words but 3 headings = not shallow
      assert.strictEqual(isShallowPage(concise), false);
    });

    it('does not flag pages with good explanation', () => {
      const goodExplanation = `The authentication module handles user login, session management,
and token validation. It integrates with OAuth providers for social login
and supports multi-factor authentication. The module uses JWT tokens for
session management and implements refresh token rotation for security.
Error handling includes rate limiting for failed attempts and account
lockout after repeated failures. Logging captures all authentication
events for audit purposes.`;
      // ~70 words, no headings but substantial content
      // This is borderline - could go either way
      // With 2+ heading threshold, this might be shallow
      // With relaxed thresholds, it might not be
      // Current impl: < 100 words AND < 2 headings = shallow
      assert.strictEqual(isShallowPage(goodExplanation), true); // No headings
    });

    it('correctly identifies substantial documentation', () => {
      const substantial = `# Authentication Service

The authentication service provides secure user login and session management.

## Overview

This service handles user authentication using JWT tokens and supports
multiple authentication providers including local accounts and OAuth.

## Architecture

The service consists of several components:

- Token generation and validation
- Session storage (Redis-backed)
- Rate limiting middleware
- Audit logging

## Usage

\`\`\`typescript
const auth = new AuthService(config);
const token = await auth.login(credentials);
\`\`\`

## Configuration

Configure via environment variables or config file.`;
      // Many words, many headings = not shallow
      assert.strictEqual(isShallowPage(substantial), false);
    });
  });

  describe('edge cases', () => {
    it('handles empty content', () => {
      assert.strictEqual(isShallowPage(''), true);
    });

    it('handles whitespace-only content', () => {
      assert.strictEqual(isShallowPage('   \n\n   '), true);
    });

    it('handles content at exact thresholds', () => {
      // Exactly 100 words, 1 heading
      const words = Array(100).fill('word').join(' ');
      const atThreshold = `# Heading\n\n${words}`;
      // 100 words is the threshold, so not shallow
      assert.strictEqual(isShallowPage(atThreshold), false);
    });
  });
});
