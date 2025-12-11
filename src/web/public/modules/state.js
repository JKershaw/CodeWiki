/**
 * Application state management for CodeWiki frontend.
 */

// Global state
let currentRepo = null;
let currentWiki = null;
let currentPage = null;
let currentUser = null;

// DOM element references for views
const views = {
  repos: document.getElementById('repos-view'),
  wiki: document.getElementById('wiki-view'),
  graph: document.getElementById('graph-view'),
  query: document.getElementById('query-view'),
  spec: document.getElementById('spec-view'),
  benchmark: document.getElementById('benchmark-view'),
  debug: document.getElementById('debug-view'),
};

const navBtns = document.querySelectorAll('.nav-btn');

/**
 * Switch to a different view.
 * @param {string} viewName - Name of the view to show
 */
function showView(viewName) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[viewName].classList.add('active');

  navBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
}

/**
 * Initialize navigation event listeners.
 */
function initNavigation() {
  navBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!btn.disabled) {
        showView(btn.dataset.view);
        // Reload data when switching to benchmark view
        if (btn.dataset.view === 'benchmark' && currentRepo) {
          await loadBenchmarkHistory(currentRepo.id);
        }
      }
    });
  });
}

/**
 * Enable repository-specific nav buttons.
 */
function enableRepoNavButtons() {
  document.querySelector('[data-view="wiki"]').disabled = false;
  document.querySelector('[data-view="graph"]').disabled = false;
  document.querySelector('[data-view="query"]').disabled = false;
  document.querySelector('[data-view="spec"]').disabled = false;
  document.querySelector('[data-view="benchmark"]').disabled = false;
}
