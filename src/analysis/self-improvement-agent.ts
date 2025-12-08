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
} from '../services/repository/unified-repo-access.js';
import type { BenchmarkRun } from '../domain/benchmark.js';
import type { QualityBenchmarkRun } from '../domain/quality-benchmark.js';
import type { WikiPage } from '../domain/wiki-page.js';
import {
  analysisTools,
  type AnalysisToolContext,
} from '../services/llm/analysis-tools.js';
import { SELF_IMPROVEMENT_SYSTEM_PROMPT } from './prompts.js';
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
   * Run a self-improvement analysis on the specified benchmark runs.
   */
  async analyze(
    repoId: string,
    wikiId: string,
    benchmarkRunIds: string[]
  ): Promise<SelfImprovementRun> {
    // Load benchmark runs
    const benchmarkRuns: BenchmarkRun[] = [];
    for (const id of benchmarkRunIds) {
      const run = await this.repos.benchmarks.findById(id);
      if (run && run.status === 'completed') {
        benchmarkRuns.push(run);
      }
    }

    if (benchmarkRuns.length < 2) {
      throw new Error('At least 2 completed benchmark runs are required for analysis');
    }

    // Sort by iteration count
    benchmarkRuns.sort((a, b) => a.iterationCount - b.iterationCount);

    // Load quality benchmark runs for the same wiki in the same iteration range
    const minIteration = benchmarkRuns[0]!.iterationCount;
    const maxIteration = benchmarkRuns[benchmarkRuns.length - 1]!.iterationCount;

    // Use findByWiki to ensure we only get quality benchmarks for the same wiki
    // as the accuracy benchmarks being analyzed (not orphaned data from deleted wikis)
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

      // Build warm-start context
      const warmStartContext = this.buildWarmStartContext(
        benchmarkRuns,
        qualityBenchmarkRuns,
        wikiPages
      );

      // Create tool executor
      const executeTools = this.createToolExecutor(toolContext);

      // Run the agentic analysis
      const completion = await this.llm.completeWithTools({
        system: SELF_IMPROVEMENT_SYSTEM_PROMPT,
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
   * Build the warm-start context that gives the agent an overview before it starts exploring.
   */
  private buildWarmStartContext(
    benchmarkRuns: BenchmarkRun[],
    qualityRuns: QualityBenchmarkRun[],
    wikiPages: WikiPage[]
  ): string {
    const sections: string[] = [];

    sections.push('# Self-Improvement Analysis Request');
    sections.push('');
    sections.push('Analyze the following benchmark data and produce improvement recommendations.');
    sections.push('');

    // Overview
    const firstBenchmark = benchmarkRuns[0]!;
    const lastBenchmark = benchmarkRuns[benchmarkRuns.length - 1]!;

    sections.push('## Analysis Scope');
    sections.push(`- Benchmark runs: ${benchmarkRuns.length}`);
    sections.push(`- Iteration range: ${firstBenchmark.iterationCount} to ${lastBenchmark.iterationCount}`);
    sections.push(`- Quality runs in range: ${qualityRuns.length}`);
    sections.push(`- Current wiki pages: ${wikiPages.length}`);
    sections.push('');

    // Score summary
    sections.push('## Score Progression');
    sections.push(`- Accuracy: ${firstBenchmark.summary.score.toFixed(1)}% → ${lastBenchmark.summary.score.toFixed(1)}% (${(lastBenchmark.summary.score - firstBenchmark.summary.score >= 0 ? '+' : '')}${(lastBenchmark.summary.score - firstBenchmark.summary.score).toFixed(1)})`);

    if (qualityRuns.length >= 2) {
      const firstQuality = qualityRuns[0]!;
      const lastQuality = qualityRuns[qualityRuns.length - 1]!;
      sections.push(`- Quality: ${firstQuality.summary.overallScore.toFixed(1)} → ${lastQuality.summary.overallScore.toFixed(1)} (${(lastQuality.summary.overallScore - firstQuality.summary.overallScore >= 0 ? '+' : '')}${(lastQuality.summary.overallScore - firstQuality.summary.overallScore).toFixed(1)})`);
    }
    sections.push('');

    // Question overview from latest run
    sections.push('## Latest Benchmark Results');
    sections.push(`- Total questions: ${lastBenchmark.summary.totalQuestions}`);
    sections.push(`- Accurate: ${lastBenchmark.summary.accurate}`);
    sections.push(`- Partial: ${lastBenchmark.summary.partial}`);
    sections.push(`- Inaccurate: ${lastBenchmark.summary.inaccurate}`);
    sections.push(`- No answer: ${lastBenchmark.summary.noAnswer}`);
    sections.push('');

    // List questions with their latest grades
    sections.push('## Questions');
    sections.push('');
    for (const result of lastBenchmark.results) {
      const icon = result.grade === 'accurate' ? '✓' : result.grade === 'partial' ? '○' : result.grade === 'inaccurate' ? '✗' : '?';
      sections.push(`- ${icon} \`${result.questionId}\`: ${result.grade}`);
    }
    sections.push('');

    // Instructions
    sections.push('## Your Task');
    sections.push('');
    sections.push('1. Use the available tools to investigate the benchmark trends');
    sections.push('2. Identify what\'s working well and what needs improvement');
    sections.push('3. Correlate changes with agent activity');
    sections.push('4. Produce a detailed analysis report with actionable recommendations');
    sections.push('');
    sections.push('Start by getting an overview of the trends to see which questions improved or got stuck, then investigate the interesting cases.');

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
