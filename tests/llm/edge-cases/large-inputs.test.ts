/**
 * Edge Case Tests - Large Inputs.
 *
 * Tests that agents handle large commits, files, and diffs correctly
 * without timing out or producing degraded results.
 *
 * Run with: node --import tsx --test tests/llm/edge-cases/large-inputs.test.ts
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

/**
 * Generate a large TypeScript file with many functions.
 */
function generateLargeFile(numFunctions: number, includeVulnerability: boolean = false): string {
  const lines: string[] = [
    '/**',
    ' * Auto-generated large service file for testing.',
    ' * This simulates a large legacy codebase.',
    ' */',
    '',
    "import { Database } from './database';",
    "import { Logger } from './logger';",
    '',
    'export class LargeService {',
    '  private db: Database;',
    '  private logger: Logger;',
    '',
    '  constructor(db: Database, logger: Logger) {',
    '    this.db = db;',
    '    this.logger = logger;',
    '  }',
    '',
  ];

  for (let i = 1; i <= numFunctions; i++) {
    // Add the vulnerability somewhere in the middle
    if (includeVulnerability && i === Math.floor(numFunctions / 2)) {
      lines.push(`  /**`);
      lines.push(`   * Get user by email - contains SQL injection vulnerability.`);
      lines.push(`   */`);
      lines.push(`  async getUserByEmail${i}(email: string): Promise<User | null> {`);
      lines.push(`    // VULNERABLE: SQL injection`);
      lines.push(`    const query = "SELECT * FROM users WHERE email = '" + email + "'";`);
      lines.push(`    const result = await this.db.query(query);`);
      lines.push(`    return result[0] || null;`);
      lines.push(`  }`);
      lines.push('');
    } else {
      // Generate safe functions
      lines.push(`  /**`);
      lines.push(`   * Process data batch ${i}.`);
      lines.push(`   * @param data - Input data array`);
      lines.push(`   * @returns Processed results`);
      lines.push(`   */`);
      lines.push(`  async processBatch${i}(data: unknown[]): Promise<ProcessedResult[]> {`);
      lines.push(`    this.logger.info(\`Processing batch ${i} with \${data.length} items\`);`);
      lines.push(`    `);
      lines.push(`    const results: ProcessedResult[] = [];`);
      lines.push(`    for (const item of data) {`);
      lines.push(`      const validated = this.validate${i}(item);`);
      lines.push(`      if (validated) {`);
      lines.push(`        const transformed = this.transform${i}(validated);`);
      lines.push(`        results.push(transformed);`);
      lines.push(`      }`);
      lines.push(`    }`);
      lines.push(`    `);
      lines.push(`    return results;`);
      lines.push(`  }`);
      lines.push('');
      lines.push(`  private validate${i}(item: unknown): ValidatedItem | null {`);
      lines.push(`    if (!item || typeof item !== 'object') return null;`);
      lines.push(`    const obj = item as Record<string, unknown>;`);
      lines.push(`    if (!obj.id || !obj.type) return null;`);
      lines.push(`    return { id: String(obj.id), type: String(obj.type), data: obj };`);
      lines.push(`  }`);
      lines.push('');
      lines.push(`  private transform${i}(item: ValidatedItem): ProcessedResult {`);
      lines.push(`    return {`);
      lines.push(`      id: item.id,`);
      lines.push(`      type: item.type,`);
      lines.push(`      processedAt: new Date(),`);
      lines.push(`      hash: this.computeHash${i}(item),`);
      lines.push(`    };`);
      lines.push(`  }`);
      lines.push('');
      lines.push(`  private computeHash${i}(item: ValidatedItem): string {`);
      lines.push(`    return Buffer.from(JSON.stringify(item)).toString('base64');`);
      lines.push(`  }`);
      lines.push('');
    }
  }

  lines.push('}');
  lines.push('');
  lines.push('interface ValidatedItem { id: string; type: string; data: unknown; }');
  lines.push('interface ProcessedResult { id: string; type: string; processedAt: Date; hash: string; }');
  lines.push('interface User { id: string; email: string; name: string; }');

  return lines.join('\n');
}

/**
 * Generate multiple files for a multi-file commit.
 */
function generateMultipleFiles(numFiles: number): Record<string, string> {
  const files: Record<string, string> = {};

  for (let i = 1; i <= numFiles; i++) {
    files[`src/services/service-${i}.ts`] = `
/**
 * Service ${i} - Auto-generated for testing.
 */

export class Service${i} {
  private name = 'Service${i}';

  async process(input: string): Promise<string> {
    console.log(\`[\${this.name}] Processing: \${input}\`);
    return \`Processed by \${this.name}: \${input}\`;
  }

  async validate(data: unknown): Promise<boolean> {
    if (!data) return false;
    return typeof data === 'object';
  }

  getMetadata() {
    return {
      name: this.name,
      version: '1.0.${i}',
      created: new Date().toISOString(),
    };
  }
}

export default new Service${i}();
`;
  }

  return files;
}

describe('Edge Case: Large Inputs', { timeout: 300000 }, () => {
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

  describe('Large Single File', () => {
    it('handles 500+ line file and still detects vulnerabilities', async () => {
      const repoId = 'llm-edge-large-file';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Large Service Project',
      });

      // Generate a file with ~600 lines (20 functions * 30 lines each)
      const largeFileContent = generateLargeFile(20, true);
      const lineCount = largeFileContent.split('\n').length;
      console.log(`Generated file with ${lineCount} lines`);

      const commitSha = await addCommit(ctx, repoId, {
        'src/services/large-service.ts': largeFileContent,
      }, 'Add large service with hidden vulnerability');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const startTime = Date.now();
      const result = await agent.runOnCommit(commitSha, agentCtx);
      const duration = Date.now() - startTime;

      console.log(`Analysis completed in ${duration}ms`);

      // Should still detect the vulnerability in the middle of the large file
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
        confidence: result.result.confidence,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis should detect the SQL injection vulnerability that is buried ' +
        'in the middle of a large (500+ line) file. The vulnerability uses string ' +
        'concatenation to build a SQL query. A good analysis will find this even ' +
        'in a large file with many other safe functions.',
        analysisText,
        7
      );

      logTestResult('Large file vulnerability detection', evalResult);
      console.log(formatEvaluationResult('Large file vulnerability detection', evalResult));

      // Check that we got meaningful results (not just a timeout or error)
      assert.ok(result.result.summary, 'Should produce a summary');
      assert.ok(result.result.confidence >= 0, 'Should have a valid confidence score');
    });

    it('handles large file without vulnerability gracefully', async () => {
      const repoId = 'llm-edge-large-safe-file';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Large Safe Project',
      });

      // Generate a large safe file
      const largeFileContent = generateLargeFile(15, false);

      const commitSha = await addCommit(ctx, repoId, {
        'src/services/safe-large-service.ts': largeFileContent,
      }, 'Add large safe service');

      const agent = new SecurityAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const startTime = Date.now();
      const result = await agent.runOnCommit(commitSha, agentCtx);
      const duration = Date.now() - startTime;

      console.log(`Analysis completed in ${duration}ms`);
      console.log(`Findings: ${result.result.findings.length}`);

      // Should complete without error and ideally have few/no findings
      assert.ok(result.result.summary, 'Should produce a summary');
    });
  });

  describe('Multi-File Commits', () => {
    it('handles commit with 20+ files', async () => {
      const repoId = 'llm-edge-multi-file';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Multi-Service Project',
      });

      // Generate 25 files
      const files = generateMultipleFiles(25);
      console.log(`Generated ${Object.keys(files).length} files`);

      const commitSha = await addCommit(ctx, repoId, files, 'Add multiple service files');

      const agent = new CodeChangeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const startTime = Date.now();
      const result = await agent.runOnCommit(commitSha, agentCtx);
      const duration = Date.now() - startTime;

      console.log(`Analysis completed in ${duration}ms`);

      // Should produce meaningful analysis
      assert.ok(result.result, 'Should produce a result');

      const analysisText = JSON.stringify(result.result, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis should provide a coherent summary of a commit that adds ' +
        '25+ service files. It should recognize this as a bulk addition of ' +
        'service infrastructure rather than analyzing each file in isolation.',
        analysisText,
        6 // Lower threshold for this edge case
      );

      logTestResult('Multi-file commit analysis', evalResult);
      console.log(formatEvaluationResult('Multi-file commit analysis', evalResult));
    });
  });

  describe('Deep Nesting', () => {
    it('handles deeply nested code structures', async () => {
      const repoId = 'llm-edge-deep-nesting';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Complex Logic Project',
      });

      // Generate deeply nested code (technical debt indicator)
      const deeplyNestedCode = `
/**
 * Complex order processing with deep nesting.
 * This is an example of code that needs refactoring.
 */

export async function processOrder(order: Order): Promise<ProcessResult> {
  if (order) {
    if (order.items) {
      if (order.items.length > 0) {
        for (const item of order.items) {
          if (item.productId) {
            if (item.quantity > 0) {
              const product = await getProduct(item.productId);
              if (product) {
                if (product.inStock) {
                  if (product.quantity >= item.quantity) {
                    if (item.price === product.price) {
                      if (order.customer) {
                        if (order.customer.verified) {
                          if (order.paymentMethod) {
                            if (order.paymentMethod.valid) {
                              // Finally process the order
                              const result = await createOrderRecord(order);
                              if (result.success) {
                                await updateInventory(item.productId, -item.quantity);
                                await chargeCustomer(order.customer, order.total);
                                return { success: true, orderId: result.orderId };
                              } else {
                                return { success: false, error: 'Failed to create order' };
                              }
                            } else {
                              return { success: false, error: 'Invalid payment method' };
                            }
                          } else {
                            return { success: false, error: 'No payment method' };
                          }
                        } else {
                          return { success: false, error: 'Customer not verified' };
                        }
                      } else {
                        return { success: false, error: 'No customer' };
                      }
                    } else {
                      return { success: false, error: 'Price mismatch' };
                    }
                  } else {
                    return { success: false, error: 'Insufficient stock' };
                  }
                } else {
                  return { success: false, error: 'Product out of stock' };
                }
              } else {
                return { success: false, error: 'Product not found' };
              }
            } else {
              return { success: false, error: 'Invalid quantity' };
            }
          } else {
            return { success: false, error: 'No product ID' };
          }
        }
        return { success: true };
      } else {
        return { success: false, error: 'No items' };
      }
    } else {
      return { success: false, error: 'No items array' };
    }
  } else {
    return { success: false, error: 'No order' };
  }
}

interface Order {
  items: OrderItem[];
  customer: Customer;
  paymentMethod: PaymentMethod;
  total: number;
}

interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

interface Customer {
  id: string;
  verified: boolean;
}

interface PaymentMethod {
  valid: boolean;
}

interface ProcessResult {
  success: boolean;
  orderId?: string;
  error?: string;
}

// Stub functions
async function getProduct(id: string) { return null; }
async function createOrderRecord(order: Order) { return { success: false, orderId: '' }; }
async function updateInventory(id: string, delta: number) {}
async function chargeCustomer(customer: Customer, amount: number) {}
`;

      const commitSha = await addCommit(ctx, repoId, {
        'src/orders/processor.ts': deeplyNestedCode,
      }, 'Add order processor with complex logic');

      const agent = new TechnicalDebtAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
      }, null, 2);

      const evalResult = await evaluateLLM(
        'The analysis should identify the deeply nested code (12+ levels) as a ' +
        'significant technical debt issue. It should recommend refactoring to ' +
        'reduce nesting, perhaps using early returns, guard clauses, or extracting ' +
        'validation into separate functions.',
        analysisText,
        7
      );

      logTestResult('Deep nesting detection', evalResult);
      console.log(formatEvaluationResult('Deep nesting detection', evalResult));
    });
  });
});
