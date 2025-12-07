/**
 * Edge Case Tests - Empty and Trivial Commits.
 *
 * Tests that agents handle edge cases gracefully:
 * - Commits with only whitespace changes
 * - Commits with only comment changes
 * - Commits with only documentation changes
 * - Commits with trivial refactoring
 *
 * Run with: node --import tsx --test tests/llm/edge-cases/empty-commits.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { SecurityAgent } from '../../../src/agents/analysis/security-agent.js';
import { CodeChangeAgent } from '../../../src/agents/analysis/code-change-agent.js';
import { TechnicalDebtAgent } from '../../../src/agents/analysis/technical-debt-agent.js';
import {
  createLLMTestContext,
  createTestRepo,
  addCommit,
  type LLMTestContext,
} from '../helpers/test-context.js';
import {
  evaluateLLM,
  formatEvaluationResult,
  getLLMService,
} from '../helpers/llm-assert.js';
import {
  startTestRun,
  logTestResult,
  saveTestRun,
} from '../helpers/result-logger.js';

describe('Edge Case: Empty and Trivial Commits', { timeout: 180000 }, () => {
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

  describe('Comment-Only Changes', () => {
    it('handles commits with only comment updates', async () => {
      const repoId = 'llm-edge-comment-only';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/service.ts': `
/**
 * Main service class.
 */
export class Service {
  // Process data
  process(data: string): string {
    return data.toUpperCase();
  }
}
`,
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/service.ts': `
/**
 * Main service class.
 *
 * This service handles data processing operations.
 * It transforms input strings according to business rules.
 *
 * @example
 * const svc = new Service();
 * svc.process("hello"); // Returns "HELLO"
 */
export class Service {
  // Process data and transform to uppercase
  // This is the main entry point for data transformation
  process(data: string): string {
    return data.toUpperCase();
  }
}
`,
      }, 'Improve documentation and comments');

      const agent = new CodeChangeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // Should complete without error
      assert.ok(result.result, 'Should produce a result');

      const analysisText = JSON.stringify(result.result, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis should correctly identify that this commit only contains ' +
        'documentation/comment changes with no functional code changes. ' +
        'It should not report any feature additions or bug fixes.',
        analysisText,
        7
      );

      logTestResult('Comment-only commit recognition', evalResult);
      console.log(formatEvaluationResult('Comment-only commit recognition', evalResult));
    });
  });

  describe('Whitespace-Only Changes', () => {
    it('handles commits with only formatting/whitespace changes', async () => {
      const repoId = 'llm-edge-whitespace-only';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/utils.ts': `
export function format(input:string):string{
return input.trim().toLowerCase();}
export function validate(x:number):boolean{return x>0&&x<100;}
`,
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/utils.ts': `
export function format(input: string): string {
  return input.trim().toLowerCase();
}

export function validate(x: number): boolean {
  return x > 0 && x < 100;
}
`,
      }, 'Format code with prettier');

      const agent = new CodeChangeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      assert.ok(result.result, 'Should produce a result');

      const analysisText = JSON.stringify(result.result, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis should correctly identify that this commit only contains ' +
        'formatting/whitespace changes (code was reformatted/prettified). ' +
        'The actual functionality is unchanged.',
        analysisText,
        7
      );

      logTestResult('Whitespace-only commit recognition', evalResult);
      console.log(formatEvaluationResult('Whitespace-only commit recognition', evalResult));
    });
  });

  describe('README-Only Changes', () => {
    it('handles commits with only README/documentation file changes', async () => {
      const repoId = 'llm-edge-readme-only';

      await createTestRepo(ctx, repoId, {
        'README.md': '# My Project\n\nA simple project.',
        'src/index.ts': 'export const version = "1.0.0";',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'README.md': `# My Project

A comprehensive project for data processing.

## Installation

\`\`\`bash
npm install my-project
\`\`\`

## Usage

\`\`\`typescript
import { process } from 'my-project';
process('data');
\`\`\`

## License

MIT
`,
        'CONTRIBUTING.md': `# Contributing

We welcome contributions! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch
3. Submit a pull request
`,
      }, 'Update documentation');

      const agent = new CodeChangeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      assert.ok(result.result, 'Should produce a result');

      // Security agent should also handle this gracefully
      const secAgent = new SecurityAgent();
      const secResult = await secAgent.runOnCommit(commitSha, agentCtx);

      // Should not find security issues in documentation
      console.log(`Security findings for docs: ${secResult.result.findings.length}`);

      const analysisText = JSON.stringify(result.result, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis should correctly identify that this commit only contains ' +
        'documentation changes (README.md and CONTRIBUTING.md). No code was ' +
        'modified, so there should be no functional change analysis.',
        analysisText,
        7
      );

      logTestResult('Documentation-only commit recognition', evalResult);
      console.log(formatEvaluationResult('Documentation-only commit recognition', evalResult));
    });
  });

  describe('Rename/Move Operations', () => {
    it('handles commits that only rename variables', async () => {
      const repoId = 'llm-edge-rename-vars';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/calculator.ts': `
export function calc(a: number, b: number): number {
  const x = a + b;
  const y = x * 2;
  return y;
}
`,
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/calculator.ts': `
export function calculate(firstNumber: number, secondNumber: number): number {
  const sum = firstNumber + secondNumber;
  const result = sum * 2;
  return result;
}
`,
      }, 'Rename variables for clarity');

      const agent = new CodeChangeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      assert.ok(result.result, 'Should produce a result');

      const analysisText = JSON.stringify(result.result, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis should correctly identify that this commit is a refactoring ' +
        'that renames variables and a function for better clarity. The actual ' +
        'logic (sum then multiply by 2) is unchanged.',
        analysisText,
        7
      );

      logTestResult('Variable rename recognition', evalResult);
      console.log(formatEvaluationResult('Variable rename recognition', evalResult));
    });
  });

  describe('Config File Changes', () => {
    it('handles commits with only config file changes', async () => {
      const repoId = 'llm-edge-config-only';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'package.json': JSON.stringify({
          name: 'test-project',
          version: '1.0.0',
          scripts: {
            test: 'jest',
          },
        }, null, 2),
        'src/index.ts': 'export const app = "test";',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'package.json': JSON.stringify({
          name: 'test-project',
          version: '1.0.1',
          scripts: {
            test: 'jest',
            lint: 'eslint src/',
            build: 'tsc',
          },
          devDependencies: {
            eslint: '^8.0.0',
            typescript: '^5.0.0',
          },
        }, null, 2),
        'tsconfig.json': JSON.stringify({
          compilerOptions: {
            target: 'ES2020',
            module: 'NodeNext',
            strict: true,
          },
        }, null, 2),
        '.eslintrc.json': JSON.stringify({
          extends: ['eslint:recommended'],
          env: { node: true },
        }, null, 2),
      }, 'Add build and lint tooling');

      const agent = new CodeChangeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      assert.ok(result.result, 'Should produce a result');

      const analysisText = JSON.stringify(result.result, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis should correctly identify that this commit adds development ' +
        'tooling configuration (TypeScript, ESLint) and build scripts. ' +
        'No application code was changed.',
        analysisText,
        7
      );

      logTestResult('Config-only commit recognition', evalResult);
      console.log(formatEvaluationResult('Config-only commit recognition', evalResult));
    });
  });

  describe('Type-Only Changes', () => {
    it('handles commits with only TypeScript type changes', async () => {
      const repoId = 'llm-edge-types-only';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
        'src/types.ts': `
export interface User {
  id: string;
  name: string;
}
`,
        'src/service.ts': `
import { User } from './types';

export function getUser(id: string): User {
  return { id, name: 'Test' };
}
`,
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/types.ts': `
export interface User {
  id: string;
  name: string;
  email?: string;
  createdAt?: Date;
  metadata?: Record<string, unknown>;
}

export type UserId = string;

export interface UserCreate extends Omit<User, 'id' | 'createdAt'> {
  password: string;
}

export interface UserUpdate extends Partial<Omit<User, 'id'>> {}
`,
      }, 'Expand User type definitions');

      const agent = new CodeChangeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      assert.ok(result.result, 'Should produce a result');

      const analysisText = JSON.stringify(result.result, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis should correctly identify that this commit adds TypeScript ' +
        'type definitions. These are compile-time only changes that improve type ' +
        'safety but do not change runtime behavior.',
        analysisText,
        7
      );

      logTestResult('Type-only commit recognition', evalResult);
      console.log(formatEvaluationResult('Type-only commit recognition', evalResult));
    });
  });
});
