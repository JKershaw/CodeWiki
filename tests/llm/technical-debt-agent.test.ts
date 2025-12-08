/**
 * Real LLM tests for TechnicalDebtAgent.
 *
 * These tests use real LLM calls to verify:
 * 1. Response format is parseable
 * 2. Agent detects TODO/FIXME comments
 * 3. Agent identifies code complexity issues
 *
 * Run with: node --import tsx --test tests/llm/technical-debt-agent.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { TechnicalDebtAgent } from '../../src/agents/analysis/technical-debt-agent.js';
import { createCommitTarget } from '../../src/domain/work-target.js';
import {
  createLLMTestContext,
  createTestRepo,
  addCommit,
  type LLMTestContext,
} from './helpers/test-context.js';
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

describe('TechnicalDebtAgent with Real LLM', { timeout: 120000 }, () => {
  let ctx: LLMTestContext;

  before(async () => {
    const apiKey = process.env['OPENROUTER_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required for LLM tests');
    }
    const model = getLLMService().getModel();
    console.log(`Using model: ${model}`);
    startTestRun(model);
    ctx = await createLLMTestContext();
  });

  after(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
    await saveTestRun();
  });

  describe('Format Compliance', () => {
    it('returns parseable response structure', async () => {
      const repoId = 'llm-tech-debt-format-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/app.ts': `
export function processData(data: any) {
  return data;
}
`,
      }, 'Add data processor');

      const agent = new TechnicalDebtAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Verify structure
      assert.ok(result.result, 'result.result should exist');
      assert.ok(typeof result.result.confidence === 'number', 'confidence should be a number');
      assert.ok(Array.isArray(result.result.findings), 'findings should be an array');
      assert.ok(typeof result.result.summary === 'string', 'summary should be a string');

      console.log(`Format compliance test passed. Findings: ${result.result.findings.length}, Confidence: ${result.result.confidence}`);
    });
  });

  describe('Detection Accuracy', () => {
    it('detects TODO/FIXME comments', async () => {
      const repoId = 'llm-tech-debt-todos';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Task Manager',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/tasks.ts': `
export interface Task {
  id: string;
  title: string;
  completed: boolean;
}

// TODO: Add validation for task title length
// FIXME: This should handle concurrent updates
// HACK: Temporary workaround for race condition
export class TaskManager {
  private tasks: Task[] = [];

  addTask(title: string): Task {
    // TODO: Generate proper UUID instead of timestamp
    const task: Task = {
      id: Date.now().toString(),
      title,
      completed: false,
    };
    this.tasks.push(task);
    return task;
  }

  // XXX: Performance issue with large task lists
  getAllTasks(): Task[] {
    return [...this.tasks];
  }
}
`,
      }, 'Add task manager with known issues');

      const agent = new TechnicalDebtAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // LLM-as-judge: Verify detection of debt markers
      // Include wiki updates (where the real content often lives)
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
        wikiContent: result.updates.map(u => u.content).join('\n'),
      }, null, 2);

      const evalResult = await assertLLM(
        'The analysis identifies technical debt or code quality issues. ' +
        'It should mention TODO, FIXME, HACK comments, or areas needing improvement.',
        analysisText,
        6
      );

      logTestResult('TODO/FIXME detection', evalResult);
      console.log(formatEvaluationResult('TODO/FIXME detection', evalResult));
    });

    it('detects code complexity issues', async () => {
      const repoId = 'llm-tech-debt-complexity';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Order Processor',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/order-processor.ts': `
// This function has high cyclomatic complexity
export function processOrder(order: any, user: any, inventory: any, config: any) {
  let result = { success: false, message: '' };

  if (order) {
    if (order.items && order.items.length > 0) {
      if (user) {
        if (user.isActive) {
          if (user.hasValidPayment) {
            for (let i = 0; i < order.items.length; i++) {
              if (inventory[order.items[i].id]) {
                if (inventory[order.items[i].id].quantity >= order.items[i].quantity) {
                  if (config.allowInternational || !order.isInternational) {
                    if (order.total < user.creditLimit) {
                      // Actually process the order
                      result.success = true;
                      result.message = 'Order processed';
                    } else {
                      result.message = 'Credit limit exceeded';
                    }
                  } else {
                    result.message = 'International orders not allowed';
                  }
                } else {
                  result.message = 'Insufficient inventory';
                }
              } else {
                result.message = 'Item not found';
              }
            }
          } else {
            result.message = 'Invalid payment method';
          }
        } else {
          result.message = 'User is inactive';
        }
      } else {
        result.message = 'User not found';
      }
    } else {
      result.message = 'No items in order';
    }
  } else {
    result.message = 'Invalid order';
  }

  return result;
}
`,
      }, 'Add order processing logic');

      const agent = new TechnicalDebtAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // LLM-as-judge: Verify detection of complexity issues
      // Include wiki updates (where the real content often lives)
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
        wikiContent: result.updates.map(u => u.content).join('\n'),
      }, null, 2);

      const evalResult = await assertLLM(
        'The analysis identifies code complexity or structure issues. ' +
        'It should mention nested conditionals, complexity, or code structure concerns.',
        analysisText,
        6
      );

      logTestResult('Complexity detection', evalResult);
      console.log(formatEvaluationResult('Complexity detection', evalResult));
    });
  });
});
