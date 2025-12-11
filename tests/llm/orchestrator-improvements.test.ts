/**
 * LLM tests for orchestrator improvements.
 *
 * These tests verify that the LLM correctly interprets and uses:
 * 1. Graduated coverage levels (25% = mentioned, 50% = has section, 100% = dedicated page)
 * 2. Entry point prioritization (index.ts, main.ts, etc.)
 * 3. Import-based importance weighting (files with many dependents)
 *
 * Run with: node --import tsx --test tests/llm/orchestrator-improvements.test.ts
 */

import { describe, it, before, after } from 'node:test';
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

describe('Orchestrator Improvements LLM Tests', { timeout: 180000 }, () => {
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

  describe('graduated coverage interpretation', () => {
    it('understands that 25% coverage means only mentioned in passing', async () => {
      const prompt = `You are analyzing wiki documentation coverage for a codebase.

Coverage levels mean:
- 0%   = Not mentioned anywhere in the wiki
- 25%  = Mentioned in passing (filename appears but no detailed explanation)
- 50%  = Has a dedicated section (heading about the file or 3+ mentions with context)
- 100% = Has a dedicated wiki page about the file

Here is the current coverage:

src/services/
├── auth-service.ts (25%) - 400 loc
├── user-service.ts (50%) - 300 loc
├── payment-service.ts (0%) - 500 loc
└── cache-service.ts (100%) - 200 loc

Which files need the most documentation work and why?`;

      const llm = getLLMService();
      const response = await llm.complete({
        messages: [{ role: 'user', content: prompt }],
      });

      const evalResult = await assertLLM(
        'The response should: ' +
        '1. Identify payment-service.ts (0%, 500 loc) as highest priority (completely undocumented + largest). ' +
        '2. Identify auth-service.ts (25%) as needing expansion from passing mention to proper documentation. ' +
        '3. Mention user-service.ts (50%) might need a dedicated page upgrade. ' +
        '4. Recognize cache-service.ts (100%) already has a dedicated page and needs no work. ' +
        '5. Show understanding that 25% means superficial coverage, not adequate.',
        response.content,
        7
      );

      logTestResult('Understands 25% = mentioned in passing', evalResult);
      console.log(formatEvaluationResult('Understands 25% = mentioned in passing', evalResult));
    });

    it('prioritizes files that need deeper coverage over those just needing creation', async () => {
      const prompt = `You are prioritizing documentation work for a codebase.

Coverage levels:
- 25%  = Only mentioned in passing (needs substantial expansion)
- 50%  = Has section but not dedicated page (might be adequate for smaller files)

Here is the current state:

src/core/
├── engine.ts (25%) - 1200 loc  [Large, complex file only briefly mentioned]
├── parser.ts (0%) - 150 loc    [Small utility, not documented]
├── validator.ts (50%) - 300 loc [Has a section in another page]
└── types.ts (25%) - 50 loc      [Type definitions, briefly mentioned]

Rank these by documentation priority, considering both coverage depth and file importance.`;

      const llm = getLLMService();
      const response = await llm.complete({
        messages: [{ role: 'user', content: prompt }],
      });

      const evalResult = await assertLLM(
        'The response should: ' +
        '1. Prioritize engine.ts (25%, 1200 loc) highest - large complex file with only superficial mention. ' +
        '2. Recognize that even though parser.ts is 0%, its small size (150 loc) makes it lower priority than expanding engine.ts coverage. ' +
        '3. Consider validator.ts (50%) as potentially adequate given its medium size. ' +
        '4. Note types.ts (25%, 50 loc) is low priority - type files often need less documentation. ' +
        '5. Demonstrate understanding that 25% on a 1200 loc file is worse than 0% on a 150 loc file.',
        response.content,
        6
      );

      logTestResult('Prioritizes depth over existence', evalResult);
      console.log(formatEvaluationResult('Prioritizes depth over existence', evalResult));
    });

    it('understands progression from 25% to 50% to 100%', async () => {
      const prompt = `You are improving wiki documentation. A file currently has 25% coverage (only mentioned in passing).

What would it take to improve coverage to:
1. 50% coverage (has dedicated section)
2. 100% coverage (has dedicated wiki page)

The file is: src/services/orchestrator.ts (25%, 800 loc)

Current mention: "The orchestrator.ts file coordinates work between agents."

Describe what documentation improvements would be needed at each level.`;

      const llm = getLLMService();
      const response = await llm.complete({
        messages: [{ role: 'user', content: prompt }],
      });

      const evalResult = await assertLLM(
        'The response should explain: ' +
        '1. For 50%: Need a dedicated section with heading like "## Orchestrator" with multiple paragraphs explaining functionality, not just a passing mention. ' +
        '2. For 100%: Need a full wiki page dedicated to orchestrator.ts with comprehensive coverage including purpose, API, usage examples, etc. ' +
        '3. Show understanding that coverage tiers reflect documentation depth, not just existence. ' +
        '4. Recognize that going from 25% to 100% requires substantial documentation work.',
        response.content,
        7
      );

      logTestResult('Understands coverage progression', evalResult);
      console.log(formatEvaluationResult('Understands coverage progression', evalResult));
    });
  });

  describe('entry point prioritization', () => {
    it('recognizes entry points as high priority', async () => {
      const prompt = `You are prioritizing documentation for a codebase.

Entry points (index.ts, main.ts, cli.ts, app.ts, server.ts) are especially important because:
- They're the first files developers encounter
- They define the public API surface
- They show how to use the system

Here is the current state:

src/ (40%) - 20 files
├── index.ts (0%) - 100 loc       [ENTRY POINT - main export]
├── main.ts (0%) - 150 loc        [ENTRY POINT - CLI entry]
├── utils/
│   ├── helpers.ts (0%) - 200 loc
│   └── format.ts (0%) - 150 loc
└── services/
    ├── api.ts (0%) - 400 loc
    └── db.ts (0%) - 300 loc

All files have 0% coverage. Rank by documentation priority.`;

      const llm = getLLMService();
      const response = await llm.complete({
        messages: [{ role: 'user', content: prompt }],
      });

      const evalResult = await assertLLM(
        'The response should: ' +
        '1. Prioritize index.ts and main.ts as highest priority despite smaller size because they are entry points. ' +
        '2. Explain that entry points are the first thing developers see and define the public API. ' +
        '3. Put services/api.ts (400 loc) high priority after entry points. ' +
        '4. Consider helpers.ts and format.ts as lower priority utilities. ' +
        '5. Show understanding that entry points deserve priority over larger internal files.',
        response.content,
        7
      );

      logTestResult('Prioritizes entry points', evalResult);
      console.log(formatEvaluationResult('Prioritizes entry points', evalResult));
    });

    it('balances entry point priority with coverage depth', async () => {
      const prompt = `Consider these files for documentation priority:

src/
├── index.ts (50%) - 80 loc   [ENTRY POINT - has section, might be adequate]
├── main.ts (25%) - 120 loc   [ENTRY POINT - only mentioned in passing]
├── core/
│   └── engine.ts (0%) - 600 loc  [Core logic, completely undocumented]

Entry points are important but so is coverage depth.
Which file needs documentation work most urgently?`;

      const llm = getLLMService();
      const response = await llm.complete({
        messages: [{ role: 'user', content: prompt }],
      });

      const evalResult = await assertLLM(
        'The response should: ' +
        '1. Identify main.ts (25%) as needing work - entry point with only passing mention. ' +
        '2. Consider engine.ts (0%, 600 loc) as high priority due to size and zero coverage. ' +
        '3. Note that index.ts (50%) might be adequate for its size. ' +
        '4. Balance between entry point importance and coverage depth. ' +
        '5. Likely recommend main.ts first (entry point needing expansion) or engine.ts (large gap).',
        response.content,
        6
      );

      logTestResult('Balances entry point priority with coverage', evalResult);
      console.log(formatEvaluationResult('Balances entry point priority with coverage', evalResult));
    });
  });

  describe('import-based importance', () => {
    it('prioritizes files with many dependents', async () => {
      const prompt = `You are prioritizing documentation. Files that are imported by many other files are more important because:
- Changes to them affect more of the codebase
- They form the foundation that other code builds on
- Developers need to understand them to work on dependent code

Here are the files with their dependent counts:

src/
├── utils/common.ts (0%) - 200 loc  [Imported by 15 other files]
├── services/api.ts (0%) - 400 loc  [Imported by 3 other files]
├── pages/home.ts (0%) - 300 loc    [Imported by 1 file]
└── components/button.ts (0%) - 100 loc [Imported by 12 other files]

All have 0% coverage. Rank by documentation priority considering dependent count.`;

      const llm = getLLMService();
      const response = await llm.complete({
        messages: [{ role: 'user', content: prompt }],
      });

      const evalResult = await assertLLM(
        'The response should: ' +
        '1. Prioritize utils/common.ts (15 dependents) as highest priority - most widely used. ' +
        '2. Put components/button.ts (12 dependents) second - also widely used. ' +
        '3. Rank services/api.ts (3 dependents) before pages/home.ts despite larger size. ' +
        '4. Put pages/home.ts (1 dependent) lowest - it is a leaf module. ' +
        '5. Explain that widely-imported files form the foundation and need docs first.',
        response.content,
        7
      );

      logTestResult('Prioritizes high-dependent files', evalResult);
      console.log(formatEvaluationResult('Prioritizes high-dependent files', evalResult));
    });

    it('combines dependent count with other factors', async () => {
      const prompt = `Consider documentation priority with multiple factors:

src/
├── index.ts (25%) - 50 loc   [ENTRY POINT, 5 dependents]
├── core/utils.ts (0%) - 150 loc  [10 dependents - foundation utility]
├── core/engine.ts (0%) - 800 loc [2 dependents - large but specialized]
└── lib/logger.ts (50%) - 100 loc [8 dependents - has section already]

Factors to consider:
- Coverage depth (25% < 50%)
- Entry point status
- Dependent count (more = more important)
- File size

Rank these files for documentation priority.`;

      const llm = getLLMService();
      const response = await llm.complete({
        messages: [{ role: 'user', content: prompt }],
      });

      const evalResult = await assertLLM(
        'The response should: ' +
        '1. Consider core/utils.ts high priority: 0% coverage AND 10 dependents (foundation). ' +
        '2. Consider index.ts needs improvement: entry point but only 25% (needs expansion). ' +
        '3. Note engine.ts is large (800 loc) but only 2 dependents - specialized. ' +
        '4. Consider logger.ts might be adequate: 50% coverage already, 8 dependents. ' +
        '5. Show understanding of how to balance multiple prioritization factors.',
        response.content,
        6
      );

      logTestResult('Combines factors for prioritization', evalResult);
      console.log(formatEvaluationResult('Combines factors for prioritization', evalResult));
    });
  });

  describe('integrated decision making', () => {
    it('makes good decisions with all factors present', async () => {
      const prompt = `You are the orchestrator deciding what to document next.

Coverage levels: 0% = none, 25% = mentioned, 50% = has section, 100% = dedicated page
Entry points get priority. High-dependent files get priority.

Current state:

src/ (35%)
├── index.ts (50%) - 80 loc    [ENTRY POINT, 8 dependents]
├── main.ts (0%) - 100 loc     [ENTRY POINT, 0 dependents]
├── core/
│   ├── scheduler.ts (0%) - 600 loc  [12 dependents - core utility]
│   ├── worker.ts (25%) - 400 loc    [6 dependents - mentioned only]
│   └── queue.ts (100%) - 200 loc    [10 dependents - fully documented]
├── services/
│   ├── api.ts (0%) - 350 loc        [4 dependents]
│   └── cache.ts (50%) - 150 loc     [3 dependents]
└── utils/
    ├── helpers.ts (25%) - 100 loc   [15 dependents - widely used]
    └── format.ts (0%) - 80 loc      [2 dependents]

Pick the TOP 3 files to document next and explain your reasoning.`;

      const llm = getLLMService();
      const response = await llm.complete({
        messages: [{ role: 'user', content: prompt }],
      });

      const evalResult = await assertLLM(
        'The response should make a reasonable top 3 selection considering: ' +
        '1. scheduler.ts is strong candidate: 0%, 600 loc, 12 dependents (core foundation). ' +
        '2. helpers.ts is strong candidate: only 25% but 15 dependents (very widely used). ' +
        '3. main.ts is an entry point with 0% but 0 dependents. ' +
        '4. worker.ts needs expansion: 25% but 6 dependents and 400 loc. ' +
        '5. Should NOT include queue.ts (100%) or cache.ts (50% and small). ' +
        '6. The reasoning should show awareness of coverage depth, dependents, entry points, and size.',
        response.content,
        6
      );

      logTestResult('Integrates all factors in decision', evalResult);
      console.log(formatEvaluationResult('Integrates all factors in decision', evalResult));
    });
  });
});
