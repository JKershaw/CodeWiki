/**
 * Utilities for extracting file/folder references from markdown content.
 *
 * These utilities help track which files are mentioned in wiki pages,
 * enabling file coverage analysis and traceability between wiki content
 * and source code.
 *
 * Used by synthesis agents and coverage tracking to understand
 * which files are documented in each wiki page.
 */

// Common file extensions to recognize
const FILE_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'yaml', 'yml', 'toml',
  'md', 'mdx', 'txt', 'rst',
  'css', 'scss', 'sass', 'less',
  'html', 'htm', 'xml', 'svg',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'scala',
  'c', 'cpp', 'h', 'hpp',
  'sh', 'bash', 'zsh',
  'sql', 'graphql', 'gql',
  'dockerfile', 'dockerignore',
  'gitignore', 'gitattributes',
  'env', 'env.local', 'env.example',
  'lock', 'config', 'rc',
];

// Known config files without extensions
const KNOWN_CONFIG_FILES = [
  'Dockerfile', 'Makefile', 'Rakefile', 'Gemfile',
  'package.json', 'tsconfig.json', 'jest.config.js',
  '.gitignore', '.eslintrc', '.prettierrc',
  'README', 'LICENSE', 'CHANGELOG',
];

/**
 * Extract file/folder references from markdown content.
 *
 * Features:
 * - Extracts file paths from inline code (`path/to/file.ts`)
 * - Extracts file paths from fenced code block headers (```ts src/file.ts)
 * - Extracts file-like paths from prose text
 * - Recognizes common file extensions and config files
 * - Normalizes paths (removes ./ prefix)
 * - Filters out URLs, commands, and variable names
 * - Deduplicates results
 *
 * @param content - Markdown content to extract file references from
 * @returns Array of unique file/folder paths
 */
export function extractFileReferencesFromContent(content: string): string[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const refs: string[] = [];

  // Extract from fenced code block headers (```language path/to/file.ext)
  extractFromCodeBlockHeaders(content, refs);

  // Extract from inline code (`path/to/file.ext`)
  extractFromInlineCode(content, refs);

  // Extract from prose text (path/to/file.ext without backticks)
  extractFromProseText(content, refs);

  // Deduplicate and return
  return [...new Set(refs)];
}

/**
 * Extract file references from content as a Set.
 * Useful for quick existence checks.
 *
 * @param content - Markdown content to extract file references from
 * @returns Set of unique file/folder paths
 */
export function extractFileReferencesAsSet(content: string): Set<string> {
  return new Set(extractFileReferencesFromContent(content));
}

/**
 * Extract file paths from fenced code block headers.
 * Matches patterns like: ```typescript src/file.ts
 */
function extractFromCodeBlockHeaders(content: string, refs: string[]): void {
  // Match ``` followed by optional language and then a file path
  const codeBlockHeaderRegex = /```(?:\w+)?\s+([^\n`]+)/g;

  let match;
  while ((match = codeBlockHeaderRegex.exec(content)) !== null) {
    const potentialPath = match[1]!.trim();
    if (isValidFilePath(potentialPath)) {
      refs.push(normalizePath(potentialPath));
    }
  }
}

/**
 * Extract file paths from inline code.
 * Matches patterns like: `src/utils/helper.ts`
 */
function extractFromInlineCode(content: string, refs: string[]): void {
  // Remove fenced code blocks first to avoid double-extraction
  const contentWithoutCodeBlocks = removeCodeBlocks(content);

  // Match inline code: `...`
  const inlineCodeRegex = /`([^`]+)`/g;

  let match;
  while ((match = inlineCodeRegex.exec(contentWithoutCodeBlocks)) !== null) {
    const potentialPath = match[1]!.trim();
    if (isValidFilePath(potentialPath) && !isCommand(potentialPath) && !isUrl(potentialPath)) {
      refs.push(normalizePath(potentialPath));
    }
  }
}

/**
 * Extract file paths from prose text (without backticks).
 * Matches patterns like: "The file src/utils.ts contains..."
 */
function extractFromProseText(content: string, refs: string[]): void {
  // Remove code blocks and inline code to avoid double-extraction
  const cleanContent = removeInlineCode(removeCodeBlocks(content));

  // Match path-like patterns: word/word.ext or word/word/
  // Must have at least one / to distinguish from regular words
  const prosePathRegex = /(?:^|[\s(,])([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]+)(?:[\s),.]|$)/g;

  let match;
  while ((match = prosePathRegex.exec(cleanContent)) !== null) {
    const potentialPath = match[1]!.trim();
    if (isValidFilePath(potentialPath) && !isUrl(potentialPath)) {
      refs.push(normalizePath(potentialPath));
    }
  }
}

/**
 * Check if a string looks like a valid file or folder path.
 */
function isValidFilePath(str: string): boolean {
  if (!str || str.length === 0 || str.length > 200) {
    return false;
  }

  // Must not contain URL schemes
  if (str.includes('://')) {
    return false;
  }

  // Check for file extension
  const hasExtension = FILE_EXTENSIONS.some(ext => {
    const pattern = new RegExp(`\\.${ext}$`, 'i');
    return pattern.test(str);
  });

  // Check for known config files
  const isKnownFile = KNOWN_CONFIG_FILES.some(file =>
    str === file || str.endsWith('/' + file) || str.endsWith('\\' + file)
  );

  // Check if it's a folder path (ends with /)
  const isFolder = str.endsWith('/');

  // Check if it looks like a path (contains / and segments look like file/folder names)
  const looksLikePath = str.includes('/') &&
    !str.includes(' ') &&
    /^[a-zA-Z0-9_./-]+$/.test(str.replace(/^\.\//, ''));

  return hasExtension || isKnownFile || isFolder || (looksLikePath && containsFileExtension(str));
}

/**
 * Check if string contains any known file extension.
 */
function containsFileExtension(str: string): boolean {
  return FILE_EXTENSIONS.some(ext => {
    const pattern = new RegExp(`\\.${ext}(?:/|$)`, 'i');
    return pattern.test(str);
  });
}

/**
 * Check if a string looks like a command (not a file path).
 */
function isCommand(str: string): boolean {
  // Common command patterns
  const commandPatterns = [
    /^npm\s/,
    /^npx\s/,
    /^yarn\s/,
    /^pnpm\s/,
    /^git\s/,
    /^cd\s/,
    /^mkdir\s/,
    /^rm\s/,
    /^cp\s/,
    /^mv\s/,
    /^ls\s/,
    /^cat\s/,
    /^echo\s/,
    /^curl\s/,
    /^wget\s/,
    /^docker\s/,
    /^kubectl\s/,
    /^[A-Z_]+=/, // Environment variable assignment
  ];

  return commandPatterns.some(pattern => pattern.test(str));
}

/**
 * Check if a string is a URL.
 */
function isUrl(str: string): boolean {
  return str.includes('://') || str.startsWith('mailto:');
}

/**
 * Normalize a file path.
 * - Removes leading ./
 */
function normalizePath(path: string): string {
  return path.replace(/^\.\//, '');
}

/**
 * Remove fenced code blocks from content.
 */
function removeCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, '');
}

/**
 * Remove inline code from content.
 */
function removeInlineCode(content: string): string {
  return content.replace(/`[^`]+`/g, '');
}
