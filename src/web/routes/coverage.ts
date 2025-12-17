/**
 * Coverage routes for viewing file/folder documentation coverage.
 *
 * Provides API endpoints to inspect how well files and directories
 * are documented in the wiki.
 */

import { Router, type Request, type Response } from 'express';
import type { Repositories } from '../../repositories/index.js';
import type { UnifiedRepoAccessFactory } from '../../services/repository/unified-repo-access.js';
import {
  buildCoverageTree,
  calculateFileCoverage,
  calculatePriorityScoreWithEntryPoint,
  isEntryPoint,
  LOW_COVERAGE_THRESHOLD,
  type DirectoryNode,
  type FileNode,
  type FileData,
} from '../../agents/orchestrator/file-coverage-tree.js';
import { buildFileDocumentationScores } from '../../agents/orchestrator/context-gatherer.js';

export interface CoverageDependencies {
  repos: Repositories;
  repoAccessFactory: UnifiedRepoAccessFactory;
}

/**
 * Extended file node with additional metadata for API response.
 */
export interface FileNodeDTO extends Omit<FileNode, 'score'> {
  priorityScore: number;
  isEntryPoint: boolean;
  /** Whether the file has any documentation (coverage > 0) */
  isTouched: boolean;
}

/**
 * Extended directory node for API response.
 */
export interface DirectoryNodeDTO {
  type: 'directory';
  name: string;
  path: string;
  files: FileNodeDTO[];
  children: DirectoryNodeDTO[];
  totalLoc: number;
  totalFileCount: number;
  coveragePercent: number;
  undocumentedCount: number;
  undocumentedRatio: number;
  /** Number of files with any documentation (coverage > 0) */
  touchedCount: number;
  /** Ratio of touched files (0-1) */
  touchedRatio: number;
}

/**
 * Coverage API response.
 */
export interface CoverageResponse {
  tree: DirectoryNodeDTO | null;
  summary: {
    totalFiles: number;
    documentedFiles: number;
    /** Number of files with any documentation (same as documentedFiles, explicit alias) */
    touchedFiles: number;
    lowCoverageFiles: number;
    averageCoverage: number;
  };
  thresholds: {
    lowCoverage: number;
  };
}

/**
 * Create coverage routes.
 */
export function createCoverageRoutes(deps: CoverageDependencies): Router {
  const { repos, repoAccessFactory } = deps;
  const router = Router();

  /**
   * @swagger
   * /api/repos/{id}/coverage:
   *   get:
   *     summary: Get file/folder coverage metrics
   *     description: Returns a hierarchical tree of files and directories with documentation coverage metrics
   *     tags: [Coverage]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Repository ID
   *     responses:
   *       200:
   *         description: Coverage tree with metrics
   *       404:
   *         description: Repository not found
   *       500:
   *         description: Internal server error
   */
  router.get('/api/repos/:id/coverage', async (req: Request, res: Response) => {
    try {
      const repoId = req.params.id!;

      // Validate repository exists
      const repo = await repos.repos.findById(repoId);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }

      // Get source files from repository
      const sourceFiles = await getSourceFiles(repoAccessFactory, repoId);

      // If no source files, return empty response
      if (sourceFiles.length === 0) {
        const response: CoverageResponse = {
          tree: null,
          summary: {
            totalFiles: 0,
            documentedFiles: 0,
            touchedFiles: 0,
            lowCoverageFiles: 0,
            averageCoverage: 0,
          },
          thresholds: {
            lowCoverage: LOW_COVERAGE_THRESHOLD,
          },
        };
        res.json(response);
        return;
      }

      // Get wiki pages with file tracking
      const wikis = await repos.wikis.findByRepo(repoId);
      const activeWiki = wikis.find(w => w.isActive);

      let wikiPages: Array<{
        path: string;
        content: string;
        filesAccessed?: string[];
        filesReferenced?: string[];
        targetPaths?: string[];
      }> = [];

      if (activeWiki) {
        const pages = await repos.wikiPages.findByWiki(activeWiki.id);
        wikiPages = pages.map(p => ({
          path: p.path,
          content: p.content,
          filesAccessed: p.filesAccessed,
          filesReferenced: p.filesReferenced,
          targetPaths: p.targetPaths,
        }));
      }

      // Build documentation scores
      const sourceFileSet = new Set(sourceFiles.map(f => f.path));
      const documentationScores = buildFileDocumentationScores(wikiPages, sourceFileSet);
      const maxScore = Math.max(...documentationScores.values(), 0);

      // Build the coverage tree
      const tree = buildCoverageTree(sourceFiles, documentationScores);

      // Transform tree to DTO with additional fields
      const treeDTO = tree ? transformTreeToDTO(tree, documentationScores, maxScore) : null;

      // Calculate summary statistics
      let documentedFiles = 0;
      let lowCoverageFiles = 0;
      let totalCoverage = 0;
      let totalLoc = 0;

      for (const file of sourceFiles) {
        const coverage = calculateFileCoverage(file.path, documentationScores, maxScore);
        if (coverage > 0) {
          documentedFiles++;
        }
        if (coverage < LOW_COVERAGE_THRESHOLD) {
          lowCoverageFiles++;
        }
        totalCoverage += coverage * file.loc;
        totalLoc += file.loc;
      }

      const averageCoverage = totalLoc > 0 ? totalCoverage / totalLoc : 0;

      const response: CoverageResponse = {
        tree: treeDTO,
        summary: {
          totalFiles: sourceFiles.length,
          documentedFiles,
          touchedFiles: documentedFiles, // Same as documentedFiles - explicit alias for clarity
          lowCoverageFiles,
          averageCoverage: Math.round(averageCoverage * 100) / 100,
        },
        thresholds: {
          lowCoverage: LOW_COVERAGE_THRESHOLD,
        },
      };

      res.json(response);
    } catch (error) {
      console.error('Coverage API error:', error);
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}

/**
 * Get source files from repository.
 * Uses getFileTreeWithSizes() for efficient single-API-call retrieval.
 */
async function getSourceFiles(
  repoAccessFactory: UnifiedRepoAccessFactory,
  repoId: string
): Promise<FileData[]> {
  try {
    const repoAccess = await repoAccessFactory.create(repoId);

    // Use efficient single-request method that returns sizes
    // For GitHub repos, this uses the Git Tree API (1 API call vs N)
    const filesWithSizes = await repoAccess.getFileTreeWithSizes();

    // Filter to source files (TypeScript, JavaScript)
    const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    const sourceFiles: FileData[] = [];

    for (const { path: filePath, size } of filesWithSizes) {
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      if (sourceExtensions.includes(ext)) {
        // Skip test files and node_modules
        if (
          filePath.includes('node_modules/') ||
          filePath.includes('.test.') ||
          filePath.includes('.spec.') ||
          filePath.includes('__tests__/')
        ) {
          continue;
        }

        // Estimate LOC from file size (~35 bytes per line of code)
        // This avoids fetching file content for each file
        const loc = estimateLocFromSize(size);
        sourceFiles.push({ path: filePath, loc });
      }
    }

    return sourceFiles;
  } catch {
    return [];
  }
}

/**
 * Estimate lines of code from file size.
 * Assumes ~35 bytes per line (typical for source code).
 */
function estimateLocFromSize(sizeBytes: number): number {
  if (sizeBytes <= 0) return 0;
  // Average line length is ~35 bytes including newline
  return Math.max(1, Math.round(sizeBytes / 35));
}

/**
 * Transform internal tree to DTO with additional fields.
 */
function transformTreeToDTO(
  node: DirectoryNode,
  documentationScores: Map<string, number>,
  maxScore: number
): DirectoryNodeDTO {
  // Transform files with isTouched flag
  const filesDTO: FileNodeDTO[] = node.files.map(file => {
    const coverage = calculateFileCoverage(file.path, documentationScores, maxScore);
    return {
      type: 'file' as const,
      name: file.name,
      path: file.path,
      loc: file.loc,
      coveragePercent: coverage,
      priorityScore: calculatePriorityScoreWithEntryPoint(coverage, file.loc, file.path),
      isEntryPoint: isEntryPoint(file.path),
      isTouched: coverage > 0,
    };
  });

  // Sort files by priority (highest first)
  filesDTO.sort((a, b) => b.priorityScore - a.priorityScore);

  // Transform children recursively
  const childrenDTO: DirectoryNodeDTO[] = node.children.map(child =>
    transformTreeToDTO(child, documentationScores, maxScore)
  );

  // Sort children by coverage (lowest first for visibility)
  childrenDTO.sort((a, b) => a.coveragePercent - b.coveragePercent);

  // Calculate undocumented count
  const undocumentedCount = filesDTO.filter(f => f.coveragePercent < LOW_COVERAGE_THRESHOLD).length +
    childrenDTO.reduce((sum, c) => sum + c.undocumentedCount, 0);

  const totalFileCount = filesDTO.length + childrenDTO.reduce((sum, c) => sum + c.totalFileCount, 0);
  const undocumentedRatio = totalFileCount > 0 ? undocumentedCount / totalFileCount : 0;

  // Calculate touched count (files with any documentation)
  const touchedCount = filesDTO.filter(f => f.isTouched).length +
    childrenDTO.reduce((sum, c) => sum + c.touchedCount, 0);
  const touchedRatio = totalFileCount > 0 ? touchedCount / totalFileCount : 0;

  return {
    type: 'directory',
    name: node.name,
    path: node.path,
    files: filesDTO,
    children: childrenDTO,
    totalLoc: node.totalLoc,
    totalFileCount: node.totalFileCount,
    coveragePercent: node.coveragePercent,
    undocumentedCount,
    undocumentedRatio,
    touchedCount,
    touchedRatio,
  };
}
