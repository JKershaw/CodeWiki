/**
 * Content validation utilities for detecting template placeholders and invalid content.
 *
 * Used to validate LLM responses before saving to wiki pages.
 */

/**
 * Result of content validation.
 */
export interface ContentValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Default minimum content length (characters) for wiki pages.
 * Pages shorter than this are likely incomplete or placeholder content.
 */
const DEFAULT_MIN_CONTENT_LENGTH = 100;

/**
 * Check if content contains template placeholders.
 *
 * Looks for patterns like [Descriptive title], [2-3 paragraph article], etc.
 * that indicate the LLM output template text instead of actual content.
 *
 * @param content - The content to check
 * @returns true if template placeholders are detected
 */
export function hasTemplatePlaceholders(content: string): boolean {
  // Extract all square bracket content
  const allBrackets = content.match(/\[[^\]]+\]/g) || [];

  for (const bracket of allBrackets) {
    const bracketContent = bracket.slice(1, -1); // Remove [ and ]

    // Skip markdown links (followed by parentheses)
    const bracketPos = content.indexOf(bracket);
    const afterBracket = content.slice(bracketPos + bracket.length, bracketPos + bracket.length + 1);
    if (afterBracket === '(') {
      continue;
    }

    // Skip reference-style link numbers like [1]
    if (/^[0-9]+$/.test(bracketContent)) {
      continue;
    }

    // Skip code arrays (contains commas, typically numeric or short)
    if (bracketContent.includes(',') && bracketContent.length < 50) {
      continue;
    }

    // Skip empty arrays []
    if (bracketContent === '') {
      continue;
    }

    // Check for template/placeholder patterns
    const lowerContent = bracketContent.toLowerCase();

    // Pattern 1: Contains placeholder keywords
    if (/\b(title|description|article|content|paragraph|section|placeholder|example|text)\b/.test(lowerContent)) {
      return true;
    }

    // Pattern 2: Contains instruction keywords
    if (/\b(add|insert|write|your|here)\b/.test(lowerContent)) {
      return true;
    }

    // Pattern 3: Starts with number and contains paragraph/sentence/word
    if (/^[0-9]+-?[0-9]* (?:paragraph|sentence|word)/.test(lowerContent)) {
      return true;
    }

    // Pattern 4: Looks like descriptive placeholder (Capitalized Phrase without punctuation)
    // e.g., [Descriptive title], [Some placeholder text]
    if (/^[A-Z][a-z]+ [a-z]+( [a-z]+)*$/.test(bracketContent) && bracketContent.length > 5) {
      return true;
    }
  }

  return false;
}

/**
 * Check if content contains instruction text that should be replaced.
 *
 * Looks for patterns like "Write a description...", "Describe the feature...",
 * that indicate the LLM output instructions instead of actual content.
 *
 * @param content - The content to check
 * @returns true if instruction text is detected
 */
export function hasInstructionText(content: string): boolean {
  // Split into lines and check each
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip headings and code blocks
    if (trimmedLine.startsWith('#') || trimmedLine.startsWith('```')) {
      continue;
    }

    // Check for standalone ellipsis or trailing ellipsis (placeholder indicator)
    // Standalone: just "..." on its own line
    // Trailing: "Content goes here: ..." at end of line
    if (/^\.\.\.+$/.test(trimmedLine) || /:\s*\.\.\.+\s*$/.test(trimmedLine)) {
      return true;
    }

    // Check for instruction patterns at sentence start
    // These patterns indicate the LLM is telling someone what to write vs actual content
    const sentenceStartPatterns = [
      /^Write a\b/i,
      /^Describe the\b/i,
      /^Add your\b/i,
      /^Insert the\b/i,
      /^Fill in\b/i,
      /^Replace with\b/i,
      /^Put your\b/i,
      /^Enter the\b/i,
    ];

    for (const pattern of sentenceStartPatterns) {
      if (pattern.test(trimmedLine)) {
        return true;
      }
    }

    // Check for sentences starting with instruction verbs after punctuation
    // e.g., "Title. Write a description here."
    const afterPunctuationPattern = /[.!?]\s+(Write a|Describe the|Add your|Insert the|Fill in|Replace with)\b/i;
    if (afterPunctuationPattern.test(trimmedLine)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if content is too short to be valid wiki content.
 *
 * @param content - The content to check
 * @param minLength - Minimum acceptable length (default: 100 characters)
 * @returns true if content is too short
 */
export function isContentTooShort(content: string, minLength: number = DEFAULT_MIN_CONTENT_LENGTH): boolean {
  return content.trim().length < minLength;
}

/**
 * Validate content for wiki page quality.
 *
 * Checks for:
 * - Template placeholders
 * - Instruction text
 * - Content length
 *
 * @param content - The content to validate
 * @param options - Validation options
 * @returns Validation result with isValid flag and error messages
 */
export function validateContent(
  content: string,
  options: { minLength?: number } = {}
): ContentValidationResult {
  const errors: string[] = [];
  const minLength = options.minLength ?? DEFAULT_MIN_CONTENT_LENGTH;

  if (isContentTooShort(content, minLength)) {
    errors.push(`Content is too short (${content.trim().length} characters, minimum ${minLength})`);
  }

  if (hasTemplatePlaceholders(content)) {
    errors.push('Content contains template placeholder text that should be replaced');
  }

  if (hasInstructionText(content)) {
    errors.push('Content contains instruction text that should be replaced with actual content');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
