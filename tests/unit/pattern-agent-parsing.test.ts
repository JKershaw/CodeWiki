/**
 * Unit tests for PatternAgent response parsing.
 * Tests the parsing of LLM responses with enhanced sections for:
 * - Key files identification
 * - Code snippets extraction
 * - Implementation explanations
 * - Trade-off analysis
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { parsePatternResponse } from '../../src/agents/analysis/pattern-agent.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});

describe('parsePatternResponse', () => {
  describe('basic parsing', () => {
    it('should parse a well-formed response with all sections', () => {
      const response = `SUMMARY:
This commit implements the Repository pattern for data access.

PATTERNS_FOUND:
- [Repository Pattern] [CATEGORY:architecture] [Abstracts data access behind a clean interface] [src/repositories/user-repository.ts]

KEY_FILES:
- [src/repositories/user-repository.ts] [PRIMARY] Repository implementation with CRUD operations
- [src/repositories/base-repository.ts] [SUPPORTING] Base class providing common repository methods
- [src/domain/user.ts] [RELATED] Domain entity used by the repository

CODE_SNIPPETS:
- [Repository Interface] [src/repositories/user-repository.ts:5-15]
\`\`\`typescript
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  save(user: User): Promise<void>;
  delete(id: string): Promise<void>;
}
\`\`\`

IMPLEMENTATION_EXPLANATION:
The Repository pattern is implemented here by creating an interface that defines data access operations (findById, save, delete) and a concrete implementation that handles database interactions. The controller depends only on the interface, not the implementation, enabling easy testing and swapping of storage backends.

TRADE_OFFS:
- [Abstraction vs Simplicity] This design prioritizes testability and flexibility over simplicity. Direct database calls would be simpler but harder to test and change.
- [Performance vs Consistency] The repository loads full entities rather than projections, prioritizing data consistency over query performance.

CONVENTIONS:
- Repository files are named with -repository.ts suffix
- All repository methods return Promises

ANTI_PATTERNS:

WIKI_UPDATES:
- [patterns/repository-pattern] [create] Document the Repository pattern implementation

CONFIDENCE: 0.9`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.summary, 'This commit implements the Repository pattern for data access.');
      assert.strictEqual(result.patterns.length, 1);
      assert.strictEqual(result.patterns[0].name, 'Repository Pattern');
      assert.strictEqual(result.patterns[0].category, 'architecture');

      // New fields
      assert.strictEqual(result.keyFiles.length, 3);
      assert.strictEqual(result.keyFiles[0].path, 'src/repositories/user-repository.ts');
      assert.strictEqual(result.keyFiles[0].role, 'PRIMARY');

      assert.strictEqual(result.codeSnippets.length, 1);
      assert.strictEqual(result.codeSnippets[0].name, 'Repository Interface');
      assert.ok(result.codeSnippets[0].code.includes('export interface UserRepository'));

      assert.ok(result.implementationExplanation.includes('Repository pattern'));

      assert.strictEqual(result.tradeOffs.length, 2);
      assert.ok(result.tradeOffs[0].name.includes('Abstraction'));

      assert.strictEqual(result.confidence, 0.9);
    });

    it('should handle response with empty new sections', () => {
      const response = `SUMMARY:
Minor utility function added.

PATTERNS_FOUND:

KEY_FILES:

CODE_SNIPPETS:

IMPLEMENTATION_EXPLANATION:

TRADE_OFFS:

CONVENTIONS:
- Uses camelCase for function names

ANTI_PATTERNS:

WIKI_UPDATES:

CONFIDENCE: 0.3`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.summary, 'Minor utility function added.');
      assert.strictEqual(result.keyFiles.length, 0);
      assert.strictEqual(result.codeSnippets.length, 0);
      assert.strictEqual(result.implementationExplanation, '');
      assert.strictEqual(result.tradeOffs.length, 0);
      assert.strictEqual(result.confidence, 0.3);
    });
  });

  describe('KEY_FILES parsing', () => {
    it('should parse key files with different roles', () => {
      const response = `SUMMARY:
Test

PATTERNS_FOUND:

KEY_FILES:
- [src/main.ts] [PRIMARY] Main entry point
- [src/config.ts] [SUPPORTING] Configuration loading
- [src/types.ts] [RELATED] Type definitions
- [src/utils/helpers.ts] [EXAMPLE] Helper utilities

CODE_SNIPPETS:

IMPLEMENTATION_EXPLANATION:

TRADE_OFFS:

CONVENTIONS:

ANTI_PATTERNS:

WIKI_UPDATES:

CONFIDENCE: 0.5`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.keyFiles.length, 4);
      assert.strictEqual(result.keyFiles[0].role, 'PRIMARY');
      assert.strictEqual(result.keyFiles[1].role, 'SUPPORTING');
      assert.strictEqual(result.keyFiles[2].role, 'RELATED');
      assert.strictEqual(result.keyFiles[3].role, 'EXAMPLE');
    });

    it('should handle key files without role specification', () => {
      const response = `SUMMARY:
Test

PATTERNS_FOUND:

KEY_FILES:
- [src/main.ts] Main entry point without explicit role

CODE_SNIPPETS:

IMPLEMENTATION_EXPLANATION:

TRADE_OFFS:

CONVENTIONS:

ANTI_PATTERNS:

WIKI_UPDATES:

CONFIDENCE: 0.5`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.keyFiles.length, 1);
      assert.strictEqual(result.keyFiles[0].path, 'src/main.ts');
      assert.strictEqual(result.keyFiles[0].role, 'RELATED'); // Default role
    });
  });

  describe('CODE_SNIPPETS parsing', () => {
    it('should parse code snippets with location info', () => {
      const response = `SUMMARY:
Test

PATTERNS_FOUND:

KEY_FILES:

CODE_SNIPPETS:
- [Factory Method] [src/factories/user-factory.ts:10-25]
\`\`\`typescript
export function createUser(data: UserData): User {
  return new User(data.id, data.name);
}
\`\`\`
- [Singleton Instance] [src/services/logger.ts:5-12]
\`\`\`typescript
let instance: Logger | null = null;
export function getLogger(): Logger {
  if (!instance) instance = new Logger();
  return instance;
}
\`\`\`

IMPLEMENTATION_EXPLANATION:

TRADE_OFFS:

CONVENTIONS:

ANTI_PATTERNS:

WIKI_UPDATES:

CONFIDENCE: 0.7`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.codeSnippets.length, 2);

      assert.strictEqual(result.codeSnippets[0].name, 'Factory Method');
      assert.strictEqual(result.codeSnippets[0].location, 'src/factories/user-factory.ts:10-25');
      assert.ok(result.codeSnippets[0].code.includes('createUser'));

      assert.strictEqual(result.codeSnippets[1].name, 'Singleton Instance');
      assert.ok(result.codeSnippets[1].code.includes('getLogger'));
    });

    it('should handle code snippets without location', () => {
      const response = `SUMMARY:
Test

PATTERNS_FOUND:

KEY_FILES:

CODE_SNIPPETS:
- [Example Pattern]
\`\`\`typescript
const example = true;
\`\`\`

IMPLEMENTATION_EXPLANATION:

TRADE_OFFS:

CONVENTIONS:

ANTI_PATTERNS:

WIKI_UPDATES:

CONFIDENCE: 0.5`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.codeSnippets.length, 1);
      assert.strictEqual(result.codeSnippets[0].name, 'Example Pattern');
      assert.strictEqual(result.codeSnippets[0].location, '');
    });

    it('should handle multi-line code snippets', () => {
      const response = `SUMMARY:
Test

PATTERNS_FOUND:

KEY_FILES:

CODE_SNIPPETS:
- [Complex Example] [src/complex.ts:1-50]
\`\`\`typescript
export class ComplexService {
  private readonly deps: Dependencies;

  constructor(deps: Dependencies) {
    this.deps = deps;
  }

  async process(input: Input): Promise<Output> {
    const validated = await this.validate(input);
    const transformed = this.transform(validated);
    return this.save(transformed);
  }
}
\`\`\`

IMPLEMENTATION_EXPLANATION:

TRADE_OFFS:

CONVENTIONS:

ANTI_PATTERNS:

WIKI_UPDATES:

CONFIDENCE: 0.8`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.codeSnippets.length, 1);
      assert.ok(result.codeSnippets[0].code.includes('ComplexService'));
      assert.ok(result.codeSnippets[0].code.includes('process(input: Input)'));
    });
  });

  describe('IMPLEMENTATION_EXPLANATION parsing', () => {
    it('should parse multi-line implementation explanation', () => {
      const response = `SUMMARY:
Test

PATTERNS_FOUND:

KEY_FILES:

CODE_SNIPPETS:

IMPLEMENTATION_EXPLANATION:
The Observer pattern is implemented through an EventEmitter base class.
Components can subscribe to events using the on() method.
When state changes, the emit() method notifies all subscribers.
This decouples the event source from its handlers.

TRADE_OFFS:

CONVENTIONS:

ANTI_PATTERNS:

WIKI_UPDATES:

CONFIDENCE: 0.85`;

      const result = parsePatternResponse(response);

      assert.ok(result.implementationExplanation.includes('Observer pattern'));
      assert.ok(result.implementationExplanation.includes('EventEmitter'));
      assert.ok(result.implementationExplanation.includes('decouples'));
    });
  });

  describe('TRADE_OFFS parsing', () => {
    it('should parse trade-offs with name and description', () => {
      const response = `SUMMARY:
Test

PATTERNS_FOUND:

KEY_FILES:

CODE_SNIPPETS:

IMPLEMENTATION_EXPLANATION:

TRADE_OFFS:
- [Memory vs CPU] Caching results in memory trades memory usage for faster CPU performance on repeated calls.
- [Flexibility vs Type Safety] Using generics provides flexibility but requires more complex type definitions.
- [Simplicity vs Extensibility] The current design is simple but would need refactoring to add new features.

CONVENTIONS:

ANTI_PATTERNS:

WIKI_UPDATES:

CONFIDENCE: 0.75`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.tradeOffs.length, 3);

      assert.strictEqual(result.tradeOffs[0].name, 'Memory vs CPU');
      assert.ok(result.tradeOffs[0].description.includes('Caching'));

      assert.strictEqual(result.tradeOffs[1].name, 'Flexibility vs Type Safety');
      assert.ok(result.tradeOffs[1].description.includes('generics'));

      assert.strictEqual(result.tradeOffs[2].name, 'Simplicity vs Extensibility');
    });

    it('should handle trade-offs without bracketed name', () => {
      const response = `SUMMARY:
Test

PATTERNS_FOUND:

KEY_FILES:

CODE_SNIPPETS:

IMPLEMENTATION_EXPLANATION:

TRADE_OFFS:
- This design prioritizes read performance over write performance.

CONVENTIONS:

ANTI_PATTERNS:

WIKI_UPDATES:

CONFIDENCE: 0.6`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.tradeOffs.length, 1);
      assert.strictEqual(result.tradeOffs[0].name, 'Trade-off');
      assert.ok(result.tradeOffs[0].description.includes('read performance'));
    });
  });

  describe('backward compatibility', () => {
    it('should still parse legacy format without new sections', () => {
      const response = `SUMMARY:
Legacy format response.

PATTERNS_FOUND:
- [Factory Pattern] [CATEGORY:design] [Creates objects without specifying exact class] [src/factory.ts]

CONVENTIONS:
- Use PascalCase for class names

ANTI_PATTERNS:
- God class detected in src/app.ts

WIKI_UPDATES:
- [patterns/factory] [create] Document factory pattern

CONFIDENCE: 0.8`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.summary, 'Legacy format response.');
      assert.strictEqual(result.patterns.length, 1);
      assert.strictEqual(result.patterns[0].name, 'Factory Pattern');
      assert.strictEqual(result.conventions.length, 1);
      assert.strictEqual(result.antiPatterns.length, 1);
      assert.strictEqual(result.confidence, 0.8);

      // New fields should be empty/default
      assert.strictEqual(result.keyFiles.length, 0);
      assert.strictEqual(result.codeSnippets.length, 0);
      assert.strictEqual(result.implementationExplanation, '');
      assert.strictEqual(result.tradeOffs.length, 0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty response', () => {
      const response = '';

      const result = parsePatternResponse(response);

      assert.strictEqual(result.summary, '');
      assert.strictEqual(result.patterns.length, 0);
      assert.strictEqual(result.keyFiles.length, 0);
      assert.strictEqual(result.codeSnippets.length, 0);
      assert.strictEqual(result.implementationExplanation, '');
      assert.strictEqual(result.tradeOffs.length, 0);
      assert.strictEqual(result.confidence, 0.5);
    });

    it('should handle malformed sections gracefully', () => {
      const response = `SUMMARY:
Test

PATTERNS_FOUND:
- malformed line without brackets

KEY_FILES:
- also malformed

CODE_SNIPPETS:
- [Missing code block]

TRADE_OFFS:
incomplete

CONFIDENCE: not-a-number`;

      const result = parsePatternResponse(response);

      // Should not crash, should return defaults for unparseable content
      assert.strictEqual(result.summary, 'Test');
      assert.strictEqual(result.confidence, 0.5); // Default when parse fails
    });

    it('should trim whitespace from parsed values', () => {
      const response = `SUMMARY:
   Whitespace test

PATTERNS_FOUND:
-   [Pattern Name]   [CATEGORY:design]   [Description]   [path.ts]

KEY_FILES:
-   [  src/file.ts  ]   [PRIMARY]   Description with spaces

IMPLEMENTATION_EXPLANATION:
   Explanation with leading/trailing whitespace

CONFIDENCE: 0.7`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.summary, 'Whitespace test');
      assert.strictEqual(result.patterns[0].name, 'Pattern Name');
      assert.strictEqual(result.keyFiles[0].path, 'src/file.ts');
      assert.ok(!result.implementationExplanation.startsWith(' '));
    });
  });
});
