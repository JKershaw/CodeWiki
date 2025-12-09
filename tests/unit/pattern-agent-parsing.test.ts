/**
 * Unit tests for PatternAgent response parsing.
 * Tests the parsing of LLM responses with the simplified format:
 * - PATTERNS (pipe-separated)
 * - KEY_FILES (pipe-separated)
 * - IMPLEMENTATION (free text)
 * - TRADE_OFFS (simple list)
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { parsePatternResponse } from '../../src/agents/analysis/pattern-agent.js';

// Suppress console output during tests
mock.method(console, 'warn', () => {});
mock.method(console, 'log', () => {});
mock.method(console, 'info', () => {});

describe('parsePatternResponse', () => {
  describe('basic parsing', () => {
    it('should parse a well-formed response with all sections', () => {
      const response = `SUMMARY:
This commit implements the Repository pattern for data access.

PATTERNS:
- name: Repository Pattern | category: architecture | description: Abstracts data access behind a clean interface | paths: src/repositories/user-repository.ts

KEY_FILES:
- path: src/repositories/user-repository.ts | role: primary | description: Repository implementation with CRUD operations
- path: src/repositories/base-repository.ts | role: supporting | description: Base class providing common repository methods
- path: src/domain/user.ts | role: related | description: Domain entity used by the repository

IMPLEMENTATION:
The Repository pattern is implemented here by creating an interface that defines data access operations (findById, save, delete) and a concrete implementation that handles database interactions. The controller depends only on the interface, not the implementation, enabling easy testing and swapping of storage backends.

TRADE_OFFS:
- This design prioritizes testability and flexibility over simplicity. Direct database calls would be simpler but harder to test and change.
- The repository loads full entities rather than projections, prioritizing data consistency over query performance.

CONVENTIONS:
- Repository files are named with -repository.ts suffix
- All repository methods return Promises

ANTI_PATTERNS:

CONFIDENCE: 0.9`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.summary, 'This commit implements the Repository pattern for data access.');
      assert.strictEqual(result.patterns.length, 1);
      assert.strictEqual(result.patterns[0]!.name, 'Repository Pattern');
      assert.strictEqual(result.patterns[0]!.category, 'architecture');

      // Key files
      assert.strictEqual(result.keyFiles.length, 3);
      assert.strictEqual(result.keyFiles[0]!.path, 'src/repositories/user-repository.ts');
      assert.strictEqual(result.keyFiles[0]!.role, 'PRIMARY');

      // Implementation
      assert.ok(result.implementationExplanation.includes('Repository pattern'));

      // Trade-offs (now just string descriptions with auto-generated name)
      assert.strictEqual(result.tradeOffs.length, 2);
      assert.ok(result.tradeOffs[0]!.description.includes('testability'));

      assert.strictEqual(result.confidence, 0.9);
    });

    it('should handle response with empty sections', () => {
      const response = `SUMMARY:
Minor utility function added.

PATTERNS:

KEY_FILES:

IMPLEMENTATION:

TRADE_OFFS:

CONVENTIONS:
- Uses camelCase for function names

ANTI_PATTERNS:

CONFIDENCE: 0.3`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.summary, 'Minor utility function added.');
      assert.strictEqual(result.keyFiles.length, 0);
      assert.strictEqual(result.implementationExplanation, '');
      assert.strictEqual(result.tradeOffs.length, 0);
      assert.strictEqual(result.confidence, 0.3);
    });
  });

  describe('PATTERNS parsing', () => {
    it('should parse patterns with pipe-separated format', () => {
      const response = `SUMMARY:
Test

PATTERNS:
- name: Factory Pattern | category: design | description: Creates objects | paths: src/factory.ts
- name: Singleton Pattern | category: design | description: Single instance | paths: src/singleton.ts, src/instance.ts

KEY_FILES:

IMPLEMENTATION:

TRADE_OFFS:

CONVENTIONS:

ANTI_PATTERNS:

CONFIDENCE: 0.8`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.patterns.length, 2);
      assert.strictEqual(result.patterns[0]!.name, 'Factory Pattern');
      assert.strictEqual(result.patterns[0]!.category, 'design');
      assert.strictEqual(result.patterns[1]!.paths.length, 2);
    });
  });

  describe('KEY_FILES parsing', () => {
    it('should parse key files with different roles', () => {
      const response = `SUMMARY:
Test

PATTERNS:

KEY_FILES:
- path: src/main.ts | role: primary | description: Main entry point
- path: src/config.ts | role: supporting | description: Configuration loading
- path: src/types.ts | role: related | description: Type definitions

IMPLEMENTATION:

TRADE_OFFS:

CONVENTIONS:

ANTI_PATTERNS:

CONFIDENCE: 0.5`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.keyFiles.length, 3);
      assert.strictEqual(result.keyFiles[0]!.role, 'PRIMARY');
      assert.strictEqual(result.keyFiles[1]!.role, 'SUPPORTING');
      assert.strictEqual(result.keyFiles[2]!.role, 'RELATED');
    });
  });

  describe('IMPLEMENTATION parsing', () => {
    it('should parse multi-line implementation explanation', () => {
      const response = `SUMMARY:
Test

PATTERNS:

KEY_FILES:

IMPLEMENTATION:
The Observer pattern is implemented through an EventEmitter base class.
Components can subscribe to events using the on() method.
When state changes, the emit() method notifies all subscribers.
This decouples the event source from its handlers.

TRADE_OFFS:

CONVENTIONS:

ANTI_PATTERNS:

CONFIDENCE: 0.85`;

      const result = parsePatternResponse(response);

      assert.ok(result.implementationExplanation.includes('Observer pattern'));
      assert.ok(result.implementationExplanation.includes('EventEmitter'));
      assert.ok(result.implementationExplanation.includes('decouples'));
    });
  });

  describe('TRADE_OFFS parsing', () => {
    it('should parse trade-offs as simple list items', () => {
      const response = `SUMMARY:
Test

PATTERNS:

KEY_FILES:

IMPLEMENTATION:

TRADE_OFFS:
- Caching results in memory trades memory usage for faster CPU performance on repeated calls.
- Using generics provides flexibility but requires more complex type definitions.
- The current design is simple but would need refactoring to add new features.

CONVENTIONS:

ANTI_PATTERNS:

CONFIDENCE: 0.75`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.tradeOffs.length, 3);
      // All trade-offs now have the generic name "Trade-off"
      assert.strictEqual(result.tradeOffs[0]!.name, 'Trade-off');
      assert.ok(result.tradeOffs[0]!.description.includes('Caching'));
      assert.ok(result.tradeOffs[1]!.description.includes('generics'));
    });
  });

  describe('edge cases', () => {
    it('should handle empty response', () => {
      const response = '';

      const result = parsePatternResponse(response);

      assert.strictEqual(result.summary, '');
      assert.strictEqual(result.patterns.length, 0);
      assert.strictEqual(result.keyFiles.length, 0);
      assert.strictEqual(result.implementationExplanation, '');
      assert.strictEqual(result.tradeOffs.length, 0);
      assert.strictEqual(result.confidence, 0.5);
    });

    it('should handle malformed sections gracefully', () => {
      const response = `SUMMARY:
Test

PATTERNS:
- malformed line without pipes

KEY_FILES:
- also malformed

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

PATTERNS:
-  name:  Pattern Name  |  category:  design  |  description:  Description  |  paths:  path.ts

KEY_FILES:
-  path:  src/file.ts  |  role:  primary  |  description:  Description with spaces

IMPLEMENTATION:
   Explanation with leading/trailing whitespace

CONFIDENCE: 0.7`;

      const result = parsePatternResponse(response);

      assert.strictEqual(result.summary, 'Whitespace test');
      assert.strictEqual(result.patterns[0]!.name, 'Pattern Name');
      assert.strictEqual(result.keyFiles[0]!.path, 'src/file.ts');
      assert.ok(!result.implementationExplanation.startsWith(' '));
    });
  });

  describe('code snippets removal', () => {
    it('should return empty code snippets array (feature removed)', () => {
      const response = `SUMMARY:
Test response

PATTERNS:
- name: Test Pattern | category: design | description: Test | paths: test.ts

CONFIDENCE: 0.8`;

      const result = parsePatternResponse(response);

      // Code snippets are no longer supported
      assert.strictEqual(result.codeSnippets.length, 0);
    });
  });
});
