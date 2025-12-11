/**
 * Unit tests for graduated coverage scoring.
 *
 * Instead of binary 0/100% coverage, we use tiered scoring:
 * - 0%   - No mention at all
 * - 25%  - Mentioned in passing (filename appears somewhere)
 * - 50%  - Has dedicated section (file mentioned with surrounding explanation)
 * - 100% - Has dedicated wiki page about the file
 *
 * TDD: Define behavior through tests before implementation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateGraduatedCoverage,
  type WikiPageLike,
} from '../../src/agents/orchestrator/file-coverage-tree.js';

/**
 * Helper to create mock wiki pages.
 */
function createWikiPage(path: string, content: string): WikiPageLike {
  return { path, content };
}

describe('calculateGraduatedCoverage', () => {
  describe('0% - No mention', () => {
    it('returns 0 when file is not mentioned anywhere', () => {
      const wikiPages = [
        createWikiPage('docs/intro', 'Welcome to our project'),
        createWikiPage('docs/setup', 'How to get started'),
      ];

      const coverage = calculateGraduatedCoverage('src/secret.ts', wikiPages);
      assert.strictEqual(coverage, 0);
    });

    it('returns 0 for empty wiki', () => {
      const coverage = calculateGraduatedCoverage('src/app.ts', []);
      assert.strictEqual(coverage, 0);
    });

    it('returns 0 when similar but different filename exists', () => {
      const wikiPages = [
        createWikiPage('docs/auth', 'The auth-helper.ts handles authentication'),
      ];

      // Looking for auth.ts, but only auth-helper.ts is mentioned
      const coverage = calculateGraduatedCoverage('src/auth.ts', wikiPages);
      assert.strictEqual(coverage, 0);
    });
  });

  describe('25% - Mentioned in passing', () => {
    it('returns 25 when filename is mentioned briefly', () => {
      const wikiPages = [
        createWikiPage('docs/overview', 'Files include app.ts and utils.ts'),
      ];

      const coverage = calculateGraduatedCoverage('src/app.ts', wikiPages);
      assert.strictEqual(coverage, 25);
    });

    it('returns 25 when full path is mentioned briefly', () => {
      const wikiPages = [
        createWikiPage('docs/structure', 'See src/services/llm.ts for details'),
      ];

      const coverage = calculateGraduatedCoverage('src/services/llm.ts', wikiPages);
      assert.strictEqual(coverage, 25);
    });

    it('returns 25 when mentioned in a list without explanation', () => {
      const wikiPages = [
        createWikiPage('docs/files', `
# Source Files
- app.ts
- config.ts
- utils.ts
`),
      ];

      const coverage = calculateGraduatedCoverage('src/app.ts', wikiPages);
      assert.strictEqual(coverage, 25);
    });

    it('returns 25 when mentioned in code block only', () => {
      const wikiPages = [
        createWikiPage('docs/example', `
\`\`\`typescript
import { foo } from './orchestrator.ts';
\`\`\`
`),
      ];

      const coverage = calculateGraduatedCoverage('src/orchestrator.ts', wikiPages);
      assert.strictEqual(coverage, 25);
    });
  });

  describe('50% - Has dedicated section', () => {
    it('returns 50 when file has a heading and paragraph about it', () => {
      const wikiPages = [
        createWikiPage('docs/architecture', `
# Architecture

## orchestrator.ts

The orchestrator is responsible for coordinating work between agents.
It manages the work queue and decides what tasks to prioritize.
`),
      ];

      const coverage = calculateGraduatedCoverage('src/orchestrator.ts', wikiPages);
      assert.strictEqual(coverage, 50);
    });

    it('returns 50 when file name appears in heading', () => {
      const wikiPages = [
        createWikiPage('docs/services', `
# Services

## LLM Service (llm-service.ts)

This service handles communication with the language model API.
`),
      ];

      const coverage = calculateGraduatedCoverage('src/llm-service.ts', wikiPages);
      assert.strictEqual(coverage, 50);
    });

    it('returns 50 when mentioned multiple times with context', () => {
      const wikiPages = [
        createWikiPage('docs/guide', `
The executor.ts file is central to task processing. The executor handles
claiming work items and running agents. When an agent completes, executor.ts
updates the work queue.
`),
      ];

      const coverage = calculateGraduatedCoverage('src/executor.ts', wikiPages);
      assert.strictEqual(coverage, 50);
    });
  });

  describe('100% - Has dedicated page', () => {
    it('returns 100 when page path matches file name', () => {
      const wikiPages = [
        createWikiPage('architecture/orchestrator', `
# Orchestrator

The orchestrator is the brain of the wiki generation system...
`),
      ];

      const coverage = calculateGraduatedCoverage('src/orchestrator.ts', wikiPages);
      assert.strictEqual(coverage, 100);
    });

    it('returns 100 when page path contains file name (without extension)', () => {
      const wikiPages = [
        createWikiPage('services/llm-service', `
# LLM Service

Handles all communication with language model APIs...
`),
      ];

      const coverage = calculateGraduatedCoverage('src/services/llm-service.ts', wikiPages);
      assert.strictEqual(coverage, 100);
    });

    it('returns 100 when page title matches file name', () => {
      const wikiPages = [
        createWikiPage('components/work-queue', `
# WorkQueue (work-queue.ts)

The work queue manages pending tasks...
`),
      ];

      const coverage = calculateGraduatedCoverage('src/work-queue.ts', wikiPages);
      assert.strictEqual(coverage, 100);
    });

    it('returns 100 for kebab-case page matching camelCase file', () => {
      const wikiPages = [
        createWikiPage('agents/base-agent', 'Documentation for BaseAgent'),
      ];

      const coverage = calculateGraduatedCoverage('src/agents/baseAgent.ts', wikiPages);
      assert.strictEqual(coverage, 100);
    });
  });

  describe('highest tier wins', () => {
    it('returns highest coverage when file appears in multiple contexts', () => {
      const wikiPages = [
        // 25% - mentioned in passing
        createWikiPage('docs/overview', 'See orchestrator.ts'),
        // 50% - has section
        createWikiPage('docs/architecture', '## orchestrator.ts\nIt coordinates work.'),
        // 100% - dedicated page
        createWikiPage('agents/orchestrator', 'Full documentation about orchestrator'),
      ];

      const coverage = calculateGraduatedCoverage('src/orchestrator.ts', wikiPages);
      assert.strictEqual(coverage, 100);
    });

    it('returns 50 when both 25 and 50 present but no dedicated page', () => {
      const wikiPages = [
        createWikiPage('docs/files', 'Files: app.ts, utils.ts'),
        createWikiPage('docs/guide', '## app.ts\nThe main application entry point.'),
      ];

      const coverage = calculateGraduatedCoverage('src/app.ts', wikiPages);
      assert.strictEqual(coverage, 50);
    });
  });

  describe('edge cases', () => {
    it('handles files with dots in name', () => {
      const wikiPages = [
        createWikiPage('config/env-config', 'Documentation for env.config.ts'),
      ];

      const coverage = calculateGraduatedCoverage('src/env.config.ts', wikiPages);
      assert.strictEqual(coverage, 100);
    });

    it('handles deeply nested files', () => {
      const wikiPages = [
        createWikiPage('docs/deep', 'The src/agents/orchestrator/strategies.ts file...'),
      ];

      const coverage = calculateGraduatedCoverage('src/agents/orchestrator/strategies.ts', wikiPages);
      assert.strictEqual(coverage, 25);
    });

    it('is case-insensitive for filename matching', () => {
      const wikiPages = [
        createWikiPage('docs/readme', 'See ORCHESTRATOR.ts for details'),
      ];

      const coverage = calculateGraduatedCoverage('src/orchestrator.ts', wikiPages);
      assert.strictEqual(coverage, 25);
    });

    it('handles index files correctly', () => {
      const wikiPages = [
        createWikiPage('modules/agents', 'The agents module (index.ts) exports all agents'),
      ];

      // index.ts is generic - should match by path context
      const coverage = calculateGraduatedCoverage('src/agents/index.ts', wikiPages);
      assert.strictEqual(coverage, 25);
    });
  });

  describe('integration with existing coverage', () => {
    it('graduated coverage affects priority scoring', () => {
      // Files with 25% coverage should have higher priority than 50%
      // which should have higher priority than 100%
      // This will be tested in priority scoring tests
    });
  });
});
