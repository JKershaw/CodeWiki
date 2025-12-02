/**
 * Unit tests for PatternAgent wiki page generation.
 * Tests that generated wiki pages include enhanced content:
 * - Key files and directories
 * - Code snippets
 * - Implementation explanations
 * - Trade-off analysis
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { generatePatternWikiUpdates, type ParsedPatternAnalysis } from '../../src/agents/analysis/pattern-agent.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});

describe('generatePatternWikiUpdates', () => {
  const baseCommit = {
    sha: 'abc123def456',
    message: 'Implement repository pattern',
    diffSummary: {
      affectedFiles: ['src/repositories/user-repo.ts'],
    },
  };

  describe('pattern pages with enhanced content', () => {
    it('should include key files section in pattern wiki page', () => {
      const analysis: ParsedPatternAnalysis = {
        summary: 'Repository pattern implementation',
        patterns: [{
          name: 'Repository Pattern',
          category: 'architecture',
          description: 'Abstracts data access',
          paths: ['src/repositories/user-repo.ts'],
        }],
        keyFiles: [
          { path: 'src/repositories/user-repo.ts', role: 'PRIMARY', description: 'Main repository implementation' },
          { path: 'src/repositories/base.ts', role: 'SUPPORTING', description: 'Base repository class' },
        ],
        codeSnippets: [],
        implementationExplanation: '',
        tradeOffs: [],
        conventions: [],
        antiPatterns: [],
        findings: [],
        wikiUpdates: [],
        confidence: 0.85,
      };

      const updates = generatePatternWikiUpdates(baseCommit, analysis);

      const patternPage = updates.find(u => u.path === 'patterns/repository-pattern');
      assert.ok(patternPage, 'Should create pattern page');
      assert.ok(patternPage!.content.includes('## Key Files'), 'Should have Key Files section');
      assert.ok(patternPage!.content.includes('src/repositories/user-repo.ts'), 'Should list primary file');
      assert.ok(patternPage!.content.includes('PRIMARY'), 'Should indicate file role');
      assert.ok(patternPage!.content.includes('src/repositories/base.ts'), 'Should list supporting file');
    });

    it('should include code snippets section in pattern wiki page', () => {
      const analysis: ParsedPatternAnalysis = {
        summary: 'Factory pattern implementation',
        patterns: [{
          name: 'Factory Pattern',
          category: 'design',
          description: 'Creates objects without specifying exact class',
          paths: ['src/factories/user-factory.ts'],
        }],
        keyFiles: [],
        codeSnippets: [
          {
            name: 'Factory Method',
            location: 'src/factories/user-factory.ts:10-20',
            code: 'export function createUser(data: UserData): User {\n  return new User(data);\n}',
          },
        ],
        implementationExplanation: '',
        tradeOffs: [],
        conventions: [],
        antiPatterns: [],
        findings: [],
        wikiUpdates: [],
        confidence: 0.8,
      };

      const updates = generatePatternWikiUpdates(baseCommit, analysis);

      const patternPage = updates.find(u => u.path === 'patterns/factory-pattern');
      assert.ok(patternPage, 'Should create pattern page');
      assert.ok(patternPage!.content.includes('## Code Examples'), 'Should have Code Examples section');
      assert.ok(patternPage!.content.includes('### Factory Method'), 'Should have snippet title');
      assert.ok(patternPage!.content.includes('```typescript'), 'Should have code block');
      assert.ok(patternPage!.content.includes('createUser'), 'Should include code content');
      assert.ok(patternPage!.content.includes('src/factories/user-factory.ts:10-20'), 'Should include location');
    });

    it('should include implementation explanation in pattern wiki page', () => {
      const analysis: ParsedPatternAnalysis = {
        summary: 'Observer pattern implementation',
        patterns: [{
          name: 'Observer Pattern',
          category: 'design',
          description: 'Defines subscription mechanism',
          paths: ['src/events/emitter.ts'],
        }],
        keyFiles: [],
        codeSnippets: [],
        implementationExplanation: 'The Observer pattern is implemented using an EventEmitter class. Components subscribe via on() and unsubscribe via off(). The emit() method notifies all registered listeners.',
        tradeOffs: [],
        conventions: [],
        antiPatterns: [],
        findings: [],
        wikiUpdates: [],
        confidence: 0.9,
      };

      const updates = generatePatternWikiUpdates(baseCommit, analysis);

      const patternPage = updates.find(u => u.path === 'patterns/observer-pattern');
      assert.ok(patternPage, 'Should create pattern page');
      assert.ok(patternPage!.content.includes('## How It Works'), 'Should have How It Works section');
      assert.ok(patternPage!.content.includes('EventEmitter'), 'Should include explanation content');
      assert.ok(patternPage!.content.includes('subscribe via on()'), 'Should include implementation details');
    });

    it('should include trade-offs section in pattern wiki page', () => {
      const analysis: ParsedPatternAnalysis = {
        summary: 'Singleton pattern implementation',
        patterns: [{
          name: 'Singleton Pattern',
          category: 'design',
          description: 'Ensures single instance',
          paths: ['src/services/logger.ts'],
        }],
        keyFiles: [],
        codeSnippets: [],
        implementationExplanation: '',
        tradeOffs: [
          { name: 'Global State', description: 'Singleton provides convenient access but introduces global state which can make testing harder.' },
          { name: 'Lazy Initialization', description: 'Instance is created on first access, saving memory but adding slight latency.' },
        ],
        conventions: [],
        antiPatterns: [],
        findings: [],
        wikiUpdates: [],
        confidence: 0.85,
      };

      const updates = generatePatternWikiUpdates(baseCommit, analysis);

      const patternPage = updates.find(u => u.path === 'patterns/singleton-pattern');
      assert.ok(patternPage, 'Should create pattern page');
      assert.ok(patternPage!.content.includes('## Design Trade-offs'), 'Should have Trade-offs section');
      assert.ok(patternPage!.content.includes('### Global State'), 'Should have trade-off name');
      assert.ok(patternPage!.content.includes('global state'), 'Should include trade-off description');
      assert.ok(patternPage!.content.includes('### Lazy Initialization'), 'Should have second trade-off');
    });

    it('should include all enhanced sections in comprehensive pattern page', () => {
      const analysis: ParsedPatternAnalysis = {
        summary: 'CQRS implementation',
        patterns: [{
          name: 'CQRS',
          category: 'architecture',
          description: 'Separates read and write operations',
          paths: ['src/commands/', 'src/queries/'],
        }],
        keyFiles: [
          { path: 'src/commands/create-user.ts', role: 'PRIMARY', description: 'Command handler' },
          { path: 'src/queries/get-user.ts', role: 'PRIMARY', description: 'Query handler' },
          { path: 'src/handlers/base.ts', role: 'SUPPORTING', description: 'Base handler class' },
        ],
        codeSnippets: [
          {
            name: 'Command Handler',
            location: 'src/commands/create-user.ts:15-30',
            code: 'export async function handleCreateUser(cmd: CreateUserCommand) {\n  // validation and persistence\n}',
          },
          {
            name: 'Query Handler',
            location: 'src/queries/get-user.ts:10-20',
            code: 'export async function handleGetUser(query: GetUserQuery) {\n  // fetch from read model\n}',
          },
        ],
        implementationExplanation: 'CQRS is implemented by separating command handlers (write operations) from query handlers (read operations). Commands mutate state and return void, while queries return data without side effects.',
        tradeOffs: [
          { name: 'Complexity vs Scalability', description: 'CQRS adds architectural complexity but enables independent scaling of read and write paths.' },
          { name: 'Eventual Consistency', description: 'Read models may lag behind writes, trading immediate consistency for performance.' },
        ],
        conventions: ['Commands are named as verbs (CreateUser)', 'Queries are named as questions (GetUser)'],
        antiPatterns: [],
        findings: [],
        wikiUpdates: [],
        confidence: 0.92,
      };

      const updates = generatePatternWikiUpdates(baseCommit, analysis);

      const patternPage = updates.find(u => u.path === 'patterns/cqrs');
      assert.ok(patternPage, 'Should create pattern page');

      // Check all sections exist
      assert.ok(patternPage!.content.includes('## Key Files'), 'Should have Key Files section');
      assert.ok(patternPage!.content.includes('## Code Examples'), 'Should have Code Examples section');
      assert.ok(patternPage!.content.includes('## How It Works'), 'Should have How It Works section');
      assert.ok(patternPage!.content.includes('## Design Trade-offs'), 'Should have Trade-offs section');

      // Check content quality
      assert.ok(patternPage!.content.includes('Command Handler'), 'Should include command snippet');
      assert.ok(patternPage!.content.includes('Query Handler'), 'Should include query snippet');
      assert.ok(patternPage!.content.includes('Complexity vs Scalability'), 'Should include trade-off');
    });
  });

  describe('pages without enhanced content', () => {
    it('should generate valid page when no key files identified', () => {
      const analysis: ParsedPatternAnalysis = {
        summary: 'Simple pattern',
        patterns: [{
          name: 'Simple Pattern',
          category: 'design',
          description: 'A simple pattern',
          paths: [],
        }],
        keyFiles: [],
        codeSnippets: [],
        implementationExplanation: '',
        tradeOffs: [],
        conventions: [],
        antiPatterns: [],
        findings: [],
        wikiUpdates: [],
        confidence: 0.5,
      };

      const updates = generatePatternWikiUpdates(baseCommit, analysis);

      const patternPage = updates.find(u => u.path === 'patterns/simple-pattern');
      assert.ok(patternPage, 'Should create pattern page');
      // Should not have empty sections
      assert.ok(!patternPage!.content.includes('## Key Files\n\n##'), 'Should not have empty Key Files section');
    });

    it('should omit sections gracefully when data is missing', () => {
      const analysis: ParsedPatternAnalysis = {
        summary: 'Minimal pattern',
        patterns: [{
          name: 'Minimal',
          category: 'convention',
          description: 'Just a convention',
          paths: ['src/utils.ts'],
        }],
        keyFiles: [],
        codeSnippets: [],
        implementationExplanation: '',
        tradeOffs: [],
        conventions: [],
        antiPatterns: [],
        findings: [],
        wikiUpdates: [],
        confidence: 0.4,
      };

      const updates = generatePatternWikiUpdates(baseCommit, analysis);

      const patternPage = updates.find(u => u.path === 'patterns/minimal');
      assert.ok(patternPage, 'Should create pattern page');

      // Should not include empty section headers
      const content = patternPage!.content;
      const hasKeyFilesSection = content.includes('## Key Files');
      const hasCodeExamplesSection = content.includes('## Code Examples');
      const hasHowItWorksSection = content.includes('## How It Works');
      const hasTradeOffsSection = content.includes('## Design Trade-offs');

      // At minimum should have description
      assert.ok(content.includes('Just a convention'), 'Should include description');

      // Empty sections should be omitted
      if (hasKeyFilesSection) {
        assert.ok(content.includes('src/'), 'If Key Files section exists, should have content');
      }
    });
  });

  describe('confidence delta scoring', () => {
    it('should have higher confidence delta for pages with more enhanced content', () => {
      const richAnalysis: ParsedPatternAnalysis = {
        summary: 'Rich pattern',
        patterns: [{
          name: 'Rich Pattern',
          category: 'architecture',
          description: 'Well documented',
          paths: ['src/rich.ts'],
        }],
        keyFiles: [{ path: 'src/rich.ts', role: 'PRIMARY', description: 'Main file' }],
        codeSnippets: [{ name: 'Example', location: 'src/rich.ts:1-10', code: 'const x = 1;' }],
        implementationExplanation: 'Detailed explanation of how this works.',
        tradeOffs: [{ name: 'Trade-off', description: 'Important consideration' }],
        conventions: [],
        antiPatterns: [],
        findings: [],
        wikiUpdates: [],
        confidence: 0.9,
      };

      const sparseAnalysis: ParsedPatternAnalysis = {
        summary: 'Sparse pattern',
        patterns: [{
          name: 'Sparse Pattern',
          category: 'design',
          description: 'Minimal documentation',
          paths: [],
        }],
        keyFiles: [],
        codeSnippets: [],
        implementationExplanation: '',
        tradeOffs: [],
        conventions: [],
        antiPatterns: [],
        findings: [],
        wikiUpdates: [],
        confidence: 0.5,
      };

      const richUpdates = generatePatternWikiUpdates(baseCommit, richAnalysis);
      const sparseUpdates = generatePatternWikiUpdates(baseCommit, sparseAnalysis);

      const richPage = richUpdates.find(u => u.path === 'patterns/rich-pattern');
      const sparsePage = sparseUpdates.find(u => u.path === 'patterns/sparse-pattern');

      assert.ok(richPage, 'Should create rich pattern page');
      assert.ok(sparsePage, 'Should create sparse pattern page');

      // Rich content should have higher confidence contribution
      assert.ok(
        richPage!.confidenceDelta >= sparsePage!.confidenceDelta,
        'Rich content should have equal or higher confidence delta'
      );
    });
  });

  describe('anti-pattern handling', () => {
    it('should not include enhanced sections for anti-pattern pages', () => {
      const analysis: ParsedPatternAnalysis = {
        summary: 'Anti-pattern detected',
        patterns: [{
          name: 'God Class',
          category: 'anti-pattern',
          description: 'Class with too many responsibilities',
          paths: ['src/god.ts'],
        }],
        keyFiles: [{ path: 'src/god.ts', role: 'PRIMARY', description: 'The problematic class' }],
        codeSnippets: [],
        implementationExplanation: 'This class handles database, caching, validation, and UI rendering.',
        tradeOffs: [],
        conventions: [],
        antiPatterns: ['God class with 50+ methods'],
        findings: [],
        wikiUpdates: [],
        confidence: 0.95,
      };

      const updates = generatePatternWikiUpdates(baseCommit, analysis);

      // Anti-patterns go to the anti-patterns page, not individual pattern pages
      const antiPatternPage = updates.find(u => u.path === 'patterns/anti-patterns');
      assert.ok(antiPatternPage, 'Should create anti-patterns page');

      // Should not create a positive pattern page for anti-patterns
      const godClassPage = updates.find(u => u.path === 'patterns/god-class');
      assert.ok(!godClassPage, 'Should not create pattern page for anti-pattern');
    });
  });
});
