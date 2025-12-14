/**
 * CodeWiki Frontend Application
 *
 * This is the main entry point that initializes all modules.
 *
 * Dependencies (loaded before this file):
 *  - modules/utils.js - Utility functions (escapeHtml, formatters, etc.)
 *  - modules/api.js - API helper
 *  - modules/ui.js - Toast and modal utilities
 *  - modules/state.js - Application state and navigation
 *  - modules/config.js - Configuration and model selection
 *  - modules/auth.js - Authentication
 *  - modules/github.js - GitHub integration
 *  - modules/browser.js - Folder browser
 *  - modules/repos.js - Repository management
 *  - modules/wiki.js - Wiki viewing
 *  - modules/graph.js - Graph visualization
 *  - modules/query.js - Query functionality
 *  - modules/spec.js - Spec generation
 *  - modules/benchmark.js - Benchmarks and self-improvement
 *  - modules/chat.js - Chat sessions
 *  - modules/debug.js - Debug/observability view
 */

/**
 * Detect which page we're on based on the URL path.
 * @returns {string} Page name: repos, wiki, graph, query, spec, benchmark, or debug
 */
function detectCurrentPage() {
  const path = window.location.pathname;
  if (path.startsWith('/wiki/')) return 'wiki';
  if (path.startsWith('/graph/')) return 'graph';
  if (path.startsWith('/query/')) return 'query';
  if (path.startsWith('/spec/')) return 'spec';
  if (path.startsWith('/benchmark/')) return 'benchmark';
  if (path.startsWith('/debug/')) return 'debug';
  return 'repos';
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  const currentPage = detectCurrentPage();

  // Initialize UI components (needed on all pages)
  initModalListeners();
  initSidePanelListeners();

  // Initialize event listeners for modules present on this page
  if (currentPage === 'repos') {
    initBrowserListeners();
  }
  if (currentPage === 'wiki') {
    initWikiListeners();
  }
  if (currentPage === 'graph') {
    initGraphListeners();
  }
  if (currentPage === 'query') {
    initQueryListeners();
  }
  if (currentPage === 'spec') {
    initSpecListeners();
  }
  if (currentPage === 'benchmark') {
    initBenchmarkListeners();
    initChatListeners();
  }
  if (currentPage === 'debug') {
    initDebugListeners();
  }

  // Load common data (config, version, user)
  await Promise.all([
    loadConfig(),
    loadVersionInfo(),
    loadCurrentUser(),
  ]);

  // Initialize page-specific content
  switch (currentPage) {
    case 'repos':
      await loadRepos();
      break;
    case 'wiki':
      await initWikiPage();
      break;
    case 'graph':
      await initGraphPage();
      break;
    case 'query':
      await initQueryPage();
      break;
    case 'spec':
      await initSpecPage();
      break;
    case 'benchmark':
      await initBenchmarkPage();
      break;
    case 'debug':
      await initDebugPage();
      break;
  }
});
