/**
 * Response parsing utilities for agents.
 *
 * This module provides robust parsing with logging for LLM responses.
 * Use these utilities instead of inline regex to get:
 * - Automatic failure logging
 * - Required vs optional section handling
 * - Parse statistics for monitoring
 * - Multi-format fallback parsing for LLM output variations
 */

export {
  // Core types
  type ParseContext,
  type ParseResult,
  type ParseFailure,
  type ParseOptions,
  type ParseStats,
  type ChoiceParseOptions,
  type ItemPattern,
  type Severity,
  type Importance,
  type FlexibleParseOptions,

  // Core functions
  createParseContext,
  parseSection,
  parseSectionFlexible,
  parseSectionItems,
  parseConfidence,

  // Extended parsing functions
  parseChoice,
  parseListItemsWithFallback,
  parseStringList,
  parseBlocks,

  // Mapping utilities
  mapSeverity,
  mapPriority,

  // Validation and inspection
  hasRequiredFailures,
  getFailureSummary,
  getParseStats,
  validateMinLength,
} from './response-parser.js';
