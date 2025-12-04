/**
 * Grader Agent - Evaluates wiki answers against actual code.
 *
 * The grader uses tool calls to read code files and verify
 * whether the wiki's answer is accurate, partial, or incorrect.
 *
 * Supports both local repositories (via filesystem) and GitHub
 * repositories (via RepositoryService API).
 */

import type { LLMService } from '../services/llm/llm-service.js';
import type { ToolContext, ToolDefinition } from '../services/llm/tools.js';
import { readFileTool, searchFilesTool, listDirectoryTool, codebaseTools } from '../services/llm/codebase-tools.js';
import type { BenchmarkQuestion, BenchmarkGrade } from '../domain/benchmark.js';
import type { RepositoryService } from '../services/repository/repository-service.js';
import type { Repo } from '../domain/repo.js';

/**
 * Result of grading a wiki answer.
 */
export interface GradeResult {
  /** The assigned grade */
  grade: BenchmarkGrade;
  /** Grader's confidence in this grade (0-1) */
  confidence: number;
  /** Explanation of why this grade was given */
  reasoning: string;
  /** Files that were read to verify the answer */
  filesChecked: string[];
  /** LLM cost for grading */
  costUsd: number;
}

/**
 * Context for grading - supports both local and GitHub repos.
 */
export interface GradeContext {
  /** Local filesystem path (for local repos) */
  repoPath?: string;
  /** Repository service (for GitHub repos) */
  repoService?: RepositoryService;
  /** Repository entity (required when using repoService) */
  repo?: Repo;
}

/**
 * Grader Agent that evaluates wiki answers by checking against code.
 */
export class GraderAgent {
  constructor(
    private readonly llm: LLMService
  ) {}

  /**
   * Grade a wiki answer against the actual codebase.
   *
   * @param question - The benchmark question being evaluated
   * @param wikiAnswer - The wiki's answer to the question
   * @param context - Either a string (legacy repoPath) or GradeContext object
   */
  async grade(
    question: BenchmarkQuestion,
    wikiAnswer: string,
    context: string | GradeContext
  ): Promise<GradeResult> {
    const filesChecked: string[] = [];

    // Normalize context - support legacy string repoPath for backwards compatibility
    const gradeContext: GradeContext = typeof context === 'string'
      ? { repoPath: context }
      : context;

    // Create tools based on what's available
    const toolSetup = this.createToolsForContext(gradeContext, filesChecked);

    if (!toolSetup) {
      // No tools available - return a result indicating we couldn't verify
      return {
        grade: 'partial',
        confidence: 0.3,
        reasoning: 'Unable to access repository to verify the wiki answer. No local path or repository service available.',
        filesChecked: [],
        costUsd: 0,
      };
    }

    const { tools, executeTools } = toolSetup;
    const toolDefs = tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));

    // Build the grading prompt
    const verificationContext = question.verificationHints?.length
      ? `\nSuggested files to check: ${question.verificationHints.join(', ')}`
      : '';

    const prompt = `You are grading how well a wiki answered a question about a codebase.

## Question
${question.question}

## Wiki's Answer
${wikiAnswer}
${verificationContext}

## Your Task
1. Use the tools to read relevant code files and verify the wiki's answer
2. Check if the answer is accurate, partially correct, or incorrect
3. Provide a clear explanation of your grading decision

## Grading Criteria
- **accurate**: The wiki's answer correctly and completely describes what the code does. Key facts are correct and the wiki does NOT claim to be missing information.
- **partial**: The wiki's answer is partially correct but missing important details, has minor inaccuracies, OR the wiki provides some correct information while acknowledging gaps in its knowledge.
- **inaccurate**: The wiki's answer is wrong or significantly misleading.
- **no_answer**: The wiki couldn't provide an answer, said it doesn't have information, OR the wiki's response primarily consists of stating that information is missing/unavailable.

IMPORTANT: If the wiki claims it is missing information or doesn't have documentation on a topic, this is a PENALTY, not a correct answer. The wiki should be marked down for knowledge gaps, not rewarded for honestly admitting them.

Start by reading the relevant code files, then provide your grade.`;

    const result = await this.llm.completeWithTools({
      system: GRADER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      tools: toolDefs,
      executeTools,
      maxTokens: 4000, // Increased from 2000 - tool call arguments were being truncated with some models
      temperature: 0.2,
      maxToolRounds: 5,
    });

    // Parse the grading response
    const parsed = this.parseGradingResponse(result.content);

    return {
      grade: parsed.grade,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      filesChecked,
      costUsd: result.costUsd,
    };
  }

  /**
   * Create tools for the given grading context.
   * Returns null if no tools can be created (no access method available).
   */
  private createToolsForContext(
    context: GradeContext,
    filesChecked: string[]
  ): {
    tools: ToolDefinition[];
    executeTools: (calls: Array<{ id: string; name: string; input: Record<string, unknown> }>) => Promise<Array<{ id: string; result: string }>>;
  } | null {
    // Try local filesystem first (if repoPath is provided)
    if (context.repoPath) {
      const toolContext: ToolContext = {
        repoPath: context.repoPath,
        maxFileSize: 50000, // 50KB per file for grading
      };

      const tools = [readFileTool, searchFilesTool, listDirectoryTool];

      return {
        tools,
        executeTools: async (calls) => {
          const results: Array<{ id: string; result: string }> = [];

          for (const call of calls) {
            const tool = tools.find(t => t.name === call.name);
            if (tool) {
              const result = await tool.execute(call.input, toolContext);
              results.push({ id: call.id, result });

              // Track file reads
              if (call.name === 'read_file' && call.input['path']) {
                filesChecked.push(call.input['path'] as string);
              }
            } else {
              results.push({ id: call.id, result: `Unknown tool: ${call.name}` });
            }
          }

          return results;
        },
      };
    }

    // Try GitHub API (if repoService and repo are provided)
    if (context.repoService && context.repo) {
      return this.createApiTools(context.repoService, context.repo, filesChecked);
    }

    // No access method available
    return null;
  }

  /**
   * Create API-based tools for GitHub repositories.
   */
  private createApiTools(
    repoService: RepositoryService,
    repo: Repo,
    filesChecked: string[]
  ): {
    tools: ToolDefinition[];
    executeTools: (calls: Array<{ id: string; name: string; input: Record<string, unknown> }>) => Promise<Array<{ id: string; result: string }>>;
  } {
    const apiTools: ToolDefinition[] = [
      {
        name: 'read_file',
        description: 'Read the contents of a file from the repository.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path from repository root',
            },
          },
          required: ['path'],
        },
        execute: async (input) => {
          const path = input['path'] as string;
          try {
            filesChecked.push(path);
            return await repoService.getFileContent(repo, path);
          } catch (error) {
            return `Error reading "${path}": ${error instanceof Error ? error.message : String(error)}`;
          }
        },
      },
      {
        name: 'list_directory',
        description: 'List contents of a directory.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Directory path relative to repo root',
            },
          },
          required: ['path'],
        },
        execute: async (input) => {
          const path = input['path'] as string;
          try {
            const entries = await repoService.listDirectory(repo, path);
            return entries.map(e => `${e.name}${e.type === 'dir' ? '/' : ''}`).join('\n');
          } catch (error) {
            return `Error listing "${path}": ${error instanceof Error ? error.message : String(error)}`;
          }
        },
      },
      {
        name: 'search_files',
        description: 'Search for files matching a pattern. Returns file paths.',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'Glob pattern (e.g., "**/*.ts")',
            },
          },
          required: ['pattern'],
        },
        execute: async (input) => {
          const pattern = input['pattern'] as string;
          try {
            const allFiles = await repoService.getFileTree(repo);
            // Simple glob matching (supports **, *, and ?)
            const matches = filterByGlob(allFiles, pattern);
            if (matches.length === 0) {
              return `No files found matching "${pattern}"`;
            }
            return matches.join('\n');
          } catch (error) {
            return `Error searching for "${pattern}": ${error instanceof Error ? error.message : String(error)}`;
          }
        },
      },
    ];

    return {
      tools: apiTools,
      executeTools: async (calls) => {
        const results = await Promise.all(calls.map(async (call) => {
          const tool = apiTools.find(t => t.name === call.name);
          if (!tool) {
            return { id: call.id, result: `Error: Unknown tool "${call.name}"` };
          }
          // API tools don't need a toolContext, they use the repoService directly
          const result = await tool.execute(call.input, { repoPath: '', maxFileSize: 100000 });
          return { id: call.id, result };
        }));
        return results;
      },
    };
  }

  /**
   * Parse the LLM's grading response.
   */
  private parseGradingResponse(response: string): {
    grade: BenchmarkGrade;
    confidence: number;
    reasoning: string;
  } {
    // Look for explicit grade markers
    const gradeMatch = response.match(/GRADE:\s*(accurate|partial|inaccurate|no_answer)/i);
    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);

    let grade: BenchmarkGrade = 'partial'; // Default
    if (gradeMatch) {
      grade = gradeMatch[1]!.toLowerCase() as BenchmarkGrade;
    } else {
      // Try to infer from response
      const lowerResponse = response.toLowerCase();
      if (lowerResponse.includes('accurate') && !lowerResponse.includes('inaccurate')) {
        grade = 'accurate';
      } else if (lowerResponse.includes('inaccurate') || lowerResponse.includes('incorrect') || lowerResponse.includes('wrong')) {
        grade = 'inaccurate';
      } else if (lowerResponse.includes('no answer') || lowerResponse.includes('no information')) {
        grade = 'no_answer';
      }
    }

    const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]!) : 0.7;

    // Clean up reasoning - remove grade/confidence markers
    let reasoning = response
      .replace(/GRADE:\s*(accurate|partial|inaccurate|no_answer)/gi, '')
      .replace(/CONFIDENCE:\s*[\d.]+/gi, '')
      .trim();

    // Truncate if too long
    if (reasoning.length > 1000) {
      reasoning = reasoning.slice(0, 1000) + '...';
    }

    return { grade, confidence, reasoning };
  }
}

const GRADER_SYSTEM_PROMPT = `You are a code verification expert. Your job is to verify whether a wiki's answer about a codebase is accurate by examining the actual code.

You have access to tools to read files from the repository. Use them to verify claims made in the wiki's answer.

Guidelines:
1. Start by reading the suggested files or searching for relevant code
2. Compare what the wiki says against what the code actually does
3. Be fair but rigorous - minor wording differences are OK if the concept is correct
4. If the wiki says "I don't have information" or claims the information is missing/unavailable, grade as "no_answer"
5. If the wiki makes specific claims that are wrong, grade as "inaccurate"
6. If the wiki is correct but missing key details, grade as "partial"
7. If the wiki provides some correct info but also admits to gaps/missing documentation, grade as "partial"
8. If the wiki accurately and completely describes the code's behavior without claiming missing info, grade as "accurate"

IMPORTANT: The purpose of this benchmark is to measure wiki COMPLETENESS. If the wiki admits it is missing information, this is a knowledge gap that should be penalized - not rewarded for honesty. A wiki that says "I don't have this information" has FAILED to document that aspect of the codebase.

End your response with:
GRADE: [accurate|partial|inaccurate|no_answer]
CONFIDENCE: [0.0-1.0]

Then explain your reasoning briefly.`;

/**
 * Simple glob pattern matching for file paths.
 */
function filterByGlob(files: string[], pattern: string): string[] {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/<<<GLOBSTAR>>>/g, '.*');

  const regex = new RegExp(`^${regexPattern}$`);
  return files.filter(file => regex.test(file));
}

/**
 * Create a grader agent instance.
 */
export function createGraderAgent(llm: LLMService): GraderAgent {
  return new GraderAgent(llm);
}
