/**
 * Integration tests for NarrativeAgent.
 * Tests the agent that detects meta-documents and captures project storytelling.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestContext, createTestRepo, addCommit, type TestContext } from '../helpers/index.js';
import { NarrativeAgent } from '../../src/agents/analysis/narrative-agent.js';
import { createCommitTarget } from '../../src/domain/work-target.js';
import { narrativeAgentResponses } from '../fixtures/agent-responses.js';

describe('NarrativeAgent', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await createTestContext();
  });

  after(async () => {
    await ctx.cleanup();
  });

  beforeEach(() => {
    ctx.llm.reset();
  });

  describe('run', () => {
    it('detects Architecture Decision Records (ADRs)', async () => {
      const repoId = 'narrative-adr';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Project with ADRs',
      });

      // Add a commit with an ADR
      const commitSha = await addCommit(ctx, repoId, {
        'docs/adr/001-cqrs.md': `# ADR 001: Use CQRS Pattern

## Status
Accepted

## Context
We need to separate read and write operations for better scalability.

## Decision
We will use the CQRS (Command Query Responsibility Segregation) pattern.

## Consequences
- Commands and queries can be scaled independently
- Read models can be optimized for specific query patterns
- Increased complexity in maintaining consistency
`,
      }, 'Add ADR for CQRS architecture decision');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add ADR for CQRS architecture decision',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 20,
          linesDeleted: 0,
          affectedFiles: ['docs/adr/001-cqrs.md'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      ctx.llm.setDefaultResponse(narrativeAgentResponses.adrDetected(commitSha));

      const agent = new NarrativeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Should identify architecture decision
      const adrFinding = result.result.findings.find(f =>
        f.type.toLowerCase().includes('architecture') ||
        f.type.toLowerCase().includes('decision') ||
        f.description.toLowerCase().includes('cqrs')
      );
      assert.ok(adrFinding, 'Should identify architecture decision');

      // Should create wiki page for the decision
      assert.ok(result.updates.length > 0, 'Should create wiki updates for ADR');

      // Decision should be in decisions/ category
      const decisionPage = result.updates.find(u =>
        u.path.includes('decisions/') || u.path.includes('architecture/')
      );
      assert.ok(decisionPage, 'Should create page in decisions/ or architecture/ category');

      // Should have high confidence for clear ADR
      assert.ok(result.result.confidence >= 0.8, 'Should have high confidence for clear ADR');

      // Should track cost
      assert.ok(result.costUsd >= 0, 'Should track API cost');
    });

    it('detects planning documents', async () => {
      const repoId = 'narrative-planning';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Project with Planning Docs',
      });

      // Add a commit with a planning document
      const commitSha = await addCommit(ctx, repoId, {
        'PLAN.md': `# Project Plan v2.0

## Vision
Build the most comprehensive documentation platform.

## Q1 Goals
- API redesign with GraphQL
- Improved authentication system
- Real-time collaboration

## Q2 Goals
- Mobile app support
- Enterprise features
- Performance optimization

## Technical Roadmap
1. Migrate to microservices architecture
2. Implement event sourcing
3. Add distributed caching
`,
      }, 'Add project planning document for v2.0');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add project planning document for v2.0',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 25,
          linesDeleted: 0,
          affectedFiles: ['PLAN.md'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      ctx.llm.setDefaultResponse(narrativeAgentResponses.planningDocDetected(commitSha));

      const agent = new NarrativeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Should identify planning document
      const planningFinding = result.result.findings.find(f =>
        f.type.toLowerCase().includes('roadmap') ||
        f.type.toLowerCase().includes('planning') ||
        f.description.toLowerCase().includes('planning')
      );
      assert.ok(planningFinding, 'Should identify planning document');

      // Should create wiki page for the plan
      assert.ok(result.updates.length > 0, 'Should create wiki updates for planning doc');

      // Should be in planning/ category
      const planningPage = result.updates.find(u => u.path.includes('planning/'));
      assert.ok(planningPage, 'Should create page in planning/ category');
    });

    it('handles commits with no narrative content', async () => {
      const repoId = 'narrative-none';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test Project',
      });

      // Add a commit with just code
      const commitSha = await addCommit(ctx, repoId, {
        'src/utils.ts': `
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`,
      }, 'Add math utility functions');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add math utility functions',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 10,
          linesDeleted: 0,
          affectedFiles: ['src/utils.ts'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      ctx.llm.setDefaultResponse(narrativeAgentResponses.noNarrativeContent());

      const agent = new NarrativeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Should have minimal findings for non-narrative commit
      assert.ok(result.result.findings.length === 0, 'Should have no findings for non-narrative code');

      // Should not create wiki pages
      assert.strictEqual(result.updates.length, 0, 'Should not create wiki pages for code-only commits');
    });

    it('detects design documents and RFCs', async () => {
      const repoId = 'narrative-rfc';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Project with RFCs',
      });

      // Add a commit with an RFC
      const commitSha = await addCommit(ctx, repoId, {
        'docs/rfcs/001-new-api.md': `# RFC 001: New API Design

## Summary
Redesign the API to use GraphQL instead of REST.

## Motivation
- Better client-server contract
- Reduced over-fetching
- Type-safe queries

## Detailed Design
The new API will use Apollo Server with the following schema...

## Alternatives Considered
- Continue with REST + OpenAPI
- Use gRPC for internal services

## Implementation Plan
1. Set up Apollo Server
2. Define GraphQL schema
3. Implement resolvers
4. Migrate clients gradually
`,
      }, 'Add RFC for new API design');

      await ctx.repos.commits.save({
        id: commitSha,
        repoId,
        sha: commitSha,
        message: 'Add RFC for new API design',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
        committedAt: new Date(),
        diffSummary: {
          filesAdded: 1,
          filesModified: 0,
          filesDeleted: 0,
          linesAdded: 28,
          linesDeleted: 0,
          affectedFiles: ['docs/rfcs/001-new-api.md'],
        },
        processedBy: [],
        createdAt: new Date(),
      });

      // Custom response for RFC
      ctx.llm.setDefaultResponse(`SUMMARY:
RFC proposing migration from REST to GraphQL API for better developer experience and type safety.

NARRATIVE_TYPE: design

PAGE_TITLE: GraphQL API Design RFC

FINDINGS:
- type: Design Document | importance: high | description: RFC for API redesign from REST to GraphQL | paths: docs/rfcs/001-new-api.md

KEY_DECISIONS:
- Migrate from REST to GraphQL using Apollo Server
- Gradual migration path to support existing clients
- Type-safe query definitions

WIKI_UPDATES:
=== path: architecture/graphql-api | action: create ===
# GraphQL API Design

## Overview

The project is migrating from REST to GraphQL for improved developer experience.

## Benefits

- Type-safe API contract
- Reduced over-fetching
- Better client tooling

## Implementation

Uses Apollo Server with schema-first design.
=== END ===

CONFIDENCE: 0.88`);

      const agent = new NarrativeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      const result = await agent.run(createCommitTarget(commitSha), agentCtx);

      // Should identify design document
      const designFinding = result.result.findings.find(f =>
        f.type.toLowerCase().includes('design') ||
        f.description.toLowerCase().includes('rfc') ||
        f.description.toLowerCase().includes('graphql')
      );
      assert.ok(designFinding, 'Should identify design document/RFC');

      // Should create wiki documentation
      assert.ok(result.updates.length > 0, 'Should create wiki pages for design docs');
    });

    it('throws error for non-existent commit', async () => {
      const repoId = 'narrative-nonexistent';

      await createTestRepo(ctx, repoId, {
        'README.md': '# Test',
      });

      const agent = new NarrativeAgent();
      const agentCtx = await ctx.agentContext(repoId);

      await assert.rejects(
        async () => agent.run(createCommitTarget('nonexistent-commit-id'), agentCtx),
        /not found/i,
        'Should throw error for non-existent commit'
      );
    });
  });

  describe('agent type', () => {
    it('has correct agent type', () => {
      const agent = new NarrativeAgent();
      assert.strictEqual(agent.type, 'narrative', 'Agent type should be narrative');
    });

    it('can handle commit targets', () => {
      const agent = new NarrativeAgent();
      assert.ok(agent.canHandle({ type: 'commit', commitId: 'abc123' }), 'Should handle commit targets');
    });

    it('cannot handle wiki targets', () => {
      const agent = new NarrativeAgent();
      assert.ok(!agent.canHandle({ type: 'wiki' }), 'Should not handle wiki targets');
    });
  });
});
