/**
 * Unit tests for content validation utilities.
 * Validates that LLM responses don't contain template placeholders or invalid content.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  validateContent,
  hasTemplatePlaceholders,
  hasInstructionText,
  isContentTooShort,
  type ContentValidationResult,
} from '../../src/utils/content-validation.js';

describe('Content Validation', () => {
  describe('hasTemplatePlaceholders', () => {
    it('detects square bracket placeholders', () => {
      assert.strictEqual(hasTemplatePlaceholders('[Descriptive title]'), true);
      assert.strictEqual(hasTemplatePlaceholders('[2-3 paragraph article]'), true);
      assert.strictEqual(hasTemplatePlaceholders('Some text with [placeholder] in it'), true);
    });

    it('allows legitimate square brackets', () => {
      // Array syntax in code
      assert.strictEqual(hasTemplatePlaceholders('const arr = [1, 2, 3]'), false);
      // Markdown links
      assert.strictEqual(hasTemplatePlaceholders('[link text](url)'), false);
      // Reference-style links
      assert.strictEqual(hasTemplatePlaceholders('[1]: http://example.com'), false);
    });

    it('detects instruction-like text', () => {
      assert.strictEqual(hasTemplatePlaceholders('[Write a description here]'), true);
      assert.strictEqual(hasTemplatePlaceholders('[Add your content]'), true);
      assert.strictEqual(hasTemplatePlaceholders('[Insert title]'), true);
    });

    it('returns false for normal content', () => {
      assert.strictEqual(hasTemplatePlaceholders('# Getting Started\n\nThis is a guide.'), false);
      assert.strictEqual(hasTemplatePlaceholders('The function returns an array.'), false);
    });
  });

  describe('hasInstructionText', () => {
    it('detects instruction patterns at sentence start', () => {
      assert.strictEqual(hasInstructionText('Write a description of the feature.'), true);
      assert.strictEqual(hasInstructionText('Describe the architecture below.'), true);
      assert.strictEqual(hasInstructionText('Add your content here.'), true);
    });

    it('detects ellipsis placeholders', () => {
      assert.strictEqual(hasInstructionText('# Title\n\n...'), true);
      assert.strictEqual(hasInstructionText('Content goes here: ...'), true);
    });

    it('allows normal content with similar words', () => {
      // "describe" in middle of sentence is okay
      assert.strictEqual(hasInstructionText('This document will describe the API endpoints.'), false);
      // "write" as part of normal prose
      assert.strictEqual(hasInstructionText('Users can write data to the database.'), false);
      // "add" in normal context
      assert.strictEqual(hasInstructionText('The function will add two numbers together.'), false);
    });

    it('returns false for normal documentation', () => {
      const content = '# Architecture Overview\n\nThis document describes the system.';
      assert.strictEqual(hasInstructionText(content), false);
    });
  });

  describe('isContentTooShort', () => {
    it('returns true for very short content', () => {
      assert.strictEqual(isContentTooShort('# Title'), true);
      assert.strictEqual(isContentTooShort('Too short'), true);
      assert.strictEqual(isContentTooShort(''), true);
    });

    it('returns false for adequate content', () => {
      const goodContent = '# Getting Started\n\nThis is a comprehensive guide to help you get started with the project. It covers installation, setup, and basic usage.\n\n## Installation\n\nRun the following command to install dependencies.';
      assert.strictEqual(isContentTooShort(goodContent), false);
    });

    it('uses configurable minimum length', () => {
      assert.strictEqual(isContentTooShort('Short text', 5), false);
      assert.strictEqual(isContentTooShort('Short text', 100), true);
    });
  });

  describe('validateContent', () => {
    it('returns valid for good content', () => {
      const content = '# Architecture Overview\n\nThis document describes the system architecture. The application follows a clean architecture pattern with clear separation of concerns.\n\n## Components\n\nThe system consists of several key components.';
      const result = validateContent(content);

      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('returns invalid for content with template placeholders', () => {
      const content = '# [Descriptive title]\n\n[2-3 paragraph article describing the feature]';
      const result = validateContent(content);

      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.includes('template placeholder')));
    });

    it('returns invalid for content with instruction text', () => {
      const content = '# Feature Overview\n\nWrite a description of the feature here. Describe how it works and what it does for the user. This section should be comprehensive.';
      const result = validateContent(content);

      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.includes('instruction')));
    });

    it('returns invalid for too short content', () => {
      const content = '# Title\n\nShort.';
      const result = validateContent(content);

      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.includes('too short')));
    });

    it('returns multiple errors for content with multiple issues', () => {
      const content = '[Title]';
      const result = validateContent(content);

      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.length >= 1);
    });

    it('handles empty content', () => {
      const result = validateContent('');

      assert.strictEqual(result.isValid, false);
      assert.ok(result.errors.some(e => e.includes('too short')));
    });
  });
});
