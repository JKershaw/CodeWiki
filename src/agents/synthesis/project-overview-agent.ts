import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage, WikiPageUpdate } from '../../domain/wiki-page.js';

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

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 3000,
      temperature: 0.4,
    });

    const overview = this.parseResponse(completion.content);
    const update = this.generateUpdate(overview, pages);

    return {
      result: createAgentResult({
        summary: `Created project overview from ${pages.length} wiki pages`,
        findings: [createFinding({
          type: 'SYNTHESIS',
          description: 'Generated project-level overview page',
          relatedPaths: [this.OVERVIEW_PATH],
          importance: 'high',
        })],
        confidence: overview.confidence,
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

    return `Create a project overview page based on the wiki content.

## Wiki Statistics
- Total pages: ${context.totalPages}
- Categories:
${categorySummary}

## Top Wiki Pages (by confidence)

${pagesSummary}

## Your Task

Write a comprehensive project overview that answers:
1. What is this project? (purpose, goals)
2. What are the main components? (architecture overview)
3. How do the components work together?
4. What are the key abstractions/concepts?
5. What are the main entry points for understanding the code?

This should be the FIRST page a new developer reads to understand the project.

Format your response as:

PROJECT_NAME:
[Inferred name of the project]

PURPOSE:
[2-3 sentences explaining what this project does and why it exists]

ARCHITECTURE:
[3-5 paragraphs describing the high-level architecture, main components, and how they interact]

KEY_COMPONENTS:
- [Component 1]: [What it does, where to find it]
- [Component 2]: [What it does, where to find it]

KEY_CONCEPTS:
- [Concept 1]: [Brief explanation]
- [Concept 2]: [Brief explanation]

ENTRY_POINTS:
- [File/Module 1]: [Why start here]
- [File/Module 2]: [Why read this]

CONFIDENCE: [0-1]
`;
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

const SYSTEM_PROMPT = `You are a technical writer creating a project overview page for a software project wiki.

Your job is to synthesize ALL the wiki pages into a single, comprehensive introduction that helps a new developer understand the entire project at a glance.

A good project overview:
- Clearly explains what the project is and why it exists
- Describes the high-level architecture and main components
- Explains how components interact with each other
- Highlights key abstractions and concepts
- Points to the best starting points for understanding the code

Write in an encyclopedic style - informative, neutral, and helpful. This should be the FIRST page a new developer reads.

Do NOT:
- Write about individual commits or git history
- Include low-level implementation details
- Repeat content from other wiki pages verbatim
- Be vague or generic - be specific about THIS project

Focus on giving the reader a mental model of how the system works as a whole.`;
