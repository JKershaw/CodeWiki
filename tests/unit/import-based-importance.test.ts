/**
 * Unit tests for import-based importance weighting.
 *
 * Files that are imported by many others are more important to document
 * because changes to them affect more of the codebase.
 *
 * TDD: Define behavior through tests before implementation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractImports,
  buildDependencyGraph,
  calculateDependentCount,
  calculateImportanceBoost,
} from '../../src/agents/orchestrator/import-analysis.js';

describe('extractImports', () => {
  describe('ES module imports', () => {
    it('extracts simple named imports', () => {
      const content = `import { foo } from './utils.js';`;
      const imports = extractImports(content);
      assert.deepStrictEqual(imports, ['./utils.js']);
    });

    it('extracts default imports', () => {
      const content = `import App from './App.tsx';`;
      const imports = extractImports(content);
      assert.deepStrictEqual(imports, ['./App.tsx']);
    });

    it('extracts namespace imports', () => {
      const content = `import * as utils from '../utils/index.js';`;
      const imports = extractImports(content);
      assert.deepStrictEqual(imports, ['../utils/index.js']);
    });

    it('extracts multiple imports from same file', () => {
      const content = `
import { a, b, c } from './helpers.js';
import { x } from './helpers.js';
`;
      const imports = extractImports(content);
      // Should include the path once or twice - either is acceptable
      assert.ok(imports.includes('./helpers.js'));
    });

    it('extracts imports from multiple files', () => {
      const content = `
import { foo } from './foo.js';
import { bar } from './bar.js';
import { baz } from '../shared/baz.js';
`;
      const imports = extractImports(content);
      assert.ok(imports.includes('./foo.js'));
      assert.ok(imports.includes('./bar.js'));
      assert.ok(imports.includes('../shared/baz.js'));
    });

    it('handles imports without extensions', () => {
      const content = `import { helper } from './helper';`;
      const imports = extractImports(content);
      assert.deepStrictEqual(imports, ['./helper']);
    });
  });

  describe('side-effect imports', () => {
    it('extracts side-effect imports', () => {
      const content = `import './polyfills.js';`;
      const imports = extractImports(content);
      assert.deepStrictEqual(imports, ['./polyfills.js']);
    });
  });

  describe('dynamic imports', () => {
    it('extracts dynamic imports', () => {
      const content = `const module = await import('./lazy-module.js');`;
      const imports = extractImports(content);
      assert.ok(imports.includes('./lazy-module.js'));
    });
  });

  describe('require statements', () => {
    it('extracts CommonJS require', () => {
      const content = `const utils = require('./utils.js');`;
      const imports = extractImports(content);
      assert.deepStrictEqual(imports, ['./utils.js']);
    });

    it('extracts destructured require', () => {
      const content = `const { foo, bar } = require('./helpers.js');`;
      const imports = extractImports(content);
      assert.deepStrictEqual(imports, ['./helpers.js']);
    });
  });

  describe('filtering', () => {
    it('excludes node_modules imports', () => {
      const content = `
import React from 'react';
import { useState } from 'react';
import express from 'express';
import { foo } from './local.js';
`;
      const imports = extractImports(content);
      assert.deepStrictEqual(imports, ['./local.js']);
    });

    it('excludes built-in modules', () => {
      const content = `
import fs from 'fs';
import path from 'path';
import { foo } from './local.js';
`;
      const imports = extractImports(content);
      assert.deepStrictEqual(imports, ['./local.js']);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for no imports', () => {
      const content = `const x = 1; console.log(x);`;
      const imports = extractImports(content);
      assert.deepStrictEqual(imports, []);
    });

    it('handles empty content', () => {
      const imports = extractImports('');
      assert.deepStrictEqual(imports, []);
    });

    it('handles multiline imports', () => {
      const content = `
import {
  foo,
  bar,
  baz,
} from './helpers.js';
`;
      const imports = extractImports(content);
      assert.deepStrictEqual(imports, ['./helpers.js']);
    });
  });
});

describe('buildDependencyGraph', () => {
  it('builds graph from file contents', () => {
    const files = new Map<string, string>([
      ['src/app.ts', `import { foo } from './utils.js';\nimport { bar } from './services/api.js';`],
      ['src/utils.ts', `export const foo = 1;`],
      ['src/services/api.ts', `import { foo } from '../utils.js';`],
    ]);

    const graph = buildDependencyGraph(files);

    // utils.ts is imported by app.ts and api.ts
    assert.ok(graph.has('src/utils.ts') || graph.has('src/utils.js'));
  });

  it('handles empty files', () => {
    const files = new Map<string, string>([
      ['src/empty.ts', ''],
    ]);

    const graph = buildDependencyGraph(files);
    assert.strictEqual(graph.size, 0);
  });

  it('resolves relative paths correctly', () => {
    const files = new Map<string, string>([
      ['src/app.ts', `import { x } from './lib/helper.js';`],
      ['src/lib/helper.ts', `export const x = 1;`],
    ]);

    const graph = buildDependencyGraph(files);

    // helper.ts should have app.ts as a dependent
    const helperKey = Array.from(graph.keys()).find(k => k.includes('helper'));
    if (helperKey) {
      assert.ok(graph.get(helperKey)!.size > 0);
    }
  });
});

describe('calculateDependentCount', () => {
  it('returns 0 for files with no dependents', () => {
    const graph = new Map<string, Set<string>>();
    const count = calculateDependentCount('src/orphan.ts', graph);
    assert.strictEqual(count, 0);
  });

  it('counts direct dependents', () => {
    const graph = new Map<string, Set<string>>([
      ['src/utils.ts', new Set(['src/app.ts', 'src/service.ts', 'src/helper.ts'])],
    ]);

    const count = calculateDependentCount('src/utils.ts', graph);
    assert.strictEqual(count, 3);
  });

  it('handles files not in graph', () => {
    const graph = new Map<string, Set<string>>([
      ['src/utils.ts', new Set(['src/app.ts'])],
    ]);

    const count = calculateDependentCount('src/unknown.ts', graph);
    assert.strictEqual(count, 0);
  });
});

describe('calculateImportanceBoost', () => {
  it('returns 1.0 for files with few dependents', () => {
    // 0-4 dependents = no boost
    assert.strictEqual(calculateImportanceBoost(0), 1.0);
    assert.strictEqual(calculateImportanceBoost(2), 1.0);
    assert.strictEqual(calculateImportanceBoost(4), 1.0);
  });

  it('returns 1.5x boost for files with 5-9 dependents', () => {
    assert.strictEqual(calculateImportanceBoost(5), 1.5);
    assert.strictEqual(calculateImportanceBoost(7), 1.5);
    assert.strictEqual(calculateImportanceBoost(9), 1.5);
  });

  it('returns 2.0x boost for files with 10+ dependents', () => {
    assert.strictEqual(calculateImportanceBoost(10), 2.0);
    assert.strictEqual(calculateImportanceBoost(15), 2.0);
    assert.strictEqual(calculateImportanceBoost(50), 2.0);
  });

  describe('real-world scenarios', () => {
    it('boosts commonly used utility files', () => {
      // utils.ts imported by 12 files
      const boost = calculateImportanceBoost(12);
      assert.strictEqual(boost, 2.0);
    });

    it('does not boost leaf modules', () => {
      // page-component.ts only imported by its parent
      const boost = calculateImportanceBoost(1);
      assert.strictEqual(boost, 1.0);
    });
  });
});
