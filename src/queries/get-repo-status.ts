import type { Query, QueryResult } from './types.js';
import { found, notFound, queryError } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { Repo } from '../domain/repo.js';
import { getOrCreateActiveWiki } from '../commands/create-wiki.js';

/**
 * Query to get repository status and processing info.
 */
export interface GetRepoStatusQuery extends Query {
  readonly type: 'GetRepoStatus';
  readonly repoId: string;
}

export function createGetRepoStatusQuery(repoId: string): GetRepoStatusQuery {
  return {
    type: 'GetRepoStatus',
    repoId,
  };
}

/**
 * Extended repo status with processing statistics.
 */
export interface RepoStatusInfo {
  repo: Repo;
  stats: {
    totalCommits: number;
    processedCommits: number;
    wikiPages: number;
    pendingWork: number;
    openConflicts: number;
    totalCost: number;
  };
}

/**
 * Handler for GetRepoStatus query.
 */
export async function handleGetRepoStatus(
  query: GetRepoStatusQuery,
  repos: Repositories
): Promise<QueryResult<RepoStatusInfo>> {
  try {
    const repo = await repos.repos.findById(query.repoId);
    if (!repo) {
      return notFound(`Repository not found: ${query.repoId}`);
    }

    // Get or create active wiki for this repo
    const wiki = await getOrCreateActiveWiki(query.repoId, repos);

    const [
      totalCommits,
      processedCommits,
      wikiPages,
      pendingWork,
      openConflicts,
      totalCost,
    ] = await Promise.all([
      repos.commits.countByRepo(query.repoId),
      repos.commits.countProcessedByAgent(query.repoId, 'code-change'),
      repos.wikiPages.findByWiki(wiki.id).then(p => p.length),
      repos.workQueue.countPending(query.repoId),
      repos.conflicts.findOpen(wiki.id).then(c => c.length),
      repos.agentRuns.calculateTotalCost(query.repoId),
    ]);

    return found({
      repo,
      stats: {
        totalCommits,
        processedCommits,
        wikiPages,
        pendingWork,
        openConflicts,
        totalCost,
      },
    });
  } catch (error) {
    return queryError(`Failed to get repo status: ${error}`);
  }
}
