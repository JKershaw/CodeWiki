/**
 * Response parsing utilities for agents.
 *
 * This module provides robust parsing functions that:
 * - Log failures with context (no silent defaults)
 * - Distinguish required vs optional sections
 * - Return structured results with error information
 * - Support gradual migration from inline regex
 *
 * Usage:
 * ```typescript
 * const ctx = createParseContext('writer', response);
 * const title = parseSection(ctx, 'TITLE', /TITLE:\s*(.+?)(?=\n|CONTENT:|$)/i, { required: false });
 * const content = parseSection(ctx, 'CONTENT', /CONTENT:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i, { required: true });
 * const confidence = parseConfidence(ctx);
 *
 * if (ctx.hasRequiredFailures()) {
 *   return { error: ctx.getFailureSummary() };
 * }
 * ```
 */

/**
 * Result of parsing a section from an LLM response.
 */
export interface ParseResult<T> {
  success: boolean;
  value: T | null;
  /** Error message if parsing failed */
  error?: string;
  /** Whether this was a required field */
  required: boolean;
}

/**
 * Context for tracking parsing operations on a single response.
 */
export interface ParseContext {
  /** Agent type for logging */
  agentType: string;
  /** The full response being parsed */
  response: string;
  /** All parse failures encountered */
  failures: ParseFailure[];
  /** Track which sections were successfully parsed */
  successfulSections: string[];
}

/**
 * Details about a parsing failure.
 */
export interface ParseFailure {
  section: string;
  required: boolean;
  pattern: string;
  responsePreview: string;
  timestamp: Date;
}

/**
 * Options for parsing a section.
 */
export interface ParseOptions {
  /** Whether this section is required (default: false) */
  required?: boolean;
  /** Default value to use if parsing fails (only for optional sections) */
  defaultValue?: string;
  /** Custom error message */
  errorMessage?: string;
}

/**
 * Create a new parsing context for a response.
 */
export function createParseContext(agentType: string, response: string): ParseContext {
  return {
    agentType,
    response,
    failures: [],
    successfulSections: [],
  };
}

/**
 * Parse a section from the response using a regex pattern.
 *
 * Logs failures with context and tracks them in the ParseContext.
 * Required sections that fail to parse are logged as errors.
 * Optional sections that fail are logged as warnings.
 *
 * @param ctx - The parsing context
 * @param sectionName - Human-readable name of the section
 * @param pattern - Regex pattern with a capture group
 * @param options - Parsing options
 * @returns The parsed value or null if parsing failed
 */
export function parseSection(
  ctx: ParseContext,
  sectionName: string,
  pattern: RegExp,
  options: ParseOptions = {}
): string | null {
  const { required = false, defaultValue, errorMessage } = options;

  const match = ctx.response.match(pattern);

  if (match && match[1]) {
    const value = match[1].trim();
    ctx.successfulSections.push(sectionName);
    return value;
  }

  // Parsing failed - log and record the failure
  const failure: ParseFailure = {
    section: sectionName,
    required,
    pattern: pattern.source.slice(0, 50) + (pattern.source.length > 50 ? '...' : ''),
    responsePreview: getResponsePreview(ctx.response, sectionName),
    timestamp: new Date(),
  };

  ctx.failures.push(failure);

  // Log the failure
  const message = errorMessage ?? `Failed to parse ${sectionName}`;
  const logLevel = required ? 'error' : 'warn';
  const logMethod = logLevel === 'error' ? console.error : console.warn;

  logMethod(
    `[${ctx.agentType}] ${message}`,
    {
      section: sectionName,
      required,
      pattern: failure.pattern,
      responsePreview: failure.responsePreview,
    }
  );

  // Return default value for optional sections, null for required
  if (!required && defaultValue !== undefined) {
    return defaultValue;
  }

  return null;
}

/**
 * Options for flexible section parsing.
 */
export interface FlexibleParseOptions extends ParseOptions {
  /**
   * Section terminators to use for markdown fallback.
   * These are section names that signal the end of the current section.
   * Default: common terminators like CONFIDENCE, FINDINGS, etc.
   */
  terminators?: string[];
  /**
   * Minimum length to consider a match valid.
   * If the matched content is shorter than this, try fallback patterns.
   * Default: 10
   */
  minLength?: number;
}

/**
 * Parse a section with automatic fallback to markdown heading formats.
 *
 * Tries patterns in this order:
 * 1. Original pattern (e.g., SUMMARY: content)
 * 2. Markdown ## heading (e.g., ## SUMMARY\ncontent)
 * 3. Markdown ### heading (e.g., ### SUMMARY\ncontent)
 *
 * This handles common LLM output variations while keeping prompts simple.
 *
 * @param ctx - The parsing context
 * @param sectionName - Human-readable name of the section (e.g., 'SUMMARY', 'FINDINGS')
 * @param primaryPattern - Primary regex pattern with a capture group
 * @param options - Parsing options including terminators for markdown fallback
 * @returns The parsed value or null if all patterns failed
 */
export function parseSectionFlexible(
  ctx: ParseContext,
  sectionName: string,
  primaryPattern: RegExp,
  options: FlexibleParseOptions = {}
): string | null {
  const {
    required = false,
    defaultValue,
    minLength = 10,
    terminators = ['CONFIDENCE', 'FINDINGS', 'SUMMARY', 'WIKI_PAGES', 'WIKI_UPDATES', 'TODO_ITEMS', 'REMEDIATION', 'HOTSPOTS']
  } = options;

  // Try primary pattern first
  const primaryMatch = ctx.response.match(primaryPattern);
  if (primaryMatch && primaryMatch[1]) {
    const value = primaryMatch[1].trim();
    if (value.length >= minLength) {
      ctx.successfulSections.push(sectionName);
      return value;
    }
  }

  // Build terminator pattern for markdown fallback
  // Match next ## or ### heading, or SECTION: format, or end of string
  const terminatorPattern = terminators
    .map(t => `##\\s*${t}|${t}:`)
    .join('|');

  // Try ## SECTION_NAME format (but not ### - must be exactly two #)
  const h2Pattern = new RegExp(
    `(?:^|\\n)##(?!#)\\s*${sectionName}\\s*\\n([\\s\\S]*?)(?=${terminatorPattern}|$)`,
    'i'
  );
  const h2Match = ctx.response.match(h2Pattern);
  if (h2Match && h2Match[1]) {
    const value = h2Match[1].trim();
    if (value.length >= minLength) {
      ctx.successfulSections.push(sectionName);
      return value;
    }
  }

  // Try ### SECTION_NAME format
  // For h3, we stop at any heading (## or ###) or at colon-format sections
  const h3Pattern = new RegExp(
    `###\\s*${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n##|${terminatorPattern}|$)`,
    'i'
  );
  const h3Match = ctx.response.match(h3Pattern);
  if (h3Match && h3Match[1]) {
    const value = h3Match[1].trim();
    if (value.length >= minLength) {
      ctx.successfulSections.push(sectionName);
      return value;
    }
  }

  // All patterns failed - log and record the failure
  const failure: ParseFailure = {
    section: sectionName,
    required,
    pattern: primaryPattern.source.slice(0, 50) + (primaryPattern.source.length > 50 ? '...' : ''),
    responsePreview: getResponsePreview(ctx.response, sectionName),
    timestamp: new Date(),
  };

  ctx.failures.push(failure);

  const logMethod = required ? console.error : console.warn;
  logMethod(
    `[${ctx.agentType}] Failed to parse ${sectionName} (tried colon and markdown formats)`,
    {
      section: sectionName,
      required,
      pattern: failure.pattern,
      responsePreview: failure.responsePreview,
    }
  );

  if (!required && defaultValue !== undefined) {
    return defaultValue;
  }

  return null;
}

/**
 * Parse multiple items from a section using a line-based pattern.
 *
 * Used for sections like:
 * ```
 * FINDINGS:
 * - [Type] [IMPORTANCE:high] Description [path]
 * - [Type] [IMPORTANCE:low] Description [path]
 * ```
 *
 * @param ctx - The parsing context
 * @param sectionName - Human-readable name of the section
 * @param sectionPattern - Regex to extract the entire section
 * @param itemPattern - Regex to match each line item (with capture groups)
 * @param mapper - Function to convert regex match to desired type
 * @param options - Parsing options
 */
export function parseSectionItems<T>(
  ctx: ParseContext,
  sectionName: string,
  sectionPattern: RegExp,
  itemPattern: RegExp,
  mapper: (match: RegExpMatchArray) => T | null,
  options: ParseOptions = {}
): T[] {
  // Build options object without defaultValue
  const parseOptions: ParseOptions = {};
  if (options.required !== undefined) parseOptions.required = options.required;
  if (options.errorMessage !== undefined) parseOptions.errorMessage = options.errorMessage;

  const sectionContent = parseSection(ctx, sectionName, sectionPattern, parseOptions);

  if (!sectionContent) {
    return [];
  }

  const items: T[] = [];
  const lines = sectionContent.split('\n').filter(l => l.trim().startsWith('-'));

  for (const line of lines) {
    const match = line.match(itemPattern);
    if (match) {
      const item = mapper(match);
      if (item !== null) {
        items.push(item);
      }
    }
  }

  // Log if we found the section but couldn't parse any items
  if (lines.length > 0 && items.length === 0) {
    console.warn(
      `[${ctx.agentType}] Found ${sectionName} section with ${lines.length} lines but parsed 0 items`,
      { sectionPreview: sectionContent.slice(0, 200) }
    );
  }

  return items;
}

/**
 * Parse the CONFIDENCE section, common to most agents.
 *
 * @param ctx - The parsing context
 * @param options - Parsing options (default: optional with 0.7 default)
 * @returns The confidence value (0-1)
 */
export function parseConfidence(
  ctx: ParseContext,
  options: { required?: boolean; defaultValue?: number } = {}
): number {
  const { required = false, defaultValue = 0.7 } = options;

  const match = ctx.response.match(/CONFIDENCE:\s*([\d.]+)/i);

  if (match && match[1]) {
    const value = parseFloat(match[1]);
    if (!isNaN(value) && value >= 0 && value <= 1) {
      ctx.successfulSections.push('CONFIDENCE');
      return value;
    }
  }

  // Log failure
  const failure: ParseFailure = {
    section: 'CONFIDENCE',
    required,
    pattern: 'CONFIDENCE:\\s*([\\d.]+)',
    responsePreview: getResponsePreview(ctx.response, 'CONFIDENCE'),
    timestamp: new Date(),
  };

  ctx.failures.push(failure);

  if (required) {
    console.error(`[${ctx.agentType}] Failed to parse required CONFIDENCE section`, {
      responsePreview: failure.responsePreview,
    });
  } else {
    console.warn(`[${ctx.agentType}] Using default confidence ${defaultValue}`, {
      responsePreview: failure.responsePreview,
    });
  }

  return defaultValue;
}

/**
 * Check if any required sections failed to parse.
 */
export function hasRequiredFailures(ctx: ParseContext): boolean {
  return ctx.failures.some(f => f.required);
}

/**
 * Get a summary of all parsing failures.
 */
export function getFailureSummary(ctx: ParseContext): string {
  if (ctx.failures.length === 0) {
    return 'No parsing failures';
  }

  const requiredFailures = ctx.failures.filter(f => f.required);
  const optionalFailures = ctx.failures.filter(f => !f.required);

  const parts: string[] = [];

  if (requiredFailures.length > 0) {
    parts.push(`Required sections missing: ${requiredFailures.map(f => f.section).join(', ')}`);
  }

  if (optionalFailures.length > 0) {
    parts.push(`Optional sections missing: ${optionalFailures.map(f => f.section).join(', ')}`);
  }

  return parts.join('; ');
}

/**
 * Get parsing statistics for monitoring.
 */
export function getParseStats(ctx: ParseContext): ParseStats {
  return {
    agentType: ctx.agentType,
    successfulSections: ctx.successfulSections.length,
    failedSections: ctx.failures.length,
    requiredFailures: ctx.failures.filter(f => f.required).length,
    optionalFailures: ctx.failures.filter(f => !f.required).length,
    sections: {
      successful: ctx.successfulSections,
      failed: ctx.failures.map(f => f.section),
    },
  };
}

export interface ParseStats {
  agentType: string;
  successfulSections: number;
  failedSections: number;
  requiredFailures: number;
  optionalFailures: number;
  sections: {
    successful: string[];
    failed: string[];
  };
}

/**
 * Extract a preview of the response around where a section should be.
 */
function getResponsePreview(response: string, sectionName: string): string {
  // Try to find the section header
  const sectionIndex = response.toUpperCase().indexOf(sectionName.toUpperCase());

  if (sectionIndex !== -1) {
    // Return content around the section header
    const start = Math.max(0, sectionIndex - 20);
    const end = Math.min(response.length, sectionIndex + 100);
    return response.slice(start, end).replace(/\n/g, '\\n');
  }

  // Section not found - return first 150 chars
  return response.slice(0, 150).replace(/\n/g, '\\n') + '...';
}

/**
 * Validate that a parsed value meets minimum length requirements.
 */
export function validateMinLength(
  ctx: ParseContext,
  sectionName: string,
  value: string | null,
  minLength: number
): boolean {
  if (!value || value.length < minLength) {
    console.warn(
      `[${ctx.agentType}] ${sectionName} is too short (${value?.length ?? 0} chars, need ${minLength})`,
      { preview: value?.slice(0, 50) }
    );
    return false;
  }
  return true;
}

/**
 * Options for parsing a choice/enum field.
 */
export interface ChoiceParseOptions<T> {
  /** Whether this section is required (default: false) */
  required?: boolean;
  /** Default value to use if parsing fails */
  defaultValue?: T;
  /** Custom error message */
  errorMessage?: string;
}

/**
 * Parse a choice/enum field from the response.
 *
 * Used for fields like:
 * ```
 * DECISION: merge
 * SECURITY_RELEVANCE: high
 * DEBT_TREND: adding_debt
 * ```
 *
 * @param ctx - The parsing context
 * @param sectionName - Human-readable name of the section
 * @param pattern - Regex pattern with a capture group for the value
 * @param validValues - Array of valid values (case-insensitive matching)
 * @param options - Parsing options
 * @returns The matched value or default/null
 */
export function parseChoice<T extends string>(
  ctx: ParseContext,
  sectionName: string,
  pattern: RegExp,
  validValues: readonly T[],
  options: ChoiceParseOptions<T> = {}
): T | null {
  const { required = false, defaultValue, errorMessage } = options;

  const match = ctx.response.match(pattern);

  if (match && match[1]) {
    const rawValue = match[1].trim().toLowerCase();
    // Normalize underscores and hyphens for comparison
    const normalizedValue = rawValue.replace(/-/g, '_');

    // Find matching valid value (case-insensitive, underscore/hyphen agnostic)
    const foundValue = validValues.find(v => {
      const normalizedValid = v.toLowerCase().replace(/-/g, '_');
      return normalizedValid === normalizedValue;
    });

    if (foundValue) {
      ctx.successfulSections.push(sectionName);
      return foundValue;
    }
  }

  // Parsing failed - log and record the failure
  const failure: ParseFailure = {
    section: sectionName,
    required,
    pattern: pattern.source.slice(0, 50) + (pattern.source.length > 50 ? '...' : ''),
    responsePreview: getResponsePreview(ctx.response, sectionName),
    timestamp: new Date(),
  };

  ctx.failures.push(failure);

  const message = errorMessage ?? `Failed to parse ${sectionName} (valid: ${validValues.join(', ')})`;
  const logMethod = required ? console.error : console.warn;

  logMethod(
    `[${ctx.agentType}] ${message}`,
    {
      section: sectionName,
      required,
      validValues,
      responsePreview: failure.responsePreview,
    }
  );

  return defaultValue ?? null;
}

/**
 * Item pattern definition for fallback parsing.
 */
export interface ItemPattern<T> {
  /** Regex pattern to match the line item */
  pattern: RegExp;
  /** Function to convert the match to the desired type */
  mapper: (match: RegExpMatchArray) => T | null;
}

/**
 * Parse list items with multiple fallback patterns.
 *
 * Tries each pattern in order until one matches. This handles LLM output
 * variations where the same semantic content may be formatted differently.
 *
 * @param ctx - The parsing context
 * @param sectionName - Human-readable name of the section
 * @param sectionPattern - Regex to extract the entire section
 * @param itemPatterns - Array of pattern/mapper pairs to try in order
 * @param options - Parsing options
 */
export function parseListItemsWithFallback<T>(
  ctx: ParseContext,
  sectionName: string,
  sectionPattern: RegExp,
  itemPatterns: ItemPattern<T>[],
  options: ParseOptions = {}
): T[] {
  const parseOptions: ParseOptions = {};
  if (options.required !== undefined) parseOptions.required = options.required;
  if (options.errorMessage !== undefined) parseOptions.errorMessage = options.errorMessage;

  const sectionContent = parseSection(ctx, sectionName, sectionPattern, parseOptions);

  if (!sectionContent) {
    return [];
  }

  const items: T[] = [];
  const lines = sectionContent.split('\n').filter(l => l.trim().startsWith('-'));
  let unmatchedLines = 0;

  for (const line of lines) {
    let matched = false;

    // Try each pattern in order
    for (const { pattern, mapper } of itemPatterns) {
      const match = line.match(pattern);
      if (match) {
        const item = mapper(match);
        if (item !== null) {
          items.push(item);
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      unmatchedLines++;
    }
  }

  // Log if many lines didn't match any pattern
  if (unmatchedLines > 0 && unmatchedLines > lines.length / 2) {
    console.warn(
      `[${ctx.agentType}] ${sectionName}: ${unmatchedLines}/${lines.length} lines didn't match any pattern`,
      { sectionPreview: sectionContent.slice(0, 200) }
    );
  }

  return items;
}

/**
 * Parse a simple string list from a section.
 *
 * Used for sections like:
 * ```
 * RECOMMENDATIONS:
 * - First recommendation
 * - Second recommendation
 * ```
 *
 * @param ctx - The parsing context
 * @param sectionName - Human-readable name of the section
 * @param sectionPattern - Regex to extract the entire section
 * @param options - Parsing options
 */
export function parseStringList(
  ctx: ParseContext,
  sectionName: string,
  sectionPattern: RegExp,
  options: ParseOptions = {}
): string[] {
  const parseOptions: ParseOptions = {};
  if (options.required !== undefined) parseOptions.required = options.required;
  if (options.errorMessage !== undefined) parseOptions.errorMessage = options.errorMessage;

  const sectionContent = parseSection(ctx, sectionName, sectionPattern, parseOptions);

  if (!sectionContent) {
    return [];
  }

  return sectionContent
    .split('\n')
    .filter(l => l.trim().startsWith('-'))
    .map(l => l.replace(/^-\s*/, '').trim())
    .filter(l => l.length > 0);
}

/**
 * Parse blocks with delimiters from the response.
 *
 * Used for sections like:
 * ```
 * WIKI_UPDATES:
 * === [path/to/page] [create] ===
 * Content here...
 * === END ===
 * ```
 *
 * @param ctx - The parsing context
 * @param sectionName - Human-readable name of the section
 * @param sectionPattern - Regex to extract the entire section containing blocks
 * @param blockPattern - Regex with global flag to match each block (must have capture groups)
 * @param mapper - Function to convert block match to desired type
 * @param options - Parsing options
 */
export function parseBlocks<T>(
  ctx: ParseContext,
  sectionName: string,
  sectionPattern: RegExp,
  blockPattern: RegExp,
  mapper: (match: RegExpMatchArray) => T | null,
  options: ParseOptions = {}
): T[] {
  const parseOptions: ParseOptions = {};
  if (options.required !== undefined) parseOptions.required = options.required;
  if (options.errorMessage !== undefined) parseOptions.errorMessage = options.errorMessage;

  const sectionContent = parseSection(ctx, sectionName, sectionPattern, parseOptions);

  if (!sectionContent) {
    return [];
  }

  const items: T[] = [];

  // Ensure the pattern has the global flag
  const globalPattern = blockPattern.global
    ? blockPattern
    : new RegExp(blockPattern.source, blockPattern.flags + 'g');

  let match;
  while ((match = globalPattern.exec(sectionContent)) !== null) {
    const item = mapper(match);
    if (item !== null) {
      items.push(item);
    }
  }

  return items;
}

/**
 * Standard severity levels used across agents.
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Standard importance levels used across agents.
 */
export type Importance = 'high' | 'medium' | 'low';

/**
 * Map a severity string to a standard importance level.
 *
 * Default mapping:
 * - critical, high -> 'high'
 * - medium, normal -> 'medium'
 * - low, minor, info -> 'low'
 *
 * @param value - The severity string to map
 * @param customMapping - Optional custom mapping to override defaults
 */
export function mapSeverity(
  value: string,
  customMapping?: Partial<Record<string, Importance>>
): Importance {
  const normalized = value.toLowerCase().trim();

  // Apply custom mapping first
  if (customMapping && normalized in customMapping) {
    return customMapping[normalized]!;
  }

  // Default mapping
  if (normalized === 'critical' || normalized === 'high' || normalized === 'urgent') {
    return 'high';
  }
  if (normalized === 'medium' || normalized === 'normal' || normalized === 'moderate') {
    return 'medium';
  }
  // low, minor, info, or anything else
  return 'low';
}

/**
 * Map a priority string to a standard level.
 *
 * @param value - The priority string to map
 */
export function mapPriority(value: string): 'high' | 'medium' | 'low' {
  const normalized = value.toLowerCase().trim();

  if (normalized === 'critical' || normalized === 'high' || normalized === 'urgent' || normalized === 'p0' || normalized === 'p1') {
    return 'high';
  }
  if (normalized === 'medium' || normalized === 'normal' || normalized === 'p2') {
    return 'medium';
  }
  return 'low';
}
