/**
 * Result logging for LLM tests.
 *
 * Logs all evaluation results to JSON files for tracking quality trends over time.
 */

import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { EvaluationResult } from './llm-assert.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '..', 'results');

interface TestResult {
  name: string;
  passed: boolean;
  score: number;
  reasoning: string;
  improvements: string[];
  timestamp: string;
}

interface RunResult {
  runId: string;
  timestamp: string;
  model: string;
  tests: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    avgScore: number;
  };
}

let currentRun: RunResult | null = null;

/**
 * Start a new test run.
 */
export function startTestRun(model: string): void {
  const now = new Date();
  currentRun = {
    runId: now.toISOString().replace(/[:.]/g, '-'),
    timestamp: now.toISOString(),
    model,
    tests: [],
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      avgScore: 0,
    },
  };
}

/**
 * Log a test result.
 */
export function logTestResult(testName: string, result: EvaluationResult): void {
  if (!currentRun) {
    // Auto-start if not started
    startTestRun('unknown');
  }

  currentRun!.tests.push({
    name: testName,
    passed: result.passed,
    score: result.score,
    reasoning: result.reasoning,
    improvements: result.improvements,
    timestamp: new Date().toISOString(),
  });

  // Update summary
  currentRun!.summary.total = currentRun!.tests.length;
  currentRun!.summary.passed = currentRun!.tests.filter(t => t.passed).length;
  currentRun!.summary.failed = currentRun!.tests.filter(t => !t.passed).length;
  currentRun!.summary.avgScore = currentRun!.tests.reduce((sum, t) => sum + t.score, 0) / currentRun!.tests.length;
}

/**
 * Save the current test run to disk.
 */
export async function saveTestRun(): Promise<string | null> {
  if (!currentRun || currentRun.tests.length === 0) {
    return null;
  }

  await mkdir(RESULTS_DIR, { recursive: true });

  const filename = `${currentRun.runId}.json`;
  const filepath = join(RESULTS_DIR, filename);

  await writeFile(filepath, JSON.stringify(currentRun, null, 2));

  const savedRun = currentRun;
  currentRun = null;

  console.log(`\nTest run saved to: ${filepath}`);
  console.log(`Summary: ${savedRun.summary.passed}/${savedRun.summary.total} passed, avg score: ${savedRun.summary.avgScore.toFixed(1)}`);

  return filepath;
}

/**
 * Get the current test run (for inspection).
 */
export function getCurrentRun(): RunResult | null {
  return currentRun;
}

/**
 * Load a previous test run from disk.
 */
export async function loadTestRun(runId: string): Promise<RunResult | null> {
  const filepath = join(RESULTS_DIR, `${runId}.json`);

  if (!existsSync(filepath)) {
    return null;
  }

  const content = await readFile(filepath, 'utf-8');
  return JSON.parse(content);
}

/**
 * List all test runs.
 */
export async function listTestRuns(): Promise<string[]> {
  const { readdir } = await import('fs/promises');

  if (!existsSync(RESULTS_DIR)) {
    return [];
  }

  const files = await readdir(RESULTS_DIR);
  return files
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort()
    .reverse(); // Most recent first
}

/**
 * Compare two test runs.
 */
export async function compareRuns(runId1: string, runId2: string): Promise<{
  improved: string[];
  regressed: string[];
  unchanged: string[];
  newTests: string[];
  removedTests: string[];
}> {
  const run1 = await loadTestRun(runId1);
  const run2 = await loadTestRun(runId2);

  if (!run1 || !run2) {
    throw new Error('Could not load one or both runs');
  }

  const tests1 = new Map(run1.tests.map(t => [t.name, t]));
  const tests2 = new Map(run2.tests.map(t => [t.name, t]));

  const result = {
    improved: [] as string[],
    regressed: [] as string[],
    unchanged: [] as string[],
    newTests: [] as string[],
    removedTests: [] as string[],
  };

  // Find improved, regressed, unchanged
  for (const [name, test1] of tests1) {
    const test2 = tests2.get(name);
    if (!test2) {
      result.removedTests.push(name);
    } else if (test2.score > test1.score) {
      result.improved.push(`${name}: ${test1.score} -> ${test2.score}`);
    } else if (test2.score < test1.score) {
      result.regressed.push(`${name}: ${test1.score} -> ${test2.score}`);
    } else {
      result.unchanged.push(name);
    }
  }

  // Find new tests
  for (const name of tests2.keys()) {
    if (!tests1.has(name)) {
      result.newTests.push(name);
    }
  }

  return result;
}
