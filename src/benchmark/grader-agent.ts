/**
 * Grader Agent - Evaluates wiki answers against actual code.
 *
 * OPTIMIZATION: Pre-fetches verification hint files and includes them
 * in the prompt, reducing or eliminating tool calls. Falls back to
 * tool-based approach if pre-fetch fails or hints are directories.
 *
 * Uses UnifiedRepoAccess to support both local and GitHub repositories.
 */

import type { LLMService } from '../services/llm/llm-service.js';
import type { ToolDefinition } from '../services/llm/tools.js';
import type { BenchmarkQuestion, BenchmarkGrade } from '../domain/benchmark.js';
import type { UnifiedRepoAccess } from '../services/repository/unified-repo-access.js';

/** Pre-fetched file content for verification */
interface PrefetchedFile {
  path: string;
  content: string;
  error?: string;
}

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
 * Context for grading - provides repository access.
 */
export interface GradeContext {
  /** Unified repository access for file operations */
  repoAccess: UnifiedRepoAccess;
}

/**
 * Grader Agent that evaluates wiki answers by checking against code.
 */
export class GraderAgent {
  // Max content length per pre-fetched file
  private readonly MAX_FILE_CONTENT_LENGTH = 8000;
  // Total max context for pre-fetched files
  private readonly MAX_TOTAL_PREFETCH_LENGTH = 30000;
  // Max files to pre-fetch
  private readonly MAX_PREFETCH_FILES = 10;

  constructor(
    private readonly llm: LLMService
  ) {}

  /**
   * Grade a wiki answer against the actual codebase.
   *
   * Uses optimized pre-fetch approach when verification hints are provided.
   * Falls back to tool-based approach if pre-fetch fails or for complex cases.
   *
   * @param question - The benchmark question being evaluated
   * @param wikiAnswer - The wiki's answer to the question
   * @param context - Grading context with repository access
   */
  async grade(
    question: BenchmarkQuestion,
    wikiAnswer: string,
    context: GradeContext
  ): Promise<GradeResult> {
    console.log(`[Grader] Starting grade for question: ${question.id}`);
    console.log(`[Grader] Using unified repo access (isLocal: ${context.repoAccess.isLocal()})`);

    // If we have verification hints, try pre-fetch approach first
    if (question.verificationHints && question.verificationHints.length > 0) {
      const prefetchResult = await this.gradeWithPrefetch(question, wikiAnswer, context);
      if (prefetchResult) {
        return prefetchResult;
      }
      console.log(`[Grader] Pre-fetch approach failed, falling back to tools`);
    }

    // Fall back to tool-based approach
    return this.gradeWithTools(question, wikiAnswer, context);
  }

  /**
   * Optimized grading using pre-fetched verification files.
   * Returns null if pre-fetch fails and we should fall back to tools.
   */
  private async gradeWithPrefetch(
    question: BenchmarkQuestion,
    wikiAnswer: string,
    context: GradeContext
  ): Promise<GradeResult | null> {
    const hints = question.verificationHints || [];
    const prefetchedFiles = await this.prefetchFiles(hints, context.repoAccess);

    // If we couldn't fetch any files, fall back to tools
    const successfulFiles = prefetchedFiles.filter(f => !f.error);
    if (successfulFiles.length === 0) {
      console.log(`[Grader] No files could be pre-fetched from hints: ${hints.join(', ')}`);
      return null;
    }

    console.log(`[Grader] Pre-fetched ${successfulFiles.length}/${prefetchedFiles.length} files`);

    // Build prompt with pre-fetched content
    const prompt = this.buildPrefetchPrompt(question, wikiAnswer, prefetchedFiles);

    const result = await this.llm.complete({
      system: GRADER_SYSTEM_PROMPT_PREFETCH,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
      temperature: 0.2,
    });

    console.log(`[Grader] Pre-fetch approach completed - 0 tool calls needed`);

    const parsed = this.parseGradingResponse(result.content);

    return {
      grade: parsed.grade,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      filesChecked: successfulFiles.map(f => f.path),
      costUsd: result.costUsd,
    };
  }

  /**
   * Pre-fetch files from verification hints, expanding directories if needed.
   */
  private async prefetchFiles(
    hints: string[],
    repoAccess: UnifiedRepoAccess
  ): Promise<PrefetchedFile[]> {
    const files: PrefetchedFile[] = [];
    let totalLength = 0;

    for (const hint of hints) {
      if (files.length >= this.MAX_PREFETCH_FILES) break;
      if (totalLength >= this.MAX_TOTAL_PREFETCH_LENGTH) break;

      try {
        // Try to read as a file first
        const content = await repoAccess.getFileContent(hint);
        const truncatedContent = content.length > this.MAX_FILE_CONTENT_LENGTH
          ? content.slice(0, this.MAX_FILE_CONTENT_LENGTH) + '\n\n[Content truncated...]'
          : content;

        files.push({ path: hint, content: truncatedContent });
        totalLength += truncatedContent.length;
      } catch (error) {
        // If it's a directory, try to list and fetch files from it
        try {
          const entries = await repoAccess.listDirectory(hint);
          const fileEntries = entries.filter(e => e.type === 'file').slice(0, 5);

          for (const entry of fileEntries) {
            if (files.length >= this.MAX_PREFETCH_FILES) break;
            if (totalLength >= this.MAX_TOTAL_PREFETCH_LENGTH) break;

            const filePath = `${hint}/${entry.name}`;
            try {
              const content = await repoAccess.getFileContent(filePath);
              const truncatedContent = content.length > this.MAX_FILE_CONTENT_LENGTH
                ? content.slice(0, this.MAX_FILE_CONTENT_LENGTH) + '\n\n[Content truncated...]'
                : content;

              files.push({ path: filePath, content: truncatedContent });
              totalLength += truncatedContent.length;
            } catch {
              files.push({ path: filePath, content: '', error: 'Could not read file' });
            }
          }
        } catch {
          // Neither a file nor a directory, record the error
          files.push({ path: hint, content: '', error: `Could not access: ${error instanceof Error ? error.message : String(error)}` });
        }
      }
    }

    return files;
  }

  /**
   * Build prompt with pre-fetched file content.
   */
  private buildPrefetchPrompt(
    question: BenchmarkQuestion,
    wikiAnswer: string,
    files: PrefetchedFile[]
  ): string {
    const sections: string[] = [];

    sections.push(`## Question\n${question.question}`);
    sections.push(`\n## Wiki's Answer\n${wikiAnswer}`);

    sections.push(`\n## Code Files for Verification\n`);
    sections.push('The following code files are provided to verify the wiki answer:\n');

    for (const file of files) {
      if (file.error) {
        sections.push(`### ${file.path}\nError: ${file.error}\n`);
      } else {
        sections.push(`### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n`);
      }
    }

    sections.push(`\n## Your Task
1. Compare the wiki's answer against the actual code provided above
2. Determine if the answer is accurate, partially correct, or incorrect
3. Provide a clear explanation of your grading decision

## Grading Criteria
- **accurate**: The wiki's answer correctly and completely describes what the code does. Key facts are correct and the wiki does NOT claim to be missing information.
- **partial**: The wiki's answer is partially correct but missing important details, has minor inaccuracies, OR the wiki provides some correct information while acknowledging gaps in its knowledge.
- **inaccurate**: The wiki's answer is wrong or significantly misleading.
- **no_answer**: The wiki couldn't provide an answer, said it doesn't have information, OR the wiki's response primarily consists of stating that information is missing/unavailable.

IMPORTANT: If the wiki claims it is missing information or doesn't have documentation on a topic, this is a PENALTY, not a correct answer. The wiki should be marked down for knowledge gaps, not rewarded for honestly admitting them.

Provide your grade based on the code files above.`);

    return sections.join('\n');
  }

  /**
   * Tool-based grading approach for complex cases.
   */
  private async gradeWithTools(
    question: BenchmarkQuestion,
    wikiAnswer: string,
    context: GradeContext
  ): Promise<GradeResult> {
    const filesChecked: string[] = [];

    // Create tools using unified repo access
    const { tools, executeTools } = this.createUnifiedTools(context.repoAccess, filesChecked);
    const toolDefs = tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));

    console.log(`[Grader] Providing ${toolDefs.length} tools to LLM: ${toolDefs.map(t => t.name).join(', ')}`);

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
      maxTokens: 4000,
      temperature: 0.2,
      maxToolRounds: 5,
    });

    // Log tool usage summary
    console.log(`[Grader] LLM completed - toolRounds: ${result.toolRounds}, toolCalls: ${result.toolCalls.length}, filesChecked: ${filesChecked.length}`);
    if (result.toolCalls.length > 0) {
      console.log(`[Grader] Tool calls made: ${result.toolCalls.map(tc => `${tc.name}(${JSON.stringify(tc.input).substring(0, 50)})`).join(', ')}`);
    } else {
      console.warn(`[Grader] WARNING: LLM made NO tool calls - it cannot verify the wiki answer!`);
    }

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
   * Create tools using UnifiedRepoAccess (works for both local and GitHub).
   */
  private createUnifiedTools(
    repoAccess: UnifiedRepoAccess,
    filesChecked: string[]
  ): {
    tools: ToolDefinition[];
    executeTools: (calls: Array<{ id: string; name: string; input: Record<string, unknown> }>) => Promise<Array<{ id: string; result: string }>>;
  } {
    const unifiedTools: ToolDefinition[] = [
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
          console.log(`[Grader Unified] read_file: ${path}`);
          try {
            filesChecked.push(path);
            const content = await repoAccess.getFileContent(path);
            if (content.length > 50000) {
              return `File "${path}" is too large (${content.length} bytes). First 50000 bytes:\n${content.substring(0, 50000)}`;
            }
            const truncated = content.length > 200 ? content.substring(0, 200) + '...' : content;
            console.log(`[Grader Unified] read_file success: ${truncated}`);
            return content;
          } catch (error) {
            const errorMsg = `Error reading "${path}": ${error instanceof Error ? error.message : String(error)}`;
            console.error(`[Grader Unified] ${errorMsg}`);
            return errorMsg;
          }
        },
      },
      {
        name: 'list_directory',
        description: 'List contents of a directory in the repository.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Directory path relative to repository root',
            },
          },
          required: ['path'],
        },
        execute: async (input) => {
          const path = input['path'] as string;
          console.log(`[Grader Unified] list_directory: ${path}`);
          try {
            const entries = await repoAccess.listDirectory(path);
            const result = entries.map(e => `${e.name}${e.type === 'dir' ? '/' : ''}`).join('\n');
            console.log(`[Grader Unified] list_directory success: ${result.substring(0, 200)}`);
            return result;
          } catch (error) {
            const errorMsg = `Error listing "${path}": ${error instanceof Error ? error.message : String(error)}`;
            console.error(`[Grader Unified] ${errorMsg}`);
            return errorMsg;
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
          console.log(`[Grader Unified] search_files: ${pattern}`);
          try {
            const allFiles = await repoAccess.getFileTree();
            console.log(`[Grader Unified] getFileTree returned ${allFiles.length} files`);
            const matches = filterByGlob(allFiles, pattern);
            if (matches.length === 0) {
              console.log(`[Grader Unified] search_files: no matches for ${pattern}`);
              return `No files found matching "${pattern}"`;
            }
            console.log(`[Grader Unified] search_files: ${matches.length} matches`);
            return matches.join('\n');
          } catch (error) {
            const errorMsg = `Error searching for "${pattern}": ${error instanceof Error ? error.message : String(error)}`;
            console.error(`[Grader Unified] ${errorMsg}`);
            return errorMsg;
          }
        },
      },
    ];

    return {
      tools: unifiedTools,
      executeTools: async (calls) => {
        console.log(`[Grader Unified] Executing ${calls.length} tool calls`);
        const results = await Promise.all(calls.map(async (call) => {
          const tool = unifiedTools.find(t => t.name === call.name);
          if (!tool) {
            console.warn(`[Grader Unified] Unknown tool: ${call.name}`);
            return { id: call.id, result: `Error: Unknown tool "${call.name}"` };
          }
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
 * System prompt for pre-fetch approach (code already provided, no tools).
 */
const GRADER_SYSTEM_PROMPT_PREFETCH = `You are a code verification expert. Your job is to verify whether a wiki's answer about a codebase is accurate by examining the actual code.

The relevant code files have been provided to you in the prompt. You do not need to use any tools - the code you need is already available.

Guidelines:
1. Compare the wiki's answer against the code files provided
2. Be fair but rigorous - minor wording differences are OK if the concept is correct
3. If the wiki says "I don't have information" or claims the information is missing/unavailable, grade as "no_answer"
4. If the wiki makes specific claims that are wrong, grade as "inaccurate"
5. If the wiki is correct but missing key details, grade as "partial"
6. If the wiki provides some correct info but also admits to gaps/missing documentation, grade as "partial"
7. If the wiki accurately and completely describes the code's behavior without claiming missing info, grade as "accurate"

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
