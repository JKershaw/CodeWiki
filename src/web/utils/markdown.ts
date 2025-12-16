/**
 * Server-side markdown rendering utility.
 */

import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// Configure marked for GitHub Flavored Markdown
marked.setOptions({
  gfm: true,
});

/**
 * Convert markdown to sanitized HTML.
 * Uses the marked library for parsing and sanitize-html for XSS prevention.
 */
export function markdownToHtml(md: string): string {
  if (!md) return '';

  const rawHtml = marked.parse(md, { async: false }) as string;

  return sanitizeHtml(rawHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img',
      'h1',
      'h2',
      'h3',
      'details',
      'summary',
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt', 'title'],
      a: ['href', 'title', 'target', 'rel'],
      code: ['class'],
      span: ['class'],
      div: ['class'],
    },
    allowedClasses: {
      code: ['language-*'],
      span: ['*'],
      div: ['*'],
    },
  });
}

/**
 * Escape HTML special characters.
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char] || char);
}
