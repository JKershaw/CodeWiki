/**
 * Debug/Observability module for CodeWiki frontend.
 * Displays orchestrator decisions, agent runs, and system metrics.
 */

// Track the current repo being debugged
let debugCurrentRepoId = null;

/**
 * Initialize debug view event listeners.
 */
function initDebugListeners() {
  // Tab switching
  document.querySelectorAll('.debug-tab').forEach(tab => {
    tab.addEventListener('click', () => switchDebugTab(tab.dataset.tab));
  });

  // Refresh buttons
  document.getElementById('debug-refresh-orchestrator')?.addEventListener('click', () => {
    if (debugCurrentRepoId) loadOrchestratorRuns(debugCurrentRepoId);
  });
  document.getElementById('debug-refresh-agents')?.addEventListener('click', () => {
    if (debugCurrentRepoId) loadAgentRuns(debugCurrentRepoId);
  });

  // Filter controls
  document.getElementById('debug-filter-llm')?.addEventListener('change', () => {
    if (debugCurrentRepoId) loadOrchestratorRuns(debugCurrentRepoId);
  });
  document.getElementById('debug-agent-filter')?.addEventListener('change', () => {
    if (debugCurrentRepoId) loadAgentRuns(debugCurrentRepoId);
  });
  document.getElementById('debug-status-filter')?.addEventListener('change', () => {
    if (debugCurrentRepoId) loadAgentRuns(debugCurrentRepoId);
  });

  // Close detail panel
  document.getElementById('debug-close-detail')?.addEventListener('click', () => {
    closeSidePanel('debug-detail-panel');
  });
}

/**
 * Initialize the debug page.
 * Called on page load when on the debug page.
 */
async function initDebugPage() {
  const repoId = window.currentRepoId;
  if (!repoId) return;

  debugCurrentRepoId = repoId;

  // Get repo info for display
  try {
    const repo = await api(`/repos/${repoId}`);
    document.getElementById('debug-repo-name').textContent = repo.fullName || repoId;
  } catch {
    document.getElementById('debug-repo-name').textContent = repoId;
  }

  // Load data
  await Promise.all([
    loadDebugSummary(repoId),
    loadOrchestratorRuns(repoId),
    loadAgentRuns(repoId),
  ]);

  // Populate agent type filter
  populateAgentTypeFilter();
}

/**
 * Switch between debug tabs.
 */
function switchDebugTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.debug-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  // Update tab content
  document.querySelectorAll('.debug-tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `debug-${tabName}-tab`);
  });
}

/**
 * Load and display debug summary statistics.
 */
async function loadDebugSummary(repoId) {
  try {
    const data = await api(`/repos/${repoId}/observability/summary`);
    const summary = data.summary;

    // Update cost displays
    document.getElementById('debug-total-cost').textContent = `$${summary.costs.total.toFixed(4)}`;
    document.getElementById('debug-orchestrator-cost').textContent = `$${summary.costs.orchestrator.toFixed(4)}`;
    document.getElementById('debug-agent-cost').textContent = `$${summary.costs.agents.toFixed(4)}`;

    // Update agent run counts
    document.getElementById('debug-total-runs').textContent = summary.agentRuns.total;
    document.getElementById('debug-completed-runs').textContent = summary.agentRuns.completed;
    document.getElementById('debug-failed-runs').textContent = summary.agentRuns.failed;
    document.getElementById('debug-success-rate').textContent = `${summary.agentRuns.successRate}%`;

    // Update orchestrator run counts
    document.getElementById('debug-orchestrator-runs').textContent = summary.orchestratorRuns.total;
    document.getElementById('debug-llm-decisions').textContent = summary.orchestratorRuns.llmDecisions;
    document.getElementById('debug-deterministic-decisions').textContent = summary.orchestratorRuns.deterministicDecisions;

  } catch (error) {
    console.error('Failed to load debug summary:', error);
  }
}

/**
 * Load and display orchestrator runs.
 */
async function loadOrchestratorRuns(repoId) {
  const container = document.getElementById('debug-orchestrator-list');
  container.innerHTML = '<p class="loading">Loading orchestrator decisions...</p>';

  try {
    const llmOnly = document.getElementById('debug-filter-llm')?.checked;
    const params = new URLSearchParams({ limit: '50' });
    if (llmOnly) params.set('usedLLM', 'true');

    const data = await api(`/repos/${repoId}/orchestrator-runs?${params}`);
    const runs = data.orchestratorRuns || [];

    if (runs.length === 0) {
      container.innerHTML = '<p class="placeholder">No orchestrator decisions yet.</p>';
      return;
    }

    container.innerHTML = runs.map(run => `
      <div class="debug-item orchestrator-run" data-run-id="${run.id}">
        <div class="debug-item-header">
          <span class="debug-item-time">${formatRelativeTime(run.timestamp)}</span>
          <span class="debug-item-badge ${run.usedLLM ? 'llm' : 'deterministic'}">
            ${run.usedLLM ? 'LLM' : 'Deterministic'}
          </span>
          <span class="debug-item-cost">$${run.costUsd.toFixed(4)}</span>
        </div>
        <div class="debug-item-reasoning">${escapeHtml(run.reasoning)}</div>
        <div class="debug-item-meta">
          <span>${run.workItemsCreated} work items</span>
          <span>${run.durationMs}ms</span>
          <span>Wiki: ${run.contextSnapshot.wikiPages} pages</span>
        </div>
        <div class="debug-item-work-items">
          ${run.workItems.slice(0, 5).map(wi => `
            <span class="work-item-chip">${wi.agentType}</span>
          `).join('')}
          ${run.workItems.length > 5 ? `<span class="work-item-more">+${run.workItems.length - 5} more</span>` : ''}
        </div>
      </div>
    `).join('');

    // Add click handlers for detail view
    container.querySelectorAll('.orchestrator-run').forEach(item => {
      item.addEventListener('click', () => showOrchestratorRunDetail(repoId, item.dataset.runId));
    });

  } catch (error) {
    container.innerHTML = `<p class="placeholder">Error: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Load and display agent runs.
 */
async function loadAgentRuns(repoId) {
  const container = document.getElementById('debug-agents-list');
  container.innerHTML = '<p class="loading">Loading agent runs...</p>';

  try {
    const agentType = document.getElementById('debug-agent-filter')?.value;
    const status = document.getElementById('debug-status-filter')?.value;

    const params = new URLSearchParams({ limit: '100' });
    if (agentType) params.set('agentType', agentType);
    if (status) params.set('status', status);

    const data = await api(`/repos/${repoId}/agent-runs?${params}`);
    const runs = data.agentRuns || [];

    if (runs.length === 0) {
      container.innerHTML = '<p class="placeholder">No agent runs found.</p>';
      return;
    }

    container.innerHTML = runs.map(run => `
      <div class="debug-item agent-run" data-run-id="${run.id}">
        <div class="debug-item-header">
          <span class="debug-item-time">${formatRelativeTime(run.startedAt)}</span>
          <span class="debug-item-badge agent-type">${run.agentType}</span>
          <span class="debug-item-badge status-${run.status}">${run.status}</span>
          ${run.costUsd ? `<span class="debug-item-cost">$${run.costUsd.toFixed(4)}</span>` : ''}
        </div>
        ${run.resultSummary ? `<div class="debug-item-summary">${escapeHtml(run.resultSummary.substring(0, 200))}${run.resultSummary.length > 200 ? '...' : ''}</div>` : ''}
        <div class="debug-item-meta">
          ${run.targetCommitId ? `<span>Commit: ${run.targetCommitId.substring(0, 7)}</span>` : ''}
          ${run.targetPath ? `<span>Path: ${run.targetPath}</span>` : ''}
          ${run.durationMs ? `<span>${run.durationMs}ms</span>` : ''}
          ${run.findingsCount > 0 ? `<span>${run.findingsCount} findings</span>` : ''}
          ${run.requestedUpdatesCount > 0 ? `<span>${run.requestedUpdatesCount} updates</span>` : ''}
        </div>
        ${run.error ? `<div class="debug-item-error">${escapeHtml(run.error)}</div>` : ''}
      </div>
    `).join('');

    // Add click handlers for detail view
    container.querySelectorAll('.agent-run').forEach(item => {
      item.addEventListener('click', () => showAgentRunDetail(repoId, item.dataset.runId));
    });

  } catch (error) {
    container.innerHTML = `<p class="placeholder">Error: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Populate the agent type filter dropdown.
 */
function populateAgentTypeFilter() {
  const select = document.getElementById('debug-agent-filter');
  if (!select) return;

  // Common agent types
  const agentTypes = [
    'bootstrap', 'code-change', 'narrative', 'security', 'technical-debt',
    'pattern', 'dependency', 'exploration', 'wiki-editor', 'link', 'structure',
    'quality', 'consistency', 'project-overview', 'getting-started', 'testing-guide',
    'extension-guide', 'writer', 'overview'
  ];

  select.innerHTML = '<option value="">All Agents</option>' +
    agentTypes.map(type => `<option value="${type}">${type}</option>`).join('');
}

/**
 * Show detailed view of an orchestrator run.
 */
async function showOrchestratorRunDetail(repoId, runId) {
  const panel = document.getElementById('debug-detail-panel');
  const content = document.getElementById('debug-detail-content');
  const title = document.getElementById('debug-detail-title');

  title.textContent = 'Orchestrator Decision Details';
  content.innerHTML = '<p class="loading">Loading...</p>';
  openSidePanel(panel);

  try {
    const data = await api(`/repos/${repoId}/orchestrator-runs/${runId}`);
    const run = data.orchestratorRun;

    content.innerHTML = `
      ${run.progressUpdate ? `
        <div class="detail-section progress-update-section">
          <h4>📊 Progress Update</h4>
          <p class="progress-update-text">${escapeHtml(run.progressUpdate)}</p>
        </div>
      ` : ''}

      <div class="detail-section">
        <h4>Decision</h4>
        <p><strong>Reasoning:</strong> ${escapeHtml(run.decision.reasoning)}</p>
        <p><strong>Mode:</strong> ${run.usedLLM ? 'LLM' : 'Deterministic'}</p>
        <p><strong>Model:</strong> ${escapeHtml(run.model)}</p>
        <p><strong>Cost:</strong> $${run.costUsd.toFixed(4)}</p>
        <p><strong>Duration:</strong> ${run.durationMs}ms</p>
        <p><strong>Time:</strong> ${new Date(run.timestamp).toLocaleString()}</p>
      </div>

      <div class="detail-section">
        <h4>Work Items (${run.decision.workItems.length})</h4>
        <div class="work-items-list">
          ${run.decision.workItems.map(wi => `
            <div class="work-item-detail">
              <span class="work-item-chip">${wi.agentType}</span>
              ${wi.targetCommitId ? `<span class="work-item-target">Commit: ${wi.targetCommitId.substring(0, 7)}</span>` : ''}
              ${wi.targetPath ? `<span class="work-item-target">Path: ${wi.targetPath}</span>` : ''}
              <p class="work-item-reason">${escapeHtml(wi.reason)}</p>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="detail-section">
        <h4>Context Snapshot</h4>
        <pre class="context-json">${escapeHtml(JSON.stringify(run.context, null, 2))}</pre>
      </div>

      ${run.promptSent ? `
        <div class="detail-section collapsible">
          <h4 class="collapsible-header" onclick="this.parentElement.classList.toggle('expanded')">
            Prompt Sent <span class="collapse-icon">+</span>
          </h4>
          <pre class="prompt-content">${escapeHtml(run.promptSent)}</pre>
        </div>
      ` : ''}

      ${run.rawResponse ? `
        <div class="detail-section collapsible">
          <h4 class="collapsible-header" onclick="this.parentElement.classList.toggle('expanded')">
            Raw Response <span class="collapse-icon">+</span>
          </h4>
          <pre class="response-content">${escapeHtml(run.rawResponse)}</pre>
        </div>
      ` : ''}
    `;

  } catch (error) {
    content.innerHTML = `<p class="placeholder">Error: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Show detailed view of an agent run.
 */
async function showAgentRunDetail(repoId, runId) {
  const panel = document.getElementById('debug-detail-panel');
  const content = document.getElementById('debug-detail-content');
  const title = document.getElementById('debug-detail-title');

  title.textContent = 'Agent Run Details';
  content.innerHTML = '<p class="loading">Loading...</p>';
  openSidePanel(panel);

  try {
    const data = await api(`/repos/${repoId}/agent-runs/${runId}`);
    const run = data.agentRun;

    content.innerHTML = `
      <div class="detail-section">
        <h4>Run Info</h4>
        <p><strong>Agent:</strong> ${run.agentType}</p>
        <p><strong>Status:</strong> <span class="status-${run.status}">${run.status}</span></p>
        ${run.targetCommitId ? `<p><strong>Target Commit:</strong> ${run.targetCommitId}</p>` : ''}
        ${run.targetPath ? `<p><strong>Target Path:</strong> ${run.targetPath}</p>` : ''}
        <p><strong>Started:</strong> ${run.startedAt ? new Date(run.startedAt).toLocaleString() : 'N/A'}</p>
        <p><strong>Completed:</strong> ${run.completedAt ? new Date(run.completedAt).toLocaleString() : 'N/A'}</p>
        <p><strong>Duration:</strong> ${run.durationMs || 0}ms</p>
        <p><strong>Cost:</strong> $${(run.costUsd || 0).toFixed(4)}</p>
      </div>

      ${run.error ? `
        <div class="detail-section error-section">
          <h4>Error</h4>
          <pre class="error-content">${escapeHtml(run.error)}</pre>
        </div>
      ` : ''}

      ${run.result ? `
        <div class="detail-section">
          <h4>Result</h4>
          <p><strong>Summary:</strong> ${escapeHtml(run.result.summary || 'N/A')}</p>
          <p><strong>Confidence:</strong> ${(run.result.confidence || 0).toFixed(2)}</p>
          ${run.result.findings && run.result.findings.length > 0 ? `
            <h5>Findings (${run.result.findings.length})</h5>
            <div class="findings-list">
              ${run.result.findings.map(f => `
                <div class="finding-item">
                  <span class="finding-type">${f.type || 'info'}</span>
                  <p>${escapeHtml(f.message || f.description || JSON.stringify(f))}</p>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      ` : ''}

      ${run.requestedUpdates && run.requestedUpdates.length > 0 ? `
        <div class="detail-section">
          <h4>Requested Updates (${run.requestedUpdates.length})</h4>
          <ul>
            ${run.requestedUpdates.map(u => `<li>${escapeHtml(u)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    `;

  } catch (error) {
    content.innerHTML = `<p class="placeholder">Error: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Format a timestamp as relative time (e.g., "5 minutes ago").
 */
function formatRelativeTime(timestamp) {
  if (!timestamp) return 'N/A';

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString();
}
