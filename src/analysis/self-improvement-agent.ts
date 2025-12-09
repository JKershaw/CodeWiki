/**
 * Self-Improvement Analysis Agent.
 *
 * Analyzes benchmark results over time to produce actionable recommendations
 * for improving the wiki generation process.
 */

import type { Repositories } from '../repositories/index.js';
import type { LLMService } from '../services/llm/llm-service.js';
import type { GitService } from '../services/git/git-service.js';
import type { RepositoryServiceFactory } from '../services/repository/repository-service.js';
import {
  createUnifiedRepoAccessFactory,
  type UnifiedRepoAccessFactory,
  type UnifiedRepoAccess,
} from '../services/repository/unified-repo-access.js';
import type { BenchmarkRun } from '../domain/benchmark.js';
import type { QualityBenchmarkRun } from '../domain/quality-benchmark.js';
import type { WikiPage } from '../domain/wiki-page.js';
import {
  analysisTools,
  type AnalysisToolContext,
} from '../services/llm/analysis-tools.js';
import { getSystemPrompt } from './prompts.js';
import {
  createSelfImprovementRun,
  completeSelfImprovementRun,
  failSelfImprovementRun,
  type SelfImprovementRun,
  type AnalysisTrace,
} from '../domain/self-improvement.js';
import { v4 as uuid } from 'uuid';

// ============================================================================
// Agent Configuration
// ============================================================================

const DEFAULT_MAX_TOOL_ROUNDS = 30;
const DEFAULT_MAX_TOKENS = 16000;


// ============================================================================
// Self-Improvement Agent
// ============================================================================

export class SelfImprovementAgent {
  private readonly repoAccessFactory?: UnifiedRepoAccessFactory;

  constructor(
    private readonly repos: Repositories,
    private readonly llm: LLMService,
    private readonly git?: GitService,
    private readonly repoServiceFactory?: RepositoryServiceFactory
  ) {
    // Create unified repo access factory if we have the required dependencies
    if (repoServiceFactory) {
      this.repoAccessFactory = createUnifiedRepoAccessFactory({
        repos,
        repoServiceFactory,
        ...(git && { gitService: git }),
      });
    }
  }

  /**
   * Run a self-improvement analysis.
   *
   * Starts with wiki quality assessment and uses benchmarks as supporting evidence.
   *
   * @param repoId - Repository ID
   * @param wikiId - Wiki ID
   * @param benchmarkRunIds - IDs of benchmark runs to analyze (can be empty for wiki-only mode)
   */
  async analyze(
    repoId: string,
    wikiId: string,
    benchmarkRunIds: string[]
  ): Promise<SelfImprovementRun> {
    // Load benchmark runs (optional - used as supporting evidence)
    const benchmarkRuns: BenchmarkRun[] = [];
    for (const id of benchmarkRunIds) {
      const run = await this.repos.benchmarks.findById(id);
      if (run && run.status === 'completed') {
        benchmarkRuns.push(run);
      }
    }

    // Sort by iteration count
    benchmarkRuns.sort((a, b) => a.iterationCount - b.iterationCount);

    // Determine iteration range
    // If no benchmarks, use all available quality benchmarks
    const minIteration = benchmarkRuns.length > 0 ? benchmarkRuns[0]!.iterationCount : 0;
    const maxIteration = benchmarkRuns.length > 0 ? benchmarkRuns[benchmarkRuns.length - 1]!.iterationCount : Infinity;

    // Load quality benchmark runs for the same wiki
    const allQualityRuns = await this.repos.qualityBenchmarks.findByWiki(wikiId);
    const qualityBenchmarkRuns = allQualityRuns
      .filter(r =>
        r.status === 'completed' &&
        r.iterationCount >= minIteration &&
        r.iterationCount <= maxIteration
      )
      .sort((a, b) => a.iterationCount - b.iterationCount);

    // Load wiki pages
    const wikiPages = await this.repos.wikiPages.findByWiki(wikiId);

    // Create the analysis run record
    const run = createSelfImprovementRun({
      id: uuid(),
      repoId,
      wikiId,
      benchmarkRunIds,
      iterationRange: [minIteration, maxIteration],
    });

    try {
      // Create unified repo access for source code exploration
      let repoAccess;
      if (this.repoAccessFactory) {
        try {
          repoAccess = await this.repoAccessFactory.create(repoId);
        } catch (err) {
          // Continue without source access if creation fails
          console.warn(`[SelfImprovement] Failed to create repo access: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Build the analysis context
      const toolContext: AnalysisToolContext = {
        repos: this.repos,
        repoId,
        wikiId,
        benchmarkRuns,
        qualityBenchmarkRuns,
        wikiPages,
        ...(repoAccess && { repoAccess }),
      };

      // Build warm-start context for wiki-quality-first analysis
      const warmStartContext = this.buildWikiQualityWarmStart(wikiPages, qualityBenchmarkRuns, benchmarkRuns, repoAccess);

      // Create tool executor
      const executeTools = this.createToolExecutor(toolContext);

      // Run the agentic analysis
      const completion = await this.llm.completeWithTools({
        system: getSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: warmStartContext,
          },
        ],
        tools: analysisTools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
        executeTools,
        maxToolRounds: DEFAULT_MAX_TOOL_ROUNDS,
        maxTokens: DEFAULT_MAX_TOKENS,
        temperature: 0.3,
      });

      // Build the analysis trace from the completion
      const analysisTrace: AnalysisTrace = {
        toolCalls: completion.toolCalls,
        toolRounds: completion.toolRounds,
      };

      // Complete the run with the report and trace
      return completeSelfImprovementRun(run, completion.content, completion.costUsd, analysisTrace);
    } catch (error) {
      return failSelfImprovementRun(
        run,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Build the warm-start context for wiki-quality-first analysis.
   * Focuses on wiki structure and quality, with benchmarks as supporting evidence.
   */
  private buildWikiQualityWarmStart(
    wikiPages: WikiPage[],
    qualityRuns: QualityBenchmarkRun[],
    benchmarkRuns: BenchmarkRun[],
    repoAccess?: UnifiedRepoAccess
  ): string {
    const sections: string[] = [];

    sections.push('# Wiki Quality Self-Assessment');
    sections.push('');
    sections.push('Assess the quality of this generated wiki and identify opportunities to improve the generation process.');
    sections.push('');

    // Wiki Overview
    sections.push('## Wiki Overview');
    sections.push('');
    sections.push(`**Total pages:** ${wikiPages.length}`);

    // Group pages by category
    const pagesByCategory = new Map<string, WikiPage[]>();
    for (const page of wikiPages) {
      const category = page.path.includes('/') ? page.path.split('/')[0]! : 'root';
      if (!pagesByCategory.has(category)) {
        pagesByCategory.set(category, []);
      }
      pagesByCategory.get(category)!.push(page);
    }

    // Show category breakdown
    sections.push('');
    sections.push('**Categories:**');
    const sortedCategories = [...pagesByCategory.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [category, pages] of sortedCategories.slice(0, 8)) {
      const bar = '█'.repeat(Math.min(pages.length, 20));
      sections.push(`- ${category}/ (${pages.length} pages) ${bar}`);
    }
    if (sortedCategories.length > 8) {
      sections.push(`- ... and ${sortedCategories.length - 8} more categories`);
    }

    // Confidence distribution
    const avgConfidence = wikiPages.length > 0
      ? wikiPages.reduce((sum, p) => sum + p.confidence, 0) / wikiPages.length
      : 0;
    const lowConfidencePages = wikiPages.filter(p => p.confidence < 0.5);
    sections.push('');
    sections.push(`**Average confidence:** ${(avgConfidence * 100).toFixed(0)}%`);
    if (lowConfidencePages.length > 0) {
      sections.push(`**Low confidence pages (< 50%):** ${lowConfidencePages.length}`);
    }

    // Quality Snapshot (if available)
    if (qualityRuns.length > 0) {
      const latestQuality = qualityRuns[qualityRuns.length - 1]!;
      sections.push('');
      sections.push('## Quality Snapshot (Latest Assessment)');
      sections.push('');
      sections.push('| Dimension | Score |');
      sections.push('|-----------|-------|');

      const dimensions = Object.entries(latestQuality.summary.byDimension)
        .sort((a, b) => a[1] - b[1]); // Sort by score ascending (worst first)

      for (const [dimension, score] of dimensions) {
        const displayName = dimension.replace(/_/g, ' ');
        sections.push(`| ${displayName} | ${score.toFixed(0)} |`);
      }

      sections.push('');
      sections.push(`**Overall quality score:** ${latestQuality.summary.overallScore.toFixed(0)}/100`);

      if (latestQuality.summary.strengths.length > 0) {
        sections.push(`**Strengths:** ${latestQuality.summary.strengths.join(', ')}`);
      }
      if (latestQuality.summary.weaknesses.length > 0) {
        sections.push(`**Weaknesses:** ${latestQuality.summary.weaknesses.join(', ')}`);
      }
    }

    // Repository context
    sections.push('');
    sections.push('## Repository Context');
    sections.push('');
    if (repoAccess) {
      sections.push('Source code access is available. Use `list_source_directory` and `read_source_file` to explore.');
    } else {
      sections.push('Source code access is not available for this analysis.');
    }

    // Available Benchmark Data (as supporting evidence)
    if (benchmarkRuns.length > 0) {
      sections.push('');
      sections.push('## Available Benchmark Data');
      sections.push('');
      sections.push(`You have access to ${benchmarkRuns.length} accuracy benchmark run(s) that test whether the wiki can answer specific questions.`);
      sections.push('Use these to validate your findings, but let your assessment of the wiki itself drive the analysis.');

      const lastBenchmark = benchmarkRuns[benchmarkRuns.length - 1]!;
      sections.push('');
      sections.push(`Latest benchmark: ${lastBenchmark.summary.score.toFixed(0)}% accuracy`);
      sections.push(`- Accurate: ${lastBenchmark.summary.accurate}/${lastBenchmark.summary.totalQuestions}`);
      sections.push(`- Partial: ${lastBenchmark.summary.partial}/${lastBenchmark.summary.totalQuestions}`);
      sections.push(`- Inaccurate/No answer: ${lastBenchmark.summary.inaccurate + lastBenchmark.summary.noAnswer}/${lastBenchmark.summary.totalQuestions}`);
    } else {
      sections.push('');
      sections.push('## Benchmark Data');
      sections.push('');
      sections.push('No accuracy benchmarks are available. Focus on wiki structure and quality assessment.');
    }

    // Instructions
    sections.push('');
    sections.push('## Your Task');
    sections.push('');
    sections.push('Follow this investigation order:');
    sections.push('');
    sections.push('**Step 1: Compare source to wiki (CRITICAL)**');
    sections.push('- Use `list_source_directory` on `src/` to see what code exists');
    sections.push('- Use `list_wiki_pages` to see what documentation exists');
    sections.push('- Identify GAPS: source files/directories with NO wiki documentation');
    sections.push('- Example: If `src/services/database.ts` exists but no `services/database` wiki page → COVERAGE GAP');
    sections.push('');
    sections.push('**Step 2: Analyze benchmark trends**');
    sections.push('- Use `get_question_trends` to find STUCK questions (no_answer across multiple runs)');
    sections.push('- Use `get_benchmark_summary` to understand overall accuracy');
    sections.push('- Correlate stuck questions with coverage gaps');
    sections.push('');
    sections.push('**Step 3: Assess quality dimensions**');
    sections.push('- Note both STRONG and WEAK dimensions');
    sections.push('- Identify actionability, completeness, and structural issues');
    sections.push('');
    sections.push('**Step 4: Recommend process improvements**');
    sections.push('- Specific changes to agents, orchestrator, or workflow');
    sections.push('- Include verification criteria');
    sections.push('');
    sections.push('START NOW: Use `list_source_directory` with path `src/` to explore the source code structure.');

    return sections.join('\n');
  }

  /**
   * Create a tool executor function for the LLM service.
   */
  private createToolExecutor(context: AnalysisToolContext) {
    return async (
      calls: Array<{ id: string; name: string; input: Record<string, unknown> }>
    ): Promise<Array<{ id: string; result: string }>> => {
      const results = await Promise.all(
        calls.map(async call => {
          const tool = analysisTools.find(t => t.name === call.name);
          if (!tool) {
            return { id: call.id, result: `Error: Unknown tool "${call.name}"` };
          }
          try {
            const result = await tool.execute(call.input, context);
            return { id: call.id, result };
          } catch (error) {
            return {
              id: call.id,
              result: `Error executing ${call.name}: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        })
      );
      return results;
    };
  }
}

/**
 * Create a self-improvement agent instance.
 */
export function createSelfImprovementAgent(
  repos: Repositories,
  llm: LLMService,
  git?: GitService,
  repoServiceFactory?: RepositoryServiceFactory
): SelfImprovementAgent {
  return new SelfImprovementAgent(repos, llm, git, repoServiceFactory);
}
