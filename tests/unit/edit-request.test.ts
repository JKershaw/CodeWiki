/**
 * Unit tests for EditRequest domain model.
 * Tests creation, conversion, and property handling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createEditRequest,
  wikiPageUpdateToEditRequest,
  createCommitEditSource,
  createStoryEditSource,
  createManualEditSource,
  isCommitEditSource,
  type EditRequest,
} from '../../src/domain/edit-request.js';

describe('EditRequest', () => {
  describe('createEditRequest', () => {
    it('creates an edit request with explicit source', () => {
      const timestamp = new Date('2024-01-15T10:00:00Z');
      const source = createCommitEditSource('abc123', timestamp);
      const editRequest = createEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source,
        sourceAgentType: 'code-change',
        sourceAgentRunId: 'run-1',
        targetPagePath: 'docs/api',
        proposedUpdateType: 'update',
        proposedContent: '# API Documentation',
        confidenceDelta: 0.1,
      });

      assert.strictEqual(editRequest.id, 'edit-1');
      assert.strictEqual(editRequest.repoId, 'repo-1');
      assert.strictEqual(editRequest.wikiId, 'wiki-1');
      assert.ok(isCommitEditSource(editRequest.source));
      if (isCommitEditSource(editRequest.source)) {
        assert.strictEqual(editRequest.source.commitSha, 'abc123');
        assert.strictEqual(editRequest.source.commitTimestamp.getTime(), timestamp.getTime());
      }
      assert.strictEqual(editRequest.sourceAgentType, 'code-change');
      assert.strictEqual(editRequest.sourceAgentRunId, 'run-1');
      assert.strictEqual(editRequest.targetPagePath, 'docs/api');
      assert.strictEqual(editRequest.proposedUpdateType, 'update');
      assert.strictEqual(editRequest.proposedContent, '# API Documentation');
      assert.strictEqual(editRequest.confidenceDelta, 0.1);
    });

    it('creates an edit request with story source', () => {
      const source = createStoryEditSource('story-1', 'write');
      const editRequest = createEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source,
        sourceAgentType: 'code-change',
        sourceAgentRunId: 'run-1',
        targetPagePath: 'docs/api',
        proposedUpdateType: 'update',
        proposedContent: '# API Documentation',
        confidenceDelta: 0.1,
      });

      assert.strictEqual(editRequest.source.type, 'story');
      assert.ok(!isCommitEditSource(editRequest.source));
    });

    it('creates an edit request with manual source', () => {
      const source = createManualEditSource('user-1', 'Fix typo');
      const editRequest = createEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source,
        sourceAgentType: 'wiki-editor',
        sourceAgentRunId: 'run-1',
        targetPagePath: 'docs/api',
        proposedUpdateType: 'update',
        proposedContent: '# API Documentation',
        confidenceDelta: 0.1,
      });

      assert.strictEqual(editRequest.source.type, 'manual');
      assert.ok(!isCommitEditSource(editRequest.source));
    });

    it('sets default status to pending', () => {
      const editRequest = createEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source: createCommitEditSource('abc123', new Date()),
        sourceAgentType: 'code-change',
        sourceAgentRunId: 'run-1',
        targetPagePath: 'docs/api',
        proposedUpdateType: 'create',
        proposedContent: 'Content',
        confidenceDelta: 0.1,
      });

      assert.strictEqual(editRequest.status, 'pending');
    });

    it('sets processing fields to null initially', () => {
      const editRequest = createEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source: createCommitEditSource('abc123', new Date()),
        sourceAgentType: 'code-change',
        sourceAgentRunId: 'run-1',
        targetPagePath: 'docs/api',
        proposedUpdateType: 'create',
        proposedContent: 'Content',
        confidenceDelta: 0.1,
      });

      assert.strictEqual(editRequest.processedAt, null);
      assert.strictEqual(editRequest.processingNotes, null);
      assert.strictEqual(editRequest.processedByAgentRunId, null);
    });

    it('sets createdAt to current time', () => {
      const before = Date.now();
      const editRequest = createEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source: createCommitEditSource('abc123', new Date()),
        sourceAgentType: 'code-change',
        sourceAgentRunId: 'run-1',
        targetPagePath: 'docs/api',
        proposedUpdateType: 'create',
        proposedContent: 'Content',
        confidenceDelta: 0.1,
      });
      const after = Date.now();

      assert.ok(editRequest.createdAt instanceof Date);
      assert.ok(editRequest.createdAt.getTime() >= before);
      assert.ok(editRequest.createdAt.getTime() <= after);
    });

    it('includes optional targetPageTitle when provided', () => {
      const editRequest = createEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source: createCommitEditSource('abc123', new Date()),
        sourceAgentType: 'code-change',
        sourceAgentRunId: 'run-1',
        targetPagePath: 'docs/api',
        targetPageTitle: 'API Documentation',
        proposedUpdateType: 'create',
        proposedContent: 'Content',
        confidenceDelta: 0.1,
      });

      assert.strictEqual(editRequest.targetPageTitle, 'API Documentation');
    });

    it('excludes targetPageTitle when not provided', () => {
      const editRequest = createEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source: createCommitEditSource('abc123', new Date()),
        sourceAgentType: 'code-change',
        sourceAgentRunId: 'run-1',
        targetPagePath: 'docs/api',
        proposedUpdateType: 'create',
        proposedContent: 'Content',
        confidenceDelta: 0.1,
      });

      assert.ok(!('targetPageTitle' in editRequest) || editRequest.targetPageTitle === undefined);
    });

    it('includes optional redirectTo when provided', () => {
      const editRequest = createEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source: createCommitEditSource('abc123', new Date()),
        sourceAgentType: 'code-change',
        sourceAgentRunId: 'run-1',
        targetPagePath: 'docs/old-api',
        proposedUpdateType: 'delete',
        proposedContent: '',
        confidenceDelta: 0,
        redirectTo: 'docs/new-api',
      });

      assert.strictEqual(editRequest.redirectTo, 'docs/new-api');
    });

    it('supports all update types', () => {
      const types: Array<'create' | 'update' | 'merge' | 'delete'> = ['create', 'update', 'merge', 'delete'];

      for (const updateType of types) {
        const editRequest = createEditRequest({
          id: `edit-${updateType}`,
          repoId: 'repo-1',
          wikiId: 'wiki-1',
          source: createCommitEditSource('abc123', new Date()),
          sourceAgentType: 'code-change',
          sourceAgentRunId: 'run-1',
          targetPagePath: 'docs/api',
          proposedUpdateType: updateType,
          proposedContent: 'Content',
          confidenceDelta: 0.1,
        });

        assert.strictEqual(editRequest.proposedUpdateType, updateType);
      }
    });

    it('supports different agent types', () => {
      const agentTypes = ['code-change', 'narrative', 'security', 'technical-debt', 'pattern', 'dependency'] as const;

      for (const agentType of agentTypes) {
        const editRequest = createEditRequest({
          id: `edit-${agentType}`,
          repoId: 'repo-1',
          wikiId: 'wiki-1',
          source: createCommitEditSource('abc123', new Date()),
          sourceAgentType: agentType,
          sourceAgentRunId: 'run-1',
          targetPagePath: 'docs/api',
          proposedUpdateType: 'update',
          proposedContent: 'Content',
          confidenceDelta: 0.1,
        });

        assert.strictEqual(editRequest.sourceAgentType, agentType);
      }
    });

    it('includes workItemId when provided for provenance tracking', () => {
      const editRequest = createEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source: createCommitEditSource('abc123', new Date()),
        sourceAgentType: 'code-change',
        sourceAgentRunId: 'run-1',
        workItemId: 'work-item-123',
        targetPagePath: 'docs/api',
        proposedUpdateType: 'create',
        proposedContent: 'Content',
        confidenceDelta: 0.1,
      });

      assert.strictEqual(editRequest.workItemId, 'work-item-123');
    });

    it('sets workItemId to null when not provided', () => {
      const editRequest = createEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source: createCommitEditSource('abc123', new Date()),
        sourceAgentType: 'code-change',
        sourceAgentRunId: 'run-1',
        targetPagePath: 'docs/api',
        proposedUpdateType: 'create',
        proposedContent: 'Content',
        confidenceDelta: 0.1,
      });

      assert.strictEqual(editRequest.workItemId, null);
    });
  });

  describe('wikiPageUpdateToEditRequest', () => {
    it('converts a WikiPageUpdate to an EditRequest with explicit source', () => {
      const timestamp = new Date('2024-01-15T10:00:00Z');
      const source = createCommitEditSource('abc123', timestamp);
      const editRequest = wikiPageUpdateToEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source,
        sourceAgentType: 'code-change',
        sourceAgentRunId: 'run-1',
        update: {
          type: 'update',
          path: 'docs/api',
          title: 'API Docs',
          content: '# API Documentation',
          confidenceDelta: 0.1,
        },
      });

      assert.strictEqual(editRequest.id, 'edit-1');
      assert.strictEqual(editRequest.targetPagePath, 'docs/api');
      assert.strictEqual(editRequest.targetPageTitle, 'API Docs');
      assert.strictEqual(editRequest.proposedUpdateType, 'update');
      assert.strictEqual(editRequest.proposedContent, '# API Documentation');
      assert.strictEqual(editRequest.confidenceDelta, 0.1);
      assert.strictEqual(editRequest.status, 'pending');
      assert.ok(isCommitEditSource(editRequest.source));
      if (isCommitEditSource(editRequest.source)) {
        assert.strictEqual(editRequest.source.commitSha, 'abc123');
      }
    });

    it('handles updates without optional fields', () => {
      const editRequest = wikiPageUpdateToEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source: createCommitEditSource('abc123', new Date()),
        sourceAgentType: 'code-change',
        sourceAgentRunId: 'run-1',
        update: {
          type: 'create',
          path: 'docs/new-page',
          content: 'New content',
          confidenceDelta: 0.5,
        },
      });

      assert.strictEqual(editRequest.targetPagePath, 'docs/new-page');
      assert.ok(!editRequest.targetPageTitle);
      assert.ok(!editRequest.redirectTo);
    });

    it('includes redirectTo for delete operations', () => {
      const editRequest = wikiPageUpdateToEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source: createCommitEditSource('abc123', new Date()),
        sourceAgentType: 'code-change',
        sourceAgentRunId: 'run-1',
        update: {
          type: 'delete',
          path: 'docs/old-page',
          content: '',
          confidenceDelta: 0,
          redirectTo: 'docs/new-page',
        },
      });

      assert.strictEqual(editRequest.proposedUpdateType, 'delete');
      assert.strictEqual(editRequest.redirectTo, 'docs/new-page');
    });

    it('includes workItemId when provided for provenance tracking', () => {
      const editRequest = wikiPageUpdateToEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source: createCommitEditSource('abc123', new Date()),
        sourceAgentType: 'code-change',
        sourceAgentRunId: 'run-1',
        workItemId: 'work-item-456',
        update: {
          type: 'update',
          path: 'docs/api',
          content: '# API',
          confidenceDelta: 0.1,
        },
      });

      assert.strictEqual(editRequest.workItemId, 'work-item-456');
    });

    it('supports story source for wiki page updates', () => {
      const source = createStoryEditSource('story-42', 'write');
      const editRequest = wikiPageUpdateToEditRequest({
        id: 'edit-1',
        repoId: 'repo-1',
        wikiId: 'wiki-1',
        source,
        sourceAgentType: 'code-change',
        sourceAgentRunId: 'run-1',
        update: {
          type: 'create',
          path: 'docs/new-feature',
          content: '# New Feature',
          confidenceDelta: 0.8,
        },
      });

      assert.strictEqual(editRequest.source.type, 'story');
      assert.ok(!isCommitEditSource(editRequest.source));
    });
  });
});
