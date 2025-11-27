/**
 * Shared mock WikiPage factories for tests.
 */

import type { WikiPage } from '../../src/domain/wiki-page.js';

/**
 * Create a mock WikiPage with sensible defaults.
 */
export function createMockPage(
  path: string,
  title: string,
  content: string,
  overrides?: Partial<WikiPage>
): WikiPage {
  return {
    id: `page-${path.replace(/\//g, '-')}`,
    repoId: 'test-repo',
    path,
    title,
    content,
    confidence: 0.5,
    sourceCommits: [],
    links: [],
    backlinks: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

/**
 * Create a mock commit page.
 */
export function createMockCommitPage(
  commitHash: string,
  title: string,
  content: string,
  overrides?: Partial<WikiPage>
): WikiPage {
  return createMockPage(
    `commits/${commitHash}`,
    title,
    content,
    {
      sourceCommits: [commitHash],
      ...overrides,
    }
  );
}

/**
 * Create a set of related pages for testing relationships.
 */
export function createRelatedPages(): WikiPage[] {
  return [
    createMockCommitPage(
      'abc1234',
      'Add user authentication',
      '# Add user authentication\n\nImplemented JWT-based authentication in `src/auth.ts`.',
      { confidence: 0.6 }
    ),
    createMockPage(
      'security/auth-review',
      'Authentication Security Review',
      '# Authentication Security Review\n\nReviewed JWT implementation from commit abc1234.',
      { confidence: 0.7, sourceCommits: ['def5678'] }
    ),
    createMockPage(
      'architecture/api-design',
      'API Design Patterns',
      '# API Design Patterns\n\nREST API design with authentication middleware in `src/middleware/auth.ts`.',
      { confidence: 0.8, sourceCommits: ['ghi9012'] }
    ),
  ];
}

/**
 * Create pages with quality issues for testing.
 */
export function createPagesWithIssues(): WikiPage[] {
  return [
    createMockPage(
      'guides/short',
      'Short Guide',
      'Too short',
      { confidence: 0.3 }
    ),
    createMockPage(
      'guides/empty-section',
      'Guide with Empty Section',
      '# Guide\n\n## Empty Section\n\n## Content Section\n\nActual content here.',
      { confidence: 0.5 }
    ),
    createMockPage(
      'guides/no-citations',
      'Guide without Citations',
      'This guide has no commit references or file paths mentioned anywhere.',
      { confidence: 0.5 }
    ),
  ];
}
