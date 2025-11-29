/**
 * Represents a wiki instance for a repository.
 * A repo can have multiple wikis (e.g., different branches, versions, audiences),
 * but only one wiki is active at a time for processing.
 */
export interface Wiki {
  id: string;
  /** Reference to the parent repo */
  repoId: string;
  /** Display name, e.g., "main", "api-docs", "v2" */
  name: string;
  /** URL-friendly identifier */
  slug: string;
  /** Description of this wiki's purpose */
  description: string;
  /** Only one wiki per repo can be active for processing */
  isActive: boolean;

  // Optional scoping filters
  /** Only process commits from this branch */
  branchFilter?: string;
  /** Only process commits affecting these paths */
  pathFilters?: string[];

  /** Wiki-specific configuration */
  config: WikiConfig;

  /** Wiki lifecycle status */
  status: WikiStatus;
  /** Last commit SHA processed by this wiki */
  lastProcessedCommitSha: string | null;
  /** When the wiki was created */
  createdAt: Date;
  /** When the wiki was last updated */
  updatedAt: Date;
}

export type WikiStatus =
  | 'active'    // Wiki is live and can be processed
  | 'draft'     // Wiki is being set up
  | 'archived'; // Wiki is frozen, no longer processed

export interface WikiConfig {
  /** Override enabled agents for this wiki */
  enabledAgents?: string[];
  /** Minimum confidence threshold before flagging pages */
  confidenceThreshold: number;
  /** Auto-publish updates or require review */
  autoPublish: boolean;
}

/**
 * Factory function to create a new wiki.
 */
export function createWiki(params: {
  id: string;
  repoId: string;
  name: string;
  slug?: string;
  description?: string;
  isActive?: boolean;
  branchFilter?: string;
  pathFilters?: string[];
  config?: Partial<WikiConfig>;
}): Wiki {
  return {
    id: params.id,
    repoId: params.repoId,
    name: params.name,
    slug: params.slug ?? slugify(params.name),
    description: params.description ?? '',
    isActive: params.isActive ?? true,
    ...(params.branchFilter ? { branchFilter: params.branchFilter } : {}),
    ...(params.pathFilters ? { pathFilters: params.pathFilters } : {}),
    config: {
      confidenceThreshold: params.config?.confidenceThreshold ?? 0.5,
      autoPublish: params.config?.autoPublish ?? true,
      ...(params.config?.enabledAgents ? { enabledAgents: params.config.enabledAgents } : {}),
    },
    status: 'active',
    lastProcessedCommitSha: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Create the default wiki for a repo.
 */
export function createDefaultWiki(params: {
  id: string;
  repoId: string;
}): Wiki {
  return createWiki({
    id: params.id,
    repoId: params.repoId,
    name: 'main',
    slug: 'main',
    description: 'Main documentation wiki',
    isActive: true,
  });
}

/**
 * Convert a name to a URL-friendly slug.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
