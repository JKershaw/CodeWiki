#!/usr/bin/env node
/**
 * Generate a wiki with the rebalanced orchestrator.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/generate-rebalanced-wiki.ts [iterations] [output-dir]
 *
 * Example:
 *   ANTHROPIC_API_KEY=sk-ant-api03-xxx npx tsx scripts/generate-rebalanced-wiki.ts 50 examples/rebalanced-50-iterations
 */

import 'dotenv/config';
import { createFileRepositories } from '../dist/repositories/file-based/index.js';
import { createOrchestrator } from '../dist/agents/orchestrator/orchestrator.js';
import { createExecutor } from '../dist/executor/executor.js';
import { createAnthropicLLM } from '../dist/services/llm/anthropic-llm-service.js';
import { createRepo } from '../dist/domain/repo.js';
import { createCommit } from '../dist/domain/commit.js';
import { createGitService } from '../dist/services/git/git-service.js';
import { v4 as uuid } from 'uuid';
import { simpleGit } from 'simple-git';
import * as fs from 'fs/promises';
import * as path from 'path';

const REPO_PATH = process.cwd();

async function main() {
  const maxIterations = parseInt(process.argv[2] || '50', 10);
  const outputDir = process.argv[3] || `examples/rebalanced-${maxIterations}-iterations`;
  const dataDir = `${outputDir}/data`;
  const wikiDir = `${outputDir}/wiki`;

  console.log(`=== Rebalanced Wiki Generation ===`);
  console.log(`Max iterations: ${maxIterations}`);
  console.log(`Output: ${outputDir}\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    console.error('\nUsage:');
    console.error('  ANTHROPIC_API_KEY=sk-... npx tsx scripts/generate-rebalanced-wiki.ts [iterations] [output-dir]');
    process.exit(1);
  }

  // Clean up previous data
  try {
    await fs.rm(outputDir, { recursive: true });
  } catch {
    // Directory doesn't exist
  }
  await fs.mkdir(outputDir, { recursive: true });

  // Initialize services
  const repos = createFileRepositories(dataDir);
  const git = createGitService();
  const llm = createAnthropicLLM({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-20250514',
    rateLimit: {
      maxRequestsPerMinute: 100,
      maxCostPerHour: 50,  // Allow higher cost for wiki generation
    },
  });

  const orchestrator = createOrchestrator(repos);
  const executor = createExecutor(repos, git, llm, orchestrator);

  // Register repo
  const repo = createRepo({
    id: uuid(),
    fullName: REPO_PATH,
    cloneUrl: REPO_PATH,
    defaultBranch: 'main',
  });
  repo.status = 'pending';
  await repos.repos.save(repo);

  const repoId = repo.id;
  git.registerLocalRepo(repoId, REPO_PATH);

  console.log(`Registered repo: ${repoId}\n`);

  // Sync commits (all available)
  console.log('Syncing commits...');
  const gitRepo = simpleGit(REPO_PATH);
  const log = await gitRepo.log(['--all', '-n', '100']);

  const commits = [];
  for (const entry of log.all) {
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
  console.log(`Synced ${commits.length} commits\n`);

  // Run iterations
  let totalIterations = 0;
  let totalCost = 0;
  const startTime = Date.now();

  console.log('Running wiki generation with rebalanced orchestrator...\n');

  // Track progress at intervals
  const checkpoints = [10, 20, 30, 40, 50, 75, 100].filter(n => n <= maxIterations);

  while (totalIterations < maxIterations) {
    const batchSize = Math.min(10, maxIterations - totalIterations);
    const summary = await executor.runIterations(repoId, batchSize);

    totalIterations += summary.iterations;
    totalCost += summary.totalCost;

    const pages = await repos.wikiPages.findByRepo(repoId);
    const agentRuns = await repos.agentRuns.findByRepo(repoId);

    // Count agent types
    const agentCounts = new Map<string, number>();
    for (const run of agentRuns) {
      agentCounts.set(run.agentType, (agentCounts.get(run.agentType) || 0) + 1);
    }

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`Iteration ${totalIterations}: ${pages.length} pages, $${totalCost.toFixed(4)}, ${elapsed}m elapsed`);
    console.log(`  Agents: ${Array.from(agentCounts.entries()).map(([a, c]) => `${a}:${c}`).join(', ')}`);

    // Save checkpoint data at intervals
    if (checkpoints.includes(totalIterations)) {
      await saveCheckpoint(repos, repoId, outputDir, totalIterations);
    }

    if (summary.iterations === 0) {
      console.log('\nNo more work available');
      break;
    }
  }

  // Final export
  const finalPages = await repos.wikiPages.findByRepo(repoId);
  const agentRuns = await repos.agentRuns.findByRepo(repoId);
  const totalTime = (Date.now() - startTime) / 1000;

  console.log('\n=== Final Statistics ===');
  console.log(`Total pages: ${finalPages.length}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);
  console.log(`Total time: ${(totalTime / 60).toFixed(1)} minutes`);
  console.log(`Total iterations: ${totalIterations}`);

  // Category breakdown
  const categories = new Map<string, number>();
  for (const page of finalPages) {
    const cat = page.path.split('/')[0] || 'uncategorized';
    categories.set(cat, (categories.get(cat) || 0) + 1);
  }
  console.log('\nCategories:');
  for (const [cat, count] of Array.from(categories.entries()).sort()) {
    console.log(`  ${cat}: ${count} pages`);
  }

  // Agent run breakdown
  const agentCounts = new Map<string, number>();
  for (const run of agentRuns) {
    agentCounts.set(run.agentType, (agentCounts.get(run.agentType) || 0) + 1);
  }
  console.log('\nAgent runs:');
  for (const [agent, count] of Array.from(agentCounts.entries()).sort()) {
    console.log(`  ${agent}: ${count}`);
  }

  // Export to markdown
  console.log('\n=== Exporting to Markdown ===');
  await exportToMarkdown(finalPages, wikiDir);

  // Save summary
  const summaryData = {
    generatedAt: new Date().toISOString(),
    iterations: totalIterations,
    pages: finalPages.length,
    cost: totalCost,
    timeSeconds: totalTime,
    categories: Object.fromEntries(categories),
    agentRuns: Object.fromEntries(agentCounts),
  };
  await fs.writeFile(`${outputDir}/summary.json`, JSON.stringify(summaryData, null, 2));

  console.log(`\n✅ Wiki exported to ${wikiDir}/`);
  console.log(`   View the index: ${wikiDir}/index.md`);
  console.log(`   Summary: ${outputDir}/summary.json`);
}

async function saveCheckpoint(repos: any, repoId: string, outputDir: string, iteration: number) {
  const checkpointDir = `${outputDir}/checkpoints/iteration-${iteration}`;
  await fs.mkdir(checkpointDir, { recursive: true });

  const pages = await repos.wikiPages.findByRepo(repoId);
  const agentRuns = await repos.agentRuns.findByRepo(repoId);

  await fs.writeFile(`${checkpointDir}/pages.json`, JSON.stringify(pages, null, 2));
  await fs.writeFile(`${checkpointDir}/agent-runs.json`, JSON.stringify(agentRuns, null, 2));

  console.log(`  📸 Checkpoint saved at iteration ${iteration}`);
}

async function exportToMarkdown(pages: any[], outputDir: string) {
  await fs.mkdir(outputDir, { recursive: true });

  // Group by category
  const categories = new Map<string, any[]>();
  for (const page of pages) {
    const category = page.path.split('/')[0] || 'uncategorized';
    if (!categories.has(category)) {
      categories.set(category, []);
    }
    categories.get(category)!.push(page);
  }

  // Export pages
  for (const page of pages) {
    const pagePath = path.join(outputDir, `${page.path}.md`);
    const pageDir = path.dirname(pagePath);
    await fs.mkdir(pageDir, { recursive: true });

    const metadata = [
      '---',
      `title: "${page.title.replace(/"/g, '\\"')}"`,
      `confidence: ${page.confidence.toFixed(2)}`,
      `created: ${page.createdAt}`,
      `updated: ${page.updatedAt}`,
      '---',
      '',
    ].join('\n');

    await fs.writeFile(pagePath, metadata + '\n' + page.content);
  }

  // Create index
  const indexLines = [
    '# Wiki Index',
    '',
    `Generated with ${pages.length} pages at ${new Date().toISOString()}`,
    '',
    '## Pages by Category',
    '',
  ];

  for (const [category, categoryPages] of Array.from(categories.entries()).sort()) {
    indexLines.push(`### ${category}`);

    for (const page of categoryPages.sort((a: any, b: any) => b.confidence - a.confidence)) {
      const confPct = Math.round(page.confidence * 100);
      indexLines.push(`- [${page.title}](${page.path}.md) (${confPct}%)`);
    }
    indexLines.push('');
  }

  await fs.writeFile(path.join(outputDir, 'index.md'), indexLines.join('\n'));
  console.log(`Exported ${pages.length} pages + index.md`);
}

main().catch(console.error);
