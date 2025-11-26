import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage, WikiPageUpdate } from '../../domain/wiki-page.js';

/**
 * Getting Started Agent - Creates entry point documentation for new developers.
 *
 * This agent synthesizes wiki content to create a practical "getting started" guide
 * at guides/getting-started.md. It focuses on actionable steps: how to run the project,
 * key commands, and which files to understand first.
 *
 * Trigger: When wiki has 10+ pages but no guides/getting-started page.
 */
export class GettingStartedAgent implements Agent {
  readonly type: AgentType = 'getting-started';

  // Minimum pages before creating getting started guide
  private readonly MIN_PAGES_FOR_GUIDE = 10;
  private readonly GUIDE_PATH = 'guides/getting-started';

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('GettingStartedAgent does not run on commits. Use runOnWiki instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    const pages = await context.repos.wikiPages.findByRepo(context.repoId);

    // Check if we have enough pages
    if (pages.length < this.MIN_PAGES_FOR_GUIDE) {
      return {
        result: createAgentResult({
          summary: `Wiki has ${pages.length} pages, need ${this.MIN_PAGES_FOR_GUIDE}+ for getting started guide`,
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Check if guide already exists
    const hasGuide = pages.some(p =>
      p.path === this.GUIDE_PATH ||
      p.path === 'guides/quickstart' ||
      p.path === 'guides/index'
    );

    if (hasGuide) {
      return {
        result: createAgentResult({
          summary: 'Getting started guide already exists',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Gather context for the guide
    const guideContext = this.gatherGuideContext(pages, context);
    const prompt = this.buildPrompt(guideContext);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2500,
      temperature: 0.4,
    });

    const guide = this.parseResponse(completion.content);
    const update = this.generateUpdate(guide);

    return {
      result: createAgentResult({
        summary: `Created getting started guide from ${pages.length} wiki pages`,
        findings: [createFinding({
          type: 'SYNTHESIS',
          description: 'Generated getting started guide for new developers',
          relatedPaths: [this.GUIDE_PATH],
          importance: 'high',
        })],
        confidence: guide.confidence,
      }),
      updates: [update],
      costUsd: completion.costUsd,
    };
  }

  private gatherGuideContext(pages: WikiPage[], context: AgentContext): GuideContext {
    // Find pages that mention setup, installation, or entry points
    const setupPages = pages.filter(p =>
      p.content.toLowerCase().includes('setup') ||
      p.content.toLowerCase().includes('install') ||
      p.content.toLowerCase().includes('entry point') ||
      p.content.toLowerCase().includes('npm') ||
      p.content.toLowerCase().includes('yarn')
    );

    // Find architecture pages
    const architecturePages = pages.filter(p => p.path.startsWith('architecture/'));

    // Find convention pages
    const conventionPages = pages.filter(p =>
      p.path.startsWith('conventions/') ||
      p.path.startsWith('patterns/')
    );

    // Gather all relevant content
    const relevantPages = [...new Set([...setupPages, ...architecturePages, ...conventionPages])]
      .slice(0, 10);

    return {
      totalPages: pages.length,
      relevantPages,
      hasArchitecture: architecturePages.length > 0,
      hasConventions: conventionPages.length > 0,
    };
  }

  private buildPrompt(context: GuideContext): string {
    const pagesSummary = context.relevantPages.map(p => {
      const firstPara = p.content.split('\n\n').slice(0, 3).join('\n\n');
      return `### ${p.title}
Path: ${p.path}

${firstPara.slice(0, 500)}${firstPara.length > 500 ? '...' : ''}
`;
    }).join('\n---\n');

    return `Create a "Getting Started" guide for new developers based on the wiki content.

## Available Wiki Content (${context.totalPages} total pages)

${pagesSummary}

## Your Task

Write a practical getting started guide that helps a NEW developer:
1. Set up the development environment
2. Understand the project structure
3. Run the project locally
4. Make their first changes
5. Know which files to read first

Focus on ACTIONABLE steps - commands to run, files to open, things to do.

Format your response as:

INTRODUCTION:
[1-2 sentences explaining what this guide covers]

PREREQUISITES:
- [Prerequisite 1]
- [Prerequisite 2]

SETUP_STEPS:
1. [Step 1 with actual commands if applicable]
2. [Step 2]
3. [Step 3]

PROJECT_STRUCTURE:
[Brief explanation of the main directories and their purposes]

KEY_FILES:
- [File/Path 1]: [Why this file matters and what to learn from it]
- [File/Path 2]: [Why this file matters]

FIRST_TASKS:
- [Suggested first task or exploration]
- [Another suggestion]

COMMON_COMMANDS:
- \`command\`: [What it does]
- \`command\`: [What it does]

NEXT_STEPS:
[Where to go after completing this guide - link to other wiki pages]

CONFIDENCE: [0-1]
`;
  }

  private parseResponse(response: string): ParsedGuide {
    const guide: ParsedGuide = {
      introduction: '',
      prerequisites: [],
      setupSteps: [],
      projectStructure: '',
      keyFiles: [],
      firstTasks: [],
      commonCommands: [],
      nextSteps: '',
      confidence: 0.7,
    };

    // Parse introduction
    const introMatch = response.match(/INTRODUCTION:\s*([\s\S]*?)(?=PREREQUISITES:|SETUP_STEPS:|$)/i);
    if (introMatch) {
      guide.introduction = introMatch[1]!.trim();
    }

    // Parse prerequisites
    const prereqMatch = response.match(/PREREQUISITES:\s*([\s\S]*?)(?=SETUP_STEPS:|PROJECT_STRUCTURE:|$)/i);
    if (prereqMatch) {
      guide.prerequisites = this.parseList(prereqMatch[1]!);
    }

    // Parse setup steps
    const setupMatch = response.match(/SETUP_STEPS:\s*([\s\S]*?)(?=PROJECT_STRUCTURE:|KEY_FILES:|$)/i);
    if (setupMatch) {
      guide.setupSteps = this.parseNumberedList(setupMatch[1]!);
    }

    // Parse project structure
    const structureMatch = response.match(/PROJECT_STRUCTURE:\s*([\s\S]*?)(?=KEY_FILES:|FIRST_TASKS:|$)/i);
    if (structureMatch) {
      guide.projectStructure = structureMatch[1]!.trim();
    }

    // Parse key files
    const filesMatch = response.match(/KEY_FILES:\s*([\s\S]*?)(?=FIRST_TASKS:|COMMON_COMMANDS:|$)/i);
    if (filesMatch) {
      const lines = filesMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*\[?`?([^\]:`]+)`?\]?:\s*(.+)$/);
        if (match) {
          guide.keyFiles.push({
            path: match[1]!.trim(),
            description: match[2]!.trim(),
          });
        }
      }
    }

    // Parse first tasks
    const tasksMatch = response.match(/FIRST_TASKS:\s*([\s\S]*?)(?=COMMON_COMMANDS:|NEXT_STEPS:|$)/i);
    if (tasksMatch) {
      guide.firstTasks = this.parseList(tasksMatch[1]!);
    }

    // Parse common commands
    const commandsMatch = response.match(/COMMON_COMMANDS:\s*([\s\S]*?)(?=NEXT_STEPS:|CONFIDENCE:|$)/i);
    if (commandsMatch) {
      const lines = commandsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of lines) {
        const match = line.match(/^-\s*`([^`]+)`:\s*(.+)$/);
        if (match) {
          guide.commonCommands.push({
            command: match[1]!.trim(),
            description: match[2]!.trim(),
          });
        }
      }
    }

    // Parse next steps
    const nextMatch = response.match(/NEXT_STEPS:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (nextMatch) {
      guide.nextSteps = nextMatch[1]!.trim();
    }

    // Parse confidence
    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    if (confidenceMatch) {
      guide.confidence = parseFloat(confidenceMatch[1]!);
    }

    return guide;
  }

  private parseList(content: string): string[] {
    return content
      .trim()
      .split('\n')
      .filter(l => l.startsWith('-'))
      .map(l => l.replace(/^-\s*/, '').trim());
  }

  private parseNumberedList(content: string): string[] {
    return content
      .trim()
      .split('\n')
      .filter(l => /^\d+\./.test(l.trim()))
      .map(l => l.replace(/^\d+\.\s*/, '').trim());
  }

  private generateUpdate(guide: ParsedGuide): WikiPageUpdate {
    const title = 'Getting Started';

    // Build prerequisites section
    const prereqSection = guide.prerequisites.length > 0
      ? `## Prerequisites

${guide.prerequisites.map(p => `- ${p}`).join('\n')}`
      : '';

    // Build setup section
    const setupSection = guide.setupSteps.length > 0
      ? `## Setup

${guide.setupSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : '';

    // Build project structure section
    const structureSection = guide.projectStructure
      ? `## Project Structure

${guide.projectStructure}`
      : '';

    // Build key files section
    const filesSection = guide.keyFiles.length > 0
      ? `## Key Files to Understand

${guide.keyFiles.map(f => `- **\`${f.path}\`**: ${f.description}`).join('\n')}`
      : '';

    // Build first tasks section
    const tasksSection = guide.firstTasks.length > 0
      ? `## Suggested First Tasks

${guide.firstTasks.map(t => `- ${t}`).join('\n')}`
      : '';

    // Build common commands section
    const commandsSection = guide.commonCommands.length > 0
      ? `## Common Commands

| Command | Description |
|---------|-------------|
${guide.commonCommands.map(c => `| \`${c.command}\` | ${c.description} |`).join('\n')}`
      : '';

    // Build next steps section
    const nextSection = guide.nextSteps
      ? `## Next Steps

${guide.nextSteps}`
      : '';

    const content = `# ${title}

${guide.introduction}

${prereqSection}

${setupSection}

${structureSection}

${filesSection}

${tasksSection}

${commandsSection}

${nextSection}
`.trim().replace(/\n{3,}/g, '\n\n');

    return {
      type: 'create',
      path: this.GUIDE_PATH,
      title,
      content,
      sourceCommitId: '',
      agentRunId: '',
      confidenceDelta: 0.6,
    };
  }
}

interface GuideContext {
  totalPages: number;
  relevantPages: WikiPage[];
  hasArchitecture: boolean;
  hasConventions: boolean;
}

interface ParsedGuide {
  introduction: string;
  prerequisites: string[];
  setupSteps: string[];
  projectStructure: string;
  keyFiles: Array<{ path: string; description: string }>;
  firstTasks: string[];
  commonCommands: Array<{ command: string; description: string }>;
  nextSteps: string;
  confidence: number;
}

const SYSTEM_PROMPT = `You are a technical writer creating a "Getting Started" guide for developers new to a project.

Your job is to create a practical, actionable guide that helps someone go from zero to productive as quickly as possible.

A good getting started guide:
- Assumes the reader knows nothing about this specific project
- Lists concrete prerequisites (tools, versions, access needed)
- Provides step-by-step setup instructions with actual commands
- Explains the project structure briefly
- Points to the most important files to understand first
- Suggests simple first tasks to get hands-on
- Links to deeper documentation for next steps

Write in a direct, friendly style. Use code blocks for commands. Be specific about THIS project.

Do NOT:
- Be vague or generic ("read the docs", "explore the codebase")
- Skip important setup steps
- Assume prior knowledge of the project
- Include history or decision rationale (that belongs in other pages)

Focus on: What does someone need to DO to get started?`;
