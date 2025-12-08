/**
 * Test context helpers for LLM tests.
 * Similar to integration test context but uses real LLM service.
 */

import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import * as git from 'isomorphic-git';
import * as fs from 'fs';
import { createRepositories, type Repositories } from '../../../src/repositories/index.js';
import { FileSystemGitService } from '../../../src/services/git/git-service.js';
import { createRepositoryServiceFactory } from '../../../src/services/repository/repository-service.js';
import { createUnifiedRepoAccessFactory } from '../../../src/services/repository/unified-repo-access.js';
import { createOpenRouterLLM } from '../../../src/services/llm/openrouter-llm-service.js';
import { clearIgnoreCache } from '../../../src/services/cwignore.js';
import { getOrCreateActiveWiki } from '../../../src/commands/create-wiki.js';
import type { AgentContext } from '../../../src/agents/base-agent.js';
import type { LLMService } from '../../../src/services/llm/llm-service.js';

export interface LLMTestContext {
  /** Base directory for all test data */
  baseDir: string;
  /** Directory for wiki data storage */
  dataDir: string;
  /** Directory for git repositories */
  reposDir: string;
  /** Real file-based repositories */
  repos: Repositories;
  /** Real git service */
  git: FileSystemGitService;
  /** Real LLM service */
  llm: LLMService;
  /** Create an AgentContext for a repo (auto-creates wiki if needed) */
  agentContext(repoId: string): Promise<AgentContext>;
  /** Clean up all test data */
  cleanup(): Promise<void>;
}

/**
 * Create a test context with real LLM service.
 *
 * Uses the OpenRouter LLM service configured via environment variables.
 */
export async function createLLMTestContext(): Promise<LLMTestContext> {
  const baseDir = await mkdtemp(join(tmpdir(), 'codewiki-llm-test-'));
  const dataDir = join(baseDir, 'data');
  const reposDir = join(baseDir, 'repos');

  await mkdir(dataDir, { recursive: true });
  await mkdir(reposDir, { recursive: true });

  const connection = await createRepositories({ fileBasePath: dataDir });
  const repos = connection.repositories;
  const gitService = new FileSystemGitService(reposDir);
  const llm = createOpenRouterLLM();

  // Create repository access factories for unified repo access
  const repoServiceFactory = createRepositoryServiceFactory({ gitService });
  const repoAccessFactory = createUnifiedRepoAccessFactory({
    repos,
    repoServiceFactory,
    gitService,
  });

  return {
    baseDir,
    dataDir,
    reposDir,
    repos,
    git: gitService,
    llm,
    async agentContext(repoId: string): Promise<AgentContext> {
      const wiki = await getOrCreateActiveWiki(repoId, repos);

      // Create unified repo access for this repo
      let repoAccess;
      try {
        repoAccess = await repoAccessFactory.create(repoId);
      } catch {
        // Continue without repoAccess if creation fails
      }

      return {
        repoId,
        wikiId: wiki.id,
        repos,
        llm,
        ...(repoAccess && { repoAccess }),
      };
    },
    async cleanup(): Promise<void> {
      clearIgnoreCache();
      await connection.close();
      await rm(baseDir, { recursive: true, force: true });
    },
  };
}

/**
 * Create a test git repository with some commits.
 */
export async function createTestRepo(
  ctx: LLMTestContext,
  repoId: string,
  files: Record<string, string> = {}
): Promise<string> {
  const repoPath = join(ctx.reposDir, repoId);
  await mkdir(repoPath, { recursive: true });

  await git.init({ fs, dir: repoPath });
  await git.setConfig({ fs, dir: repoPath, path: 'user.email', value: 'test@example.com' });
  await git.setConfig({ fs, dir: repoPath, path: 'user.name', value: 'Test User' });

  const filesToCreate = Object.keys(files).length > 0
    ? files
    : { 'README.md': '# Test Repo\n\nThis is a test repository.' };

  for (const [path, content] of Object.entries(filesToCreate)) {
    const fullPath = join(repoPath, path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (dir !== repoPath && dir.length > 0) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(fullPath, content);
    await git.add({ fs, dir: repoPath, filepath: path });
  }

  await git.commit({
    fs,
    dir: repoPath,
    message: 'Initial commit',
    author: { name: 'Test User', email: 'test@example.com' },
  });

  // Register repo with git service for local access
  ctx.git.registerLocalRepo(repoId, repoPath);

  await ctx.repos.repos.save({
    id: repoId,
    fullName: `test/${repoId}`,
    cloneUrl: repoPath,
    defaultBranch: 'main',
    status: 'ready',
    config: {
      throttle: { maxCallsPerMinute: 100, maxCostPerHour: 10 },
      enabledAgents: ['security'],
    },
    createdAt: new Date(),
    lastProcessedAt: null,
  });

  return repoPath;
}

/**
 * Add a commit to a test repository and register it.
 */
export async function addCommit(
  ctx: LLMTestContext,
  repoId: string,
  files: Record<string, string>,
  message: string
): Promise<string> {
  const repoPath = join(ctx.reposDir, repoId);

  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(repoPath, path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (dir !== repoPath && dir.length > 0) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(fullPath, content);
    await git.add({ fs, dir: repoPath, filepath: path });
  }

  const sha = await git.commit({
    fs,
    dir: repoPath,
    message,
    author: { name: 'Test User', email: 'test@example.com' },
  });

  // Also save the commit to the repository so the agent can find it
  await ctx.repos.commits.save({
    id: sha,
    repoId,
    sha,
    message,
    authorName: 'Test User',
    authorEmail: 'test@example.com',
    committedAt: new Date(),
    diffSummary: {
      filesAdded: Object.keys(files).length,
      filesModified: 0,
      filesDeleted: 0,
      linesAdded: Object.values(files).reduce((sum, content) => sum + content.split('\n').length, 0),
      linesDeleted: 0,
      affectedFiles: Object.keys(files),
    },
    processedBy: [],
    createdAt: new Date(),
  });

  return sha;
}
