/**
 * CLI status command - shows processing status for a repository.
 */

import { createRepositories } from '../../repositories/index.js';
import { createOrchestrator } from '../../agents/orchestrator/orchestrator.js';
import { getOrCreateActiveWiki } from '../../commands/create-wiki.js';
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

  const repos = createRepositories({ type: 'file' });
  // Use CQRS query to find repository
  const repoQuery = createGetRepositoryQuery(repoId);
  const repoResult = await handleGetRepository(repoQuery, repos);

  if (!repoResult.success || !repoResult.data) {
    console.error(`Repository not found: ${repoId}`);
    process.exit(1);
  }

  const repo = repoResult.data;

  const orchestrator = createOrchestrator(repos);
  const wiki = await getOrCreateActiveWiki(repoId, repos);
  const summary = await orchestrator.getWorkSummary(repoId, wiki.id);

  console.log(`\n📊 Status for ${repo.fullName}`);
  console.log(`   ID: ${repo.id}`);
  console.log(`   Status: ${repo.status}`);
  console.log(`   Commits: ${summary.processedCommits}/${summary.totalCommits} (${summary.coveragePercent.toFixed(1)}%)`);
  console.log(`   Wiki pages: ${summary.wikiPages}`);
  console.log(`   Avg confidence: ${(summary.avgConfidence * 100).toFixed(1)}%`);
  console.log(`   Pending work: ${summary.pendingWork}`);
  console.log(`   Open conflicts: ${summary.openConflicts}\n`);
}
