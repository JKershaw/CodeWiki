/**
 * Integration tests for Coverage API endpoint.
 * Tests the /api/repos/:id/coverage endpoint for file/folder coverage metrics.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer, type Server } from 'http';
import { createTestContext, createTestRepo, type TestContext } from '../helpers/index.js';
import express from 'express';
import { v4 as uuid } from 'uuid';
import { getOrCreateActiveWiki } from '../../src/commands/create-wiki.js';
import { createCoverageRoutes } from '../../src/web/routes/coverage.js';

describe('Coverage API', () => {
  let ctx: TestContext;
  let app: express.Application;
  let server: Server;
  let baseUrl: string;

  before(async () => {
    ctx = await createTestContext();

    app = express();
    app.use(express.json());

    // Mount the coverage routes
    const coverageRouter = createCoverageRoutes({
      repos: ctx.repos,
      repoAccessFactory: ctx.repoAccessFactory,
    });
    app.use(coverageRouter);

    // Start server on random port
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) {
          baseUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await ctx.cleanup();
  });

  describe('GET /api/repos/:id/coverage', () => {
    it('returns 404 for non-existent repository', async () => {
      const response = await fetch(`${baseUrl}/api/repos/nonexistent/coverage`);
      assert.strictEqual(response.status, 404);
    });

    it('returns empty tree for repository with no source files', async () => {
      const repoId = 'coverage-empty-repo';
      await createTestRepo(ctx, repoId, {
        'README.md': '# Empty project',
      });

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/coverage`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();
      assert.strictEqual(data.tree, null);
      assert.strictEqual(data.summary.totalFiles, 0);
    });

    it('returns coverage tree for repository with source files', async () => {
      const repoId = 'coverage-with-files';
      await createTestRepo(ctx, repoId, {
        'src/index.ts': 'export const main = () => console.log("hello");',
        'src/utils/helper.ts': 'export function helper() { return 1; }',
        'src/utils/format.ts': 'export function format(s: string) { return s.trim(); }',
      });

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/coverage`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();

      // Should have tree structure
      assert.ok(data.tree, 'Should have tree');
      assert.strictEqual(data.tree.type, 'directory');

      // Should have summary
      assert.strictEqual(data.summary.totalFiles, 3);
      assert.strictEqual(data.summary.documentedFiles, 0); // No wiki pages yet
      assert.strictEqual(data.summary.averageCoverage, 0);

      // Should have thresholds
      assert.strictEqual(data.thresholds.lowCoverage, 40);
    });

    it('shows coverage for files referenced in wiki pages', async () => {
      const repoId = 'coverage-with-wiki';
      await createTestRepo(ctx, repoId, {
        'src/index.ts': 'export const main = () => console.log("hello");',
        'src/api/routes.ts': 'export const routes = [];',
        'src/api/handlers.ts': 'export const handlers = {};',
      });

      // Create wiki and add a page that references files
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await ctx.repos.wikiPages.save({
        id: uuid(),
        wikiId: wiki.id,
        path: 'api/overview',
        title: 'API Overview',
        content: '# API Overview\n\nThis documents the API layer.',
        confidence: 0.8,
        sourceCommits: [],
        links: [],
        backlinks: [],
        filesAccessed: ['src/api/routes.ts', 'src/api/handlers.ts'],
        filesReferenced: ['src/api/routes.ts'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/coverage`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();

      // Files referenced in wiki should have coverage
      assert.ok(data.summary.documentedFiles > 0, 'Should have documented files');
      assert.ok(data.summary.averageCoverage > 0, 'Should have some coverage');
    });

    it('includes priority scores and entry point flags', async () => {
      const repoId = 'coverage-priority';
      await createTestRepo(ctx, repoId, {
        'src/index.ts': 'export const main = () => {};', // Entry point
        'src/utils.ts': 'export const util = () => {};',
      });

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/coverage`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();

      // Find files in the tree
      const files = collectFilesFromTree(data.tree);

      // Should have priority scores
      for (const file of files) {
        assert.ok(typeof file.priorityScore === 'number', 'Should have priorityScore');
        assert.ok(typeof file.isEntryPoint === 'boolean', 'Should have isEntryPoint flag');
      }

      // index.ts should be marked as entry point
      const indexFile = files.find(f => f.name === 'index.ts');
      assert.ok(indexFile, 'Should find index.ts');
      assert.strictEqual(indexFile.isEntryPoint, true, 'index.ts should be entry point');
    });

    it('calculates directory-level coverage correctly', async () => {
      const repoId = 'coverage-directory';
      await createTestRepo(ctx, repoId, {
        'src/a/file1.ts': 'export const a1 = 1;',
        'src/a/file2.ts': 'export const a2 = 2;',
        'src/b/file3.ts': 'export const b1 = 1;',
      });

      // Document one file in src/a
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await ctx.repos.wikiPages.save({
        id: uuid(),
        wikiId: wiki.id,
        path: 'module-a',
        title: 'Module A',
        content: '# Module A\n\nDocuments module A.',
        confidence: 0.9,
        sourceCommits: [],
        links: [],
        backlinks: [],
        filesAccessed: ['src/a/file1.ts'],
        filesReferenced: ['src/a/file1.ts'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/coverage`);
      const data = await response.json();

      // Find src/a directory
      const srcDir = data.tree.children?.find((d: any) => d.name === 'a') ||
                     data.tree.children?.find((d: any) => d.name === 'src')?.children?.find((d: any) => d.name === 'a');

      if (srcDir) {
        // Directory should have partial coverage (1 of 2 files documented)
        assert.ok(srcDir.coveragePercent > 0, 'src/a should have some coverage');
        assert.ok(srcDir.coveragePercent < 100, 'src/a should not have full coverage');
      }
    });

    it('includes touched metrics for directories and summary', async () => {
      const repoId = 'coverage-touched-metrics';
      await createTestRepo(ctx, repoId, {
        'src/api/routes.ts': 'export const routes = [];',
        'src/api/handlers.ts': 'export const handlers = {};',
        'src/api/middleware.ts': 'export const middleware = {};',
        'src/utils/format.ts': 'export function format() {}',
        'src/utils/parse.ts': 'export function parse() {}',
      });

      // Create wiki and add a page that references only some files
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await ctx.repos.wikiPages.save({
        id: uuid(),
        wikiId: wiki.id,
        path: 'api/overview',
        title: 'API Overview',
        content: '# API Overview\n\nThis documents the API routes.',
        confidence: 0.8,
        sourceCommits: [],
        links: [],
        backlinks: [],
        filesAccessed: ['src/api/routes.ts', 'src/api/handlers.ts'],
        filesReferenced: ['src/api/routes.ts'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/coverage`);
      assert.strictEqual(response.status, 200);

      const data = await response.json();

      // Summary should include touched metrics
      assert.ok('touchedFiles' in data.summary, 'Summary should have touchedFiles');
      assert.strictEqual(data.summary.touchedFiles, 2, 'Should have 2 touched files');
      assert.strictEqual(data.summary.totalFiles, 5, 'Should have 5 total files');

      // Find the src/api directory
      const srcDir = data.tree.children?.find((d: any) => d.name === 'src');
      const apiDir = srcDir?.children?.find((d: any) => d.name === 'api') ||
                     data.tree.children?.find((d: any) => d.name === 'api');

      if (apiDir) {
        // Directory should have touched count and ratio
        assert.ok('touchedCount' in apiDir, 'Directory should have touchedCount');
        assert.ok('touchedRatio' in apiDir, 'Directory should have touchedRatio');
        assert.strictEqual(apiDir.touchedCount, 2, 'api dir should have 2 touched files');
        assert.strictEqual(apiDir.totalFileCount, 3, 'api dir should have 3 total files');
        assert.ok(apiDir.touchedRatio > 0.6 && apiDir.touchedRatio < 0.7,
          `api dir touchedRatio should be ~0.67, got ${apiDir.touchedRatio}`);
      }

      // Find the src/utils directory - should have 0 touched
      const utilsDir = srcDir?.children?.find((d: any) => d.name === 'utils') ||
                       data.tree.children?.find((d: any) => d.name === 'utils');

      if (utilsDir) {
        assert.strictEqual(utilsDir.touchedCount, 0, 'utils dir should have 0 touched files');
        assert.strictEqual(utilsDir.touchedRatio, 0, 'utils dir touchedRatio should be 0');
      }
    });

    it('includes touched flag for individual files', async () => {
      const repoId = 'coverage-touched-files';
      await createTestRepo(ctx, repoId, {
        'src/documented.ts': 'export const documented = 1;',
        'src/undocumented.ts': 'export const undocumented = 2;',
      });

      // Document only one file
      const wiki = await getOrCreateActiveWiki(repoId, ctx.repos);
      await ctx.repos.wikiPages.save({
        id: uuid(),
        wikiId: wiki.id,
        path: 'documented',
        title: 'Documented Module',
        content: '# Documented\n\nThis file is documented.',
        confidence: 0.9,
        sourceCommits: [],
        links: [],
        backlinks: [],
        filesAccessed: ['src/documented.ts'],
        filesReferenced: ['src/documented.ts'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await fetch(`${baseUrl}/api/repos/${repoId}/coverage`);
      const data = await response.json();

      const files = collectFilesFromTree(data.tree);

      const docFile = files.find((f: any) => f.name === 'documented.ts');
      const undocFile = files.find((f: any) => f.name === 'undocumented.ts');

      assert.ok(docFile, 'Should find documented.ts');
      assert.ok(undocFile, 'Should find undocumented.ts');

      assert.ok('isTouched' in docFile, 'File should have isTouched flag');
      assert.strictEqual(docFile.isTouched, true, 'documented.ts should be touched');
      assert.strictEqual(undocFile.isTouched, false, 'undocumented.ts should not be touched');
    });
  });
});

/**
 * Helper to collect all files from a coverage tree.
 */
function collectFilesFromTree(node: any): any[] {
  if (!node) return [];

  const files: any[] = [];

  if (node.files) {
    files.push(...node.files);
  }

  if (node.children) {
    for (const child of node.children) {
      files.push(...collectFilesFromTree(child));
    }
  }

  return files;
}
