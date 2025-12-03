/**
 * Playwright global setup for E2E tests.
 *
 * Uses CQRS commands to set up test data before any E2E tests run.
 * This ensures tests have the required data (repos, wikis, wiki pages)
 * without needing to mock or skip.
 */

import { createRepositories } from '../../src/repositories/index.js';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import {
  createUpdateWikiPageCommand,
  handleUpdateWikiPage,
} from '../../src/commands/update-wiki-page.js';
import {
  createRegisterRepositoryCommand,
  handleRegisterRepository,
} from '../../src/commands/repository.js';
import { v4 as uuid } from 'uuid';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import * as git from 'isomorphic-git';
import * as fs from 'fs';

/**
 * Test wiki pages with nested structure.
 * These provide the data needed for wiki browser tests including:
 * - Multiple pages (for pagination/listing)
 * - Nested paths (for tree expand/collapse tests)
 * - Varying content (for search tests)
 */
const TEST_WIKI_PAGES = [
  {
    path: 'overview',
    content: `# Project Overview

This is the main overview page for the project.

## Summary

The project provides a comprehensive solution for documentation generation.

## Key Features

- Automated wiki generation
- Confidence scoring
- Source tracking
`,
  },
  {
    path: 'architecture/overview',
    content: `# Architecture Overview

High-level system architecture documentation.

## Components

The system consists of several key components:
- Web Server
- CQRS Layer
- Repository Layer
- Agent System

## Design Principles

We follow clean architecture principles with clear separation of concerns.
`,
  },
  {
    path: 'architecture/patterns',
    content: `# Design Patterns

Common design patterns used in the codebase.

## CQRS

Command Query Responsibility Segregation separates reads from writes.

## Repository Pattern

Data access is abstracted behind repository interfaces.

## Agent Pattern

Autonomous agents process work items from a queue.
`,
  },
  {
    path: 'api/endpoints',
    content: `# API Endpoints

REST API documentation.

## Repositories

- GET /api/repos - List all repositories
- POST /api/repos - Add a new repository
- GET /api/repos/:id - Get repository details

## Wiki

- GET /api/repos/:id/wiki - Get wiki pages
- GET /api/repos/:id/wiki-tree - Get wiki tree structure
`,
  },
  {
    path: 'api/authentication',
    content: `# Authentication

API authentication documentation.

## Password Protection

The API supports optional password protection for all endpoints.

## Configuration

Set the PASSWORD environment variable to enable protection.
`,
  },
];

export default async function globalSetup(): Promise<void> {
  console.log('[E2E Setup] Initializing test data using CQRS...');

  const connection = await createRepositories();
  const repos = connection.repositories;

  try {
    // Step 0: Clean up any existing repos from previous test runs
    // This ensures test isolation when using persistent storage (MongoDB)
    const existingRepos = await repos.repos.findAll();
    if (existingRepos.length > 0) {
      console.log(`[E2E Setup] Cleaning up ${existingRepos.length} existing repos from previous runs...`);
      for (const repo of existingRepos) {
        // Delete associated data
        await repos.wikis.deleteByRepo(repo.id);
        await repos.commits.deleteByRepo(repo.id);
        await repos.agentRuns.deleteByRepo(repo.id);
        await repos.workQueue.deleteByRepo(repo.id);
        await repos.processingRuns.deleteByRepo(repo.id);
        await repos.repos.delete(repo.id);
      }
    }

    // Step 1: Create a fresh repository
    let repoList = await repos.repos.findAll();
    let repo = repoList[0];

    if (!repo) {
      console.log('[E2E Setup] No repository found, creating one...');
      const repoId = uuid();
      const registerCmd = createRegisterRepositoryCommand({
        id: repoId,
        fullName: process.cwd(), // Use current working directory
        cloneUrl: process.cwd(),
        defaultBranch: 'main',
      });
      const result = await handleRegisterRepository(registerCmd, repos);
      if (!result.success) {
        console.error('[E2E Setup] Failed to create repository:', result.error);
        return;
      }
      repo = result.data!;
      // Update status to ready
      await repos.repos.updateStatus(repo.id, 'ready');
      console.log('[E2E Setup] Created repository:', repo.id);
    } else {
      console.log('[E2E Setup] Using existing repository:', repo.id);
    }

    // Step 2: Get or create the active wiki
    const wiki = await getOrCreateActiveWiki(repo.id, repos);
    console.log('[E2E Setup] Using wiki:', wiki.id);

    // Step 3: Check existing pages and create missing ones
    const existingPages = await repos.wikiPages.findByWiki(wiki.id);
    const existingPaths = new Set(existingPages.map(p => p.path));

    let createdCount = 0;
    for (const page of TEST_WIKI_PAGES) {
      if (existingPaths.has(page.path)) {
        continue; // Skip existing pages
      }

      const cmd = createUpdateWikiPageCommand({
        type: 'create',
        path: page.path,
        content: page.content,
        agentRunId: 'e2e-test-setup',
        confidenceDelta: 0.3, // Give test pages decent confidence
      });

      const result = await handleUpdateWikiPage(cmd, repos, wiki.id);
      if (result.success) {
        createdCount++;
      } else {
        console.warn(`[E2E Setup] Failed to create page ${page.path}:`, result.error);
      }
    }

    const totalPages = existingPages.length + createdCount;
    console.log(`[E2E Setup] Wiki now has ${totalPages} pages (created ${createdCount} new)`);

    // Step 4: Create a test git repository under $HOME for folder browser tests
    // The folder browser starts at $HOME and is sandboxed there, so we need a git repo
    // that's visible from within that directory.
    await createTestGitRepo();

    console.log('[E2E Setup] Test data setup complete!');
  } finally {
    await connection.close();
  }
}

/**
 * Create a test git repository under $HOME for the folder browser test.
 * This ensures there's at least one git repo visible when the folder browser opens.
 */
async function createTestGitRepo(): Promise<void> {
  const testRepoPath = join(homedir(), 'e2e-test-repo');

  try {
    // Create the directory
    await mkdir(testRepoPath, { recursive: true });

    // Check if already initialized
    try {
      await git.findRoot({ fs, filepath: testRepoPath });
      console.log('[E2E Setup] Test git repo already exists at:', testRepoPath);
      return;
    } catch {
      // Not a git repo yet, continue to initialize
    }

    await git.init({ fs, dir: testRepoPath });
    await git.setConfig({ fs, dir: testRepoPath, path: 'user.email', value: 'test@example.com' });
    await git.setConfig({ fs, dir: testRepoPath, path: 'user.name', value: 'Test User' });

    // Create a README file
    await writeFile(join(testRepoPath, 'README.md'), '# E2E Test Repository\n\nThis is a test repository for E2E tests.\n');

    await git.add({ fs, dir: testRepoPath, filepath: 'README.md' });
    await git.commit({
      fs,
      dir: testRepoPath,
      message: 'Initial commit',
      author: { name: 'Test User', email: 'test@example.com' },
    });

    console.log('[E2E Setup] Created test git repo at:', testRepoPath);
  } catch (error) {
    console.warn('[E2E Setup] Failed to create test git repo:', error);
    // Don't fail the entire setup, just warn
  }
}
