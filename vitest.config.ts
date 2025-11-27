import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns
    include: [
      'tests/**/*.test.ts',
      'src/**/*.test.ts', // Keep for backwards compatibility during migration
    ],
    exclude: [
      'node_modules',
      'dist',
      'tests/e2e/**', // E2E tests use Playwright
    ],

    // Environment
    environment: 'node',

    // Timeouts
    testTimeout: 10000,
    hookTimeout: 10000,

    // Reporter
    reporters: ['verbose'],

    // Coverage (run with --coverage flag)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules',
        'dist',
        'tests',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },
  },
});
