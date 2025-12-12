/**
 * Unit tests for link extraction utilities.
 * These utilities extract wiki page links from markdown content.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractLinksFromContent,
  extractLinkTargetsAsSet,
} from '../../src/utils/link-extraction.js';

describe('Link Extraction', () => {
  describe('extractLinksFromContent', () => {
    it('extracts basic markdown links', () => {
      const content = 'Check out [Auth Module](architecture/auth) for details.';
      const links = extractLinksFromContent(content);

      assert.deepStrictEqual(links, ['architecture/auth']);
    });

    it('extracts multiple links from content', () => {
      const content = `
# Overview

See [Auth](architecture/auth) and [API](architecture/api) for more info.
Also check [Testing Guide](guides/testing).
`;
      const links = extractLinksFromContent(content);

      assert.deepStrictEqual(links, [
        'architecture/auth',
        'architecture/api',
        'guides/testing',
      ]);
    });

    it('removes .md extension from links', () => {
      const content = '[Page](some/page.md) and [Other](other/page)';
      const links = extractLinksFromContent(content);

      assert.deepStrictEqual(links, ['some/page', 'other/page']);
    });

    it('removes leading slashes from links', () => {
      const content = '[Absolute](/architecture/overview) and [Relative](guides/start)';
      const links = extractLinksFromContent(content);

      assert.deepStrictEqual(links, ['architecture/overview', 'guides/start']);
    });

    it('removes leading ./ from links', () => {
      const content = '[Local](./local/page) link';
      const links = extractLinksFromContent(content);

      assert.deepStrictEqual(links, ['local/page']);
    });

    it('deduplicates links', () => {
      const content = `
[Auth](architecture/auth) is important.
See also [Auth Module](architecture/auth) for implementation.
`;
      const links = extractLinksFromContent(content);

      assert.deepStrictEqual(links, ['architecture/auth']);
    });

    it('returns empty array for content with no links', () => {
      const content = '# Title\n\nJust some text without any links.';
      const links = extractLinksFromContent(content);

      assert.deepStrictEqual(links, []);
    });

    it('ignores external URLs', () => {
      const content = `
[Internal](architecture/overview) link.
[External](https://example.com) link.
[HTTP](http://example.com/page) link.
`;
      const links = extractLinksFromContent(content);

      assert.deepStrictEqual(links, ['architecture/overview']);
    });

    it('ignores other URL schemes (mailto, ftp, etc)', () => {
      const content = `
[Email](mailto:test@example.com) link.
[FTP](ftp://files.example.com) link.
[File](file:///path/to/file) link.
[Internal](architecture/overview) link.
`;
      const links = extractLinksFromContent(content);

      assert.deepStrictEqual(links, ['architecture/overview']);
    });

    it('ignores anchor-only links', () => {
      const content = '[Jump to section](#section-name) and [Page](real/page)';
      const links = extractLinksFromContent(content);

      assert.deepStrictEqual(links, ['real/page']);
    });

    it('handles links with anchors (extracts path only)', () => {
      const content = '[Section](architecture/auth#authentication)';
      const links = extractLinksFromContent(content);

      assert.deepStrictEqual(links, ['architecture/auth']);
    });

    it('handles complex markdown with code blocks', () => {
      const content = `
# Guide

See [API](architecture/api) for details.

\`\`\`typescript
// This is not a link: [fake](not/a/link)
const url = "[test](test/path)";
\`\`\`

Also see [Testing](guides/testing).
`;
      const links = extractLinksFromContent(content);

      // Should NOT extract links from code blocks
      assert.deepStrictEqual(links, ['architecture/api', 'guides/testing']);
    });

    it('handles inline code with link-like syntax', () => {
      const content = 'Use `[link](path)` syntax. See [Real Link](real/path).';
      const links = extractLinksFromContent(content);

      // Should NOT extract from inline code
      assert.deepStrictEqual(links, ['real/path']);
    });

    it('handles empty content', () => {
      const links = extractLinksFromContent('');
      assert.deepStrictEqual(links, []);
    });

    it('handles content with only whitespace', () => {
      const links = extractLinksFromContent('   \n\n   ');
      assert.deepStrictEqual(links, []);
    });
  });

  describe('extractLinkTargetsAsSet', () => {
    it('returns a Set of link targets', () => {
      const content = '[A](path/a) and [B](path/b)';
      const targets = extractLinkTargetsAsSet(content);

      assert.ok(targets instanceof Set);
      assert.strictEqual(targets.size, 2);
      assert.ok(targets.has('path/a'));
      assert.ok(targets.has('path/b'));
    });

    it('is useful for checking link existence', () => {
      const content = '[Auth](architecture/auth) module';
      const targets = extractLinkTargetsAsSet(content);

      assert.strictEqual(targets.has('architecture/auth'), true);
      assert.strictEqual(targets.has('architecture/other'), false);
    });
  });
});
