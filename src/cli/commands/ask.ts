/**
 * CLI ask command - quick query for current directory.
 */

import { createRepositories } from '../../repositories/index.js';
import { createResearchAgent } from '../../agents/research/research-agent.js';
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

export async function askCommand(args: string[]): Promise<void> {
  const question = args.join(' ');

  if (!question) {
    console.error('Error: Question is required');
    console.log('Usage: npm run ask "your question here"');
    process.exit(1);
  }

  // Use current working directory
  const absolutePath = process.cwd();

  // Initialize services
  const connection = await createRepositories();
  const repos = connection.repositories;
  const llm = createLLM();

  try {

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

  // Create research agent and query
  const research = createResearchAgent(repos, llm);
  const result = await research.query(wiki.id, question);

  // Output just the answer (clean for piping)
  console.log(result.answer);
  } finally {
    await connection.close();
  }
}
