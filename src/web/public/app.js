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
  benchmark: document.getElementById('benchmark-view'),
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
          <button class="btn benchmark-btn" data-id="${repo.id}" ${repo.wikiPages > 0 ? '' : 'disabled'}>Benchmark</button>
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
    container.querySelectorAll('.benchmark-btn').forEach(btn => {
      btn.addEventListener('click', () => openBenchmark(btn.dataset.id));
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

        if (processing && (processing.status === 'running' || processing.status === 'stopping')) {
          // Update progress display
          const percent = processing.totalIterations > 0
            ? Math.round((processing.completedIterations / processing.totalIterations) * 100)
            : 0;

          let progressText = `Iteration ${processing.completedIterations}/${processing.totalIterations}`;
          if (processing.currentIteration && processing.currentIteration.agentType) {
            progressText += ` - ${formatAgentType(processing.currentIteration.agentType)}`;
          }

          const isStopping = processing.status === 'stopping';
          const stopButtonHtml = isStopping
            ? `<button class="btn danger small" disabled>Stopping...</button>`
            : `<button class="btn danger small stop-btn" data-id="${id}">Stop</button>`;

          progressDiv.innerHTML = `
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${percent}%"></div>
            </div>
            <div class="progress-text-row">
              <span class="progress-text">${progressText}</span>
              ${stopButtonHtml}
            </div>
          `;

          // Add stop button event listener
          const stopBtn = progressDiv.querySelector('.stop-btn');
          if (stopBtn) {
            stopBtn.addEventListener('click', () => stopProcessing(id, stopBtn));
          }

          // Update job list display
          jobListDiv.innerHTML = renderJobList(workQueue);

          btn.textContent = isStopping ? 'Stopping...' : `Processing... ${percent}%`;
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

async function stopProcessing(id, stopBtn) {
  stopBtn.disabled = true;
  stopBtn.textContent = 'Stopping...';

  try {
    await api(`/repos/${id}/processing/stop`, {
      method: 'PATCH',
    });
    // Polling will detect the status change and update the UI
  } catch (error) {
    alert('Error stopping processing: ' + error.message);
    stopBtn.disabled = false;
    stopBtn.textContent = 'Stop';
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

// Benchmark
let benchmarkPollingInterval = null;
let qualityBenchmarkPollingInterval = null;
let benchmarkChart = null;

async function openBenchmark(repoId) {
  currentRepo = await api(`/repos/${repoId}`);
  document.getElementById('benchmark-repo-name').textContent = currentRepo.fullName;

  // Enable nav buttons
  document.querySelector('[data-view="wiki"]').disabled = false;
  document.querySelector('[data-view="query"]').disabled = false;
  document.querySelector('[data-view="spec"]').disabled = false;
  document.querySelector('[data-view="benchmark"]').disabled = false;

  showView('benchmark');

  // Close detail panel if open
  document.getElementById('benchmark-detail').classList.add('hidden');

  // Load benchmark history
  await loadBenchmarkHistory(repoId);
}

async function loadBenchmarkHistory(repoId) {
  const container = document.getElementById('benchmark-history');
  const statusText = document.getElementById('benchmark-status-text');
  const runBtn = document.getElementById('run-benchmark-btn');
  const qualityRunBtn = document.getElementById('run-quality-benchmark-btn');
  const bothRunBtn = document.getElementById('run-both-benchmarks-btn');

  container.innerHTML = '<p class="loading">Loading benchmark history...</p>';

  try {
    // Load both accuracy and quality benchmarks in parallel
    const [accuracyData, qualityData] = await Promise.all([
      api(`/repos/${repoId}/benchmarks`),
      api(`/repos/${repoId}/quality-benchmarks`).catch(() => ({ qualityBenchmarks: [] })),
    ]);

    const accuracyBenchmarks = accuracyData.benchmarks || [];
    const qualityBenchmarks = qualityData.qualityBenchmarks || [];

    // Check if there's a running accuracy benchmark
    const runningAccuracy = accuracyBenchmarks.find(b => b.status === 'running');
    const runningQuality = qualityBenchmarks.find(b => b.status === 'running');

    if (runningAccuracy) {
      runBtn.disabled = true;
      startBenchmarkPolling(repoId);
    } else {
      runBtn.disabled = false;
      stopBenchmarkPolling();
    }

    if (runningQuality) {
      qualityRunBtn.disabled = true;
      startQualityBenchmarkPolling(repoId);
    } else {
      qualityRunBtn.disabled = false;
      stopQualityBenchmarkPolling();
    }

    // Update status text
    if (runningAccuracy && runningQuality) {
      statusText.textContent = 'Both benchmarks in progress...';
    } else if (runningAccuracy) {
      statusText.textContent = 'Accuracy benchmark in progress...';
    } else if (runningQuality) {
      statusText.textContent = 'Quality benchmark in progress...';
    } else {
      statusText.textContent = '';
    }

    bothRunBtn.disabled = runningAccuracy || runningQuality;

    if (accuracyBenchmarks.length === 0 && qualityBenchmarks.length === 0) {
      container.innerHTML = '<p class="placeholder">No benchmarks yet. Run one to measure wiki quality.</p>';
      renderBenchmarkChart([], []);
      return;
    }

    // Render combined chart
    renderBenchmarkChart(accuracyBenchmarks, qualityBenchmarks);

    // Render benchmark cards grouped
    let cardsHtml = '';

    if (accuracyBenchmarks.length > 0) {
      cardsHtml += '<h4 class="benchmark-section-title">Accuracy Benchmarks</h4>';
      cardsHtml += accuracyBenchmarks.map((benchmark, index) => {
        const prevBenchmark = accuracyBenchmarks[index + 1];
        return renderBenchmarkCard(benchmark, prevBenchmark, 'accuracy');
      }).join('');
    }

    if (qualityBenchmarks.length > 0) {
      cardsHtml += '<h4 class="benchmark-section-title">Quality Benchmarks</h4>';
      cardsHtml += qualityBenchmarks.map((benchmark, index) => {
        const prevBenchmark = qualityBenchmarks[index + 1];
        return renderQualityBenchmarkCard(benchmark, prevBenchmark);
      }).join('');
    }

    container.innerHTML = cardsHtml;

    // Add click handlers for accuracy benchmarks
    container.querySelectorAll('.benchmark-card[data-type="accuracy"]').forEach(card => {
      card.addEventListener('click', () => showBenchmarkDetail(card.dataset.id));
    });

    // Add click handlers for quality benchmarks
    container.querySelectorAll('.benchmark-card[data-type="quality"]').forEach(card => {
      card.addEventListener('click', () => showQualityBenchmarkDetail(card.dataset.id));
    });
  } catch (error) {
    container.innerHTML = `<p class="placeholder">Error loading benchmarks: ${escapeHtml(error.message)}</p>`;
  }
}

function renderBenchmarkChart(accuracyBenchmarks, qualityBenchmarks) {
  const chartContainer = document.getElementById('benchmark-chart-container');
  const canvas = document.getElementById('benchmark-chart');

  // Destroy existing chart
  if (benchmarkChart) {
    benchmarkChart.destroy();
    benchmarkChart = null;
  }

  // Filter to completed benchmarks only
  const completedAccuracy = (accuracyBenchmarks || []).filter(b => b.status === 'completed');
  const completedQuality = (qualityBenchmarks || []).filter(b => b.status === 'completed');

  // Hide chart if less than 2 completed benchmarks total
  const totalCompleted = completedAccuracy.length + completedQuality.length;
  if (totalCompleted < 2) {
    chartContainer.classList.add('hidden');
    return;
  }

  chartContainer.classList.remove('hidden');

  // Sort by iteration count (ascending) for the chart
  const sortedAccuracy = [...completedAccuracy].sort((a, b) => a.iterationCount - b.iterationCount);
  const sortedQuality = [...completedQuality].sort((a, b) => a.iterationCount - b.iterationCount);

  // Use x/y data points for proper numeric scaling
  const accuracyPoints = sortedAccuracy.map(b => ({
    x: b.iterationCount,
    y: b.score ?? 0
  }));

  const qualityPoints = sortedQuality.map(b => ({
    x: b.iterationCount,
    y: b.overallScore ?? 0
  }));

  // Combine page count data from both benchmark types (deduplicate by iteration)
  const pageCountMap = new Map();
  [...sortedAccuracy, ...sortedQuality].forEach(b => {
    if (b.pageCount != null && b.pageCount > 0) {
      // Keep the highest page count for each iteration (in case of duplicates)
      const existing = pageCountMap.get(b.iterationCount);
      if (!existing || b.pageCount > existing) {
        pageCountMap.set(b.iterationCount, b.pageCount);
      }
    }
  });
  const pageCountPoints = Array.from(pageCountMap.entries())
    .map(([iteration, count]) => ({ x: iteration, y: count }))
    .sort((a, b) => a.x - b.x);

  // Calculate max page count for y-axis scaling
  const maxPageCount = pageCountPoints.length > 0
    ? Math.max(...pageCountPoints.map(p => p.y))
    : 0;

  const datasets = [];

  if (accuracyPoints.length > 0) {
    datasets.push({
      label: 'Accuracy',
      data: accuracyPoints,
      borderColor: '#4a9eff',
      backgroundColor: 'rgba(74, 158, 255, 0.1)',
      borderWidth: 2,
      fill: false,
      tension: 0.3,
      pointBackgroundColor: '#4a9eff',
      pointRadius: 4,
      pointHoverRadius: 6,
      yAxisID: 'y',
    });
  }

  if (qualityPoints.length > 0) {
    datasets.push({
      label: 'Quality',
      data: qualityPoints,
      borderColor: '#10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.1)',
      borderWidth: 2,
      fill: false,
      tension: 0.3,
      pointBackgroundColor: '#10b981',
      pointRadius: 4,
      pointHoverRadius: 6,
      yAxisID: 'y',
    });
  }

  // Add page count dataset if we have data
  if (pageCountPoints.length > 0) {
    datasets.push({
      label: 'Pages',
      data: pageCountPoints,
      borderColor: '#f59e0b',
      backgroundColor: 'rgba(245, 158, 11, 0.1)',
      borderWidth: 2,
      fill: false,
      tension: 0.3,
      pointBackgroundColor: '#f59e0b',
      pointRadius: 4,
      pointHoverRadius: 6,
      yAxisID: 'y2',
      borderDash: [5, 5],
    });
  }

  const scales = {
    y: {
      type: 'linear',
      position: 'left',
      min: 0,
      max: 100,
      ticks: {
        callback: (value) => `${value}%`,
        color: '#888',
      },
      grid: {
        color: 'rgba(255, 255, 255, 0.1)',
      },
    },
    x: {
      type: 'linear',
      title: {
        display: true,
        text: 'Iteration',
        color: '#888',
      },
      ticks: {
        color: '#888',
      },
      grid: {
        color: 'rgba(255, 255, 255, 0.1)',
      },
    }
  };

  // Add secondary y-axis for page count if we have data
  if (pageCountPoints.length > 0) {
    scales.y2 = {
      type: 'linear',
      position: 'right',
      min: 0,
      max: Math.ceil(maxPageCount * 1.1), // Add 10% padding
      ticks: {
        color: '#f59e0b',
      },
      grid: {
        drawOnChartArea: false, // Don't draw grid lines for secondary axis
      },
      title: {
        display: true,
        text: 'Pages',
        color: '#f59e0b',
      },
    };
  }

  benchmarkChart = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: {
            color: '#888',
          },
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const label = context.dataset.label;
              const value = context.parsed.y;
              if (label === 'Pages') {
                return `${label} - Iteration ${context.parsed.x}: ${value}`;
              }
              return `${label} - Iteration ${context.parsed.x}: ${value.toFixed(0)}%`;
            }
          }
        }
      },
      scales
    }
  });
}

function renderBenchmarkCard(benchmark, prevBenchmark, type = 'accuracy') {
  const date = new Date(benchmark.startedAt).toLocaleString();
  const score = benchmark.score ?? 0;
  const scoreClass = score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';

  let changeHtml = '';
  if (prevBenchmark && benchmark.status === 'completed' && prevBenchmark.status === 'completed') {
    const prevScore = prevBenchmark.score ?? 0;
    const change = score - prevScore;
    if (change !== 0) {
      const changeClass = change > 0 ? 'positive' : 'negative';
      const changeSign = change > 0 ? '+' : '';
      changeHtml = `<div class="benchmark-change ${changeClass}">${changeSign}${change.toFixed(0)}% from previous</div>`;
    }
  }

  return `
    <div class="benchmark-card" data-id="${benchmark.id}" data-type="${type}">
      <div class="benchmark-card-header">
        <div class="benchmark-card-left">
          <div class="benchmark-date">${escapeHtml(date)}</div>
          <div class="benchmark-iteration">Iteration ${benchmark.iterationCount}</div>
        </div>
        <div class="benchmark-card-right">
          <div class="benchmark-score ${scoreClass}">${score.toFixed(0)}%</div>
          <span class="benchmark-status ${benchmark.status}">${benchmark.status}</span>
        </div>
      </div>
      <div class="benchmark-card-stats">
        <span>${benchmark.totalQuestions || 0} questions</span>
        ${benchmark.totalCostUsd ? `<span>$${benchmark.totalCostUsd.toFixed(3)}</span>` : ''}
        ${benchmark.completedAt ? `<span>${formatDuration(benchmark.startedAt, benchmark.completedAt)}</span>` : ''}
      </div>
      ${changeHtml}
    </div>
  `;
}

function renderQualityBenchmarkCard(benchmark, prevBenchmark) {
  const date = new Date(benchmark.startedAt).toLocaleString();
  const score = benchmark.overallScore ?? 0;
  const scoreClass = score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';

  let changeHtml = '';
  if (prevBenchmark && benchmark.status === 'completed' && prevBenchmark.status === 'completed') {
    const prevScore = prevBenchmark.overallScore ?? 0;
    const change = score - prevScore;
    if (change !== 0) {
      const changeClass = change > 0 ? 'positive' : 'negative';
      const changeSign = change > 0 ? '+' : '';
      changeHtml = `<div class="benchmark-change ${changeClass}">${changeSign}${change.toFixed(0)}% from previous</div>`;
    }
  }

  return `
    <div class="benchmark-card quality" data-id="${benchmark.id}" data-type="quality">
      <div class="benchmark-card-header">
        <div class="benchmark-card-left">
          <div class="benchmark-date">${escapeHtml(date)}</div>
          <div class="benchmark-iteration">Iteration ${benchmark.iterationCount}</div>
        </div>
        <div class="benchmark-card-right">
          <div class="benchmark-score ${scoreClass}">${score.toFixed(0)}%</div>
          <span class="benchmark-status ${benchmark.status}">${benchmark.status}</span>
        </div>
      </div>
      <div class="benchmark-card-stats">
        <span>${benchmark.pagesEvaluated || 0} pages</span>
        ${benchmark.totalCostUsd ? `<span>$${benchmark.totalCostUsd.toFixed(3)}</span>` : ''}
        ${benchmark.completedAt ? `<span>${formatDuration(benchmark.startedAt, benchmark.completedAt)}</span>` : ''}
      </div>
      ${changeHtml}
    </div>
  `;
}

function formatDuration(startedAt, completedAt) {
  const start = new Date(startedAt);
  const end = new Date(completedAt);
  const durationMs = end - start;
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

async function runBenchmark() {
  if (!currentRepo) return;

  const runBtn = document.getElementById('run-benchmark-btn');
  const statusText = document.getElementById('benchmark-status-text');
  const progressDiv = document.getElementById('benchmark-progress');

  runBtn.disabled = true;
  statusText.textContent = 'Starting benchmark...';
  progressDiv.classList.remove('hidden');
  document.getElementById('benchmark-progress-fill').style.width = '0%';
  document.getElementById('benchmark-progress-text').textContent = 'Starting benchmark...';

  try {
    const response = await fetch(`/api/repos/${currentRepo.id}/benchmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (response.status === 409) {
      statusText.textContent = 'A benchmark is already running';
      startBenchmarkPolling(currentRepo.id);
      return;
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start benchmark');
    }

    statusText.textContent = 'Benchmark in progress...';
    startBenchmarkPolling(currentRepo.id);
  } catch (error) {
    runBtn.disabled = false;
    statusText.textContent = `Error: ${error.message}`;
    progressDiv.classList.add('hidden');
  }
}

function startBenchmarkPolling(repoId) {
  stopBenchmarkPolling();

  const progressDiv = document.getElementById('benchmark-progress');
  progressDiv.classList.remove('hidden');

  benchmarkPollingInterval = setInterval(async () => {
    try {
      const data = await api(`/repos/${repoId}/benchmarks?limit=1`);
      const benchmarks = data.benchmarks || [];
      const latest = benchmarks[0];

      if (!latest || latest.status !== 'running') {
        // Benchmark completed or failed
        stopBenchmarkPolling();
        progressDiv.classList.add('hidden');
        await loadBenchmarkHistory(repoId);
        return;
      }

      // Update progress (we don't have detailed progress, so show indeterminate)
      document.getElementById('benchmark-progress-text').textContent = 'Benchmark in progress... This may take a few minutes.';
    } catch (error) {
      console.error('Error polling benchmark status:', error);
    }
  }, 3000);
}

function stopBenchmarkPolling() {
  if (benchmarkPollingInterval) {
    clearInterval(benchmarkPollingInterval);
    benchmarkPollingInterval = null;
  }
}

async function showBenchmarkDetail(benchmarkId) {
  const detailPanel = document.getElementById('benchmark-detail');
  const contentDiv = document.getElementById('benchmark-detail-content');

  detailPanel.classList.remove('hidden');
  contentDiv.innerHTML = '<p class="loading">Loading benchmark details...</p>';

  try {
    const data = await api(`/repos/${currentRepo.id}/benchmarks/${benchmarkId}`);
    const benchmark = data.benchmark;

    if (!benchmark) {
      contentDiv.innerHTML = '<p class="placeholder">Benchmark not found</p>';
      return;
    }

    const summary = benchmark.summary || {};
    const results = benchmark.results || [];

    // Build summary stats
    let summaryHtml = `
      <div class="benchmark-detail-summary">
        <div class="benchmark-detail-stat">
          <div class="value">${(benchmark.score ?? summary.score ?? 0).toFixed(0)}%</div>
          <div class="label">Score</div>
        </div>
        <div class="benchmark-detail-stat">
          <div class="value">${summary.totalQuestions || results.length || 0}</div>
          <div class="label">Questions</div>
        </div>
        <div class="benchmark-detail-stat">
          <div class="value">${summary.accurate || 0}</div>
          <div class="label">Accurate</div>
        </div>
        <div class="benchmark-detail-stat">
          <div class="value">${summary.partial || 0}</div>
          <div class="label">Partial</div>
        </div>
      </div>
    `;

    // By category breakdown
    if (summary.byCategory && Object.keys(summary.byCategory).length > 0) {
      summaryHtml += `
        <div class="benchmark-breakdown">
          <h4>By Category</h4>
          <div class="breakdown-items">
            ${Object.entries(summary.byCategory).map(([cat, data]) => `
              <div class="breakdown-item">
                <span class="name">${escapeHtml(cat)}</span>
                <span class="score">${data.score?.toFixed(0) || 0}%</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // By difficulty breakdown
    if (summary.byDifficulty) {
      summaryHtml += `
        <div class="benchmark-breakdown">
          <h4>By Difficulty</h4>
          <div class="breakdown-items">
            ${Object.entries(summary.byDifficulty).map(([diff, data]) => `
              <div class="breakdown-item">
                <span class="name">${escapeHtml(diff)}</span>
                <span class="score">${data.score?.toFixed(0) || 0}%</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Individual question results
    if (results.length > 0) {
      summaryHtml += `
        <div class="benchmark-questions">
          <h4>Question Results</h4>
          ${results.map(result => `
            <div class="question-result ${result.grade}">
              <div class="question-header">
                <div class="question-text">${escapeHtml(result.questionId)}</div>
                <span class="grade-badge ${result.grade}">${formatGrade(result.grade)}</span>
              </div>
              <div class="question-meta">
                <span>Confidence: ${((result.confidence || 0) * 100).toFixed(0)}%</span>
                ${result.durationMs ? `<span>${(result.durationMs / 1000).toFixed(1)}s</span>` : ''}
              </div>
              ${result.reasoning ? `<div class="question-reasoning">${escapeHtml(result.reasoning)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }

    contentDiv.innerHTML = summaryHtml;
  } catch (error) {
    contentDiv.innerHTML = `<p class="placeholder">Error loading details: ${escapeHtml(error.message)}</p>`;
  }
}

function formatGrade(grade) {
  const labels = {
    'accurate': 'Accurate',
    'partial': 'Partial',
    'inaccurate': 'Inaccurate',
    'no_answer': 'No Answer',
  };
  return labels[grade] || grade;
}

// Quality Benchmark Functions
async function runQualityBenchmark() {
  if (!currentRepo) return;

  const runBtn = document.getElementById('run-quality-benchmark-btn');
  const statusText = document.getElementById('benchmark-status-text');
  const progressDiv = document.getElementById('benchmark-progress');

  runBtn.disabled = true;
  statusText.textContent = 'Starting quality benchmark...';
  progressDiv.classList.remove('hidden');
  document.getElementById('benchmark-progress-fill').style.width = '0%';
  document.getElementById('benchmark-progress-text').textContent = 'Starting quality benchmark...';

  try {
    const response = await fetch(`/api/repos/${currentRepo.id}/quality-benchmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (response.status === 409) {
      statusText.textContent = 'A quality benchmark is already running';
      startQualityBenchmarkPolling(currentRepo.id);
      return;
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start quality benchmark');
    }

    statusText.textContent = 'Quality benchmark in progress...';
    startQualityBenchmarkPolling(currentRepo.id);
  } catch (error) {
    runBtn.disabled = false;
    statusText.textContent = `Error: ${error.message}`;
    progressDiv.classList.add('hidden');
  }
}

async function runBothBenchmarks() {
  if (!currentRepo) return;

  const bothBtn = document.getElementById('run-both-benchmarks-btn');
  const statusText = document.getElementById('benchmark-status-text');

  bothBtn.disabled = true;
  statusText.textContent = 'Starting both benchmarks...';

  try {
    // Start both benchmarks in parallel
    const results = await Promise.allSettled([
      fetch(`/api/repos/${currentRepo.id}/benchmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      fetch(`/api/repos/${currentRepo.id}/quality-benchmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    ]);

    statusText.textContent = 'Both benchmarks in progress...';
    startBenchmarkPolling(currentRepo.id);
    startQualityBenchmarkPolling(currentRepo.id);

    // Refresh the view to show running status
    await loadBenchmarkHistory(currentRepo.id);
  } catch (error) {
    bothBtn.disabled = false;
    statusText.textContent = `Error: ${error.message}`;
  }
}

function startQualityBenchmarkPolling(repoId) {
  stopQualityBenchmarkPolling();

  const progressDiv = document.getElementById('benchmark-progress');
  progressDiv.classList.remove('hidden');

  qualityBenchmarkPollingInterval = setInterval(async () => {
    try {
      const data = await api(`/repos/${repoId}/quality-benchmarks?limit=1`);
      const benchmarks = data.qualityBenchmarks || [];
      const latest = benchmarks[0];

      if (!latest || latest.status !== 'running') {
        // Benchmark completed or failed
        stopQualityBenchmarkPolling();
        progressDiv.classList.add('hidden');
        await loadBenchmarkHistory(repoId);
        return;
      }

      // Update progress
      document.getElementById('benchmark-progress-text').textContent = 'Quality benchmark in progress... This may take a few minutes.';
    } catch (error) {
      console.error('Error polling quality benchmark status:', error);
    }
  }, 3000);
}

function stopQualityBenchmarkPolling() {
  if (qualityBenchmarkPollingInterval) {
    clearInterval(qualityBenchmarkPollingInterval);
    qualityBenchmarkPollingInterval = null;
  }
}

async function showQualityBenchmarkDetail(benchmarkId) {
  const detailPanel = document.getElementById('benchmark-detail');
  const contentDiv = document.getElementById('benchmark-detail-content');

  detailPanel.classList.remove('hidden');
  contentDiv.innerHTML = '<p class="loading">Loading quality benchmark details...</p>';

  try {
    const data = await api(`/repos/${currentRepo.id}/quality-benchmarks/${benchmarkId}`);
    const benchmark = data.qualityBenchmark;

    if (!benchmark) {
      contentDiv.innerHTML = '<p class="placeholder">Quality benchmark not found</p>';
      return;
    }

    const summary = benchmark.summary || {};
    const results = benchmark.results || [];

    // Build summary stats
    let summaryHtml = `
      <div class="benchmark-detail-summary">
        <div class="benchmark-detail-stat">
          <div class="value">${(summary.overallScore ?? 0).toFixed(0)}%</div>
          <div class="label">Overall Score</div>
        </div>
        <div class="benchmark-detail-stat">
          <div class="value">${summary.pagesEvaluated || results.length || 0}</div>
          <div class="label">Pages</div>
        </div>
        <div class="benchmark-detail-stat">
          <div class="value">${(summary.strengths || []).length}</div>
          <div class="label">Strengths</div>
        </div>
        <div class="benchmark-detail-stat">
          <div class="value">${(summary.weaknesses || []).length}</div>
          <div class="label">Weaknesses</div>
        </div>
      </div>
    `;

    // By dimension breakdown
    if (summary.byDimension) {
      summaryHtml += `
        <div class="benchmark-breakdown">
          <h4>By Dimension</h4>
          <div class="breakdown-items">
            ${Object.entries(summary.byDimension).map(([dim, score]) => `
              <div class="breakdown-item">
                <span class="name">${formatDimensionName(dim)}</span>
                <span class="score ${score >= 70 ? 'high' : score >= 50 ? 'medium' : 'low'}">${score.toFixed(0)}%</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Strengths and weaknesses
    if ((summary.strengths || []).length > 0) {
      summaryHtml += `
        <div class="benchmark-breakdown">
          <h4>Strengths</h4>
          <div class="breakdown-items">
            ${summary.strengths.map(dim => `
              <div class="breakdown-item strength">
                <span class="name">${formatDimensionName(dim)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    if ((summary.weaknesses || []).length > 0) {
      summaryHtml += `
        <div class="benchmark-breakdown">
          <h4>Areas for Improvement</h4>
          <div class="breakdown-items">
            ${summary.weaknesses.map(dim => `
              <div class="breakdown-item weakness">
                <span class="name">${formatDimensionName(dim)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Individual page results
    if (results.length > 0) {
      summaryHtml += `
        <div class="benchmark-questions">
          <h4>Page Results</h4>
          ${results.map(result => {
            const avgScore = Object.values(result.scores || {}).reduce((a, b) => a + b, 0) / 8;
            return `
              <div class="question-result ${avgScore >= 70 ? 'accurate' : avgScore >= 50 ? 'partial' : 'inaccurate'}">
                <div class="question-header">
                  <div class="question-text">${escapeHtml(result.pageTitle || result.pagePath)}</div>
                  <span class="grade-badge">${avgScore.toFixed(0)}%</span>
                </div>
                <div class="question-meta">
                  <span>Path: ${escapeHtml(result.pagePath)}</span>
                  ${result.durationMs ? `<span>${(result.durationMs / 1000).toFixed(1)}s</span>` : ''}
                </div>
                ${result.reasoning ? `<div class="question-reasoning">${escapeHtml(result.reasoning)}</div>` : ''}
                ${(result.findings || []).length > 0 ? `
                  <div class="question-findings">
                    <strong>Findings:</strong>
                    <ul>${result.findings.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    contentDiv.innerHTML = summaryHtml;
  } catch (error) {
    contentDiv.innerHTML = `<p class="placeholder">Error loading details: ${escapeHtml(error.message)}</p>`;
  }
}

function formatDimensionName(dimension) {
  const names = {
    'contextual_richness': 'Contextual Richness',
    'coherence_consistency': 'Coherence & Consistency',
    'completeness_coverage': 'Completeness Coverage',
    'actionability': 'Actionability',
    'structural_quality': 'Structural Quality',
    'confidence_calibration': 'Confidence Calibration',
    'machine_readability': 'Machine Readability',
    'information_density': 'Information Density',
  };
  return names[dimension] || dimension;
}

document.getElementById('run-benchmark-btn').addEventListener('click', runBenchmark);
document.getElementById('run-quality-benchmark-btn').addEventListener('click', runQualityBenchmark);
document.getElementById('run-both-benchmarks-btn').addEventListener('click', runBothBenchmarks);
document.getElementById('close-benchmark-detail').addEventListener('click', () => {
  document.getElementById('benchmark-detail').classList.add('hidden');
});
document.getElementById('back-to-repos-benchmark').addEventListener('click', () => {
  stopBenchmarkPolling();
  stopAutoBenchmark();
  showView('repos');
  loadRepos();
});

// Auto Benchmark
let autoBenchmarkRunning = false;
let autoBenchmarkStopping = false;

async function runAutoBenchmark() {
  if (!currentRepo || autoBenchmarkRunning) return;

  const iterationsPerCycle = parseInt(document.getElementById('auto-benchmark-iterations').value, 10) || 5;
  const maxCycles = parseInt(document.getElementById('auto-benchmark-max-cycles').value, 10) || 10;
  const includeQuality = document.getElementById('auto-benchmark-include-quality').checked;

  autoBenchmarkRunning = true;
  autoBenchmarkStopping = false;

  // Update UI
  const startBtn = document.getElementById('auto-benchmark-btn');
  const stopBtn = document.getElementById('stop-auto-benchmark-btn');
  const progressDiv = document.getElementById('auto-benchmark-progress');
  const cycleSpan = document.getElementById('auto-benchmark-cycle');
  const phaseSpan = document.getElementById('auto-benchmark-phase');
  const statusText = document.getElementById('auto-benchmark-status-text');
  const progressFill = document.getElementById('auto-benchmark-progress-fill');

  startBtn.disabled = true;
  stopBtn.classList.remove('hidden');
  stopBtn.textContent = 'Stop';
  stopBtn.disabled = false;
  document.getElementById('auto-benchmark-iterations').disabled = true;
  document.getElementById('auto-benchmark-max-cycles').disabled = true;
  document.getElementById('auto-benchmark-include-quality').disabled = true;
  progressDiv.classList.remove('hidden');

  // Also disable benchmark buttons during auto-benchmark
  document.getElementById('run-benchmark-btn').disabled = true;
  document.getElementById('run-quality-benchmark-btn').disabled = true;
  document.getElementById('run-both-benchmarks-btn').disabled = true;

  try {
    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      if (autoBenchmarkStopping) {
        statusText.textContent = 'Stopped by user';
        break;
      }

      // Update cycle display
      cycleSpan.textContent = `Cycle ${cycle}/${maxCycles}`;
      const overallProgress = ((cycle - 1) / maxCycles) * 100;
      progressFill.style.width = `${overallProgress}%`;

      // Phase 1: Run iterations
      phaseSpan.textContent = 'Running iterations...';
      statusText.textContent = `Starting ${iterationsPerCycle} iterations...`;

      await runIterationsAndWait(currentRepo.id, iterationsPerCycle, (completed, total) => {
        statusText.textContent = `Iteration ${completed}/${total}`;
      });

      if (autoBenchmarkStopping) {
        statusText.textContent = 'Stopped by user';
        break;
      }

      // Phase 2: Run benchmarks (accuracy and optionally quality in parallel)
      const benchmarkLabel = includeQuality ? 'benchmarks' : 'benchmark';
      phaseSpan.textContent = `Running ${benchmarkLabel}...`;
      statusText.textContent = `Starting ${benchmarkLabel}...`;

      if (includeQuality) {
        // Run both accuracy and quality benchmarks in parallel
        await Promise.all([
          runBenchmarkAndWait(currentRepo.id, () => {
            statusText.textContent = 'Benchmarks in progress...';
          }),
          runQualityBenchmarkAndWait(currentRepo.id, () => {
            statusText.textContent = 'Benchmarks in progress...';
          }),
        ]);
      } else {
        // Run only accuracy benchmark
        await runBenchmarkAndWait(currentRepo.id, () => {
          statusText.textContent = 'Benchmark in progress...';
        });
      }

      // Update progress after cycle completes
      const cycleProgress = (cycle / maxCycles) * 100;
      progressFill.style.width = `${cycleProgress}%`;
      statusText.textContent = `Cycle ${cycle} complete`;

      // Refresh benchmark history to show new result
      await loadBenchmarkHistory(currentRepo.id);
    }

    if (!autoBenchmarkStopping) {
      phaseSpan.textContent = 'Complete';
      statusText.textContent = `All ${maxCycles} cycles completed`;
      progressFill.style.width = '100%';
    }
  } catch (error) {
    statusText.textContent = `Error: ${error.message}`;
    phaseSpan.textContent = 'Failed';
  } finally {
    autoBenchmarkRunning = false;
    startBtn.disabled = false;
    stopBtn.classList.add('hidden');
    document.getElementById('auto-benchmark-iterations').disabled = false;
    document.getElementById('auto-benchmark-max-cycles').disabled = false;
    document.getElementById('auto-benchmark-include-quality').disabled = false;
    document.getElementById('run-benchmark-btn').disabled = false;
    document.getElementById('run-quality-benchmark-btn').disabled = false;
    document.getElementById('run-both-benchmarks-btn').disabled = false;
  }
}

function stopAutoBenchmark() {
  if (autoBenchmarkRunning) {
    autoBenchmarkStopping = true;
    document.getElementById('stop-auto-benchmark-btn').textContent = 'Stopping...';
    document.getElementById('stop-auto-benchmark-btn').disabled = true;
    document.getElementById('auto-benchmark-phase').textContent = 'Stopping after current phase...';
  }
}

/**
 * Run iterations and wait for completion.
 */
async function runIterationsAndWait(repoId, iterations, onProgress) {
  // Start processing
  await api(`/repos/${repoId}/process`, {
    method: 'POST',
    body: JSON.stringify({ iterations }),
  });

  // Poll until complete
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const data = await api(`/repos/${repoId}/processing`);
        const { processing } = data;

        if (!processing || (processing.status !== 'running' && processing.status !== 'stopping')) {
          resolve();
          return;
        }

        if (onProgress) {
          onProgress(processing.completedIterations, processing.totalIterations);
        }

        setTimeout(poll, 1500);
      } catch (error) {
        reject(error);
      }
    };
    setTimeout(poll, 500);
  });
}

/**
 * Run an accuracy benchmark and wait for completion.
 */
async function runBenchmarkAndWait(repoId, onProgress) {
  // Start benchmark
  const response = await fetch(`/api/repos/${repoId}/benchmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (response.status === 409) {
    // Already running, just wait for it
  } else if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to start benchmark');
  }

  // Poll until complete
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const data = await api(`/repos/${repoId}/benchmarks?limit=1`);
        const benchmarks = data.benchmarks || [];
        const latest = benchmarks[0];

        if (!latest || latest.status !== 'running') {
          resolve();
          return;
        }

        if (onProgress) {
          onProgress();
        }

        setTimeout(poll, 3000);
      } catch (error) {
        reject(error);
      }
    };
    setTimeout(poll, 500);
  });
}

/**
 * Run a quality benchmark and wait for completion.
 */
async function runQualityBenchmarkAndWait(repoId, onProgress) {
  // Start quality benchmark
  const response = await fetch(`/api/repos/${repoId}/quality-benchmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (response.status === 409) {
    // Already running, just wait for it
  } else if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to start quality benchmark');
  }

  // Poll until complete
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const data = await api(`/repos/${repoId}/quality-benchmarks?limit=1`);
        const benchmarks = data.qualityBenchmarks || [];
        const latest = benchmarks[0];

        if (!latest || latest.status !== 'running') {
          resolve();
          return;
        }

        if (onProgress) {
          onProgress();
        }

        setTimeout(poll, 3000);
      } catch (error) {
        reject(error);
      }
    };
    setTimeout(poll, 500);
  });
}

document.getElementById('auto-benchmark-btn').addEventListener('click', runAutoBenchmark);
document.getElementById('stop-auto-benchmark-btn').addEventListener('click', stopAutoBenchmark);

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
