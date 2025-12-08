/**
 * Service for Q&A chat on self-improvement analysis reports.
 *
 * Allows users to ask follow-up questions about a completed analysis,
 * with the LLM having access to the same tools used during the original analysis.
 */

import { v4 as uuid } from 'uuid';
import type { Repositories } from '../repositories/index.js';
import type { LLMService, Message } from './llm/llm-service.js';
import type { ChatMessage } from '../domain/chat-session.js';
import { createChatMessage } from '../domain/chat-session.js';
import {
  analysisTools,
  type AnalysisToolContext,
} from './llm/analysis-tools.js';
import type { GitService } from './git/git-service.js';
import type { RepositoryServiceFactory } from './repository/repository-service.js';
import {
  createUnifiedRepoAccessFactory,
  type UnifiedRepoAccessFactory,
} from './repository/unified-repo-access.js';

// ============================================================================
// Types
// ============================================================================

export interface ChatResult {
  success: boolean;
  data?: ChatMessage;
  error?: string;
}

// ============================================================================
// Chat System Prompt
// ============================================================================

function buildChatSystemPrompt(report: string): string {
  return `You are a Q&A assistant helping users understand a self-improvement analysis report for CodeWiki.

## Original Analysis Report

${report}

## Your Role

You are helping the user understand and explore the findings in this analysis report. You can:

1. **Answer questions** about the report content
2. **Investigate further** using the available tools to look up specific details
3. **Explain recommendations** and their rationale
4. **Explore specific questions or pages** that were mentioned in the analysis

## Available Tools

You have access to the same analysis tools used during the original analysis:

- **Benchmark tools**: Look up question history, trends, and iteration details
- **Quality tools**: Examine quality scores and dimension breakdowns
- **Wiki tools**: Read wiki page content and structure
- **Provenance tools**: Trace who created/modified pages and why
- **Source tools**: Read and explore source code files
- **History tools**: Explore wiki evolution and edit history

Use these tools when the user asks about specific details not covered in the report.

## Guidelines

- Be concise but thorough in your answers
- Reference specific data from tools when relevant
- If you don't know something, use the tools to investigate
- If the tools can't provide the answer, be honest about the limitations
`;
}

// ============================================================================
// Chat Service
// ============================================================================

export class SelfImprovementChatService {
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
   * Process a user message in a chat session and return the assistant's response.
   */
  async chat(sessionId: string, userMessage: string): Promise<ChatResult> {
    try {
      // Load the session
      const session = await this.repos.chatSessions.findById(sessionId);
      if (!session) {
        return { success: false, error: `Chat session not found: ${sessionId}` };
      }

      if (session.status === 'closed') {
        return { success: false, error: 'Cannot send message: chat session is closed' };
      }

      // Load the self-improvement run to get the report
      const run = await this.repos.selfImprovements.findById(session.selfImprovementRunId);
      if (!run) {
        return { success: false, error: `Self-improvement run not found: ${session.selfImprovementRunId}` };
      }

      // Add the user message to the session
      const userMsg = createChatMessage({
        id: uuid(),
        role: 'user',
        content: userMessage,
      });
      await this.repos.chatSessions.addMessage(sessionId, userMsg, 0);

      // Build the conversation history from previous messages
      const messages: Message[] = session.messages.map(m => ({
        role: m.role,
        content: m.content,
      }));
      // Add the new user message
      messages.push({ role: 'user', content: userMessage });

      // Create unified repo access for source code exploration
      let repoAccess;
      if (this.repoAccessFactory) {
        try {
          repoAccess = await this.repoAccessFactory.create(session.repoId);
        } catch (err) {
          // Continue without source access if creation fails
          console.warn(`[ChatService] Failed to create repo access: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Build the tool context
      // For Q&A, we don't need the full benchmark data loaded - tools will fetch as needed
      const toolContext: AnalysisToolContext = {
        repos: this.repos,
        repoId: session.repoId,
        wikiId: session.wikiId,
        benchmarkRuns: [],
        qualityBenchmarkRuns: [],
        wikiPages: [],
        ...(repoAccess && { repoAccess }),
      };

      // Create tool executor
      const executeTools = this.createToolExecutor(toolContext);

      // Call the LLM with the conversation history and tools
      const completion = await this.llm.completeWithTools({
        system: buildChatSystemPrompt(run.report),
        messages,
        tools: analysisTools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
        executeTools,
        maxToolRounds: 10, // Lower limit for chat than full analysis
        maxTokens: 4096,
        temperature: 0.3,
      });

      // Create the assistant message
      const assistantMsgParams: {
        id: string;
        role: 'assistant';
        content: string;
        toolCalls?: typeof completion.toolCalls;
      } = {
        id: uuid(),
        role: 'assistant',
        content: completion.content,
      };

      if (completion.toolCalls && completion.toolCalls.length > 0) {
        assistantMsgParams.toolCalls = completion.toolCalls;
      }

      const assistantMsg = createChatMessage(assistantMsgParams);

      // Add the assistant message to the session
      await this.repos.chatSessions.addMessage(sessionId, assistantMsg, completion.costUsd);

      return { success: true, data: assistantMsg };
    } catch (error) {
      return {
        success: false,
        error: `Chat error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
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
 * Create a self-improvement chat service instance.
 */
export function createSelfImprovementChatService(
  repos: Repositories,
  llm: LLMService,
  git?: GitService,
  repoServiceFactory?: RepositoryServiceFactory
): SelfImprovementChatService {
  return new SelfImprovementChatService(repos, llm, git, repoServiceFactory);
}
