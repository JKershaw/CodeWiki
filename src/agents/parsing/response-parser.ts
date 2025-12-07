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
