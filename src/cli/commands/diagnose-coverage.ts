/**
 * CLI diagnose-coverage command - detailed coverage analysis for debugging.
 *
 * Provides deep insight into how coverage is calculated, what files
 * are considered documented, and why the orchestrator makes its decisions.
 */

import { createRepositories } from '../../repositories/index.js';
import { getOrCreateActiveWiki } from '../../commands/create-wiki.js';
import { FileSystemGitService } from '../../services/git/git-service.js';
import { createRepositoryServiceFactory } from '../../services/repository/repository-service.js';
import { createUnifiedRepoAccessFactory } from '../../services/repository/unified-repo-access.js';
import {
  ContextGatherer,
  buildFileDocumentationScores,
  sortUndocumentedDirectories,
} from '../../agents/orchestrator/context-gatherer.js';
import {
  calculateLowestDirectoryCoverage,
  prioritizeDirectoriesForPhase,
  detectPhase,
  Phase,
  MAX_FOCUS_DIRECTORIES,
} from '../../agents/orchestrator/phased-orchestrator.js';
// Note: calculateFileCoverage available from file-coverage-tree.js if needed
import {
  createGetRepositoryQuery,
  handleGetRepository,
  createListWikiPagesQuery,
  handleListWikiPages,
} from '../../queries/index.js';

export async function diagnoseCoverageCommand(args: string[]): Promise<void> {
  const repoId = args[0];

  if (!repoId) {
    console.error('Error: Repository ID is required');
    console.log('Usage: diagnose-coverage <repo-id>');
    process.exit(1);
  }

  const connection = await createRepositories();
  const repos = connection.repositories;

  try {
    // Find repository
    const repoQuery = createGetRepositoryQuery(repoId);
    const repoResult = await handleGetRepository(repoQuery, repos);

    if (!repoResult.success || !repoResult.data) {
      console.error(`Repository not found: ${repoId}`);
      process.exit(1);
    }

    const repo = repoResult.data;
    console.log(`\n🔍 Coverage Diagnosis for ${repo.fullName}`);
    console.log('═'.repeat(60));

    // Create services
    const gitService = new FileSystemGitService('.');
    if (repo.cloneUrl && !repo.cloneUrl.startsWith('http')) {
      gitService.registerLocalRepo(repoId, repo.cloneUrl);
    }

    const repoServiceFactory = createRepositoryServiceFactory({ gitService });
    const repoAccessFactory = createUnifiedRepoAccessFactory({
      repos,
      repoServiceFactory,
      gitService,
    });

    const wiki = await getOrCreateActiveWiki(repoId, repos);

    // Get wiki pages
    const pagesQuery = createListWikiPagesQuery(wiki.id);
    const pagesResult = await handleListWikiPages(pagesQuery, repos);
    const wikiPages = pagesResult.data || [];

    console.log(`\n📚 Wiki State`);
    console.log(`   Pages: ${wikiPages.length}`);

    // Show file tracking info
    let pagesWithFileTracking = 0;
    let totalFilesAccessed = 0;
    let totalFilesReferenced = 0;

    for (const page of wikiPages) {
      if (page.filesAccessed?.length || page.filesReferenced?.length) {
        pagesWithFileTracking++;
        totalFilesAccessed += page.filesAccessed?.length ?? 0;
        totalFilesReferenced += page.filesReferenced?.length ?? 0;
      }
    }

    console.log(`   Pages with file tracking: ${pagesWithFileTracking}`);
    console.log(`   Total filesAccessed entries: ${totalFilesAccessed}`);
    console.log(`   Total filesReferenced entries: ${totalFilesReferenced}`);

    // Build documentation scores (raw, without file tree validation)
    // This shows what paths are being referenced, including potential directories
    // that would be filtered out during actual coverage calculation
    console.log(`\n📊 Documentation Scores (raw, unvalidated)`);
    const documentationScores = buildFileDocumentationScores(wikiPages);
    console.log(`   Paths with scores: ${documentationScores.size}`);

    if (documentationScores.size > 0) {
      const scores = Array.from(documentationScores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      const maxScore = Math.max(...documentationScores.values());
      console.log(`   Max score: ${maxScore.toFixed(0)}`);

      console.log(`\n   Top 10 documented files by score:`);
      for (const [path, score] of scores) {
        const coveragePct = Math.min(100, (score / Math.max(maxScore, 100)) * 100);
        console.log(`     ${coveragePct.toFixed(0)}% (${score.toFixed(0)}) ${path}`);
      }
    }

    // Gather full context
    console.log(`\n⏳ Gathering orchestrator context...`);
    const contextGatherer = new ContextGatherer(repos, repoAccessFactory);
    const context = await contextGatherer.gather(repoId, wiki.id);

    // Directory coverage
    console.log(`\n📁 Directory Coverage Analysis`);
    console.log(`   Directories with low coverage: ${context.undocumentedDirectories.length}`);

    const sortedDirs = sortUndocumentedDirectories(context.undocumentedDirectories);

    if (sortedDirs.length > 0) {
      // Calculate lowest coverage
      const lowestCoverage = calculateLowestDirectoryCoverage(sortedDirs, wikiPages.length);
      console.log(`   Lowest directory coverage: ${lowestCoverage.toFixed(1)}%`);

      console.log(`\n   All directories (sorted by undocumented ratio):`);
      for (const dir of sortedDirs) {
        const coveragePct = ((1 - dir.undocumentedRatio) * 100).toFixed(1);
        const status = dir.undocumentedRatio === 1.0 ? '⚠️ NOT STARTED' :
                       dir.undocumentedRatio > 0.7 ? '🔸 LOW' : '✓';
        console.log(`     ${status} ${dir.path}: ${coveragePct}% (${dir.totalFiles - dir.undocumentedCount}/${dir.totalFiles} files documented)`);
      }
    }

    // Low coverage files
    console.log(`\n📄 Low Coverage Files`);
    console.log(`   Files below 40% coverage: ${context.lowCoverageFiles.length}`);

    if (context.lowCoverageFiles.length > 0) {
      console.log(`\n   Top 30 lowest coverage files:`);
      for (const file of context.lowCoverageFiles.slice(0, 30)) {
        console.log(`     ${file.coverage.toFixed(0)}% ${file.path}`);
      }
      if (context.lowCoverageFiles.length > 30) {
        console.log(`     ... and ${context.lowCoverageFiles.length - 30} more files`);
      }
    }

    // Phase detection simulation
    console.log(`\n🎯 Phase Detection`);

    // Build phase context (simplified - would need full buildPhaseContext for accuracy)
    const dirsWithSomeCoverage = sortedDirs.filter(d => d.undocumentedRatio < 1.0).length;
    const estimatedDirs = Math.min(Math.floor(wikiPages.length / 3), 10);
    const dirsWithCoverage = Math.max(dirsWithSomeCoverage, estimatedDirs);
    const lowestCoverage = calculateLowestDirectoryCoverage(sortedDirs, wikiPages.length);
    const avgConfidence = wikiPages.length > 0
      ? wikiPages.reduce((sum, p) => sum + p.confidence, 0) / wikiPages.length
      : 0;

    // Calculate touched files ratio from low coverage files
    // Files with coverage > 0 are considered touched
    const touchedCount = context.lowCoverageFiles.filter(f => f.coverage > 0).length;
    // Total source files approximation: all files in directories with stats
    const totalSourceFiles = sortedDirs.reduce((sum, d) => sum + d.totalFiles, 0);
    // Files not in lowCoverageFiles are either high coverage (touched) or not counted
    // Low coverage files with coverage > 0 are touched, files not in low coverage are touched (they passed threshold)
    const filesWithHighCoverage = totalSourceFiles - context.lowCoverageFiles.length;
    const estimatedTouched = touchedCount + filesWithHighCoverage;
    const touchedFilesRatio = totalSourceFiles > 0 ? estimatedTouched / totalSourceFiles : 0;

    const phaseCtx = {
      pages: wikiPages.length,
      directoriesWithAnyCoverage: dirsWithCoverage,
      lowestDirectoryCoverage: lowestCoverage,
      touchedFilesRatio,
      avgConfidence,
      hasProjectOverview: wikiPages.some(p => p.synthesisType === 'project-overview'),
      hasGettingStarted: wikiPages.some(p => p.synthesisType === 'getting-started'),
      hasTestingGuide: wikiPages.some(p => p.synthesisType === 'testing-guide'),
      hasExtensionGuide: wikiPages.some(p => p.synthesisType === 'extension-guide'),
      lowConfidenceRatio: wikiPages.length > 0
        ? wikiPages.filter(p => p.confidence < 0.5).length / wikiPages.length
        : 0,
      openFindings: 0, // Would need DB query
    };

    const phase = detectPhase(phaseCtx);
    console.log(`   Detected Phase: ${phase} (${Phase[phase]})`);
    console.log(`\n   Decision factors:`);
    console.log(`     pages: ${phaseCtx.pages} (need >=10 for Phase 1→2, >=25 for Phase 2→3)`);
    console.log(`     dirsWithAnyCoverage: ${phaseCtx.directoriesWithAnyCoverage} (need >=3 for Phase 1→2)`);
    console.log(`     touchedFilesRatio: ${(phaseCtx.touchedFilesRatio * 100).toFixed(1)}% (need >=90% for Phase 2→3)`);
    console.log(`     avgConfidence: ${(phaseCtx.avgConfidence * 100).toFixed(1)}% (need >=65% for Phase 3→4)`);

    // Phase 2 specific: show prioritized directories
    if (phase === Phase.Breadth || phase === Phase.Skeleton) {
      console.log(`\n🎯 Phase ${phase} Directory Prioritization`);
      const phaseThreshold = 0.70; // 30% coverage

      const prioritized = prioritizeDirectoriesForPhase(sortedDirs, phaseThreshold);
      const selected = prioritized.slice(0, MAX_FOCUS_DIRECTORIES);

      console.log(`   Directories needing work: ${prioritized.length}`);
      console.log(`   In-progress (partial coverage): ${prioritized.filter(d => d.undocumentedRatio < 1.0).length}`);
      console.log(`   Not started (0% coverage): ${prioritized.filter(d => d.undocumentedRatio === 1.0).length}`);

      console.log(`\n   Selected for next batch (max ${MAX_FOCUS_DIRECTORIES}):`);
      for (let i = 0; i < selected.length; i++) {
        const dir = selected[i]!;
        const status = dir.undocumentedRatio < 1.0 ? 'IN-PROGRESS' : 'NOT-STARTED';
        const coveragePct = ((1 - dir.undocumentedRatio) * 100).toFixed(1);
        console.log(`     ${i + 1}. [${status}] ${dir.path} (${coveragePct}% coverage)`);

        // Show files in this directory
        const dirFiles = context.lowCoverageFiles
          .filter(f => f.directory === dir.path)
          .slice(0, 5);
        for (const file of dirFiles) {
          const fileName = file.path.split('/').pop();
          console.log(`        └─ ${file.coverage.toFixed(0)}% ${fileName}`);
        }
      }
    }

    // File coverage tree preview
    if (context.fileCoverageTree) {
      console.log(`\n🌲 File Coverage Tree (as shown to LLM)`);
      console.log('─'.repeat(60));
      // Show first 50 lines
      const lines = context.fileCoverageTree.split('\n').slice(0, 50);
      for (const line of lines) {
        console.log(line);
      }
      const totalLines = context.fileCoverageTree.split('\n').length;
      if (totalLines > 50) {
        console.log(`... (${totalLines - 50} more lines)`);
      }
    }

    console.log('\n' + '═'.repeat(60));
    console.log('Diagnosis complete.');
    console.log('');
  } finally {
    await connection.close();
  }
}
