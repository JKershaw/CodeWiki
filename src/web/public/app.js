/**
 * CodeWiki Frontend Application
 */

// State
let currentRepo = null;
let currentWiki = null;
let currentPage = null;

// DOM Elements
const views = {
  repos: document.getElementById('repos-view'),
  wiki: document.getElementById('wiki-view'),
  query: document.getElementById('query-view'),
  spec: document.getElementById('spec-view'),
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
          <div class="card-header-right">
            ${repo.activeWiki ? `
              <span class="wiki-badge" title="Active wiki">
                ${escapeHtml(repo.activeWiki.name)}${repo.wikiCount > 1 ? ` (+${repo.wikiCount - 1})` : ''}
              </span>
            ` : ''}
            <span class="card-status ${repo.status}">${repo.status}</span>
          </div>
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
          <input type="number" class="iteration-input" data-id="${repo.id}" value="5" min="1" max="50" title="Number of iterations">
          <button class="btn primary process-btn" data-id="${repo.id}">Process</button>
          <button class="btn wiki-btn" data-id="${repo.id}" ${repo.wikiPages > 0 ? '' : 'disabled'}>Browse Wiki</button>
          <button class="btn query-btn" data-id="${repo.id}" ${repo.wikiPages > 0 ? '' : 'disabled'}>Ask</button>
          <button class="btn spec-btn" data-id="${repo.id}" ${repo.wikiPages > 0 ? '' : 'disabled'}>Spec</button>
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
    container.querySelectorAll('.spec-btn').forEach(btn => {
      btn.addEventListener('click', () => openSpec(btn.dataset.id));
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
  const iterationInput = document.querySelector(`.iteration-input[data-id="${id}"]`);
  const iterations = parseInt(iterationInput.value, 10) || 5;
  const card = btn.closest('.card');
  const originalText = btn.textContent;
  btn.textContent = 'Starting...';
  btn.disabled = true;
  iterationInput.disabled = true;

  // Create or get progress indicator
  let progressDiv = card.querySelector('.processing-progress');
  if (!progressDiv) {
    progressDiv = document.createElement('div');
    progressDiv.className = 'processing-progress';
    card.querySelector('.card-actions').before(progressDiv);
  }

  // Create or get job list container
  let jobListDiv = card.querySelector('.job-list-container');
  if (!jobListDiv) {
    jobListDiv = document.createElement('div');
    jobListDiv.className = 'job-list-container';
    progressDiv.after(jobListDiv);
  }

  try {
    await api(`/repos/${id}/process`, {
      method: 'POST',
      body: JSON.stringify({ iterations }),
    });

    btn.textContent = 'Processing...';

    // Poll for updates with detailed progress
    const pollStatus = async () => {
      try {
        // Fetch both processing status and work queue in parallel
        const [processingData, workQueueData] = await Promise.all([
          api(`/repos/${id}/processing`),
          api(`/repos/${id}/work-queue`),
        ]);

        const { processing } = processingData;
        const { workQueue } = workQueueData;

        if (processing && processing.status === 'running') {
          // Update progress display
          const percent = processing.totalIterations > 0
            ? Math.round((processing.completedIterations / processing.totalIterations) * 100)
            : 0;

          let progressText = `Iteration ${processing.completedIterations}/${processing.totalIterations}`;
          if (processing.currentIteration && processing.currentIteration.agentType) {
            progressText += ` - ${formatAgentType(processing.currentIteration.agentType)}`;
          }

          progressDiv.innerHTML = `
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${percent}%"></div>
            </div>
            <div class="progress-text">${progressText}</div>
          `;

          // Update job list display
          jobListDiv.innerHTML = renderJobList(workQueue);

          btn.textContent = `Processing... ${percent}%`;
          setTimeout(pollStatus, 1500);
        } else {
          // Processing complete
          progressDiv.remove();
          jobListDiv.remove();
          loadRepos();
        }
      } catch (error) {
        console.error('Error polling status:', error);
        setTimeout(pollStatus, 2000);
      }
    };
    setTimeout(pollStatus, 1000);
  } catch (error) {
    alert('Error starting processing: ' + error.message);
    btn.textContent = originalText;
    btn.disabled = false;
    iterationInput.disabled = false;
    if (progressDiv) progressDiv.remove();
    if (jobListDiv) jobListDiv.remove();
  }
}

/**
 * Render the job list (work queue) as HTML.
 */
function renderJobList(workQueue) {
  const { pending, claimed, completed, failed, counts } = workQueue;

  // Build the sections
  let html = '<div class="job-list">';

  // Header with counts
  html += `
    <div class="job-list-header">
      <span class="job-list-title">Job Queue</span>
      <div class="job-list-counts">
        <span class="job-count pending" title="Pending">${counts.pending}</span>
        <span class="job-count claimed" title="In Progress">${counts.claimed}</span>
        <span class="job-count completed" title="Completed">${counts.completed}</span>
        ${counts.failed > 0 ? `<span class="job-count failed" title="Failed">${counts.failed}</span>` : ''}
      </div>
    </div>
  `;

  // In-progress jobs (claimed)
  if (claimed.length > 0) {
    html += '<div class="job-section">';
    html += '<div class="job-section-title">In Progress</div>';
    html += '<div class="job-items">';
    for (const job of claimed) {
      html += renderJobItem(job, 'claimed');
    }
    html += '</div></div>';
  }

  // Pending jobs (show first 10)
  if (pending.length > 0) {
    html += '<div class="job-section">';
    html += `<div class="job-section-title">Pending${pending.length > 10 ? ` (showing 10 of ${pending.length})` : ''}</div>`;
    html += '<div class="job-items">';
    for (const job of pending.slice(0, 10)) {
      html += renderJobItem(job, 'pending');
    }
    html += '</div></div>';
  }

  // Recently completed (show last 5)
  if (completed.length > 0) {
    html += '<div class="job-section">';
    html += '<div class="job-section-title">Recently Completed</div>';
    html += '<div class="job-items">';
    for (const job of completed.slice(0, 5)) {
      html += renderJobItem(job, 'completed');
    }
    html += '</div></div>';
  }

  // Failed jobs
  if (failed.length > 0) {
    html += '<div class="job-section">';
    html += '<div class="job-section-title">Failed</div>';
    html += '<div class="job-items">';
    for (const job of failed.slice(0, 5)) {
      html += renderJobItem(job, 'failed');
    }
    html += '</div></div>';
  }

  html += '</div>';
  return html;
}

/**
 * Render a single job item as HTML.
 */
function renderJobItem(job, status) {
  const agentName = formatAgentType(job.agentType);
  const target = job.targetCommitId
    ? `<span class="job-target" title="${escapeHtml(job.targetCommitId)}">${escapeHtml(job.targetCommitId.substring(0, 7))}</span>`
    : job.targetPagePath
    ? `<span class="job-target">${escapeHtml(job.targetPagePath)}</span>`
    : '';

  return `
    <div class="job-item ${status}">
      <span class="job-agent">${escapeHtml(agentName)}</span>
      ${target}
      <span class="job-priority" title="Priority: ${job.priority}">${getPriorityLabel(job.priority)}</span>
    </div>
  `;
}

/**
 * Get a human-readable priority label.
 */
function getPriorityLabel(priority) {
  if (priority >= 100) return 'Urgent';
  if (priority >= 80) return 'High';
  if (priority >= 50) return 'Normal';
  if (priority >= 20) return 'Low';
  return 'Background';
}

function formatAgentType(type) {
  const names = {
    'code-change': 'Analyzing Code',
    'narrative': 'Narrative Analysis',
    'security': 'Security Review',
    'technical-debt': 'Tech Debt Analysis',
    'pattern': 'Pattern Detection',
    'dependency': 'Dependency Analysis',
    'structure': 'Structure Analysis',
    'link': 'Linking Pages',
    'quality': 'Quality Check',
    'consistency': 'Consistency Check',
    'guide': 'Creating Guides',
    'overview': 'Creating Overview',
    'project-overview': 'Project Overview',
    'getting-started': 'Getting Started',
    'history': 'History Analysis',
    'convention': 'Convention Analysis',
    'bootstrap': 'Bootstrapping Wiki',
    'research': 'Research',
    'writer': 'Writing Content',
    'orchestrator': 'Planning...',
  };
  return names[type] || type;
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
  document.querySelector('[data-view="spec"]').disabled = false;

  showView('wiki');

  // Load wikis for selector
  await loadWikiSelector(repoId);
}

async function loadWikiSelector(repoId) {
  const selector = document.getElementById('wiki-selector');

  try {
    const wikis = await api(`/repos/${repoId}/wikis`);

    selector.innerHTML = wikis.map(wiki => `
      <option value="${wiki.id}" ${wiki.isActive ? 'selected' : ''}>
        ${escapeHtml(wiki.name)}${wiki.isActive ? ' (active)' : ''}
      </option>
    `).join('');

    // Set current wiki
    const activeWiki = wikis.find(w => w.isActive) || wikis[0];
    if (activeWiki) {
      currentWiki = activeWiki;
      loadWikiPages(repoId, activeWiki.id);
    }
  } catch (error) {
    selector.innerHTML = '<option value="">Error loading wikis</option>';
  }
}

// Wiki selector change handler
document.getElementById('wiki-selector').addEventListener('change', async (e) => {
  if (currentRepo && e.target.value) {
    currentWiki = { id: e.target.value };
    loadWikiPages(currentRepo.id, e.target.value);
  }
});

async function loadWikiPages(repoId, wikiId) {
  const sidebar = document.getElementById('wiki-categories');
  sidebar.innerHTML = '<p class="loading">Loading...</p>';

  try {
    const url = wikiId ? `/repos/${repoId}/wiki?wikiId=${wikiId}` : `/repos/${repoId}/wiki`;
    const { grouped } = await api(url);

    sidebar.innerHTML = Object.entries(grouped).map(([category, pages]) => `
      <div class="wiki-category">
        <div class="wiki-category-title">${escapeHtml(category)}</div>
        ${pages.map(page => `
          <a class="wiki-page-link" data-path="${escapeHtml(page.path)}">${escapeHtml(page.title)}</a>
        `).join('')}
      </div>
    `).join('');

    sidebar.querySelectorAll('.wiki-page-link').forEach(link => {
      link.addEventListener('click', () => loadWikiPage(repoId, link.dataset.path, wikiId));
    });
  } catch (error) {
    sidebar.innerHTML = `<p class="placeholder">Error: ${escapeHtml(error.message)}</p>`;
  }
}

async function loadWikiPage(repoId, path, wikiId) {
  const content = document.getElementById('wiki-content');
  content.innerHTML = '<p class="loading">Loading...</p>';

  // Update active state
  document.querySelectorAll('.wiki-page-link').forEach(link => {
    link.classList.toggle('active', link.dataset.path === path);
  });

  try {
    const url = wikiId ? `/repos/${repoId}/wiki/${path}?wikiId=${wikiId}` : `/repos/${repoId}/wiki/${path}`;
    const page = await api(url);
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
  document.querySelector('[data-view="spec"]').disabled = false;

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
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitQuery();
  }
});

// Spec
async function openSpec(repoId) {
  currentRepo = await api(`/repos/${repoId}`);
  document.getElementById('spec-repo-name').textContent = currentRepo.fullName;

  // Enable nav buttons
  document.querySelector('[data-view="wiki"]').disabled = false;
  document.querySelector('[data-view="query"]').disabled = false;
  document.querySelector('[data-view="spec"]').disabled = false;

  showView('spec');

  // Clear previous results
  document.getElementById('spec-result').classList.add('hidden');
  document.getElementById('spec-task').value = '';
  document.getElementById('spec-task').focus();
}

let lastSpecResult = null;

async function submitSpec() {
  const task = document.getElementById('spec-task').value.trim();
  if (!task || !currentRepo) return;

  const resultDiv = document.getElementById('spec-result');
  const contentDiv = document.getElementById('spec-content');
  const metaDiv = document.getElementById('spec-meta');
  const sourcesDiv = document.getElementById('spec-sources');

  resultDiv.classList.remove('hidden');
  contentDiv.innerHTML = '<p class="loading">Generating specification...</p>';
  metaDiv.innerHTML = '';
  sourcesDiv.innerHTML = '';

  try {
    const result = await api(`/repos/${currentRepo.id}/spec`, {
      method: 'POST',
      body: JSON.stringify({ task }),
    });

    lastSpecResult = result;

    // Build the spec content HTML
    let specHtml = `
      <div class="spec-section">
        <h4>Task</h4>
        <p>${escapeHtml(result.task)}</p>
      </div>
      <div class="spec-section">
        <h4>Interpretation</h4>
        <p>${escapeHtml(result.interpretation)}</p>
      </div>
      <div class="spec-section">
        <h4>Context</h4>
        ${markdownToHtml(result.spec.context)}
      </div>
    `;

    if (result.spec.keyFiles && result.spec.keyFiles.length > 0) {
      specHtml += `
        <div class="spec-section">
          <h4>Key Files</h4>
          <ul>
            ${result.spec.keyFiles.map(f => `<li><code>${escapeHtml(f)}</code></li>`).join('')}
          </ul>
        </div>
      `;
    }

    specHtml += `
      <div class="spec-section">
        <h4>Patterns</h4>
        ${markdownToHtml(result.spec.patterns)}
      </div>
      <div class="spec-section">
        <h4>Conventions</h4>
        ${markdownToHtml(result.spec.conventions)}
      </div>
      <div class="spec-section">
        <h4>Dependencies</h4>
        ${markdownToHtml(result.spec.dependencies)}
      </div>
      <div class="spec-section">
        <h4>Testing</h4>
        ${markdownToHtml(result.spec.testing)}
      </div>
      <div class="spec-section">
        <h4>Pitfalls</h4>
        ${markdownToHtml(result.spec.pitfalls)}
      </div>
    `;

    contentDiv.innerHTML = specHtml;

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
    contentDiv.innerHTML = `<p class="placeholder">Error: ${escapeHtml(error.message)}</p>`;
  }
}

function copySpec() {
  if (!lastSpecResult) return;

  const result = lastSpecResult;
  let text = `# Coding Agent Specification\n\n`;
  text += `## Task\n${result.task}\n\n`;
  text += `## Interpretation\n${result.interpretation}\n\n`;
  text += `## Context\n${result.spec.context}\n\n`;

  if (result.spec.keyFiles && result.spec.keyFiles.length > 0) {
    text += `## Key Files\n`;
    result.spec.keyFiles.forEach(f => text += `- ${f}\n`);
    text += '\n';
  }

  text += `## Patterns\n${result.spec.patterns}\n\n`;
  text += `## Conventions\n${result.spec.conventions}\n\n`;
  text += `## Dependencies\n${result.spec.dependencies}\n\n`;
  text += `## Testing\n${result.spec.testing}\n\n`;
  text += `## Pitfalls\n${result.spec.pitfalls}\n\n`;
  text += `---\nConfidence: ${(result.confidence * 100).toFixed(0)}%\n`;

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-spec');
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = originalText, 2000);
  });
}

document.getElementById('submit-spec').addEventListener('click', submitSpec);
document.getElementById('spec-task').addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitSpec();
  }
});
document.getElementById('copy-spec').addEventListener('click', copySpec);

// Back buttons
document.getElementById('back-to-repos').addEventListener('click', () => {
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

// Utility Functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Convert markdown to HTML using the marked library.
 * Output is sanitized with DOMPurify to prevent XSS attacks.
 *
 * @param {string} md - Markdown content to convert
 * @returns {string} Sanitized HTML string
 */
function markdownToHtml(md) {
  if (!md) return '';

  // Configure marked for GitHub Flavored Markdown
  marked.setOptions({
    gfm: true,        // GitHub Flavored Markdown
    breaks: true,     // Convert \n to <br>
  });

  // Parse markdown and sanitize to prevent XSS
  const rawHtml = marked.parse(md);
  return DOMPurify.sanitize(rawHtml);
}

// Initialize
loadRepos();
