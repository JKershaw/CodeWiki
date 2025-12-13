/**
 * Unit tests for file reference extraction utilities.
 * These utilities extract file/folder references from markdown content.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractFileReferencesFromContent,
  extractFileReferencesAsSet,
} from '../../src/utils/file-reference-extraction.js';

describe('File Reference Extraction', () => {
  describe('extractFileReferencesFromContent', () => {
    it('extracts file paths from inline code', () => {
      const content = 'Check the `src/utils/helper.ts` file for details.';
      const refs = extractFileReferencesFromContent(content);

      assert.deepStrictEqual(refs, ['src/utils/helper.ts']);
    });

    it('extracts multiple file references', () => {
      const content = `
# Overview

See \`src/index.ts\` and \`src/config.json\` for configuration.
Also check \`tests/unit/example.test.ts\`.
`;
      const refs = extractFileReferencesFromContent(content);

      assert.deepStrictEqual(refs, [
        'src/index.ts',
        'src/config.json',
        'tests/unit/example.test.ts',
      ]);
    });

    it('extracts file paths from fenced code block headers', () => {
      const content = `
Here's the implementation:

\`\`\`typescript src/services/auth.ts
export function authenticate() {}
\`\`\`
`;
      const refs = extractFileReferencesFromContent(content);

      assert.deepStrictEqual(refs, ['src/services/auth.ts']);
    });

    it('extracts file paths with language and filename in code blocks', () => {
      const content = `
\`\`\`ts src/app.ts
const app = express();
\`\`\`

\`\`\`json package.json
{ "name": "test" }
\`\`\`
`;
      const refs = extractFileReferencesFromContent(content);

      assert.deepStrictEqual(refs, ['src/app.ts', 'package.json']);
    });

    it('deduplicates file references', () => {
      const content = `
See \`src/utils.ts\` for helpers.
Also, \`src/utils.ts\` contains utility functions.
`;
      const refs = extractFileReferencesFromContent(content);

      assert.deepStrictEqual(refs, ['src/utils.ts']);
    });

    it('returns empty array for content with no file references', () => {
      const content = '# Title\n\nJust some text without any file paths.';
      const refs = extractFileReferencesFromContent(content);

      assert.deepStrictEqual(refs, []);
    });

    it('ignores non-file inline code (commands, variables, etc)', () => {
      const content = `
Run \`npm install\` to install.
Set \`DEBUG=true\` for debugging.
The \`userId\` variable stores the ID.
But check \`src/config.ts\` for settings.
`;
      const refs = extractFileReferencesFromContent(content);

      // Only the actual file path should be extracted
      assert.deepStrictEqual(refs, ['src/config.ts']);
    });

    it('extracts folder paths', () => {
      const content = 'Files are stored in `src/components/` directory.';
      const refs = extractFileReferencesFromContent(content);

      assert.deepStrictEqual(refs, ['src/components/']);
    });

    it('handles various file extensions', () => {
      const content = `
- \`src/index.ts\` - TypeScript
- \`src/styles.css\` - Styles
- \`README.md\` - Documentation
- \`Dockerfile\` - Container config
- \`src/data.json\` - JSON data
- \`.gitignore\` - Git ignore
`;
      const refs = extractFileReferencesFromContent(content);

      assert.deepStrictEqual(refs, [
        'src/index.ts',
        'src/styles.css',
        'README.md',
        'Dockerfile',
        'src/data.json',
        '.gitignore',
      ]);
    });

    it('handles relative paths with ./', () => {
      const content = 'Check `./src/utils.ts` for the implementation.';
      const refs = extractFileReferencesFromContent(content);

      // Should normalize by removing ./
      assert.deepStrictEqual(refs, ['src/utils.ts']);
    });

    it('handles empty content', () => {
      const refs = extractFileReferencesFromContent('');
      assert.deepStrictEqual(refs, []);
    });

    it('handles content with only whitespace', () => {
      const refs = extractFileReferencesFromContent('   \n\n   ');
      assert.deepStrictEqual(refs, []);
    });

    it('does not extract URLs as file paths', () => {
      const content = `
Check \`https://example.com/file.ts\` for examples.
See \`src/real-file.ts\` in the codebase.
`;
      const refs = extractFileReferencesFromContent(content);

      assert.deepStrictEqual(refs, ['src/real-file.ts']);
    });

    it('extracts paths mentioned in prose without backticks', () => {
      const content = `
The file src/services/api.ts handles API requests.
Configuration is in config/settings.json file.
`;
      const refs = extractFileReferencesFromContent(content);

      // Should extract paths that look like file paths even without backticks
      assert.ok(refs.includes('src/services/api.ts'));
      assert.ok(refs.includes('config/settings.json'));
    });
  });

  describe('extractFileReferencesAsSet', () => {
    it('returns a Set of file references', () => {
      const content = '`src/a.ts` and `src/b.ts` files';
      const refs = extractFileReferencesAsSet(content);

      assert.ok(refs instanceof Set);
      assert.strictEqual(refs.size, 2);
      assert.ok(refs.has('src/a.ts'));
      assert.ok(refs.has('src/b.ts'));
    });

    it('is useful for checking file reference existence', () => {
      const content = 'Check `src/utils.ts` for helpers.';
      const refs = extractFileReferencesAsSet(content);

      assert.strictEqual(refs.has('src/utils.ts'), true);
      assert.strictEqual(refs.has('src/other.ts'), false);
    });
  });
});
