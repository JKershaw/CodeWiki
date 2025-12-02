/**
 * CLI process command - processes a local repository.
 */

import { v4 as uuid } from 'uuid';
import { resolve } from 'path';
import { createRepositories } from '../../repositories/index.js';
import { createGitService } from '../../services/git/git-service.js';
import { createOrchestrator } from '../../agents/orchestrator/orchestrator.js';
import { createExecutor } from '../../executor/executor.js';
import { createRepo } from '../../domain/repo.js';
import { getOrCreateActiveWiki } from '../../commands/create-wiki.js';
import {
  createGetRepositoryByFullNameQuery,
  handleGetRepositoryByFullName,
} from '../../queries/index.js';
import { createLLM } from '../utils.js';

export async function processCommand(args: string[]): Promise<void> {
  const repoPath = args[0];
  const iterations = parseInt(args[1] ?? '10', 10);

  if (!repoPath) {
    console.error('Error: Repository path is required');
    console.log('Usage: process <repo-path> [iterations]');
    process.exit(1);
  }

  const absolutePath = resolve(repoPath);
  console.log(`\n📂 Processing repository: ${absolutePath}`);
  console.log(`🔄 Iterations: ${iterations}\n`);

  // Initialize services
  const repos = createRepositories({ type: 'file' });
  const git = createGitService();
  const llm = createLLM();

  // Check if repo already exists (via CQRS query)
  const repoQuery = createGetRepositoryByFullNameQuery(absolutePath);
  const repoResult = await handleGetRepositoryByFullName(repoQuery, repos);
  let repo = repoResult.data ?? null;

  if (!repo) {
    // Create new repo record
    repo = createRepo({
      id: uuid(),
      fullName: absolutePath,
      cloneUrl: absolutePath,
      defaultBranch: 'main',
    });
    repo.status = 'processing';
    await repos.repos.save(repo);
    console.log(`✓ Created repository record: ${repo.id}\n`);

    // Load commits from the repository
    console.log('📥 Loading commits...');

    // For local repos, we'll use simple-git directly on the path
    const { simpleGit } = await import('simple-git');
    const gitRepo = simpleGit(absolutePath);

    // Get commit log
    const log = await gitRepo.log(['--all']);
    console.log(`   Found ${log.all.length} commits\n`);

    // Save commits
    const { createCommit } = await import('../../domain/commit.js');
    const commits = [];

    for (const entry of log.all) {
      // Get diff summary for each commit
      let diffSummary = {
        filesAdded: 0,
        filesModified: 0,
        filesDeleted: 0,
        linesAdded: 0,
        linesDeleted: 0,
        affectedFiles: [] as string[],
      };

      try {
        const diffFiles = await gitRepo.diff([`${entry.hash}^`, entry.hash, '--name-status']);
        const lines = diffFiles.trim().split('\n').filter((l: string) => l.length > 0);

        for (const line of lines) {
          const [status, ...pathParts] = line.split('\t');
          const filePath = pathParts.join('\t');
          if (filePath) diffSummary.affectedFiles.push(filePath);

          switch (status?.[0]) {
            case 'A': diffSummary.filesAdded++; break;
            case 'D': diffSummary.filesDeleted++; break;
            default: diffSummary.filesModified++; break;
          }
        }
      } catch {
        // Initial commit or error
      }

      commits.push(createCommit({
        id: uuid(),
        repoId: repo.id,
        sha: entry.hash,
        message: entry.message,
        authorName: entry.author_name,
        authorEmail: entry.author_email,
        committedAt: new Date(entry.date),
        diffSummary,
      }));
    }

    await repos.commits.saveMany(commits);
    console.log(`✓ Saved ${commits.length} commits\n`);
  } else {
    console.log(`✓ Found existing repository: ${repo.id}\n`);
  }

  // Register the local repo path so git service can find it
  git.registerLocalRepo(repo.id, absolutePath);

  // Create orchestrator and executor (always uses LLM-powered orchestration)
  const orchestrator = createOrchestrator(repos, llm, { useLLM: true }, git);
  const executor = createExecutor(repos, git, llm, orchestrator);

  // Get or create the active wiki for this repo
  const wiki = await getOrCreateActiveWiki(repo.id, repos);

  // Show initial status
  const beforeSummary = await orchestrator.getWorkSummary(repo.id, wiki.id);
  console.log('📊 Before processing:');
  console.log(`   Commits: ${beforeSummary.processedCommits}/${beforeSummary.totalCommits} processed (${beforeSummary.coveragePercent.toFixed(1)}%)`);
  console.log(`   Wiki pages: ${beforeSummary.wikiPages}`);
  console.log(`   Pending work: ${beforeSummary.pendingWork}\n`);

  // Run iterations
  console.log(`🚀 Running ${iterations} iterations...\n`);
  const result = await executor.runIterations(repo.id, iterations);

  // Show results
  console.log('\n📊 Results:');
  console.log(`   Iterations: ${result.iterations}`);
  console.log(`   Successful: ${result.successful}`);
  console.log(`   Failed: ${result.failed}`);
  console.log(`   Wiki pages created: ${result.wikiPagesCreated}`);
  console.log(`   Wiki pages updated: ${result.wikiPagesUpdated}`);
  console.log(`   Total cost: $${result.totalCost.toFixed(4)}`);

  // Show final status
  const afterSummary = await orchestrator.getWorkSummary(repo.id, wiki.id);
  console.log('\n📊 After processing:');
  console.log(`   Commits: ${afterSummary.processedCommits}/${afterSummary.totalCommits} processed (${afterSummary.coveragePercent.toFixed(1)}%)`);
  console.log(`   Wiki pages: ${afterSummary.wikiPages}`);
  console.log(`   Avg confidence: ${(afterSummary.avgConfidence * 100).toFixed(1)}%\n`);
}
