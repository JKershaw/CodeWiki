import type { AgentContext } from '../../base-agent.js';
import { createAgentResult, createFinding } from '../../base-agent.js';
import type { FindingGroup, FindingType, Finding } from '../../../domain/finding.js';
import type { WikiPage, WikiPageUpdate } from '../../../domain/wiki-page.js';
import type { FindingHandler, FindingHandlerResult } from '../finding-handler.js';
import { HandlerUtils } from '../finding-handler.js';
import { createCodebaseToolExecutor } from '../../agent-helpers.js';
import { createParseContext, parseSection } from '../../parsing/index.js';

/**
 * Handler for inaccurate content findings.
 *
 * This handler processes findings where wiki content doesn't match source code.
 * It reads the actual source file and generates corrected content.
 */
export class InaccuracyHandler implements FindingHandler {
  readonly supportedTypes: readonly FindingType[] = ['inaccurate'];

  async handle(group: FindingGroup, context: AgentContext): Promise<FindingHandlerResult> {
    const pages = await HandlerUtils.loadPages(group.affectedPaths, context);

    if (pages.length === 0) {
      return HandlerUtils.createEmptyResult('No pages found to correct');
    }

    // Set up tools to read source files
    const toolExecutor = createCodebaseToolExecutor(context);
    if (!toolExecutor) {
      return HandlerUtils.createEmptyResult('Cannot read source files: no tool executor available');
    }

    const allUpdates: WikiPageUpdate[] = [];
    let totalCost = 0;

    for (const finding of group.findings) {
      const page = pages.find(p => finding.affectedPaths.includes(p.path));
      if (!page) continue;

      const sourceFile = finding.metadata?.sourceFile;
      if (!sourceFile) {
        continue;
      }

      // Read the source file
      const sourceResults = await toolExecutor.executeTools([{
        id: 'read-source',
        name: 'read_file',
        input: { path: sourceFile },
      }]);

      const sourceContent = sourceResults[0]?.result;
      if (!sourceContent || sourceContent.startsWith('Error')) {
        continue;
      }

      // Generate corrected content using LLM
      const { content: correctedContent, cost } = await this.generateCorrection(
        finding,
        page,
        sourceContent,
        context
      );
      totalCost += cost;

      if (correctedContent && correctedContent !== page.content) {
        allUpdates.push({
          type: 'update',
          path: page.path,
          content: correctedContent,
          sourceCommitId: '',
          agentRunId: '',
          confidenceDelta: 0.15, // Boost confidence after source-verified correction
        });
      }
    }

    return {
      result: createAgentResult({
        summary: `Corrected ${allUpdates.length} inaccuracies based on source code`,
        findings: [
          createFinding({
            type: 'CONSOLIDATION',
            description: `Corrected ${allUpdates.length} wiki pages based on source code verification`,
            relatedPaths: group.affectedPaths,
            importance: 'high',
          }),
        ],
        confidence: 0.85,
      }),
      updates: allUpdates,
      costUsd: totalCost,
    };
  }

  private async generateCorrection(
    finding: Finding,
    page: WikiPage,
    sourceContent: string,
    context: AgentContext
  ): Promise<{ content: string | null; cost: number }> {
    const prompt = this.buildCorrectionPrompt(finding, page, sourceContent);

    const completion = await context.llm.complete({
      system: CORRECTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 3000,
      temperature: 0.3,
    });

    const correctedContent = this.parseCorrection(completion.content);
    return { content: correctedContent, cost: completion.costUsd };
  }

  private buildCorrectionPrompt(
    finding: Finding,
    page: WikiPage,
    sourceContent: string
  ): string {
    const metadata = finding.metadata;
    const claim = metadata?.claim || finding.description;
    const sourceFile = metadata?.sourceFile || 'unknown';

    // Truncate source content if too long
    const truncatedSource = sourceContent.length > 4000
      ? sourceContent.slice(0, 4000) + '\n... (truncated)'
      : sourceContent;

    return `## Task

Correct inaccurate content in a wiki page based on actual source code.

## The Inaccuracy

**Incorrect claim:** ${claim}

**Source file:** ${sourceFile}

**Actual source code:**
\`\`\`
${truncatedSource}
\`\`\`

## Current Wiki Page

**Path:** ${page.path}
**Title:** ${page.title}

**Content:**
${page.content}

## Instructions

1. Locate the inaccurate claim in the wiki content
2. Replace it with accurate information based on the source code
3. Preserve the overall structure and other content
4. Make the correction clearly sourced from the code

## Required Output Format

CORRECTED_CONTENT:
[The full corrected page content]

CHANGES_MADE:
[Brief description of what was corrected]
`;
  }

  private parseCorrection(response: string): string | null {
    const ctx = createParseContext('inaccuracy-handler', response);
    return parseSection(ctx, 'CORRECTED_CONTENT', /CORRECTED_CONTENT:\s*([\s\S]*?)(?=CHANGES_MADE:|$)/i);
  }
}

const CORRECTION_SYSTEM_PROMPT = `You correct inaccurate wiki documentation based on source code.

Guidelines:
- Make minimal changes - only fix the inaccuracy
- Preserve the page structure and other content
- Use specific details from the source code
- Include code snippets where helpful
- Cite the source file for transparency

Do NOT:
- Rewrite the entire page
- Add speculation beyond what the code shows
- Remove content that isn't related to the inaccuracy
- Add unnecessary formatting or structure changes`;
