/**
 * GitHub integration module for CodeWiki frontend.
 * Handles GitHub URL validation, repo picker, and authentication.
 */

// Module state
let githubInstallationUrl = null;
let accessibleGitHubRepos = [];
let selectedGitHubRepo = null;

/**
 * Validate a GitHub URL.
 * Accepts formats like:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - http://github.com/owner/repo
 */
function isValidGitHubUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return false;
    // Path should be /owner/repo or /owner/repo.git
    const pathMatch = parsed.pathname.match(/^\/([^\/]+)\/([^\/]+?)(\.git)?$/);
    return pathMatch !== null;
  } catch {
    return false;
  }
}

/**
 * Extract owner/repo from GitHub URL.
 */
function extractRepoName(url) {
  try {
    const parsed = new URL(url);
    const pathMatch = parsed.pathname.match(/^\/([^\/]+)\/([^\/]+?)(\.git)?$/);
    if (pathMatch) {
      return `${pathMatch[1]}/${pathMatch[2]}`;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Fetch the GitHub App installation URL.
 */
async function fetchGitHubInstallationUrl() {
  if (githubInstallationUrl) return githubInstallationUrl;

  try {
    const response = await fetch('/auth/github/installation');
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();
        if (data && data.url) {
          githubInstallationUrl = data.url;
          return githubInstallationUrl;
        }
      }
    }
  } catch {
    // GitHub auth not configured
  }
  return null;
}

/**
 * Fetch repositories accessible to the current user via GitHub App.
 */
async function fetchAccessibleGitHubRepos() {
  if (!currentUser) return [];

  try {
    const response = await fetch('/auth/github/repos');
    if (response.ok) {
      const data = await response.json();
      accessibleGitHubRepos = data.repos || [];
      return accessibleGitHubRepos;
    }
  } catch (error) {
    console.error('Failed to fetch accessible repos:', error);
  }
  return [];
}

/**
 * Render the GitHub repos picker panel based on auth state.
 */
async function renderGitHubReposPanel() {
  const githubReposSection = document.getElementById('github-repos-section');
  const githubEmptyState = document.getElementById('github-empty-state');
  const githubLoginPrompt = document.getElementById('github-login-prompt');
  const githubAccessError = document.getElementById('github-access-error');
  const githubReposList = document.getElementById('github-repos-list');
  const githubManageAccess = document.getElementById('github-manage-access');
  const githubInstallApp = document.getElementById('github-install-app');
  const githubErrorInstall = document.getElementById('github-error-install');
  const githubUrlInput = document.getElementById('github-url');
  const submitRepoBtn = document.getElementById('submit-repo-btn');

  // Hide all sections initially
  githubReposSection.classList.add('hidden');
  githubEmptyState.classList.add('hidden');
  githubLoginPrompt.classList.add('hidden');
  githubAccessError.classList.add('hidden');

  // Fetch installation URL for manage/install links
  const installUrl = await fetchGitHubInstallationUrl();

  if (!installUrl) {
    // GitHub auth not configured on server
    return;
  }

  // Set up installation URLs on all relevant links
  if (githubManageAccess) githubManageAccess.href = installUrl;
  if (githubInstallApp) githubInstallApp.href = installUrl;
  if (githubErrorInstall) githubErrorInstall.href = installUrl;

  if (!currentUser) {
    // Not logged in - show login prompt
    githubLoginPrompt.classList.remove('hidden');
    return;
  }

  // User is logged in - fetch their accessible repos
  githubReposList.innerHTML = '<p class="loading">Loading your repositories...</p>';
  githubReposSection.classList.remove('hidden');

  const repos = await fetchAccessibleGitHubRepos();

  if (repos.length === 0) {
    // No repos accessible - show install prompt
    githubReposSection.classList.add('hidden');
    githubEmptyState.classList.remove('hidden');
    return;
  }

  // Render the repo list
  githubReposList.innerHTML = repos.map(repo => `
    <div class="github-repo-item" data-full-name="${escapeHtml(repo.fullName)}" data-clone-url="${escapeHtml(repo.cloneUrl)}">
      <span class="repo-icon">${repo.isPrivate ? '🔒' : '📦'}</span>
      <span class="repo-name">${escapeHtml(repo.fullName)}</span>
      ${repo.isPrivate ? '<span class="private-badge">Private</span>' : ''}
    </div>
  `).join('');

  // Add click handlers
  githubReposList.querySelectorAll('.github-repo-item').forEach(item => {
    item.addEventListener('click', () => {
      // Deselect all
      githubReposList.querySelectorAll('.github-repo-item').forEach(i => i.classList.remove('selected'));
      // Select this one
      item.classList.add('selected');
      selectedGitHubRepo = {
        fullName: item.dataset.fullName,
        cloneUrl: item.dataset.cloneUrl,
      };
      // Clear URL input and enable submit
      githubUrlInput.value = '';
      submitRepoBtn.disabled = false;
    });
  });
}

/**
 * Show the GitHub access error with install link.
 */
function showGitHubAccessError() {
  const githubAccessError = document.getElementById('github-access-error');
  githubAccessError.classList.remove('hidden');
}

/**
 * Hide the GitHub access error.
 */
function hideGitHubAccessError() {
  const githubAccessError = document.getElementById('github-access-error');
  githubAccessError.classList.add('hidden');
}

/**
 * Update submit button state based on GitHub URL validity or selected repo.
 */
function updateGitHubSubmitButton() {
  const currentRepoSource = getRepoSource();
  if (currentRepoSource === 'github') {
    const githubUrlInput = document.getElementById('github-url');
    const githubReposList = document.getElementById('github-repos-list');
    const submitRepoBtn = document.getElementById('submit-repo-btn');

    const url = githubUrlInput.value.trim();
    // Enable if either a repo is selected from picker OR a valid URL is entered
    const hasValidUrl = isValidGitHubUrl(url);
    const hasSelectedRepo = selectedGitHubRepo !== null;
    submitRepoBtn.disabled = !hasValidUrl && !hasSelectedRepo;

    // If user types in URL, deselect picker
    if (url && githubReposList) {
      githubReposList.querySelectorAll('.github-repo-item').forEach(i => i.classList.remove('selected'));
      if (hasValidUrl) {
        selectedGitHubRepo = null;
      }
    }
  }
}

/**
 * Get the currently selected GitHub repo.
 */
function getSelectedGitHubRepo() {
  return selectedGitHubRepo;
}

/**
 * Clear the selected GitHub repo.
 */
function clearSelectedGitHubRepo() {
  selectedGitHubRepo = null;
}
