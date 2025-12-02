/**
 * CLI query command - asks a question about a codebase.
 */

import { resolve } from 'path';
import { createRepositories } from '../../repositories/index.js';
import { createResearchAgent } from '../../agents/research/research-agent.js';
import { getOrCreateActiveWiki } from '../../commands/create-wiki.js';
import {
  createGetRepositoryByFullNameQuery,
  handleGetRepositoryByFullName,
  createListWikiPagesQuery,
  handleListWikiPages,
} from '../../queries/index.js';
import { createLLM } from '../utils.js';

export async function queryCommand(args: string[]): Promise<void> {
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

  // Find the repository via CQRS query
  const repoQuery = createGetRepositoryByFullNameQuery(absolutePath);
  const repoResult = await handleGetRepositoryByFullName(repoQuery, repos);

  if (!repoResult.success || !repoResult.data) {
    console.error(`Repository not found: ${absolutePath}`);
    console.log('Run "process <repo-path>" first to index the repository.');
    process.exit(1);
  }

  const repo = repoResult.data;

  // Get active wiki
  const wiki = await getOrCreateActiveWiki(repo.id, repos);

  // Check if wiki has content via CQRS query
  const pagesQuery = createListWikiPagesQuery(wiki.id);
  const pagesResult = await handleListWikiPages(pagesQuery, repos);
  const wikiPages = pagesResult.data || [];
  if (wikiPages.length === 0) {
    console.error('Wiki is empty. Run "process <repo-path>" first to generate wiki content.');
    process.exit(1);
  }

  console.log(`\n🔍 Searching wiki for: "${question}"\n`);

  // Create research agent and query
  const research = createResearchAgent(repos, llm);
  const result = await research.query(wiki.id, question);

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
