#!/usr/bin/env node

/**
 * CodeWiki CLI - Manual trigger for wiki generation.
 *
 * Usage:
 *   npx tsx src/cli.ts <command> [options]
 *
 * Commands:
 *   process <repo-path> [iterations]  - Process a local repository
 *   status <repo-id>                  - Show processing status
 *   list                              - List connected repositories
 */

import { v4 as uuid } from 'uuid';
import { resolve } from 'path';
import { createRepositories } from './repositories/index.js';
import { createGitService } from './services/git/git-service.js';
import { createMockLLMForCodeAnalysis } from './services/llm/mock-llm-service.js';
import { createAnthropicLLM } from './services/llm/anthropic-llm-service.js';
import type { LLMService } from './services/llm/llm-service.js';
import { createOrchestrator } from './agents/orchestrator/orchestrator.js';
import { createResearchAgent } from './agents/research/research-agent.js';
import { createExecutor } from './executor/executor.js';
import { createRepo } from './domain/repo.js';

/**
 * Create the appropriate LLM service based on environment.
 */
function createLLM(): LLMService {
  const apiKey = process.env['ANTHROPIC_API_KEY'];

  if (apiKey) {
    console.log('🤖 Using Anthropic Claude API\n');
    return createAnthropicLLM({ apiKey });
  }

  console.log('🤖 Using mock LLM (set ANTHROPIC_API_KEY for real analysis)\n');
  return createMockLLMForCodeAnalysis();
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  switch (command) {
    case 'process':
      await processCommand(args.slice(1));
      break;
    case 'query':
      await queryCommand(args.slice(1));
      break;
    case 'status':
      await statusCommand(args.slice(1));
      break;
    case 'list':
      await listCommand();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
CodeWiki CLI - Generate living wikis from Git repositories

Usage:
  npx tsx src/cli.ts <command> [options]

Commands:
  process <repo-path> [iterations]  Process a local Git repository
                                    Default: 10 iterations

  query <repo-path> "<question>"    Ask a question about the codebase
                                    Searches wiki and synthesizes an answer

  status <repo-id>                  Show processing status for a repository

  list                              List all connected repositories

Examples:
  npx tsx src/cli.ts process . 5                        # Process current repo
  npx tsx src/cli.ts query . "what is the architecture?"  # Ask about architecture
  npx tsx src/cli.ts query . "why use CQRS?"            # Ask about decisions
  npx tsx src/cli.ts status abc123                      # Show status
  npx tsx src/cli.ts list                               # List repos
`);
}

async function processCommand(args: string[]) {
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

  // Check if repo already exists
  let repo = await repos.repos.findByFullName(absolutePath);

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

    // Copy the repo to our managed location (or just reference it directly)
    const repoDir = git.getRepoPath(repo.id);

    // For local repos, we'll use simple-git directly on the path
    const simpleGit = (await import('simple-git')).default;
    const gitRepo = simpleGit(absolutePath);

    // Get commit log
    const log = await gitRepo.log(['--all']);
    console.log(`   Found ${log.all.length} commits\n`);

    // Save commits
    const { createCommit } = await import('./domain/commit.js');
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
        const lines = diffFiles.trim().split('\n').filter(l => l.length > 0);

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

  // Create orchestrator and executor
  const orchestrator = createOrchestrator(repos);
  const executor = createExecutor(repos, git, llm, orchestrator);

  // Show initial status
  const beforeSummary = await orchestrator.getWorkSummary(repo.id);
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
  const afterSummary = await orchestrator.getWorkSummary(repo.id);
  console.log('\n📊 After processing:');
  console.log(`   Commits: ${afterSummary.processedCommits}/${afterSummary.totalCommits} processed (${afterSummary.coveragePercent.toFixed(1)}%)`);
  console.log(`   Wiki pages: ${afterSummary.wikiPages}`);
  console.log(`   Avg confidence: ${(afterSummary.avgConfidence * 100).toFixed(1)}%\n`);
}

async function statusCommand(args: string[]) {
  const repoId = args[0];

  if (!repoId) {
    console.error('Error: Repository ID is required');
    console.log('Usage: status <repo-id>');
    process.exit(1);
  }

  const repos = createRepositories({ type: 'file' });
  const repo = await repos.repos.findById(repoId);

  if (!repo) {
    console.error(`Repository not found: ${repoId}`);
    process.exit(1);
  }

  const orchestrator = createOrchestrator(repos);
  const summary = await orchestrator.getWorkSummary(repoId);

  console.log(`\n📊 Status for ${repo.fullName}`);
  console.log(`   ID: ${repo.id}`);
  console.log(`   Status: ${repo.status}`);
  console.log(`   Commits: ${summary.processedCommits}/${summary.totalCommits} (${summary.coveragePercent.toFixed(1)}%)`);
  console.log(`   Wiki pages: ${summary.wikiPages}`);
  console.log(`   Avg confidence: ${(summary.avgConfidence * 100).toFixed(1)}%`);
  console.log(`   Pending work: ${summary.pendingWork}`);
  console.log(`   Open conflicts: ${summary.openConflicts}\n`);
}

async function listCommand() {
  const repos = createRepositories({ type: 'file' });
  const allRepos = await repos.repos.findAll();

  if (allRepos.length === 0) {
    console.log('\nNo repositories connected.\n');
    console.log('Use "process <repo-path>" to add a repository.\n');
    return;
  }

  console.log('\n📚 Connected Repositories:\n');

  for (const repo of allRepos) {
    console.log(`   ${repo.id.slice(0, 8)}  ${repo.fullName}`);
    console.log(`            Status: ${repo.status}`);
    console.log('');
  }
}

async function queryCommand(args: string[]) {
  const repoPath = args[0];
  const question = args.slice(1).join(' ');

  if (!repoPath) {
    console.error('Error: Repository path is required');
    console.log('Usage: query <repo-path> "<question>"');
    process.exit(1);
  }

  if (!question) {
    console.error('Error: Question is required');
    console.log('Usage: query <repo-path> "<question>"');
    process.exit(1);
  }

  const absolutePath = resolve(repoPath);

  // Initialize services
  const repos = createRepositories({ type: 'file' });
  const llm = createLLM();

  // Find the repository
  const repo = await repos.repos.findByFullName(absolutePath);

  if (!repo) {
    console.error(`Repository not found: ${absolutePath}`);
    console.log('Run "process <repo-path>" first to index the repository.');
    process.exit(1);
  }

  // Check if wiki has content
  const wikiPages = await repos.wikiPages.findByRepo(repo.id);
  if (wikiPages.length === 0) {
    console.error('Wiki is empty. Run "process <repo-path>" first to generate wiki content.');
    process.exit(1);
  }

  console.log(`\n🔍 Searching wiki for: "${question}"\n`);

  // Create research agent and query
  const research = createResearchAgent(repos, llm);
  const result = await research.query(repo.id, question);

  // Display results
  console.log('━'.repeat(60));
  console.log('\n📖 Answer:\n');
  console.log(result.answer);
  console.log('\n' + '━'.repeat(60));

  console.log(`\n📊 Confidence: ${(result.confidence * 100).toFixed(0)}%`);

  if (result.sources.length > 0) {
    console.log('\n📚 Sources:');
    for (const source of result.sources) {
      console.log(`   • ${source.title} (${source.path})`);
      console.log(`     Relevance: ${(source.relevance * 100).toFixed(0)}%, Confidence: ${(source.confidence * 100).toFixed(0)}%`);
    }
  }

  if (result.costUsd) {
    console.log(`\n💰 Query cost: $${result.costUsd.toFixed(4)}`);
  }

  console.log('');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
