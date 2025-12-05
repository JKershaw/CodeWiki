/**
 * Folder browser module for CodeWiki frontend.
 * Handles local filesystem browsing for adding repositories.
 */

// Module state
let selectedRepoPath = null;
let currentBrowsePath = null;
let currentRepoSource = 'local'; // 'local' or 'github'

/**
 * Browse folders at the given path.
 */
async function browseFolders(path = null) {
  const folderList = document.getElementById('folder-list');
  const browserPath = document.getElementById('browser-path');
  const browserUpBtn = document.getElementById('browser-up-btn');
  const submitRepoBtn = document.getElementById('submit-repo-btn');

  folderList.innerHTML = '<p class="loading" style="padding: 20px;">Loading...</p>';

  try {
    const url = path ? `/api/filesystem/browse?path=${encodeURIComponent(path)}` : '/api/filesystem/browse';
    const data = await api(url.replace('/api', ''));

    currentBrowsePath = data.currentPath;
    browserPath.textContent = data.currentPath;
    browserUpBtn.disabled = !data.parent;

    if (data.directories.length === 0) {
      folderList.innerHTML = '<p class="placeholder" style="padding: 20px;">No subdirectories</p>';
      return;
    }

    folderList.innerHTML = data.directories.map(dir => `
      <div class="folder-item" data-path="${escapeHtml(dir.path)}" data-is-git="${dir.isGitRepo}">
        <span class="folder-icon">${dir.isGitRepo ? '📦' : '📁'}</span>
        <span class="folder-name">${escapeHtml(dir.name)}</span>
        ${dir.isGitRepo ? '<span class="git-badge">GIT</span>' : ''}
      </div>
    `).join('');

    // Add click handlers
    folderList.querySelectorAll('.folder-item').forEach(item => {
      item.addEventListener('click', () => {
        const isGit = item.dataset.isGit === 'true';
        const itemPath = item.dataset.path;

        if (isGit) {
          // Select this repo
          folderList.querySelectorAll('.folder-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          selectedRepoPath = itemPath;
          submitRepoBtn.disabled = false;
        } else {
          // Navigate into folder
          browseFolders(itemPath);
        }
      });

      // Double-click to navigate into git repos too
      item.addEventListener('dblclick', () => {
        browseFolders(item.dataset.path);
      });
    });
  } catch (error) {
    folderList.innerHTML = `<p class="placeholder" style="padding: 20px;">Error: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Navigate to parent directory.
 */
function browseParent() {
  if (currentBrowsePath) {
    const parent = currentBrowsePath.split('/').slice(0, -1).join('/') || '/';
    browseFolders(parent);
  }
}

/**
 * Switch between local folder and GitHub URL source modes.
 */
function setRepoSource(source) {
  const sourceLocalBtn = document.getElementById('source-local-btn');
  const sourceGithubBtn = document.getElementById('source-github-btn');
  const localSourcePanel = document.getElementById('local-source-panel');
  const githubSourcePanel = document.getElementById('github-source-panel');
  const githubUrlInput = document.getElementById('github-url');
  const submitRepoBtn = document.getElementById('submit-repo-btn');

  currentRepoSource = source;
  selectedRepoPath = null;
  clearSelectedGitHubRepo();

  if (source === 'local') {
    sourceLocalBtn.classList.add('active');
    sourceGithubBtn.classList.remove('active');
    localSourcePanel.classList.remove('hidden');
    githubSourcePanel.classList.add('hidden');
    submitRepoBtn.textContent = 'Add Selected';
    submitRepoBtn.disabled = true;
    githubUrlInput.value = '';
  } else {
    sourceLocalBtn.classList.remove('active');
    sourceGithubBtn.classList.add('active');
    localSourcePanel.classList.add('hidden');
    githubSourcePanel.classList.remove('hidden');
    submitRepoBtn.textContent = 'Add Repository';
    submitRepoBtn.disabled = true;
    // Load and render GitHub repos panel
    renderGitHubReposPanel();
    updateGitHubSubmitButton();
  }
}

/**
 * Get the current repo source ('local' or 'github').
 */
function getRepoSource() {
  return currentRepoSource;
}

/**
 * Get the selected local repo path.
 */
function getSelectedRepoPath() {
  return selectedRepoPath;
}

/**
 * Clear the selected repo path.
 */
function clearSelectedRepoPath() {
  selectedRepoPath = null;
}

/**
 * Initialize the folder browser event listeners.
 */
function initBrowserListeners() {
  const addRepoBtn = document.getElementById('add-repo-btn');
  const addRepoForm = document.getElementById('add-repo-form');
  const cancelRepoBtn = document.getElementById('cancel-repo-btn');
  const browserUpBtn = document.getElementById('browser-up-btn');
  const sourceLocalBtn = document.getElementById('source-local-btn');
  const sourceGithubBtn = document.getElementById('source-github-btn');
  const githubUrlInput = document.getElementById('github-url');
  const submitRepoBtn = document.getElementById('submit-repo-btn');

  addRepoBtn.addEventListener('click', () => {
    addRepoForm.classList.remove('hidden');
    selectedRepoPath = null;
    currentRepoSource = 'local';
    setRepoSource('local');
    browseFolders();
  });

  cancelRepoBtn.addEventListener('click', () => {
    addRepoForm.classList.add('hidden');
    selectedRepoPath = null;
    clearSelectedGitHubRepo();
    githubUrlInput.value = '';
    hideGitHubAccessError();
  });

  // Source toggle event listeners
  sourceLocalBtn.addEventListener('click', () => setRepoSource('local'));
  sourceGithubBtn.addEventListener('click', () => setRepoSource('github'));

  // GitHub URL input validation
  githubUrlInput.addEventListener('input', updateGitHubSubmitButton);

  submitRepoBtn.addEventListener('click', () => {
    if (currentRepoSource === 'local') {
      if (selectedRepoPath) {
        addRepo(selectedRepoPath, false);
        addRepoForm.classList.add('hidden');
        selectedRepoPath = null;
      }
    } else if (currentRepoSource === 'github') {
      // Check if repo selected from picker
      const selectedGitHubRepo = getSelectedGitHubRepo();
      if (selectedGitHubRepo) {
        const url = `https://github.com/${selectedGitHubRepo.fullName}`;
        addRepo(url, true);
        addRepoForm.classList.add('hidden');
        clearSelectedGitHubRepo();
        githubUrlInput.value = '';
        return;
      }
      // Otherwise use manual URL input
      const url = githubUrlInput.value.trim();
      if (isValidGitHubUrl(url)) {
        addRepo(url, true);
        addRepoForm.classList.add('hidden');
        githubUrlInput.value = '';
      }
    }
  });

  browserUpBtn.addEventListener('click', browseParent);
}
