/**
 * Unit tests for markdown parsing and sanitization.
 * Tests the marked library and DOMPurify configuration used in the frontend.
 *
 * These tests verify that the marked library produces expected HTML output
 * for the markdown features we use in CodeWiki, and that DOMPurify properly
 * sanitizes the output to prevent XSS attacks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { marked } from 'marked';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

// Set up jsdom window for DOMPurify
const window = new JSDOM('').window;
const purify = DOMPurify(window);

// Configure marked the same way as in app.js
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Wrapper function that mirrors the frontend markdownToHtml function.
 * Parses markdown to HTML and sanitizes with DOMPurify.
 */
function markdownToHtml(md: string): string {
  if (!md) return '';
  const rawHtml = marked.parse(md) as string;
  return purify.sanitize(rawHtml);
}

describe('markdownToHtml', () => {
  describe('basic markdown features', () => {
    it('converts headers', () => {
      const md = '# Heading 1\n## Heading 2\n### Heading 3';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<h1>Heading 1</h1>'), 'Should convert H1');
      assert.ok(html.includes('<h2>Heading 2</h2>'), 'Should convert H2');
      assert.ok(html.includes('<h3>Heading 3</h3>'), 'Should convert H3');
    });

    it('converts bold text', () => {
      const md = 'This is **bold** text';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<strong>bold</strong>'), 'Should convert bold');
    });

    it('converts italic text', () => {
      const md = 'This is *italic* text';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<em>italic</em>'), 'Should convert italic');
    });

    it('converts inline code', () => {
      const md = 'Use `console.log()` for debugging';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<code>console.log()</code>'), 'Should convert inline code');
    });

    it('converts code blocks', () => {
      const md = '```javascript\nconst x = 1;\n```';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<pre>'), 'Should have pre tag');
      assert.ok(html.includes('<code'), 'Should have code tag'); // Note: <code may have class attribute
      assert.ok(html.includes('const x = 1;'), 'Should preserve code content');
    });

    it('converts unordered lists', () => {
      const md = '- Item 1\n- Item 2\n- Item 3';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<ul>'), 'Should have ul tag');
      assert.ok(html.includes('<li>Item 1</li>'), 'Should convert list items');
      assert.ok(html.includes('<li>Item 2</li>'), 'Should convert list items');
    });

    it('converts ordered lists', () => {
      const md = '1. First\n2. Second\n3. Third';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<ol>'), 'Should have ol tag');
      assert.ok(html.includes('<li>First</li>'), 'Should convert list items');
    });

    it('converts horizontal rules', () => {
      const md = 'Above\n\n---\n\nBelow';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<hr'), 'Should convert horizontal rule');
    });

    it('converts links', () => {
      const md = 'Visit [Google](https://google.com) for search';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<a href="https://google.com">Google</a>'), 'Should convert links');
    });

    it('converts paragraphs', () => {
      const md = 'First paragraph.\n\nSecond paragraph.';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<p>First paragraph.</p>'), 'Should wrap in paragraph');
      assert.ok(html.includes('<p>Second paragraph.</p>'), 'Should create separate paragraphs');
    });
  });

  describe('GitHub Flavored Markdown features', () => {
    it('converts tables', () => {
      const md = '| Name | Age |\n|------|-----|\n| John | 30  |';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<table>'), 'Should convert tables');
      assert.ok(html.includes('<th>Name</th>'), 'Should have table headers');
      assert.ok(html.includes('<td>John</td>'), 'Should have table data');
    });

    it('converts strikethrough', () => {
      const md = 'This is ~~deleted~~ text';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<del>deleted</del>'), 'Should convert strikethrough');
    });

    it('converts task lists', () => {
      const md = '- [x] Completed task\n- [ ] Pending task';
      const html = markdownToHtml(md);

      assert.ok(html.includes('type="checkbox"'), 'Should have checkbox inputs');
      assert.ok(html.includes('checked'), 'Should have checked attribute on completed');
    });

    it('converts line breaks with breaks option', () => {
      const md = 'Line one\nLine two';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<br'), 'Should convert single newlines to br');
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      const html = markdownToHtml('');
      assert.strictEqual(html, '', 'Empty string should return empty string');
    });

    it('handles null/undefined gracefully', () => {
      // @ts-expect-error - Testing null handling
      const htmlNull = markdownToHtml(null);
      assert.strictEqual(htmlNull, '', 'Null should return empty string');

      // @ts-expect-error - Testing undefined handling
      const htmlUndefined = markdownToHtml(undefined);
      assert.strictEqual(htmlUndefined, '', 'Undefined should return empty string');
    });

    it('handles nested formatting', () => {
      const md = '**bold and *italic* text**';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<strong>'), 'Should have bold');
      assert.ok(html.includes('<em>'), 'Should have italic');
    });

    it('handles code blocks with special characters', () => {
      const md = '```html\n<div class="test">&amp;</div>\n```';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<pre>'), 'Should preserve code block');
      // HTML entities should be escaped in code blocks
      assert.ok(
        html.includes('&lt;div') || html.includes('<div'),
        'Should handle HTML in code blocks'
      );
    });

    it('handles multiple code blocks', () => {
      const md = '```js\ncode1\n```\n\nSome text\n\n```js\ncode2\n```';
      const html = markdownToHtml(md);

      const preCount = (html.match(/<pre>/g) || []).length;
      assert.strictEqual(preCount, 2, 'Should have two code blocks');
    });
  });

  describe('real-world wiki content', () => {
    it('handles typical wiki page content', () => {
      const md = `# Authentication System

This module handles user authentication.

## Features

- JWT token generation
- Password hashing with bcrypt
- Session management

## Usage

\`\`\`typescript
import { authenticate } from './auth';

const user = await authenticate(credentials);
\`\`\`

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | /login   | User login  |
| POST   | /logout  | User logout |

---

*Last updated: 2024*`;

      const html = markdownToHtml(md);

      assert.ok(html.includes('<h1>Authentication System</h1>'), 'Should have title');
      assert.ok(html.includes('<h2>Features</h2>'), 'Should have section headers');
      assert.ok(html.includes('<li>JWT token generation</li>'), 'Should have list items');
      assert.ok(html.includes('<pre>'), 'Should have code block');
      assert.ok(html.includes('<table>'), 'Should have table');
      assert.ok(html.includes('<hr'), 'Should have horizontal rule');
      assert.ok(html.includes('<em>Last updated'), 'Should have italic text');
    });
  });

  describe('XSS sanitization', () => {
    it('removes script tags', () => {
      const md = 'Hello <script>alert("xss")</script> world';
      const html = markdownToHtml(md);

      assert.ok(!html.includes('<script>'), 'Should remove script tags');
      assert.ok(!html.includes('alert'), 'Should remove script content');
      assert.ok(html.includes('Hello'), 'Should preserve safe content');
      assert.ok(html.includes('world'), 'Should preserve safe content');
    });

    it('removes javascript: URLs in links', () => {
      const md = '[Click me](javascript:alert("xss"))';
      const html = markdownToHtml(md);

      assert.ok(!html.includes('javascript:'), 'Should remove javascript: protocol');
    });

    it('sanitizes malformed image syntax with XSS attempt', () => {
      const md = '![alt](image.jpg" onerror="alert(\'xss\'))';
      const html = markdownToHtml(md);

      // Marked treats malformed image syntax as plain text (not an img tag)
      // This is safe because the text is not executable HTML
      assert.ok(!html.includes('<img'), 'Should not create img tag from malformed syntax');
      // The malformed syntax becomes plain text in a paragraph
      assert.ok(html.includes('<p>'), 'Should wrap in paragraph as plain text');
    });

    it('removes event handlers from HTML', () => {
      const md = '<div onclick="alert(\'xss\')">Click me</div>';
      const html = markdownToHtml(md);

      assert.ok(!html.includes('onclick'), 'Should remove onclick handler');
    });

    it('removes iframe tags', () => {
      const md = '<iframe src="https://evil.com"></iframe>';
      const html = markdownToHtml(md);

      assert.ok(!html.includes('<iframe'), 'Should remove iframe tags');
    });

    it('preserves safe HTML in markdown', () => {
      const md = 'This is <strong>bold</strong> and <em>italic</em>';
      const html = markdownToHtml(md);

      assert.ok(html.includes('<strong>bold</strong>'), 'Should preserve strong tags');
      assert.ok(html.includes('<em>italic</em>'), 'Should preserve em tags');
    });

    it('handles complex XSS attempts', () => {
      // Note: Marked escapes some raw HTML tags to text (like <img> and <svg>)
      // while parsing others as HTML (like <body> and <input>).
      // DOMPurify removes dangerous attributes from actual HTML elements.
      const md = `
# Safe Title

<div onclick="alert('XSS')">test</div>
<a href="javascript:alert('XSS')">link</a>
<input onfocus=alert('XSS') autofocus>

Normal paragraph with **bold** text.
`;
      const html = markdownToHtml(md);

      // Event handlers should be stripped from actual HTML elements
      assert.ok(!html.includes('onclick='), 'Should remove onclick');
      assert.ok(!html.includes('onfocus='), 'Should remove onfocus');
      assert.ok(!html.includes('javascript:'), 'Should remove javascript: protocol');
      assert.ok(html.includes('<h1>Safe Title</h1>'), 'Should preserve safe content');
      assert.ok(html.includes('<strong>bold</strong>'), 'Should preserve bold text');
    });

    it('sanitizes data: URLs', () => {
      const md = '[link](data:text/html,<script>alert("xss")</script>)';
      const html = markdownToHtml(md);

      // DOMPurify should remove or neutralize the data: URL
      assert.ok(!html.includes('data:text/html'), 'Should remove dangerous data: URLs');
    });
  });
});
