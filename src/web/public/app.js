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

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize UI components
  initModalListeners();
  initSidePanelListeners();
  initNavigation();

  // Initialize feature modules
  initBrowserListeners();
  initWikiListeners();
  initGraphListeners();
  initQueryListeners();
  initSpecListeners();
  initBenchmarkListeners();
  initChatListeners();
  initDebugListeners();

  // Initialize back buttons
  initBackButtons();

  // Load initial data
  await Promise.all([
    loadConfig(),
    loadVersionInfo(),
    loadCurrentUser(),
    loadRepos(),
  ]);
});

/**
 * Initialize back button event listeners.
 */
function initBackButtons() {
  document.getElementById('back-to-repos').addEventListener('click', () => {
    showView('repos');
    loadRepos();
  });
  document.getElementById('back-to-repos-graph')?.addEventListener('click', () => {
    destroyGraph();
    showView('repos');
    loadRepos();
  });
  document.getElementById('back-to-repos-query').addEventListener('click', () => {
    showView('repos');
    loadRepos();
  });
  document.getElementById('back-to-repos-spec').addEventListener('click', () => {
    showView('repos');
    loadRepos();
  });
  document.getElementById('back-to-repos-debug')?.addEventListener('click', () => {
    showView('repos');
    loadRepos();
  });
}
