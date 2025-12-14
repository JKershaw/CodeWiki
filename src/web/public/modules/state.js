/**
 * Application state management for CodeWiki frontend.
 */

// Global state
let currentRepo = null;
let currentWiki = null;
let currentPage = null;
let currentUser = null;

/**
 * Navigate to a repository-specific page.
 * @param {string} page - Page name (wiki, graph, query, spec, benchmark, debug)
 * @param {string} repoId - Repository ID
 */
function navigateToPage(page, repoId) {
  window.location.href = `/${page}/${repoId}`;
}

/**
 * Navigate to the repos list.
 */
function navigateToRepos() {
  window.location.href = '/';
}

/**
 * Initialize state from server-provided data.
 * Should be called on page load.
 */
async function initializeStateFromServer() {
  // Check if server provided a repoId
  if (window.currentRepoId) {
    try {
      currentRepo = await api(`/repos/${window.currentRepoId}`);

      // Get active wiki
      const wikis = await api(`/repos/${window.currentRepoId}/wikis`);
      currentWiki = wikis.find(w => w.isActive) || wikis[0] || null;
    } catch (error) {
      console.error('Failed to load repo state:', error);
    }
  }
}

/**
 * Get the current repo ID from either state or server-provided value.
 */
function getCurrentRepoId() {
  return currentRepo?.id || window.currentRepoId || null;
}
