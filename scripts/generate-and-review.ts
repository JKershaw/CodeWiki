#!/usr/bin/env node
/**
 * Generate a wiki and export for review.
 *
 * This script runs the full wiki generation pipeline and exports
 * the result to markdown for quality review.
 */

import 'dotenv/config';
import { createFileRepositories } from '../dist/repositories/file-based/index.js';
import { createOrchestrator } from '../dist/agents/orchestrator/orchestrator.js';
import { createExecutor } from '../dist/executor/executor.js';
import { createOpenRouterLLM } from '../dist/services/llm/openrouter-llm-service.js';
import { createRepo } from '../dist/domain/repo.js';
import { createCommit } from '../dist/domain/commit.js';
import { createGitService } from '../dist/services/git/git-service.js';
import { v4 as uuid } from 'uuid';
import { simpleGit } from 'simple-git';
import * as fs from 'fs/promises';
import * as path from 'path';

const REPO_PATH = process.cwd();
const DATA_DIR = './review-wiki-data';
const MARKDOWN_DIR = './review-wiki-markdown';

async function main() {
  const maxIterations = parseInt(process.argv[2] || '50', 10);
  console.log(`=== Wiki Generation & Review ===`);
  console.log(`Max iterations: ${maxIterations}\n`);

  // Clean up previous data
  try {
    await fs.rm(DATA_DIR, { recursive: true });
    await fs.rm(MARKDOWN_DIR, { recursive: true });
  } catch {
    // Directories don't exist
  }

  // Initialize services
  const repos = createFileRepositories(DATA_DIR);
  const git = createGitService();
  const llm = createOpenRouterLLM({
    apiKey: process.env['OPENROUTER_API_KEY'],
    model: process.env['OPENROUTER_MODEL'] ?? 'anthropic/claude-sonnet-4.5',
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

  // Sync commits (limit to recent commits for faster testing)
  console.log('Syncing commits...');
  const gitRepo = simpleGit(REPO_PATH);
  const log = await gitRepo.log(['--all', '-n', '10']);

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

  console.log('Running wiki generation...\n');

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

    console.log(`Iteration ${totalIterations}: ${pages.length} pages, $${totalCost.toFixed(4)}`);
    console.log(`  Agents: ${Array.from(agentCounts.entries()).map(([a, c]) => `${a}:${c}`).join(', ')}`);

    if (summary.iterations === 0) {
      console.log('\nNo more work available');
      break;
    }
  }

  // Get final state
  const finalPages = await repos.wikiPages.findByRepo(repoId);
  const agentRuns = await repos.agentRuns.findByRepo(repoId);

  console.log('\n=== Final Wiki Statistics ===');
  console.log(`Total pages: ${finalPages.length}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);
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
  await exportToMarkdown(finalPages, MARKDOWN_DIR);

  // Show structure agent findings if any
  const structureRuns = agentRuns.filter(r => r.agentType === 'structure');
  if (structureRuns.length > 0) {
    console.log('\n=== Structure Agent Findings ===');
    for (const run of structureRuns) {
      if (run.result) {
        console.log(`\n${run.result.summary}`);
        for (const finding of run.result.findings.slice(0, 10)) {
          console.log(`  - [${finding.importance}] ${finding.description}`);
        }
      }
    }
  }

  console.log(`\n✅ Wiki exported to ${MARKDOWN_DIR}/`);
  console.log(`   View the index: ${MARKDOWN_DIR}/index.md`);

  // Keep data for inspection
  console.log(`\n📁 Raw data kept at ${DATA_DIR}/`);
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
    `Generated: ${new Date().toISOString()}`,
    `Total pages: ${pages.length}`,
    '',
    '## Categories',
    '',
  ];

  for (const [category, categoryPages] of Array.from(categories.entries()).sort()) {
    indexLines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    indexLines.push('');

    for (const page of categoryPages.sort((a: any, b: any) => a.title.localeCompare(b.title))) {
      const conf = page.confidence >= 0.8 ? '🟢' : page.confidence >= 0.5 ? '🟡' : '🔴';
      indexLines.push(`- ${conf} [${page.title}](${page.path}.md)`);
    }
    indexLines.push('');
  }

  // Statistics
  indexLines.push('## Statistics');
  indexLines.push('');
  indexLines.push('| Category | Pages | Avg Confidence |');
  indexLines.push('|----------|-------|----------------|');

  for (const [category, categoryPages] of Array.from(categories.entries()).sort()) {
    const avg = categoryPages.reduce((s: number, p: any) => s + p.confidence, 0) / categoryPages.length;
    indexLines.push(`| ${category} | ${categoryPages.length} | ${(avg * 100).toFixed(0)}% |`);
  }

  await fs.writeFile(path.join(outputDir, 'index.md'), indexLines.join('\n'));
  console.log(`Exported ${pages.length} pages + index.md`);
}

main().catch(console.error);
