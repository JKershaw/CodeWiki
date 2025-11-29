#!/usr/bin/env node

/**
 * CodeWiki MCP Server
 *
 * Exposes the wiki as tools that AI agents can use to get context
 * about a codebase before starting work.
 *
 * Tools:
 * - query_wiki: Ask a question and get a synthesized answer
 * - list_wiki_pages: List all wiki pages for a repository
 * - get_wiki_page: Get the content of a specific wiki page
 * - get_repo_status: Get processing status for a repository
 * - generate_spec: Generate a specification for a coding task
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'path';

import { createRepositories } from '../repositories/index.js';
import { createAnthropicLLM } from '../services/llm/anthropic-llm-service.js';
import { createMockLLMForCodeAnalysis } from '../services/llm/mock-llm-service.js';
import { createResearchAgent } from '../agents/research/research-agent.js';
import { createSpecAgent } from '../agents/spec/spec-agent.js';
import { createOrchestrator } from '../agents/orchestrator/orchestrator.js';
import { getOrCreateActiveWiki } from '../commands/create-wiki.js';

// Initialize services
const repos = createRepositories({ type: 'file' });

function createLLM() {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (apiKey) {
    return createAnthropicLLM({ apiKey });
  }
  return createMockLLMForCodeAnalysis();
}

const llm = createLLM();
const research = createResearchAgent(repos, llm);
const specAgent = createSpecAgent(repos, llm);
const orchestrator = createOrchestrator(repos);

// Create MCP server
const server = new Server(
  {
    name: 'codewiki',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'query_wiki',
        description:
          'Ask a question about the codebase and get a synthesized answer from the wiki. ' +
          'Use this to understand architecture, conventions, design decisions, or any aspect of the code. ' +
          'Examples: "what is the architecture?", "why do we use CQRS?", "how does authentication work?"',
        inputSchema: {
          type: 'object',
          properties: {
            repo_path: {
              type: 'string',
              description: 'Path to the repository (absolute or relative)',
            },
            question: {
              type: 'string',
              description: 'The question to ask about the codebase',
            },
          },
          required: ['repo_path', 'question'],
        },
      },
      {
        name: 'list_wiki_pages',
        description:
          'List all wiki pages for a repository. Returns page paths, titles, and confidence scores.',
        inputSchema: {
          type: 'object',
          properties: {
            repo_path: {
              type: 'string',
              description: 'Path to the repository (absolute or relative)',
            },
          },
          required: ['repo_path'],
        },
      },
      {
        name: 'get_wiki_page',
        description:
          'Get the full content of a specific wiki page. Use list_wiki_pages first to see available pages.',
        inputSchema: {
          type: 'object',
          properties: {
            repo_path: {
              type: 'string',
              description: 'Path to the repository (absolute or relative)',
            },
            page_path: {
              type: 'string',
              description: 'The wiki page path (e.g., "architecture/cqrs" or "commits/abc123")',
            },
          },
          required: ['repo_path', 'page_path'],
        },
      },
      {
        name: 'get_repo_status',
        description:
          'Get the processing status for a repository, including commit coverage and wiki statistics.',
        inputSchema: {
          type: 'object',
          properties: {
            repo_path: {
              type: 'string',
              description: 'Path to the repository (absolute or relative)',
            },
          },
          required: ['repo_path'],
        },
      },
      {
        name: 'generate_spec',
        description:
          'Generate a specification for a coding task. Given a task description, returns structured context ' +
          'from the wiki that a coding agent needs to implement the task, including relevant architecture, ' +
          'patterns, conventions, key files, dependencies, testing approach, and potential pitfalls. ' +
          'Examples: "add user authentication", "implement rate limiting", "refactor the payment module"',
        inputSchema: {
          type: 'object',
          properties: {
            repo_path: {
              type: 'string',
              description: 'Path to the repository (absolute or relative)',
            },
            task: {
              type: 'string',
              description: 'Description of the coding task to generate a spec for',
            },
          },
          required: ['repo_path', 'task'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'query_wiki':
        return await handleQueryWiki(args as { repo_path: string; question: string });

      case 'list_wiki_pages':
        return await handleListWikiPages(args as { repo_path: string });

      case 'get_wiki_page':
        return await handleGetWikiPage(args as { repo_path: string; page_path: string });

      case 'get_repo_status':
        return await handleGetRepoStatus(args as { repo_path: string });

      case 'generate_spec':
        return await handleGenerateSpec(args as { repo_path: string; task: string });

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function findRepo(repoPath: string) {
  const absolutePath = resolve(repoPath);
  const repo = await repos.repos.findByFullName(absolutePath);

  if (!repo) {
    throw new Error(
      `Repository not found: ${absolutePath}\n` +
        'Run "npm run cli process <repo-path>" first to index the repository.'
    );
  }

  return repo;
}

async function handleQueryWiki(args: { repo_path: string; question: string }) {
  const repo = await findRepo(args.repo_path);
  const wiki = await getOrCreateActiveWiki(repo.id, repos);
  const result = await research.query(wiki.id, args.question);

  let response = `## Answer\n\n${result.answer}\n\n`;
  response += `**Confidence:** ${(result.confidence * 100).toFixed(0)}%\n\n`;

  if (result.sources.length > 0) {
    response += '## Sources\n\n';
    for (const source of result.sources) {
      response += `- **${source.title}** (\`${source.path}\`)\n`;
      response += `  Relevance: ${(source.relevance * 100).toFixed(0)}%, `;
      response += `Confidence: ${(source.confidence * 100).toFixed(0)}%\n`;
    }
  }

  return {
    content: [{ type: 'text', text: response }],
  };
}

async function handleListWikiPages(args: { repo_path: string }) {
  const repo = await findRepo(args.repo_path);
  const wiki = await getOrCreateActiveWiki(repo.id, repos);
  const pages = await repos.wikiPages.findByWiki(wiki.id);

  if (pages.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No wiki pages found. Run "npm run cli process <repo-path>" first to generate wiki content.',
        },
      ],
    };
  }

  // Group pages by category
  const grouped: Record<string, typeof pages> = {};
  for (const page of pages) {
    const category = page.path.split('/')[0] || 'root';
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(page);
  }

  let response = `# Wiki Pages (${pages.length} total)\n\n`;

  for (const [category, categoryPages] of Object.entries(grouped)) {
    response += `## ${category}\n\n`;
    for (const page of categoryPages) {
      response += `- **${page.title}** (\`${page.path}\`)\n`;
      response += `  Confidence: ${(page.confidence * 100).toFixed(0)}%\n`;
    }
    response += '\n';
  }

  return {
    content: [{ type: 'text', text: response }],
  };
}

async function handleGetWikiPage(args: { repo_path: string; page_path: string }) {
  const repo = await findRepo(args.repo_path);
  const wiki = await getOrCreateActiveWiki(repo.id, repos);
  const page = await repos.wikiPages.findByPath(wiki.id, args.page_path);

  if (!page) {
    return {
      content: [
        {
          type: 'text',
          text: `Wiki page not found: ${args.page_path}\nUse list_wiki_pages to see available pages.`,
        },
      ],
    };
  }

  let response = `# ${page.title}\n\n`;
  response += `**Path:** \`${page.path}\`\n`;
  response += `**Confidence:** ${(page.confidence * 100).toFixed(0)}%\n`;
  response += `**Last Updated:** ${page.updatedAt.toISOString()}\n\n`;
  response += '---\n\n';
  response += page.content;

  return {
    content: [{ type: 'text', text: response }],
  };
}

async function handleGetRepoStatus(args: { repo_path: string }) {
  const repo = await findRepo(args.repo_path);
  const wiki = await getOrCreateActiveWiki(repo.id, repos);
  const summary = await orchestrator.getWorkSummary(repo.id, wiki.id);

  let response = `# Repository Status\n\n`;
  response += `**Path:** ${repo.fullName}\n`;
  response += `**Status:** ${repo.status}\n\n`;
  response += `## Processing\n\n`;
  response += `- **Commits:** ${summary.processedCommits}/${summary.totalCommits} processed `;
  response += `(${summary.coveragePercent.toFixed(1)}%)\n`;
  response += `- **Wiki Pages:** ${summary.wikiPages}\n`;
  response += `- **Average Confidence:** ${(summary.avgConfidence * 100).toFixed(1)}%\n`;
  response += `- **Pending Work:** ${summary.pendingWork}\n`;
  response += `- **Open Conflicts:** ${summary.openConflicts}\n`;

  return {
    content: [{ type: 'text', text: response }],
  };
}

async function handleGenerateSpec(args: { repo_path: string; task: string }) {
  const repo = await findRepo(args.repo_path);
  const result = await specAgent.generateSpec(repo.id, args.task);

  let response = `# Coding Agent Specification\n\n`;
  response += `**Confidence:** ${(result.confidence * 100).toFixed(0)}%\n\n`;

  response += `## Task\n\n${result.task}\n\n`;
  response += `## Interpretation\n\n${result.interpretation}\n\n`;
  response += `## Context\n\n${result.spec.context}\n\n`;

  if (result.spec.keyFiles.length > 0) {
    response += `## Key Files\n\n`;
    for (const file of result.spec.keyFiles) {
      response += `- \`${file}\`\n`;
    }
    response += '\n';
  }

  response += `## Patterns\n\n${result.spec.patterns}\n\n`;
  response += `## Conventions\n\n${result.spec.conventions}\n\n`;
  response += `## Dependencies\n\n${result.spec.dependencies}\n\n`;
  response += `## Testing\n\n${result.spec.testing}\n\n`;
  response += `## Pitfalls\n\n${result.spec.pitfalls}\n\n`;

  if (result.sources.length > 0) {
    response += '## Sources\n\n';
    for (const source of result.sources) {
      response += `- **${source.title}** (\`${source.path}\`)\n`;
      response += `  Relevance: ${(source.relevance * 100).toFixed(0)}%\n`;
    }
  }

  return {
    content: [{ type: 'text', text: response }],
  };
}

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('CodeWiki MCP server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
