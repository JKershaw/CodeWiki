/**
 * CLI status command - shows processing status for a repository.
 */

import { createRepositories } from '../../repositories/index.js';
import { createOrchestrator } from '../../agents/orchestrator/orchestrator.js';
import { getOrCreateActiveWiki } from '../../commands/create-wiki.js';
import { FileSystemGitService } from '../../services/git/git-service.js';
import { createRepositoryServiceFactory } from '../../services/repository/repository-service.js';
import { createUnifiedRepoAccessFactory } from '../../services/repository/unified-repo-access.js';
import {
  createGetRepositoryQuery,
  handleGetRepository,
} from '../../queries/index.js';

export async function statusCommand(args: string[]): Promise<void> {
  const repoId = args[0];

  if (!repoId) {
    console.error('Error: Repository ID is required');
    console.log('Usage: status <repo-id>');
    process.exit(1);
  }

  const connection = await createRepositories();
  const repos = connection.repositories;

  try {
    // Use CQRS query to find repository
    const repoQuery = createGetRepositoryQuery(repoId);
    const repoResult = await handleGetRepository(repoQuery, repos);

    if (!repoResult.success || !repoResult.data) {
      console.error(`Repository not found: ${repoId}`);
      process.exit(1);
    }

    const repo = repoResult.data;

    // Create git service and repo access factory for file coverage calculation
    const gitService = new FileSystemGitService('.');
    // Try to register the repo's clone URL as local path (for local repos)
    if (repo.cloneUrl && !repo.cloneUrl.startsWith('http')) {
      gitService.registerLocalRepo(repoId, repo.cloneUrl);
    }

    const repoServiceFactory = createRepositoryServiceFactory({ gitService });
    const repoAccessFactory = createUnifiedRepoAccessFactory({
      repos,
      repoServiceFactory,
      gitService,
    });

    const orchestrator = createOrchestrator(repos, undefined, undefined, repoAccessFactory);
    const wiki = await getOrCreateActiveWiki(repoId, repos);
    const summary = await orchestrator.getWorkSummary(repoId, wiki.id);

    console.log(`\n📊 Status for ${repo.fullName}`);
    console.log(`   ID: ${repo.id}`);
    console.log(`   Status: ${repo.status}`);
    console.log(`   Commits: ${summary.processedCommits}/${summary.totalCommits} (${summary.coveragePercent.toFixed(1)}%)`);
    console.log(`   Wiki pages: ${summary.wikiPages}`);
    console.log(`   Avg confidence: ${(summary.avgConfidence * 100).toFixed(1)}%`);
    console.log(`   Pending work: ${summary.pendingWork}`);
    console.log(`   Open conflicts: ${summary.openConflicts}`);

    // Show file coverage metrics
    if (summary.totalSourceFiles > 0) {
      console.log(`\n📁 File Coverage:`);
      console.log(`   Source files: ${summary.documentedFiles}/${summary.totalSourceFiles} documented`);
      console.log(`   Coverage: ${summary.fileDocCoverage.toFixed(1)}%`);
    }

    console.log('');
  } finally {
    await connection.close();
  }
}
