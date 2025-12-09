/**
 * LLM tests for Orchestrator coverage tree interpretation.
 *
 * These tests verify that the formatted coverage tree helps the LLM
 * make good decisions about what areas to explore/document.
 *
 * TDD Phase 7: Verify LLM understands the coverage format.
 *
 * Run with: node --import tsx --test tests/llm/orchestrator-coverage-interpretation.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import {
  assertLLM,
  formatEvaluationResult,
  getLLMService,
} from './helpers/llm-assert.js';
import {
  startTestRun,
  logTestResult,
  saveTestRun,
} from './helpers/result-logger.js';

/**
 * Simulate what the LLM would see in the orchestrator prompt.
 * This is a simplified version - the real implementation will use ContextGatherer.
 */
function formatCoverageTreeForTest(tree: string): string {
  return `## Codebase Structure (Coverage)

The following shows the codebase structure with documentation coverage.
Directories and files marked with ⚠️ have low coverage and need documentation.

${tree}

## Your Task

Based on the coverage tree above, identify which directories or files
should be prioritized for documentation. Focus on:
1. Items marked with ⚠️ (low coverage)
2. Larger files (more LOC = more important)
3. Core functionality over utilities
`;
}

describe('Orchestrator Coverage Tree Interpretation', { timeout: 180000 }, () => {
  before(async () => {
    const apiKey = process.env['OPENROUTER_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required for LLM tests');
    }
    const model = getLLMService().getModel();
    console.log(`Using model: ${model}`);
    startTestRun(model);
  });

  after(async () => {
    await saveTestRun();
  });

  describe('identifies exploration targets', () => {
    it('prioritizes items marked with warning emoji', async () => {
      const coverageTree = `
src/ (45%) - 120 files, 15000 loc
├── agents/ (20%) - 35 files, 4500 loc ⚠️
│   ├── orchestrator.ts (0%) - 850 loc ⚠️
│   └── base-agent.ts (100%) - 200 loc
├── services/ (80%) - 45 files, 6000 loc
│   ├── llm-service.ts (100%) - 500 loc
│   └── git-service.ts (90%) - 400 loc
└── utils/ (90%) - 40 files, 4500 loc
    └── helpers.ts (100%) - 150 loc
`;

      const prompt = formatCoverageTreeForTest(coverageTree);

      const llm = getLLMService();
      const response = await llm.complete({
        messages: [{
          role: 'user',
          content: prompt + '\n\nList the top 3 items that need documentation most urgently, in order of priority.',
        }],
      });

      const evalResult = await assertLLM(
        'The response should prioritize items marked with ⚠️. ' +
        'The agents/ directory and orchestrator.ts should be mentioned as high priority ' +
        'because they have low coverage (20% and 0%). ' +
        'The well-covered services/ and utils/ should NOT be prioritized.',
        response.content,
        7
      );

      logTestResult('Prioritizes warning-marked items', evalResult);
      console.log(formatEvaluationResult('Prioritizes warning-marked items', evalResult));
    });

    it('considers file size (LOC) in prioritization', async () => {
      const coverageTree = `
src/ (30%) - 10 files, 2000 loc ⚠️
├── core/
│   ├── big-important.ts (0%) - 800 loc ⚠️
│   └── small-util.ts (0%) - 30 loc ⚠️
├── api/
│   ├── medium-handler.ts (0%) - 200 loc ⚠️
│   └── tiny-helper.ts (0%) - 15 loc ⚠️
└── config.ts (100%) - 50 loc
`;

      const prompt = formatCoverageTreeForTest(coverageTree);

      const llm = getLLMService();
      const response = await llm.complete({
        messages: [{
          role: 'user',
          content: prompt + '\n\nRank these undocumented files by priority for documentation. Consider both coverage and file size.',
        }],
      });

      const evalResult = await assertLLM(
        'The response should rank big-important.ts (800 loc) as highest priority ' +
        'because it is the largest undocumented file. ' +
        'medium-handler.ts (200 loc) should come second. ' +
        'small-util.ts and tiny-helper.ts should be lower priority due to small size. ' +
        'config.ts should not be mentioned as a priority since it has 100% coverage.',
        response.content,
        7
      );

      logTestResult('Considers file size in prioritization', evalResult);
      console.log(formatEvaluationResult('Considers file size in prioritization', evalResult));
    });
  });

  describe('understands file-level detail', () => {
    it('distinguishes file coverage from folder average', async () => {
      const coverageTree = `
src/services/ (50%) - 4 files, 1000 loc
├── user-service.ts (100%) - 300 loc
├── auth-service.ts (100%) - 200 loc
├── payment-service.ts (0%) - 400 loc ⚠️
└── notification-service.ts (0%) - 100 loc ⚠️
`;

      const prompt = formatCoverageTreeForTest(coverageTree);

      const llm = getLLMService();
      const response = await llm.complete({
        messages: [{
          role: 'user',
          content: prompt + '\n\nThe services/ folder shows 50% coverage. Which specific files need documentation?',
        }],
      });

      const evalResult = await assertLLM(
        'The response should identify payment-service.ts and notification-service.ts ' +
        'as needing documentation (both have 0% coverage). ' +
        'It should recognize that user-service.ts and auth-service.ts are already ' +
        'fully documented (100% coverage) and do not need attention. ' +
        'The 50% folder average should NOT lead to documenting already-covered files.',
        response.content,
        7
      );

      logTestResult('Distinguishes file vs folder coverage', evalResult);
      console.log(formatEvaluationResult('Distinguishes file vs folder coverage', evalResult));
    });

    it('uses LOC to prioritize within same coverage level', async () => {
      const coverageTree = `
src/ (0%) - 5 files, 1500 loc ⚠️
├── massive-core.ts (0%) - 1000 loc ⚠️
├── medium-logic.ts (0%) - 300 loc ⚠️
├── small-util.ts (0%) - 100 loc ⚠️
├── tiny-const.ts (0%) - 50 loc ⚠️
└── minimal-type.ts (0%) - 50 loc ⚠️
`;

      const prompt = formatCoverageTreeForTest(coverageTree);

      const llm = getLLMService();
      const response = await llm.complete({
        messages: [{
          role: 'user',
          content: prompt + '\n\nAll files have 0% coverage. How would you prioritize them?',
        }],
      });

      const evalResult = await assertLLM(
        'Since all files have 0% coverage, the response should prioritize by size. ' +
        'massive-core.ts (1000 loc) should be highest priority. ' +
        'medium-logic.ts (300 loc) should be second. ' +
        'The smaller files should be lower priority. ' +
        'The reasoning should mention that larger files likely contain more ' +
        'important logic that needs documentation.',
        response.content,
        7
      );

      logTestResult('Uses LOC to prioritize same-coverage files', evalResult);
      console.log(formatEvaluationResult('Uses LOC to prioritize same-coverage files', evalResult));
    });
  });

  describe('handles various codebase structures', () => {
    it('navigates deep structure to find important files', async () => {
      const coverageTree = `
src/ (60%) - 50 files, 8000 loc
├── app/ (90%) - 20 files, 3000 loc
│   └── components/ (95%) - 15 files, 2000 loc
├── lib/ (80%) - 15 files, 2500 loc
└── core/ (20%) - 15 files, 2500 loc ⚠️
    └── engine/ (10%) - 8 files, 1800 loc ⚠️
        └── scheduler/ (0%) - 3 files, 800 loc ⚠️
            ├── main-scheduler.ts (0%) - 500 loc ⚠️
            ├── task-queue.ts (0%) - 200 loc ⚠️
            └── priority-heap.ts (0%) - 100 loc ⚠️
`;

      const prompt = formatCoverageTreeForTest(coverageTree);

      const llm = getLLMService();
      const response = await llm.complete({
        messages: [{
          role: 'user',
          content: prompt + '\n\nIdentify the highest priority documentation targets in this codebase.',
        }],
      });

      const evalResult = await assertLLM(
        'The response should identify the deeply nested scheduler/ directory as critical. ' +
        'main-scheduler.ts should be highlighted as highest priority (0%, 500 loc). ' +
        'The core/engine/scheduler path should be mentioned as the problem area. ' +
        'Well-covered areas like app/ and lib/ should not be prioritized.',
        response.content,
        7
      );

      logTestResult('Navigates deep structure', evalResult);
      console.log(formatEvaluationResult('Navigates deep structure', evalResult));
    });

    it('handles flat structure without confusion', async () => {
      const coverageTree = `
./ (40%) - 8 files, 2000 loc ⚠️
├── main.py (0%) - 500 loc ⚠️
├── utils.py (0%) - 300 loc ⚠️
├── config.py (100%) - 100 loc
├── models.py (80%) - 400 loc
├── views.py (50%) - 300 loc
├── tests.py (100%) - 200 loc
├── requirements.txt (100%) - 50 loc
└── README.md (100%) - 150 loc
`;

      const prompt = formatCoverageTreeForTest(coverageTree);

      const llm = getLLMService();
      const response = await llm.complete({
        messages: [{
          role: 'user',
          content: prompt + '\n\nThis is a flat Python project. What should be documented first?',
        }],
      });

      const evalResult = await assertLLM(
        'The response should identify main.py as highest priority (0%, 500 loc). ' +
        'utils.py should be second priority (0%, 300 loc). ' +
        'views.py might be mentioned as partial coverage (50%). ' +
        'Fully covered files (config.py, tests.py, README.md) should not be prioritized. ' +
        'The response should handle the flat structure (no deep nesting) appropriately.',
        response.content,
        7
      );

      logTestResult('Handles flat structure', evalResult);
      console.log(formatEvaluationResult('Handles flat structure', evalResult));
    });
  });

  describe('interprets truncation information', () => {
    it('understands when items are hidden', async () => {
      const coverageTree = `
src/ (55%) - 150 files, 25000 loc
├── core/ (20%) - 25 files, 5000 loc ⚠️
│   ├── engine.ts (0%) - 800 loc ⚠️
│   ├── processor.ts (0%) - 600 loc ⚠️
│   └── handler.ts (10%) - 400 loc ⚠️
├── api/ (30%) - 30 files, 4000 loc ⚠️
│   └── routes.ts (0%) - 500 loc ⚠️
└── utils/ (85%) - 20 files, 3000 loc

Showing items with coverage ≤ 30% (75 files, 12 directories hidden)
`;

      const prompt = formatCoverageTreeForTest(coverageTree);

      const llm = getLLMService();
      const response = await llm.complete({
        messages: [{
          role: 'user',
          content: prompt + '\n\nThe tree shows some items are hidden. What can you infer about the hidden items? What should be documented?',
        }],
      });

      const evalResult = await assertLLM(
        'The response should recognize that 75 files are hidden because they have >30% coverage. ' +
        'It should focus on the visible low-coverage items (core/, api/). ' +
        'engine.ts (800 loc, 0%) should be identified as top priority. ' +
        'The response should understand that hidden items are less urgent ' +
        'since they already have some documentation.',
        response.content,
        7
      );

      logTestResult('Understands truncation/hidden items', evalResult);
      console.log(formatEvaluationResult('Understands truncation/hidden items', evalResult));
    });
  });
});
