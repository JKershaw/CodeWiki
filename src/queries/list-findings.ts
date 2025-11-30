import type { Query, QueryResult } from './types.js';
import { found } from './types.js';
import type { Repositories } from '../repositories/index.js';
import type { Finding, FindingType, FindingGroup } from '../domain/finding.js';

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

/**
 * Query to group open findings by type for consolidation.
 */
export interface GroupOpenFindingsQuery extends Query {
  readonly type: 'GroupOpenFindings';
  readonly wikiId: string;
}

export function createGroupOpenFindingsQuery(wikiId: string): GroupOpenFindingsQuery {
  return {
    type: 'GroupOpenFindings',
    wikiId,
  };
}

/**
 * Handler for GroupOpenFindings query.
 */
export async function handleGroupOpenFindings(
  query: GroupOpenFindingsQuery,
  repos: Repositories
): Promise<QueryResult<FindingGroup[]>> {
  const groups = await repos.findings.groupOpenFindings(query.wikiId);
  return found(groups);
}

/**
 * Query to check if a similar finding already exists.
 */
export interface FindingExistsSimilarQuery extends Query {
  readonly type: 'FindingExistsSimilar';
  readonly wikiId: string;
  readonly findingType: FindingType;
  readonly affectedPaths: string[];
}

export function createFindingExistsSimilarQuery(
  wikiId: string,
  findingType: FindingType,
  affectedPaths: string[]
): FindingExistsSimilarQuery {
  return {
    type: 'FindingExistsSimilar',
    wikiId,
    findingType,
    affectedPaths,
  };
}

/**
 * Handler for FindingExistsSimilar query.
 */
export async function handleFindingExistsSimilar(
  query: FindingExistsSimilarQuery,
  repos: Repositories
): Promise<QueryResult<boolean>> {
  const exists = await repos.findings.existsSimilar(
    query.wikiId,
    query.findingType,
    query.affectedPaths
  );
  return found(exists);
}
