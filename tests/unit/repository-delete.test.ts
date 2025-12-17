/**
 * Unit tests for DeleteRepository CQRS command.
 * Tests the command in isolation with mock repositories.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { v4 as uuid } from 'uuid';
import {
  createDeleteRepositoryCommand,
  handleDeleteRepository,
} from '../../src/commands/repository.js';
import { createRepo, type Repo } from '../../src/domain/repo.js';
import { createWiki, type Wiki } from '../../src/domain/wiki.js';
import type { WikiPage } from '../../src/domain/wiki-page.js';
import type { Commit } from '../../src/domain/commit.js';
import type { AgentRun } from '../../src/domain/agent-run.js';
import type { ProcessingRun } from '../../src/domain/processing-run.js';
import type { Repositories } from '../../src/repositories/index.js';

// Create a mock repositories object for testing cascade deletion
function createMockRepos(): Repositories {
  const repos = new Map<string, Repo>();
  const wikis = new Map<string, Wiki>();
  const wikiPages = new Map<string, WikiPage>();
  const commits = new Map<string, Commit>();
  const agentRuns = new Map<string, AgentRun>();
  const processingRuns = new Map<string, ProcessingRun>();
  const benchmarks = new Map<string, unknown>();
  const qualityBenchmarks = new Map<string, unknown>();
  const chatSessions = new Map<string, unknown>();
  const learnings = new Map<string, unknown>();
  const workQueue = new Map<string, unknown>();
  const selfImprovements = new Map<string, unknown>();
  const findings = new Map<string, unknown>();
  const conflicts = new Map<string, unknown>();

  const mockRepos: Repositories['repos'] = {
    findById: async (id) => repos.get(id) ?? null,
    findByFullName: async () => null,
    findAll: async () => Array.from(repos.values()),
    findByStatus: async () => [],
    save: async (repo) => { repos.set(repo.id, repo); },
    delete: async (id) => { repos.delete(id); },
    updateStatus: async () => {},
  };

  const mockWikis: Repositories['wikis'] = {
    findById: async (id) => wikis.get(id) ?? null,
    findBySlug: async () => null,
    findByRepo: async (repoId) => {
      return Array.from(wikis.values()).filter(w => w.repoId === repoId);
    },
    findActive: async () => null,
    findByStatus: async () => [],
    save: async (wiki) => { wikis.set(wiki.id, wiki); },
    delete: async (id) => { wikis.delete(id); },
    deleteByRepo: async (repoId) => {
      for (const [id, wiki] of wikis) {
        if (wiki.repoId === repoId) wikis.delete(id);
      }
    },
    setActive: async () => {},
    updateStatus: async () => {},
    updateLastProcessedCommit: async () => {},
    incrementIterations: async () => {},
  };

  const mockWikiPages: Repositories['wikiPages'] = {
    findById: async () => null,
    findByPath: async () => null,
    findByWiki: async (wikiId) => {
      return Array.from(wikiPages.values()).filter(p => p.wikiId === wikiId);
    },
    findByStatus: async () => [],
    countByWiki: async (wikiId) => {
      return Array.from(wikiPages.values()).filter(p => p.wikiId === wikiId).length;
    },
    search: async () => [],
    save: async (page) => { wikiPages.set(page.id, page); },
    delete: async (id) => { wikiPages.delete(id); },
    deleteByWiki: async (wikiId) => {
      for (const [id, page] of wikiPages) {
        if (page.wikiId === wikiId) wikiPages.delete(id);
      }
    },
    bulkUpdateStatus: async () => {},
  };

  const mockCommits: Repositories['commits'] = {
    findById: async () => null,
    findByRepo: async (repoId) => {
      return Array.from(commits.values()).filter(c => c.repoId === repoId);
    },
    findBySha: async () => null,
    findByRepoAndBranch: async () => [],
    findUnprocessedByRepoAndBranch: async () => [],
    countByRepo: async (repoId) => {
      return Array.from(commits.values()).filter(c => c.repoId === repoId).length;
    },
    findLatestByRepo: async () => null,
    save: async (commit) => { commits.set(commit.id, commit); },
    saveMany: async (newCommits) => {
      for (const c of newCommits) commits.set(c.id, c);
    },
    delete: async (id) => { commits.delete(id); },
    deleteByRepo: async (repoId) => {
      for (const [id, commit] of commits) {
        if (commit.repoId === repoId) commits.delete(id);
      }
    },
    addProcessingRecord: async () => {},
  };

  const mockAgentRuns: Repositories['agentRuns'] = {
    findById: async () => null,
    findByWiki: async () => [],
    findByCommit: async () => [],
    findByRepo: async (repoId) => {
      return Array.from(agentRuns.values()).filter((r: AgentRun) => r.repoId === repoId);
    },
    findByStatus: async () => [],
    findLatestByWiki: async () => null,
    save: async (run) => { agentRuns.set(run.id, run as AgentRun); },
    updateStatus: async () => {},
    setEndTime: async () => {},
    incrementIterations: async () => {},
    delete: async (id) => { agentRuns.delete(id); },
    deleteByRepo: async (repoId) => {
      for (const [id, run] of agentRuns) {
        if ((run as AgentRun).repoId === repoId) agentRuns.delete(id);
      }
    },
  };

  const mockProcessingRuns: Repositories['processingRuns'] = {
    findById: async () => null,
    findByRepo: async (repoId) => {
      return Array.from(processingRuns.values()).filter((r: ProcessingRun) => r.repoId === repoId);
    },
    findByStatus: async () => [],
    findLatestByRepo: async () => null,
    save: async (run) => { processingRuns.set(run.id, run as ProcessingRun); },
    updateStatus: async () => {},
    setEndTime: async () => {},
    delete: async (id) => { processingRuns.delete(id); },
    deleteByRepo: async (repoId) => {
      for (const [id, run] of processingRuns) {
        if ((run as ProcessingRun).repoId === repoId) processingRuns.delete(id);
      }
    },
  };

  const mockBenchmarks: Repositories['benchmarks'] = {
    findById: async () => null,
    findByRepo: async () => [],
    findByWiki: async () => [],
    findLatest: async () => null,
    findLatestByRepo: async () => null,
    findLatestByWiki: async () => null,
    save: async (b) => { benchmarks.set((b as { id: string }).id, b); },
    delete: async (id) => { benchmarks.delete(id); },
    deleteByRepo: async (repoId) => {
      for (const [id, b] of benchmarks) {
        if ((b as { repoId: string }).repoId === repoId) benchmarks.delete(id);
      }
    },
    deleteByWiki: async () => {},
  };

  const mockQualityBenchmarks: Repositories['qualityBenchmarks'] = {
    findById: async () => null,
    findByRepo: async () => [],
    findByWiki: async () => [],
    findLatest: async () => null,
    findLatestByRepo: async () => null,
    findLatestByWiki: async () => null,
    save: async (b) => { qualityBenchmarks.set((b as { id: string }).id, b); },
    delete: async (id) => { qualityBenchmarks.delete(id); },
    deleteByRepo: async (repoId) => {
      for (const [id, b] of qualityBenchmarks) {
        if ((b as { repoId: string }).repoId === repoId) qualityBenchmarks.delete(id);
      }
    },
    deleteByWiki: async () => {},
  };

  const mockChatSessions: Repositories['chatSessions'] = {
    findById: async () => null,
    findByRepo: async () => [],
    findByUser: async () => [],
    findRecent: async () => [],
    save: async (s) => { chatSessions.set((s as { id: string }).id, s); },
    delete: async (id) => { chatSessions.delete(id); },
    deleteByRepo: async (repoId) => {
      for (const [id, s] of chatSessions) {
        if ((s as { repoId: string }).repoId === repoId) chatSessions.delete(id);
      }
    },
    addMessage: async () => {},
  };

  const mockLearnings: Repositories['learnings'] = {
    findById: async () => null,
    findByRepo: async () => [],
    findByType: async () => [],
    findRecent: async () => [],
    save: async (l) => { learnings.set((l as { id: string }).id, l); },
    delete: async (id) => { learnings.delete(id); },
    deleteByRepo: async (repoId) => {
      for (const [id, l] of learnings) {
        if ((l as { repoId: string }).repoId === repoId) learnings.delete(id);
      }
    },
  };

  const mockWorkQueue: Repositories['workQueue'] = {
    findById: async () => null,
    findByRepo: async () => [],
    findPending: async () => [],
    findByStatus: async () => [],
    save: async (w) => { workQueue.set((w as { id: string }).id, w); },
    delete: async (id) => { workQueue.delete(id); },
    deleteByRepo: async (repoId) => {
      for (const [id, w] of workQueue) {
        if ((w as { repoId: string }).repoId === repoId) workQueue.delete(id);
      }
    },
    updateStatus: async () => {},
    claim: async () => null,
  };

  const mockSelfImprovements: Repositories['selfImprovements'] = {
    findById: async () => null,
    findByRepo: async () => [],
    findPending: async () => [],
    save: async (s) => { selfImprovements.set((s as { id: string }).id, s); },
    delete: async (id) => { selfImprovements.delete(id); },
    deleteByRepo: async (repoId) => {
      for (const [id, s] of selfImprovements) {
        if ((s as { repoId: string }).repoId === repoId) selfImprovements.delete(id);
      }
    },
    updateStatus: async () => {},
  };

  const mockFindings: Repositories['findings'] = {
    findById: async () => null,
    findByWiki: async (wikiId) => {
      return Array.from(findings.values()).filter((f: unknown) => (f as { wikiId: string }).wikiId === wikiId);
    },
    findByPage: async () => [],
    findByType: async () => [],
    findByStatus: async () => [],
    save: async (f) => { findings.set((f as { id: string }).id, f); },
    delete: async (id) => { findings.delete(id); },
    deleteByWiki: async (wikiId) => {
      for (const [id, f] of findings) {
        if ((f as { wikiId: string }).wikiId === wikiId) findings.delete(id);
      }
    },
    updateStatus: async () => {},
  };

  const mockConflicts: Repositories['conflicts'] = {
    findById: async () => null,
    findByWiki: async (wikiId) => {
      return Array.from(conflicts.values()).filter((c: unknown) => (c as { wikiId: string }).wikiId === wikiId);
    },
    findByPage: async () => [],
    findUnresolved: async () => [],
    save: async (c) => { conflicts.set((c as { id: string }).id, c); },
    delete: async (id) => { conflicts.delete(id); },
    deleteByWiki: async (wikiId) => {
      for (const [id, c] of conflicts) {
        if ((c as { wikiId: string }).wikiId === wikiId) conflicts.delete(id);
      }
    },
    resolve: async () => {},
  };

  // Stub repositories that don't have deleteByRepo
  const mockOrchestratorRuns: Repositories['orchestratorRuns'] = {
    findById: async () => null,
    findByRepo: async () => [],
    findByStatus: async () => [],
    findLatestByRepo: async () => null,
    save: async () => {},
    updateStatus: async () => {},
    setEndTime: async () => {},
    delete: async () => {},
  };

  const mockIterations: Repositories['iterations'] = {
    findById: async () => null,
    findByRun: async () => [],
    findByWiki: async () => [],
    save: async () => {},
    delete: async () => {},
  };

  const mockUsers: Repositories['users'] = {
    findById: async () => null,
    findByGithubId: async () => null,
    findByUsername: async () => null,
    save: async () => {},
    delete: async () => {},
  };

  return {
    repos: mockRepos,
    wikis: mockWikis,
    wikiPages: mockWikiPages,
    commits: mockCommits,
    agentRuns: mockAgentRuns,
    processingRuns: mockProcessingRuns,
    benchmarks: mockBenchmarks,
    qualityBenchmarks: mockQualityBenchmarks,
    chatSessions: mockChatSessions,
    learnings: mockLearnings,
    workQueue: mockWorkQueue,
    selfImprovements: mockSelfImprovements,
    findings: mockFindings,
    conflicts: mockConflicts,
    orchestratorRuns: mockOrchestratorRuns,
    iterations: mockIterations,
    users: mockUsers,
  } as Repositories;
}

describe('DeleteRepository Command', () => {
  it('deletes a repository that exists', async () => {
    const mockRepos = createMockRepos();
    const repoId = uuid();

    const repo = createRepo({
      id: repoId,
      fullName: 'test/repo',
      cloneUrl: '/path/to/repo',
      defaultBranch: 'main',
    });
    await mockRepos.repos.save(repo);

    const command = createDeleteRepositoryCommand(repoId);
    const result = await handleDeleteRepository(command, mockRepos);

    assert.strictEqual(result.success, true);

    const deleted = await mockRepos.repos.findById(repoId);
    assert.strictEqual(deleted, null);
  });

  it('fails when repository does not exist', async () => {
    const mockRepos = createMockRepos();

    const command = createDeleteRepositoryCommand('nonexistent');
    const result = await handleDeleteRepository(command, mockRepos);

    assert.strictEqual(result.success, false);
    assert.ok(result.error?.includes('not found'));
  });

  it('has correct command type', () => {
    const command = createDeleteRepositoryCommand('repo-1');
    assert.strictEqual(command.type, 'DeleteRepository');
    assert.strictEqual(command.repoId, 'repo-1');
  });

  describe('cascade deletion', () => {
    it('deletes all wikis for the repository', async () => {
      const mockRepos = createMockRepos();
      const repoId = uuid();

      const repo = createRepo({
        id: repoId,
        fullName: 'test/repo',
        cloneUrl: '/path/to/repo',
        defaultBranch: 'main',
      });
      await mockRepos.repos.save(repo);

      // Create wikis for this repo
      const wiki1 = createWiki({ id: uuid(), repoId, name: 'Wiki 1' });
      const wiki2 = createWiki({ id: uuid(), repoId, name: 'Wiki 2' });
      await mockRepos.wikis.save(wiki1);
      await mockRepos.wikis.save(wiki2);

      // Verify wikis exist
      const wikisBefore = await mockRepos.wikis.findByRepo(repoId);
      assert.strictEqual(wikisBefore.length, 2);

      const command = createDeleteRepositoryCommand(repoId);
      const result = await handleDeleteRepository(command, mockRepos);

      assert.strictEqual(result.success, true);

      // Verify wikis are deleted
      const wikisAfter = await mockRepos.wikis.findByRepo(repoId);
      assert.strictEqual(wikisAfter.length, 0);
    });

    it('deletes all wiki pages for each wiki', async () => {
      const mockRepos = createMockRepos();
      const repoId = uuid();
      const wikiId = uuid();

      const repo = createRepo({
        id: repoId,
        fullName: 'test/repo',
        cloneUrl: '/path/to/repo',
        defaultBranch: 'main',
      });
      await mockRepos.repos.save(repo);

      const wiki = createWiki({ id: wikiId, repoId, name: 'Test Wiki' });
      await mockRepos.wikis.save(wiki);

      // Create wiki pages
      const page1: WikiPage = {
        id: uuid(),
        wikiId,
        path: 'test/page1',
        title: 'Page 1',
        content: 'Content 1',
        summary: '',
        confidence: 0.8,
        lastUpdatedBy: 'code-change',
        lastCommitSha: null,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const page2: WikiPage = {
        id: uuid(),
        wikiId,
        path: 'test/page2',
        title: 'Page 2',
        content: 'Content 2',
        summary: '',
        confidence: 0.9,
        lastUpdatedBy: 'code-change',
        lastCommitSha: null,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await mockRepos.wikiPages.save(page1);
      await mockRepos.wikiPages.save(page2);

      // Verify pages exist
      const pagesBefore = await mockRepos.wikiPages.findByWiki(wikiId);
      assert.strictEqual(pagesBefore.length, 2);

      const command = createDeleteRepositoryCommand(repoId);
      const result = await handleDeleteRepository(command, mockRepos);

      assert.strictEqual(result.success, true);

      // Verify pages are deleted
      const pagesAfter = await mockRepos.wikiPages.findByWiki(wikiId);
      assert.strictEqual(pagesAfter.length, 0);
    });

    it('deletes all commits for the repository', async () => {
      const mockRepos = createMockRepos();
      const repoId = uuid();

      const repo = createRepo({
        id: repoId,
        fullName: 'test/repo',
        cloneUrl: '/path/to/repo',
        defaultBranch: 'main',
      });
      await mockRepos.repos.save(repo);

      // Create commits
      const commit1: Commit = {
        id: uuid(),
        repoId,
        sha: 'abc123',
        message: 'First commit',
        author: 'test',
        authorEmail: 'test@test.com',
        date: new Date(),
        branch: 'main',
        filesChanged: [],
        agentProcessing: [],
      };
      const commit2: Commit = {
        id: uuid(),
        repoId,
        sha: 'def456',
        message: 'Second commit',
        author: 'test',
        authorEmail: 'test@test.com',
        date: new Date(),
        branch: 'main',
        filesChanged: [],
        agentProcessing: [],
      };
      await mockRepos.commits.save(commit1);
      await mockRepos.commits.save(commit2);

      // Verify commits exist
      const commitsBefore = await mockRepos.commits.findByRepo(repoId);
      assert.strictEqual(commitsBefore.length, 2);

      const command = createDeleteRepositoryCommand(repoId);
      const result = await handleDeleteRepository(command, mockRepos);

      assert.strictEqual(result.success, true);

      // Verify commits are deleted
      const commitsAfter = await mockRepos.commits.findByRepo(repoId);
      assert.strictEqual(commitsAfter.length, 0);
    });

    it('deletes all agent runs for the repository', async () => {
      const mockRepos = createMockRepos();
      const repoId = uuid();

      const repo = createRepo({
        id: repoId,
        fullName: 'test/repo',
        cloneUrl: '/path/to/repo',
        defaultBranch: 'main',
      });
      await mockRepos.repos.save(repo);

      // Create agent run
      const agentRun: AgentRun = {
        id: uuid(),
        repoId,
        wikiId: 'wiki-1',
        commitId: 'commit-1',
        agentType: 'code-change',
        status: 'completed',
        startTime: new Date(),
        endTime: new Date(),
        iterations: 5,
      };
      await mockRepos.agentRuns.save(agentRun);

      // Verify agent run exists
      const runsBefore = await mockRepos.agentRuns.findByRepo(repoId);
      assert.strictEqual(runsBefore.length, 1);

      const command = createDeleteRepositoryCommand(repoId);
      const result = await handleDeleteRepository(command, mockRepos);

      assert.strictEqual(result.success, true);

      // Verify agent runs are deleted
      const runsAfter = await mockRepos.agentRuns.findByRepo(repoId);
      assert.strictEqual(runsAfter.length, 0);
    });

    it('deletes all processing runs for the repository', async () => {
      const mockRepos = createMockRepos();
      const repoId = uuid();

      const repo = createRepo({
        id: repoId,
        fullName: 'test/repo',
        cloneUrl: '/path/to/repo',
        defaultBranch: 'main',
      });
      await mockRepos.repos.save(repo);

      // Create processing run
      const processingRun: ProcessingRun = {
        id: uuid(),
        repoId,
        wikiId: 'wiki-1',
        status: 'completed',
        startTime: new Date(),
        endTime: new Date(),
        commitsProcessed: 10,
        pagesCreated: 5,
        pagesUpdated: 3,
      };
      await mockRepos.processingRuns.save(processingRun);

      // Verify processing run exists
      const runsBefore = await mockRepos.processingRuns.findByRepo(repoId);
      assert.strictEqual(runsBefore.length, 1);

      const command = createDeleteRepositoryCommand(repoId);
      const result = await handleDeleteRepository(command, mockRepos);

      assert.strictEqual(result.success, true);

      // Verify processing runs are deleted
      const runsAfter = await mockRepos.processingRuns.findByRepo(repoId);
      assert.strictEqual(runsAfter.length, 0);
    });

    it('deletes findings for each wiki', async () => {
      const mockRepos = createMockRepos();
      const repoId = uuid();
      const wikiId = uuid();

      const repo = createRepo({
        id: repoId,
        fullName: 'test/repo',
        cloneUrl: '/path/to/repo',
        defaultBranch: 'main',
      });
      await mockRepos.repos.save(repo);

      const wiki = createWiki({ id: wikiId, repoId, name: 'Test Wiki' });
      await mockRepos.wikis.save(wiki);

      // Create finding
      await mockRepos.findings.save({
        id: uuid(),
        wikiId,
        pageId: 'page-1',
        type: 'suggestion',
        content: 'Test finding',
        status: 'pending',
        createdAt: new Date(),
      });

      // Verify finding exists
      const findingsBefore = await mockRepos.findings.findByWiki(wikiId);
      assert.strictEqual(findingsBefore.length, 1);

      const command = createDeleteRepositoryCommand(repoId);
      const result = await handleDeleteRepository(command, mockRepos);

      assert.strictEqual(result.success, true);

      // Verify findings are deleted
      const findingsAfter = await mockRepos.findings.findByWiki(wikiId);
      assert.strictEqual(findingsAfter.length, 0);
    });

    it('deletes conflicts for each wiki', async () => {
      const mockRepos = createMockRepos();
      const repoId = uuid();
      const wikiId = uuid();

      const repo = createRepo({
        id: repoId,
        fullName: 'test/repo',
        cloneUrl: '/path/to/repo',
        defaultBranch: 'main',
      });
      await mockRepos.repos.save(repo);

      const wiki = createWiki({ id: wikiId, repoId, name: 'Test Wiki' });
      await mockRepos.wikis.save(wiki);

      // Create conflict
      await mockRepos.conflicts.save({
        id: uuid(),
        wikiId,
        pageId: 'page-1',
        conflictType: 'content',
        description: 'Test conflict',
        resolved: false,
        createdAt: new Date(),
      });

      // Verify conflict exists
      const conflictsBefore = await mockRepos.conflicts.findByWiki(wikiId);
      assert.strictEqual(conflictsBefore.length, 1);

      const command = createDeleteRepositoryCommand(repoId);
      const result = await handleDeleteRepository(command, mockRepos);

      assert.strictEqual(result.success, true);

      // Verify conflicts are deleted
      const conflictsAfter = await mockRepos.conflicts.findByWiki(wikiId);
      assert.strictEqual(conflictsAfter.length, 0);
    });

    it('does not affect other repositories', async () => {
      const mockRepos = createMockRepos();
      const repoId1 = uuid();
      const repoId2 = uuid();

      // Create two repositories
      const repo1 = createRepo({
        id: repoId1,
        fullName: 'test/repo1',
        cloneUrl: '/path/to/repo1',
        defaultBranch: 'main',
      });
      const repo2 = createRepo({
        id: repoId2,
        fullName: 'test/repo2',
        cloneUrl: '/path/to/repo2',
        defaultBranch: 'main',
      });
      await mockRepos.repos.save(repo1);
      await mockRepos.repos.save(repo2);

      // Create wikis for both repos
      const wiki1 = createWiki({ id: uuid(), repoId: repoId1, name: 'Wiki 1' });
      const wiki2 = createWiki({ id: uuid(), repoId: repoId2, name: 'Wiki 2' });
      await mockRepos.wikis.save(wiki1);
      await mockRepos.wikis.save(wiki2);

      // Delete only repo1
      const command = createDeleteRepositoryCommand(repoId1);
      const result = await handleDeleteRepository(command, mockRepos);

      assert.strictEqual(result.success, true);

      // Verify repo1 and its wiki are deleted
      assert.strictEqual(await mockRepos.repos.findById(repoId1), null);
      assert.strictEqual((await mockRepos.wikis.findByRepo(repoId1)).length, 0);

      // Verify repo2 and its wiki still exist
      assert.notStrictEqual(await mockRepos.repos.findById(repoId2), null);
      assert.strictEqual((await mockRepos.wikis.findByRepo(repoId2)).length, 1);
    });
  });
});
