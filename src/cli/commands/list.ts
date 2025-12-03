/**
 * CLI list command - lists all connected repositories.
 */

import { createRepositories } from '../../repositories/index.js';
import {
  createListRepositoriesQuery,
  handleListRepositories,
} from '../../queries/index.js';

export async function listCommand(): Promise<void> {
  const connection = await createRepositories();
  const repos = connection.repositories;

  try {
    // Use CQRS query to list repositories
    const listQuery = createListRepositoriesQuery();
    const listResult = await handleListRepositories(listQuery, repos);
    const allRepos = listResult.data || [];

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
  } finally {
    await connection.close();
  }
}
