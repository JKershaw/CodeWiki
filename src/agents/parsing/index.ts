/**
 * Response parsing utilities for agents.
 *
 * This module provides robust parsing with logging for LLM responses.
 * Use these utilities instead of inline regex to get:
 * - Automatic failure logging
 * - Required vs optional section handling
 * - Parse statistics for monitoring
 */

export {
  // Core types
  type ParseContext,
  type ParseResult,
  type ParseFailure,
  type ParseOptions,
  type ParseStats,

  // Core functions
  createParseContext,
  parseSection,
  parseSectionItems,
  parseConfidence,

  // Validation and inspection
  hasRequiredFailures,
  getFailureSummary,
  getParseStats,
  validateMinLength,
} from './response-parser.js';
