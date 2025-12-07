/**
 * Real LLM tests for NarrativeAgent.
 *
 * These tests use real LLM calls to verify:
 * 1. Response format is parseable
 * 2. Agent detects ADRs (Architecture Decision Records)
 * 3. Agent identifies planning documents
 *
 * Run with: node --import tsx --test tests/llm/narrative-agent.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import 'dotenv/config';

import { NarrativeAgent } from '../../src/agents/analysis/narrative-agent.js';
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

describe('NarrativeAgent with Real LLM', { timeout: 120000 }, () => {
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
      const repoId = 'llm-narrative-format-test';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      const commitSha = await addCommit(ctx, repoId, {
        'src/app.ts': `
console.log('Hello World');
`,
      }, 'Add hello world');

      const agent = new NarrativeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // Verify structure
      assert.ok(result.result, 'result.result should exist');
      assert.ok(typeof result.result.confidence === 'number', 'confidence should be a number');
      assert.ok(result.result.confidence >= 0 && result.result.confidence <= 1,
        `confidence should be 0-1, got ${result.result.confidence}`);
      assert.ok(Array.isArray(result.result.findings), 'findings should be an array');
      assert.ok(typeof result.result.summary === 'string', 'summary should be a string');

      console.log(`Format compliance test passed. Findings: ${result.result.findings.length}, Confidence: ${result.result.confidence}`);
    });
  });

  describe('Detection Accuracy', () => {
    it('detects Architecture Decision Record', async () => {
      const repoId = 'llm-narrative-adr';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Project with ADRs',
      });

      // Add commit with ADR document
      const commitSha = await addCommit(ctx, repoId, {
        'docs/adr/001-use-postgresql.md': `
# ADR 001: Use PostgreSQL as Primary Database

## Status
Accepted

## Context
We need to choose a database for our application. The application requires:
- ACID compliance for financial transactions
- Complex querying capabilities for reporting
- Support for JSON data for flexible schemas
- Proven scalability for growing data

## Decision
We will use PostgreSQL as our primary database.

## Consequences

### Positive
- Strong ACID compliance ensures data integrity
- Excellent support for complex queries and joins
- Native JSON/JSONB support for flexible data
- Large ecosystem of tools and extensions
- Well-documented and mature technology

### Negative
- Slightly higher operational complexity than simpler databases
- May be overkill for simple CRUD applications
- Requires more planning for horizontal scaling

## Alternatives Considered
- **MySQL**: Good option but weaker JSON support
- **MongoDB**: Better for flexible schemas but lacks ACID guarantees
- **SQLite**: Too limited for production multi-user scenarios
`,
      }, 'Add ADR for PostgreSQL database choice');

      const agent = new NarrativeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // LLM-as-judge: Verify ADR detection
      // Include summary and wiki updates (where the real content lives)
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
        confidence: result.result.confidence,
        wikiUpdatesCount: result.updates.length,
        wikiUpdatePaths: result.updates.map(u => u.path),
        wikiContent: result.updates.map(u => u.content).join('\n---\n'),
      }, null, 2);

      const evalResult = await assertLLM(
        'The narrative analysis identifies an Architecture Decision Record (ADR). ' +
        'The summary or wiki content should mention PostgreSQL as the database choice, ' +
        'and recognize the document structure (context, decision, consequences).',
        analysisText,
        7
      );

      logTestResult('ADR detection', evalResult);
      console.log(formatEvaluationResult('ADR detection', evalResult));
    });

    it('detects planning document', async () => {
      const repoId = 'llm-narrative-planning';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Project with Planning Docs',
      });

      // Add commit with planning document
      const commitSha = await addCommit(ctx, repoId, {
        'docs/ROADMAP.md': `
# Project Roadmap

## Q1 2024: Foundation
- [x] Set up project structure
- [x] Implement core data models
- [ ] Add user authentication
- [ ] Create REST API endpoints

## Q2 2024: Features
- [ ] Dashboard UI implementation
- [ ] Real-time notifications
- [ ] Export functionality
- [ ] Mobile-responsive design

## Q3 2024: Scale
- [ ] Performance optimization
- [ ] Caching layer
- [ ] Load testing
- [ ] Multi-region deployment

## Future Considerations
- Integration with third-party services
- AI-powered recommendations
- White-label customization
`,
      }, 'Add project roadmap document');

      const agent = new NarrativeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.runOnCommit(commitSha, agentCtx);

      // LLM-as-judge: Verify planning document detection
      // Include wiki updates which contain the processed content
      const analysisText = JSON.stringify({
        summary: result.result.summary,
        findings: result.result.findings,
        confidence: result.result.confidence,
        wikiUpdatesCount: result.updates.length,
        wikiContent: result.updates.map(u => u.content).join('\n---\n'),
      }, null, 2);

      const evalResult = await assertLLM(
        'The narrative analysis identifies a planning or roadmap document. ' +
        'The summary or wiki content should mention development phases, ' +
        'quarterly milestones (Q1, Q2, Q3), or future features.',
        analysisText,
        7
      );

      logTestResult('Planning document detection', evalResult);
      console.log(formatEvaluationResult('Planning document detection', evalResult));
    });
  });
});
