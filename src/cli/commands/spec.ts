/**
 * CLI spec command - generates a spec for a coding agent task.
 */

import { createRepositories } from '../../repositories/index.js';
import { createSpecAgent } from '../../agents/spec/spec-agent.js';
import { getOrCreateActiveWiki } from '../../commands/create-wiki.js';
import {
  createGetRepositoryByFullNameQuery,
  handleGetRepositoryByFullName,
  createListRepositoriesQuery,
  handleListRepositories,
  createListWikiPagesQuery,
  handleListWikiPages,
} from '../../queries/index.js';
import { createLLM } from '../utils.js';

export async function specCommand(args: string[]): Promise<void> {
  const task = args.join(' ');

  if (!task) {
    console.error('Error: Task description is required');
    console.log('Usage: npm run spec "your task description here"');
    process.exit(1);
  }

  // Use current working directory
  const absolutePath = process.cwd();

  // Initialize services
  const repos = createRepositories({ type: 'file' });
  const llm = createLLM();

  // Find the repository - try exact match first, then find most recent (via CQRS queries)
  const repoQuery = createGetRepositoryByFullNameQuery(absolutePath);
  const repoResult = await handleGetRepositoryByFullName(repoQuery, repos);
  let repo = repoResult.data ?? null;

  if (!repo) {
    // Look for any repo that might match this path (in case of multiple wikis)
    const listQuery = createListRepositoriesQuery();
    const listResult = await handleListRepositories(listQuery, repos);
    const allRepos = listResult.data || [];
    const matchingRepos = allRepos
      .filter(r => r.fullName === absolutePath || absolutePath.startsWith(r.fullName))
      .sort((a, b) => {
        // Sort by most recently updated (using createdAt as proxy)
        const aTime = a.createdAt?.getTime() ?? 0;
        const bTime = b.createdAt?.getTime() ?? 0;
        return bTime - aTime;
      });

    repo = matchingRepos[0] ?? null;
  }

  if (!repo) {
    console.error(`No wiki found for: ${absolutePath}`);
    console.log('Run "npm run cli process ." first to generate a wiki.');
    process.exit(1);
  }

  // Get active wiki
  const wiki = await getOrCreateActiveWiki(repo.id, repos);

  // Check if wiki has content via CQRS query
  const pagesQuery = createListWikiPagesQuery(wiki.id);
  const pagesResult = await handleListWikiPages(pagesQuery, repos);
  const wikiPages = pagesResult.data || [];
  if (wikiPages.length === 0) {
    console.error('Wiki is empty. Run "npm run cli process ." first to generate wiki content.');
    process.exit(1);
  }

  // Create spec agent and generate
  const specAgent = createSpecAgent(repos, llm);
  const result = await specAgent.generateSpec(wiki.id, task);

  // Output the spec in a readable format
  console.log('# Coding Agent Specification\n');
  console.log(`## Task\n${result.task}\n`);
  console.log(`## Interpretation\n${result.interpretation}\n`);
  console.log(`## Context\n${result.spec.context}\n`);

  if (result.spec.keyFiles.length > 0) {
    console.log('## Key Files');
    for (const file of result.spec.keyFiles) {
      console.log(`- ${file}`);
    }
    console.log('');
  }

  console.log(`## Patterns\n${result.spec.patterns}\n`);
  console.log(`## Conventions\n${result.spec.conventions}\n`);
  console.log(`## Dependencies\n${result.spec.dependencies}\n`);
  console.log(`## Testing\n${result.spec.testing}\n`);
  console.log(`## Pitfalls\n${result.spec.pitfalls}\n`);

  console.log('---');
  console.log(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);

  if (result.sources.length > 0) {
    console.log('\nSources:');
    for (const source of result.sources) {
      console.log(`  - ${source.title} (${source.path})`);
    }
  }

  if (result.costUsd) {
    console.log(`\nCost: $${result.costUsd.toFixed(4)}`);
  }
}
