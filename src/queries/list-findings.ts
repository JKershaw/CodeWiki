import type { Query, QueryResult } from './types.js';
import { found } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { Finding } from '../domain/finding.js';

/**
 * Query to list open findings for a wiki.
 */
export interface ListOpenFindingsQuery extends Query {
  readonly type: 'ListOpenFindings';
  readonly wikiId: string;
}

export function createListOpenFindingsQuery(wikiId: string): ListOpenFindingsQuery {
  return {
    type: 'ListOpenFindings',
    wikiId,
  };
}

/**
 * Handler for ListOpenFindings query.
 */
export async function handleListOpenFindings(
  query: ListOpenFindingsQuery,
  repos: Repositories
): Promise<QueryResult<Finding[]>> {
  const findings = await repos.findings.findOpen(query.wikiId);
  return found(findings);
}
