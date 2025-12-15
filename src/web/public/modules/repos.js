/**
 * Repository management module for CodeWiki frontend.
 * Handles loading, adding, and processing repositories.
 */

/**
 * Load and display all repositories.
 */
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
            <button class="btn danger small delete-repo-btn" data-id="${repo.id}" data-name="${escapeHtml(repo.fullName)}" title="Delete repository">✕</button>
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
        <div class="card-stats card-stats-secondary">
          <div class="stat">
            <div class="stat-value ${getCoverageColorClass(repo.fileDocCoverage)}">${(repo.fileDocCoverage || 0).toFixed(0)}%</div>
            <div class="stat-label">File Doc</div>
          </div>
          <div class="stat">
            <div class="stat-value ${getCoverageColorClass(repo.avgConfidence)}">${(repo.avgConfidence || 0).toFixed(0)}%</div>
            <div class="stat-label">Confidence</div>
          </div>
          <div class="stat">
            <div class="stat-value ${(repo.openConflicts || 0) + (repo.openFindings || 0) > 0 ? 'stat-warning' : ''}">${(repo.openConflicts || 0) + (repo.openFindings || 0)}</div>
            <div class="stat-label">Issues</div>
          </div>
          <div class="stat stat-agents">
            <div class="agent-coverage-mini">
              ${renderAgentCoverageMini(repo.agentCoverage)}
            </div>
            <div class="stat-label">Agents</div>
          </div>
        </div>
        <div class="card-actions">
          <input type="number" class="iteration-input" data-id="${repo.id}" value="5" min="1" max="50" title="Number of iterations">
          <button class="btn primary process-btn" data-id="${repo.id}">Process</button>
          <button class="btn wiki-btn" data-id="${repo.id}" ${repo.wikiPages > 0 ? '' : 'disabled'}>Browse Wiki</button>
          <button class="btn graph-btn" data-id="${repo.id}" ${repo.wikiPages > 0 ? '' : 'disabled'}>Graph</button>
          <button class="btn query-btn" data-id="${repo.id}" ${repo.wikiPages > 0 ? '' : 'disabled'}>Ask</button>
          <button class="btn spec-btn" data-id="${repo.id}" ${repo.wikiPages > 0 ? '' : 'disabled'}>Spec</button>
          <button class="btn benchmark-btn" data-id="${repo.id}" ${repo.wikiPages > 0 ? '' : 'disabled'}>Benchmark</button>
          <button class="btn debug-btn" data-id="${repo.id}">Debug</button>
        </div>
      </div>
    `).join('');

    // Add event listeners
    container.querySelectorAll('.process-btn').forEach(btn => {
      btn.addEventListener('click', () => processRepo(btn.dataset.id));
    });
    container.querySelectorAll('.wiki-btn').forEach(btn => {
      btn.addEventListener('click', () => navigateToPage('wiki', btn.dataset.id));
    });
    container.querySelectorAll('.graph-btn').forEach(btn => {
      btn.addEventListener('click', () => navigateToPage('graph', btn.dataset.id));
    });
    container.querySelectorAll('.query-btn').forEach(btn => {
      btn.addEventListener('click', () => navigateToPage('query', btn.dataset.id));
    });
    container.querySelectorAll('.spec-btn').forEach(btn => {
      btn.addEventListener('click', () => navigateToPage('spec', btn.dataset.id));
    });
    container.querySelectorAll('.benchmark-btn').forEach(btn => {
      btn.addEventListener('click', () => navigateToPage('benchmark', btn.dataset.id));
    });
    container.querySelectorAll('.debug-btn').forEach(btn => {
      btn.addEventListener('click', () => navigateToPage('debug', btn.dataset.id));
    });
    container.querySelectorAll('.delete-repo-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent card click events
        confirmDeleteRepository(btn.dataset.id, btn.dataset.name);
      });
    });

    // Auto-resume polling for any repos that are currently processing
    repos.forEach(repo => {
      if (repo.status === 'processing') {
        startProcessingPolling(repo.id);
      }
    });
  } catch (error) {
    container.innerHTML = `<p class="placeholder">Error loading repositories: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Add a new repository from local path or GitHub URL.
 */
async function addRepo(pathOrUrl, isGitHubUrl = false) {
  const container = document.getElementById('repos-list');
  const addRepoForm = document.getElementById('add-repo-form');
  const displayName = isGitHubUrl ? extractRepoName(pathOrUrl) || pathOrUrl : pathOrUrl;
  const statusText = isGitHubUrl ? 'cloning' : 'adding';
  const progressText = isGitHubUrl
    ? 'Cloning repository from GitHub...'
    : 'Loading commits from git history...';

  // Hide any previous access error
  hideGitHubAccessError();

  // Create and insert loading card at the beginning
  const loadingCard = document.createElement('div');
  loadingCard.className = 'card repo-loading-card';
  loadingCard.innerHTML = `
    <div class="card-header">
      <h3 class="card-title">${escapeHtml(displayName)}</h3>
      <span class="card-status pending">${statusText}</span>
    </div>
    <div class="processing-progress">
      <div class="progress-bar">
        <div class="progress-fill indeterminate"></div>
      </div>
      <div class="progress-text">${progressText}</div>
    </div>
  `;

  // Insert at the beginning of the list
  const firstCard = container.querySelector('.card');
  if (firstCard) {
    container.insertBefore(loadingCard, firstCard);
  } else {
    // If no cards exist, replace the placeholder
    container.innerHTML = '';
    container.appendChild(loadingCard);
  }

  try {
    const body = isGitHubUrl ? { url: pathOrUrl } : { path: pathOrUrl };
    await api('/repos', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    loadingCard.remove();
    await loadRepos();
  } catch (error) {
    loadingCard.remove();

    // Check if this is a permission/access error for a GitHub repo
    // Only show the access error UI for clear permission issues (401/403)
    const errorMsg = error.message.toLowerCase();
    const isAccessError = isGitHubUrl && (
      errorMsg.includes('401') ||
      errorMsg.includes('403') ||
      errorMsg.includes('unauthorized') ||
      errorMsg.includes('forbidden') ||
      (errorMsg.includes('private') && errorMsg.includes('repo'))
    );

    if (isAccessError) {
      // Show the inline access error with install link
      showGitHubAccessError();
      // Re-show the form so user can see the error
      addRepoForm.classList.remove('hidden');
    } else {
      alert('Error adding repository: ' + error.message);
    }
  }
}

/**
 * Start polling for processing status updates.
 * Used both when starting a new run and when resuming after page reload.
 */
function startProcessingPolling(id) {
  const card = document.querySelector(`.card[data-repo-id="${id}"]`);
  if (!card) return;

  const btn = card.querySelector('.process-btn');
  const iterationInput = card.querySelector('.iteration-input');

  btn.textContent = 'Processing...';
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

        const duplicatesHtml = processing.duplicatesFiltered > 0
          ? `<div class="progress-duplicates">⚠ ${processing.duplicatesFiltered} duplicate(s) filtered</div>`
          : '';

        progressDiv.innerHTML = `
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${percent}%"></div>
          </div>
          <div class="progress-text-row">
            <span class="progress-text">${progressText}</span>
            ${stopButtonHtml}
          </div>
          ${duplicatesHtml}
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
  setTimeout(pollStatus, 500);
}

/**
 * Start processing a repository.
 */
async function processRepo(id) {
  const btn = document.querySelector(`.process-btn[data-id="${id}"]`);
  const iterationInput = document.querySelector(`.iteration-input[data-id="${id}"]`);
  const iterations = parseInt(iterationInput.value, 10) || 5;
  const originalText = btn.textContent;
  btn.textContent = 'Starting...';
  btn.disabled = true;
  iterationInput.disabled = true;

  try {
    await api(`/repos/${id}/process`, {
      method: 'POST',
      body: JSON.stringify({ iterations }),
    });

    startProcessingPolling(id);
  } catch (error) {
    alert('Error starting processing: ' + error.message);
    btn.textContent = originalText;
    btn.disabled = false;
    iterationInput.disabled = false;
  }
}

/**
 * Stop processing a repository.
 */
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
 * Show confirmation dialog for repository deletion.
 */
async function confirmDeleteRepository(repoId, repoName) {
  showConfirmModal({
    title: 'Delete Repository',
    message: 'Are you sure you want to delete this repository?',
    details: `
      <div class="detail-item">
        <span class="detail-label">Repository</span>
        <span class="detail-value">${escapeHtml(repoName)}</span>
      </div>
      <p class="warning-text">This will permanently delete the repository and all its wikis, pages, and benchmark data. This action cannot be undone.</p>
    `,
    confirmText: 'Delete Repository',
    confirmClass: 'danger',
    onConfirm: () => deleteRepository(repoId, repoName),
  });
}

/**
 * Delete a repository and refresh the list.
 */
async function deleteRepository(repoId, repoName) {
  try {
    await api(`/repos/${repoId}`, {
      method: 'DELETE',
    });

    showToast(`Repository "${repoName}" deleted successfully`, 'success');

    // Reset current repo if it was deleted
    if (currentRepo && currentRepo.id === repoId) {
      currentRepo = null;
      currentWiki = null;
      currentPage = null;
      // Go back to repos view
      navigateToRepos();
      return; // Don't reload repos list since we're navigating away
    }

    // Reload the repos list
    await loadRepos();
  } catch (error) {
    showToast(`Failed to delete repository: ${error.message}`, 'error');
  }
}


/**
 * Get CSS class for coverage percentage coloring.
 * @param {number} percent - Coverage percentage (0-100)
 * @returns {string} CSS class name
 */
function getCoverageColorClass(percent) {
  if (percent == null) return '';
  if (percent >= 70) return 'stat-high';
  if (percent >= 40) return 'stat-medium';
  return 'stat-low';
}

/**
 * Render mini agent coverage visualization.
 * Shows key agents as small colored bars.
 * @param {Object} agentCoverage - Map of agent type to coverage percentage
 * @returns {string} HTML for mini visualization
 */
function renderAgentCoverageMini(agentCoverage) {
  if (!agentCoverage || Object.keys(agentCoverage).length === 0) {
    return '<span class="no-data">-</span>';
  }

  // Key agents to show (abbreviations for space)
  const keyAgents = [
    { key: 'code-change', label: 'CC' },
    { key: 'architecture', label: 'AR' },
    { key: 'security', label: 'SE' },
    { key: 'quality', label: 'QA' },
  ];

  const bars = keyAgents.map(({ key, label }) => {
    const percent = agentCoverage[key] || 0;
    const colorClass = getCoverageColorClass(percent);
    return `<div class="agent-bar ${colorClass}" title="${label}: ${percent.toFixed(0)}%" style="--coverage: ${percent}%"></div>`;
  }).join('');

  return bars;
}
