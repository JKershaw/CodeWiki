/**
 * CodeWiki Frontend Application
 */

// State
let currentRepo = null;
let currentPage = null;

// DOM Elements
const views = {
  repos: document.getElementById('repos-view'),
  wiki: document.getElementById('wiki-view'),
  query: document.getElementById('query-view'),
};

const navBtns = document.querySelectorAll('.nav-btn');

// Navigation
function showView(viewName) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[viewName].classList.add('active');

  navBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
}

navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!btn.disabled) {
      showView(btn.dataset.view);
    }
  });
});

// API Helpers
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API Error');
  }
  return response.json();
}

// Repositories
async function loadRepos() {
  const container = document.getElementById('repos-list');
  container.innerHTML = '<p class="loading">Loading repositories...</p>';

  try {
    const repos = await api('/repos');

    if (repos.length === 0) {
      container.innerHTML = '<p class="placeholder">No repositories yet. Add one to get started!</p>';
      return;
    }

    container.innerHTML = repos.map(repo => `
      <div class="card" data-repo-id="${repo.id}">
        <div class="card-header">
          <h3 class="card-title">${escapeHtml(repo.fullName)}</h3>
          <span class="card-status ${repo.status}">${repo.status}</span>
        </div>
        <div class="card-stats">
          <div class="stat">
            <div class="stat-value">${repo.totalCommits || 0}</div>
            <div class="stat-label">Commits</div>
          </div>
          <div class="stat">
            <div class="stat-value">${repo.processedCommits || 0}</div>
            <div class="stat-label">Processed</div>
          </div>
          <div class="stat">
            <div class="stat-value">${repo.wikiPages || 0}</div>
            <div class="stat-label">Wiki Pages</div>
          </div>
          <div class="stat">
            <div class="stat-value">${(repo.coveragePercent || 0).toFixed(0)}%</div>
            <div class="stat-label">Coverage</div>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn primary process-btn" data-id="${repo.id}">Process</button>
          <button class="btn wiki-btn" data-id="${repo.id}" ${repo.wikiPages > 0 ? '' : 'disabled'}>Browse Wiki</button>
          <button class="btn query-btn" data-id="${repo.id}" ${repo.wikiPages > 0 ? '' : 'disabled'}>Query</button>
        </div>
      </div>
    `).join('');

    // Add event listeners
    container.querySelectorAll('.process-btn').forEach(btn => {
      btn.addEventListener('click', () => processRepo(btn.dataset.id));
    });
    container.querySelectorAll('.wiki-btn').forEach(btn => {
      btn.addEventListener('click', () => openWiki(btn.dataset.id));
    });
    container.querySelectorAll('.query-btn').forEach(btn => {
      btn.addEventListener('click', () => openQuery(btn.dataset.id));
    });
  } catch (error) {
    container.innerHTML = `<p class="placeholder">Error loading repositories: ${escapeHtml(error.message)}</p>`;
  }
}

async function addRepo(path) {
  try {
    await api('/repos', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
    loadRepos();
  } catch (error) {
    alert('Error adding repository: ' + error.message);
  }
}

async function processRepo(id) {
  const btn = document.querySelector(`.process-btn[data-id="${id}"]`);
  const originalText = btn.textContent;
  btn.textContent = 'Starting...';
  btn.disabled = true;

  try {
    await api(`/repos/${id}/process`, {
      method: 'POST',
      body: JSON.stringify({ iterations: 5 }),
    });

    btn.textContent = 'Processing...';

    // Poll for updates
    const pollStatus = async () => {
      const repo = await api(`/repos/${id}`);
      if (repo.status === 'processing') {
        setTimeout(pollStatus, 2000);
      } else {
        loadRepos();
      }
    };
    setTimeout(pollStatus, 2000);
  } catch (error) {
    alert('Error starting processing: ' + error.message);
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// Add Repo Form - Folder Browser
const addRepoBtn = document.getElementById('add-repo-btn');
const addRepoForm = document.getElementById('add-repo-form');
const submitRepoBtn = document.getElementById('submit-repo-btn');
const cancelRepoBtn = document.getElementById('cancel-repo-btn');
const browserUpBtn = document.getElementById('browser-up-btn');
const browserPath = document.getElementById('browser-path');
const folderList = document.getElementById('folder-list');

let selectedRepoPath = null;
let currentBrowsePath = null;

async function browseFolders(path = null) {
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
        const path = item.dataset.path;

        if (isGit) {
          // Select this repo
          folderList.querySelectorAll('.folder-item').forEach(i => i.classList.remove('selected'));
          item.classList.add('selected');
          selectedRepoPath = path;
          submitRepoBtn.disabled = false;
        } else {
          // Navigate into folder
          browseFolders(path);
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

addRepoBtn.addEventListener('click', () => {
  addRepoForm.classList.remove('hidden');
  selectedRepoPath = null;
  submitRepoBtn.disabled = true;
  browseFolders();
});

cancelRepoBtn.addEventListener('click', () => {
  addRepoForm.classList.add('hidden');
  selectedRepoPath = null;
});

submitRepoBtn.addEventListener('click', () => {
  if (selectedRepoPath) {
    addRepo(selectedRepoPath);
    addRepoForm.classList.add('hidden');
    selectedRepoPath = null;
  }
});

browserUpBtn.addEventListener('click', async () => {
  if (currentBrowsePath) {
    // Go to parent directory
    const parent = currentBrowsePath.split('/').slice(0, -1).join('/') || '/';
    browseFolders(parent);
  }
});

// Wiki
async function openWiki(repoId) {
  currentRepo = await api(`/repos/${repoId}`);
  document.getElementById('wiki-repo-name').textContent = currentRepo.fullName;

  // Enable nav buttons
  document.querySelector('[data-view="wiki"]').disabled = false;
  document.querySelector('[data-view="query"]').disabled = false;

  showView('wiki');
  loadWikiPages(repoId);
}

async function loadWikiPages(repoId) {
  const sidebar = document.getElementById('wiki-categories');
  sidebar.innerHTML = '<p class="loading">Loading...</p>';

  try {
    const { grouped } = await api(`/repos/${repoId}/wiki`);

    sidebar.innerHTML = Object.entries(grouped).map(([category, pages]) => `
      <div class="wiki-category">
        <div class="wiki-category-title">${escapeHtml(category)}</div>
        ${pages.map(page => `
          <a class="wiki-page-link" data-path="${escapeHtml(page.path)}">${escapeHtml(page.title)}</a>
        `).join('')}
      </div>
    `).join('');

    sidebar.querySelectorAll('.wiki-page-link').forEach(link => {
      link.addEventListener('click', () => loadWikiPage(repoId, link.dataset.path));
    });
  } catch (error) {
    sidebar.innerHTML = `<p class="placeholder">Error: ${escapeHtml(error.message)}</p>`;
  }
}

async function loadWikiPage(repoId, path) {
  const content = document.getElementById('wiki-content');
  content.innerHTML = '<p class="loading">Loading...</p>';

  // Update active state
  document.querySelectorAll('.wiki-page-link').forEach(link => {
    link.classList.toggle('active', link.dataset.path === path);
  });

  try {
    const page = await api(`/repos/${repoId}/wiki/${path}`);
    currentPage = page;

    content.innerHTML = `
      <div class="wiki-body">${markdownToHtml(page.content)}</div>
      <div class="wiki-meta">
        <div>
          <strong>Confidence:</strong> ${(page.confidence * 100).toFixed(0)}%
          <div class="confidence-bar">
            <div class="confidence-fill" style="width: ${page.confidence * 100}%"></div>
          </div>
        </div>
        <div style="margin-top: 10px">
          <strong>Last updated:</strong> ${new Date(page.updatedAt).toLocaleString()}
        </div>
        <div style="margin-top: 5px">
          <strong>Sources:</strong> ${page.sourceCommits.length} commit(s)
        </div>
      </div>
    `;
  } catch (error) {
    content.innerHTML = `<p class="placeholder">Error: ${escapeHtml(error.message)}</p>`;
  }
}

// Query
async function openQuery(repoId) {
  currentRepo = await api(`/repos/${repoId}`);
  document.getElementById('query-repo-name').textContent = currentRepo.fullName;

  // Enable nav buttons
  document.querySelector('[data-view="wiki"]').disabled = false;
  document.querySelector('[data-view="query"]').disabled = false;

  showView('query');

  // Clear previous results
  document.getElementById('query-result').classList.add('hidden');
  document.getElementById('query-question').value = '';
  document.getElementById('query-question').focus();
}

async function submitQuery() {
  const question = document.getElementById('query-question').value.trim();
  if (!question || !currentRepo) return;

  const resultDiv = document.getElementById('query-result');
  const answerDiv = document.getElementById('query-answer');
  const metaDiv = document.getElementById('query-meta');
  const sourcesDiv = document.getElementById('query-sources');

  resultDiv.classList.remove('hidden');
  answerDiv.innerHTML = '<p class="loading">Searching wiki...</p>';
  metaDiv.innerHTML = '';
  sourcesDiv.innerHTML = '';

  try {
    const result = await api(`/repos/${currentRepo.id}/query`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    });

    answerDiv.innerHTML = markdownToHtml(result.answer);

    metaDiv.innerHTML = `
      <div><strong>Confidence:</strong> ${(result.confidence * 100).toFixed(0)}%</div>
      ${result.costUsd ? `<div><strong>Cost:</strong> $${result.costUsd.toFixed(4)}</div>` : ''}
    `;

    if (result.sources && result.sources.length > 0) {
      sourcesDiv.innerHTML = `
        <h4>Sources</h4>
        ${result.sources.map(source => `
          <div class="source-item">
            <div class="title">${escapeHtml(source.title)}</div>
            <div class="path">${escapeHtml(source.path)} - Relevance: ${(source.relevance * 100).toFixed(0)}%</div>
          </div>
        `).join('')}
      `;
    }
  } catch (error) {
    answerDiv.innerHTML = `<p class="placeholder">Error: ${escapeHtml(error.message)}</p>`;
  }
}

document.getElementById('submit-query').addEventListener('click', submitQuery);
document.getElementById('query-question').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') submitQuery();
});

// Back buttons
document.getElementById('back-to-repos').addEventListener('click', () => {
  showView('repos');
  loadRepos();
});
document.getElementById('back-to-repos-query').addEventListener('click', () => {
  showView('repos');
  loadRepos();
});

// Utility Functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function markdownToHtml(md) {
  // Simple markdown to HTML conversion
  return md
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Lists
    .replace(/^\- (.*$)/gim, '<li>$1</li>')
    // Line breaks
    .replace(/\n\n/g, '</p><p>')
    // Wrap in paragraphs
    .replace(/^(?!<[hplu])/gm, '')
    // Horizontal rule
    .replace(/^---$/gim, '<hr>')
    // Clean up
    .replace(/<li>/g, '<ul><li>')
    .replace(/<\/li>\n(?!<li>)/g, '</li></ul>')
    .replace(/<\/li><ul>/g, '</li>');
}

// Initialize
loadRepos();
