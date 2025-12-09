/**
 * Swagger/OpenAPI configuration for CodeWiki API.
 */

import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'CodeWiki API',
      version: '0.1.0',
      description: 'API for generating living wikis from Git repositories',
    },
    servers: [
      {
        url: '/api',
        description: 'API server',
      },
    ],
    tags: [
      { name: 'Repositories', description: 'Repository management' },
      { name: 'Wikis', description: 'Wiki management' },
      { name: 'Wiki Content', description: 'Wiki page content' },
      { name: 'Agents', description: 'AI agent operations (query, spec generation)' },
      { name: 'Processing', description: 'Work queue and processing status' },
      { name: 'Benchmarks', description: 'Accuracy benchmarks' },
      { name: 'Quality Benchmarks', description: 'Quality measurement benchmarks' },
      { name: 'Self Improvement', description: 'Self-improvement analysis and chat' },
      { name: 'Observability', description: 'Agent runs and findings' },
      { name: 'Config', description: 'Server configuration' },
      { name: 'Filesystem', description: 'Local filesystem browsing' },
    ],
    components: {
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message',
            },
          },
        },
        Repository: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            fullName: { type: 'string', description: 'Full repository name or path' },
            status: {
              type: 'string',
              enum: ['pending', 'processing', 'ready', 'paused', 'error'],
            },
            activeWiki: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
                slug: { type: 'string' },
              },
            },
            wikiCount: { type: 'integer' },
            totalCommits: { type: 'integer' },
            processedCommits: { type: 'integer' },
            wikiPages: { type: 'integer' },
            coveragePercent: { type: 'number' },
          },
        },
        Wiki: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            repoId: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: 'string' },
            branchFilter: { type: 'string' },
            pathFilters: { type: 'array', items: { type: 'string' } },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        WikiPage: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            wikiId: { type: 'string', format: 'uuid' },
            path: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        WikiTreeNode: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            path: { type: 'string' },
            type: { type: 'string', enum: ['file', 'directory'] },
            children: {
              type: 'array',
              items: { $ref: '#/components/schemas/WikiTreeNode' },
            },
          },
        },
        Commit: {
          type: 'object',
          properties: {
            oid: { type: 'string' },
            message: { type: 'string' },
            author: { type: 'string' },
            authorEmail: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        Model: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
        },
        BenchmarkRun: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            repoId: { type: 'string', format: 'uuid' },
            wikiId: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] },
            startedAt: { type: 'string', format: 'date-time' },
            completedAt: { type: 'string', format: 'date-time' },
            results: { type: 'object' },
          },
        },
        QualityBenchmarkRun: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            repoId: { type: 'string', format: 'uuid' },
            wikiId: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] },
            startedAt: { type: 'string', format: 'date-time' },
            completedAt: { type: 'string', format: 'date-time' },
            metrics: { type: 'object' },
          },
        },
        SelfImprovementAnalysis: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            repoId: { type: 'string', format: 'uuid' },
            status: { type: 'string' },
            findings: { type: 'array', items: { type: 'object' } },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        AgentRun: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            repoId: { type: 'string', format: 'uuid' },
            agentType: { type: 'string' },
            status: { type: 'string' },
            startedAt: { type: 'string', format: 'date-time' },
            completedAt: { type: 'string', format: 'date-time' },
          },
        },
        QueryResult: {
          type: 'object',
          properties: {
            answer: { type: 'string' },
            sources: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  relevance: { type: 'number' },
                },
              },
            },
          },
        },
        SpecResult: {
          type: 'object',
          properties: {
            spec: { type: 'string' },
            files: { type: 'array', items: { type: 'string' } },
          },
        },
        FileSystemEntry: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            path: { type: 'string' },
            isDirectory: { type: 'boolean' },
          },
        },
      },
    },
  },
  apis: ['./src/web/routes/*.ts', './dist/web/routes/*.js'],
};

export const swaggerSpec = swaggerJsdoc(options);
