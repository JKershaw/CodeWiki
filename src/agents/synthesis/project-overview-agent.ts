import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage, WikiPageUpdate } from '../../domain/wiki-page.js';
import { codebaseTools, type ToolContext, type ToolDefinition } from '../../services/llm/index.js';

/**
 * Project Overview Agent - Creates a project-level overview page.
 *
 * This agent synthesizes ALL wiki pages to create a high-level "what is this project"
 * page at architecture/overview.md. Unlike the category OverviewAgent, this looks at
 * the entire wiki to understand the project as a whole.
 *
 * Trigger: When wiki has 10+ pages but no architecture/overview page.
 */
export class ProjectOverviewAgent implements Agent {
  readonly type: AgentType = 'project-overview';

  // Minimum pages before creating project overview
  private readonly MIN_PAGES_FOR_OVERVIEW = 10;
  private readonly OVERVIEW_PATH = 'architecture/overview';

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('ProjectOverviewAgent does not run on commits. Use runOnWiki instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    const pages = await context.repos.wikiPages.findByRepo(context.repoId);

    // Check if we have enough pages
    if (pages.length < this.MIN_PAGES_FOR_OVERVIEW) {
      return {
        result: createAgentResult({
          summary: `Wiki has ${pages.length} pages, need ${this.MIN_PAGES_FOR_OVERVIEW}+ for project overview`,
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Check if overview already exists
    const hasOverview = pages.some(p =>
      p.path === this.OVERVIEW_PATH ||
      p.path === 'architecture/index'
    );

    if (hasOverview) {
      return {
        result: createAgentResult({
          summary: 'Project overview already exists',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Gather information for the overview
    const projectContext = this.gatherProjectContext(pages);
    const prompt = this.buildPrompt(projectContext);

    // Set up tool context for codebase exploration
    const repoPath = context.git.getRepoPath(context.repoId);
    const toolContext: ToolContext = { repoPath, maxFileSize: 50000 };

    // Create tool executor
    const executeTools = async (calls: Array<{ id: string; name: string; input: Record<string, unknown> }>) => {
      const results = await Promise.all(calls.map(async (call) => {
        const tool = codebaseTools.find(t => t.name === call.name);
        if (!tool) {
          return { id: call.id, result: `Error: Unknown tool "${call.name}"` };
        }
        const result = await tool.execute(call.input, toolContext);
        return { id: call.id, result };
      }));
      return results;
    };

    // Use completeWithTools to allow codebase exploration
    const completion = await context.llm.completeWithTools({
      system: SYSTEM_PROMPT_WITH_TOOLS,
      messages: [{ role: 'user', content: prompt }],
      tools: codebaseTools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      executeTools,
      maxToolRounds: 5,
      maxTokens: 4000,
    });

    // Use the LLM output directly as markdown content
    const content = completion.content.trim();
    const update = this.generateDirectUpdate(content, pages);

    // Include tool usage in findings
    const toolUsageFinding = completion.toolCalls.length > 0
      ? [createFinding({
          type: 'TOOL_USE',
          description: `Used ${completion.toolCalls.length} tool calls to explore codebase`,
          relatedPaths: completion.toolCalls
            .filter(c => c.name === 'read_file')
            .map(c => c.input['path'] as string)
            .filter(Boolean),
          importance: 'low',
        })]
      : [];

    return {
      result: createAgentResult({
        summary: `Created project overview from ${pages.length} wiki pages and ${completion.toolCalls.length} source file reads`,
        findings: [
          createFinding({
            type: 'SYNTHESIS',
            description: 'Generated project-level overview page',
            relatedPaths: [this.OVERVIEW_PATH],
            importance: 'high',
          }),
          ...toolUsageFinding,
        ],
        confidence: 0.8,  // High confidence since we read source files
      }),
      updates: [update],
      costUsd: completion.costUsd,
    };
  }

  private gatherProjectContext(pages: WikiPage[]): ProjectContext {
    // Group by category
    const categories = new Map<string, WikiPage[]>();
    for (const page of pages) {
      const category = page.path.split('/')[0] ?? 'uncategorized';
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      categories.get(category)!.push(page);
    }

    // Find architecture pages (most relevant for project overview)
    const architecturePages = categories.get('architecture') ?? [];

    // Find pattern pages
    const patternPages = categories.get('patterns') ?? [];

    // Find convention pages
    const conventionPages = categories.get('conventions') ?? [];

    // Find decision pages
    const decisionPages = categories.get('decisions') ?? [];

    // Skip commits for the overview - they're too granular
    const nonCommitPages = pages.filter(p => !p.path.startsWith('commits/'));

    return {
      totalPages: pages.length,
      categories: Array.from(categories.entries()).map(([name, pages]) => ({
        name,
        count: pages.length,
      })),
      architecturePages,
      patternPages,
      conventionPages,
      decisionPages,
      topPages: nonCommitPages
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 15),
    };
  }

  private buildPrompt(context: ProjectContext): string {
    // Build summary of top pages
    const pagesSummary = context.topPages.map(p => {
      const firstPara = p.content.split('\n\n').slice(0, 2).join('\n\n');
      return `### ${p.title}
Path: ${p.path}
Confidence: ${(p.confidence * 100).toFixed(0)}%

${firstPara.slice(0, 400)}${firstPara.length > 400 ? '...' : ''}
`;
    }).join('\n---\n');

    const categorySummary = context.categories
      .filter(c => c.name !== 'commits')
      .map(c => `- ${c.name}: ${c.count} pages`)
      .join('\n');

    return `Create a project overview page.

## Existing Wiki Info
- ${context.totalPages} pages in categories: ${categorySummary}

## Instructions

1. FIRST use read_file to read "README.md" - this has the project description
2. THEN use read_file to read "PLAN.md" if it exists - this has architecture details
3. Optionally read "package.json" for dependencies

After reading the source files, write a Markdown overview page. Start with:
# [Project Name] - Project Overview

Include sections for:
- What the project does (2-3 paragraphs from README)
- Architecture overview
- Key components
- Where to start reading the code

Output ONLY the markdown content. No explanations before or after.
`;
  }

  private generateDirectUpdate(content: string, pages: WikiPage[]): WikiPageUpdate {
    // Extract title from the content or use default
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1]! : 'Project Overview';

    // Append related pages if not already present
    const nonCommitPages = pages.filter(p =>
      !p.path.startsWith('commits/') &&
      p.path !== this.OVERVIEW_PATH
    );

    let finalContent = content;
    if (!content.includes('## Related') && nonCommitPages.length > 0) {
      const relatedSection = `\n\n## Related Documentation\n\n${nonCommitPages.slice(0, 8).map(p => `- [${p.title}](${p.path}.md)`).join('\n')}`;
      finalContent += relatedSection;
    }

    return {
      type: 'create',
      path: this.OVERVIEW_PATH,
      title,
      content: finalContent,
      sourceCommitId: '',
      agentRunId: '',
      confidenceDelta: 0.8,
    };
  }

  private parseResponse(response: string): ParsedProjectOverview {
    const overview: ParsedProjectOverview = {
      projectName: '',
      purpose: '',
      architecture: '',
      keyComponents: [],
      keyConcepts: [],
      entryPoints: [],
      confidence: 0.7,
    };

    // Parse project name
    const nameMatch = response.match(/PROJECT_NAME:\s*(.+?)(?=\n|PURPOSE:|$)/i);
    if (nameMatch) {
      overview.projectName = nameMatch[1]!.trim();
    }

    // Parse purpose
    const purposeMatch = response.match(/PURPOSE:\s*([\s\S]*?)(?=ARCHITECTURE:|KEY_COMPONENTS:|$)/i);
    if (purposeMatch) {
      overview.purpose = purposeMatch[1]!.trim();
    }

    // Parse architecture
    const archMatch = response.match(/ARCHITECTURE:\s*([\s\S]*?)(?=KEY_COMPONENTS:|KEY_CONCEPTS:|$)/i);
    if (archMatch) {
      overview.architecture = archMatch[1]!.trim();
    }

    // Parse key components
    const componentsMatch = response.match(/KEY_COMPONENTS:\s*([\s\S]*?)(?=KEY_CONCEPTS:|ENTRY_POINTS:|CONFIDENCE:|$)/i);
    if (componentsMatch) {
      const lines = componentsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\[?([^\]:]+)\]?:\s*(.+)$/);
        if (match) {
          overview.keyComponents.push({
            name: match[1]!.trim(),
            description: match[2]!.trim(),
          });
        }
      }
    }

    // Parse key concepts
    const conceptsMatch = response.match(/KEY_CONCEPTS:\s*([\s\S]*?)(?=ENTRY_POINTS:|CONFIDENCE:|$)/i);
    if (conceptsMatch) {
      const lines = conceptsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\[?([^\]:]+)\]?:\s*(.+)$/);
        if (match) {
          overview.keyConcepts.push({
            name: match[1]!.trim(),
            description: match[2]!.trim(),
          });
        }
      }
    }

    // Parse entry points
    const entryMatch = response.match(/ENTRY_POINTS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (entryMatch) {
      const lines = entryMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\[?([^\]:]+)\]?:\s*(.+)$/);
        if (match) {
          overview.entryPoints.push({
            path: match[1]!.trim(),
            reason: match[2]!.trim(),
          });
        }
      }
    }

    // Parse confidence
    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    if (confidenceMatch) {
      overview.confidence = parseFloat(confidenceMatch[1]!);
    }

    return overview;
  }

  private generateUpdate(overview: ParsedProjectOverview, pages: WikiPage[]): WikiPageUpdate {
    const title = overview.projectName
      ? `${overview.projectName} - Project Overview`
      : 'Project Overview';

    // Build key components section
    const componentsSection = overview.keyComponents.length > 0
      ? `## Key Components

${overview.keyComponents.map(c => `- **${c.name}**: ${c.description}`).join('\n')}`
      : '';

    // Build key concepts section
    const conceptsSection = overview.keyConcepts.length > 0
      ? `## Key Concepts

${overview.keyConcepts.map(c => `- **${c.name}**: ${c.description}`).join('\n')}`
      : '';

    // Build entry points section
    const entryPointsSection = overview.entryPoints.length > 0
      ? `## Where to Start

${overview.entryPoints.map(e => `- **${e.path}**: ${e.reason}`).join('\n')}`
      : '';

    // Build related pages section (link to other wiki pages)
    const nonCommitPages = pages.filter(p =>
      !p.path.startsWith('commits/') &&
      p.path !== this.OVERVIEW_PATH
    );
    const relatedPagesSection = nonCommitPages.length > 0
      ? `## Related Documentation

${nonCommitPages.slice(0, 10).map(p => `- [${p.title}](${p.path}.md)`).join('\n')}`
      : '';

    const content = `# ${title}

${overview.purpose}

## Architecture

${overview.architecture}

${componentsSection}

${conceptsSection}

${entryPointsSection}

${relatedPagesSection}
`.trim();

    return {
      type: 'create',
      path: this.OVERVIEW_PATH,
      title,
      content,
      sourceCommitId: '',
      agentRunId: '',
      confidenceDelta: 0.7,
    };
  }
}

interface ProjectContext {
  totalPages: number;
  categories: Array<{ name: string; count: number }>;
  architecturePages: WikiPage[];
  patternPages: WikiPage[];
  conventionPages: WikiPage[];
  decisionPages: WikiPage[];
  topPages: WikiPage[];
}

interface ParsedProjectOverview {
  projectName: string;
  purpose: string;
  architecture: string;
  keyComponents: Array<{ name: string; description: string }>;
  keyConcepts: Array<{ name: string; description: string }>;
  entryPoints: Array<{ path: string; reason: string }>;
  confidence: number;
}

const SYSTEM_PROMPT_WITH_TOOLS = `You are a technical writer creating a project overview page for a software project wiki.

You have access to tools to explore the actual source code:
- read_file: Read any file (README.md, package.json, source files)
- search_files: Find files matching glob patterns
- list_directory: See directory structure

IMPORTANT: ALWAYS start by reading key documentation files to understand the project:
1. First, read "README.md" if it exists - this usually has the project description
2. Read "package.json" or equivalent to understand dependencies and scripts
3. List the main source directory to understand the structure
4. Read any other documentation files you find

Your job is to create a comprehensive introduction that helps a new developer understand the entire project at a glance.

A good project overview:
- Clearly explains what the project is and why it exists (from README/docs)
- Describes the high-level architecture and main components
- Explains how components interact with each other
- Highlights key abstractions and concepts
- Points to the best starting points for understanding the code

Write in an encyclopedic style - informative, neutral, and helpful. This should be the FIRST page a new developer reads.

Do NOT:
- Write about individual commits or git history
- Include low-level implementation details
- Repeat content from other wiki pages verbatim
- Say "cannot be determined" - USE THE TOOLS to find out!

Focus on giving the reader a mental model of how the system works as a whole.`;
