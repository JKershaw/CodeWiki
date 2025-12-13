/**
 * Benchmark module for CodeWiki frontend.
 * Handles accuracy and quality benchmarks, auto-benchmark, and self-improvement.
 */

// Module state
let benchmarkPollingInterval = null;
let qualityBenchmarkPollingInterval = null;
let benchmarkChart = null;
let autoBenchmarkRunning = false;
let autoBenchmarkStopping = false;
let currentAutoBenchmarkRunId = null;
let selectedBenchmarkIds = new Set();
let selfImprovementPollingInterval = null;

/**
 * Open the benchmark view for a repository.
 */
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
  closeSidePanel('benchmark-detail');

  // Load benchmark history
  await loadBenchmarkHistory(repoId);
}

/**
 * Load and display benchmark history.
 */
async function loadBenchmarkHistory(repoId) {
  const container = document.getElementById('benchmark-history');
  const statusText = document.getElementById('benchmark-status-text');
  const runBtn = document.getElementById('run-benchmark-btn');
  const qualityRunBtn = document.getElementById('run-quality-benchmark-btn');
  const bothRunBtn = document.getElementById('run-both-benchmarks-btn');

  container.innerHTML = '<p class="loading">Loading benchmark history...</p>';

  try {
    // Load benchmarks and page history in parallel
    const [accuracyData, qualityData, pageHistoryData] = await Promise.all([
      api(`/repos/${repoId}/benchmarks`),
      api(`/repos/${repoId}/quality-benchmarks`).catch(() => ({ qualityBenchmarks: [] })),
      api(`/repos/${repoId}/page-history`).catch(() => ({ pageHistory: [] })),
    ]);

    const accuracyBenchmarks = accuracyData.benchmarks || [];
    const qualityBenchmarks = qualityData.qualityBenchmarks || [];
    const pageHistory = pageHistoryData.pageHistory || [];

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
      renderBenchmarkChart([], [], pageHistory);
      return;
    }

    // Render combined chart
    renderBenchmarkChart(accuracyBenchmarks, qualityBenchmarks, pageHistory);

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

    // Add click handlers for delete buttons
    container.querySelectorAll('.benchmark-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent card click
        const benchmarkId = btn.dataset.id;
        const benchmarkType = btn.dataset.type;
        const iteration = btn.dataset.iteration;
        confirmDeleteBenchmark(repoId, benchmarkId, benchmarkType, iteration);
      });
    });

    // Populate self-improvement benchmark selector
    renderBenchmarkSelector(accuracyBenchmarks);

    // Check for running auto-benchmark and resume UI polling
    await checkAndResumeAutoBenchmark(repoId);
  } catch (error) {
    container.innerHTML = `<p class="placeholder">Error loading benchmarks: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Show confirmation dialog and delete a benchmark if confirmed.
 */
function confirmDeleteBenchmark(repoId, benchmarkId, benchmarkType, iteration) {
  const typeLabel = benchmarkType === 'quality' ? 'Quality Benchmark' : 'Accuracy Benchmark';
  const typeLabelLower = benchmarkType === 'quality' ? 'quality benchmark' : 'benchmark';

  showConfirmModal({
    title: `Delete ${typeLabel}`,
    message: `Are you sure you want to delete this ${typeLabelLower}?`,
    details: `
      <div class="detail-item">
        <span class="detail-label">Type</span>
        <span class="detail-value">${typeLabel}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Iteration</span>
        <span class="detail-value">${iteration}</span>
      </div>
      <p class="warning-text">This will permanently delete the benchmark results. This action cannot be undone.</p>
    `,
    confirmText: `Delete ${typeLabel}`,
    confirmClass: 'danger',
    onConfirm: () => deleteBenchmark(repoId, benchmarkId, benchmarkType),
  });
}

/**
 * Delete a benchmark and refresh the UI.
 */
async function deleteBenchmark(repoId, benchmarkId, benchmarkType) {
  const typeLabel = benchmarkType === 'quality' ? 'quality benchmark' : 'benchmark';

  // Find the delete button to show loading state
  const deleteBtn = document.querySelector(`.benchmark-delete-btn[data-id="${benchmarkId}"]`);
  if (deleteBtn) {
    deleteBtn.textContent = '...';
    deleteBtn.disabled = true;
  }

  try {
    const endpoint = benchmarkType === 'quality'
      ? `/repos/${repoId}/quality-benchmarks/${benchmarkId}`
      : `/repos/${repoId}/benchmarks/${benchmarkId}`;

    const response = await fetch(`/api${endpoint}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Failed to delete ${typeLabel}`);
    }

    showToast(`${benchmarkType === 'quality' ? 'Quality benchmark' : 'Benchmark'} deleted successfully`, 'success');

    // Reload the benchmark history
    await loadBenchmarkHistory(repoId);
  } catch (error) {
    showToast(`Failed to delete ${typeLabel}: ${error.message}`, 'error');

    // Restore button state on error
    if (deleteBtn) {
      deleteBtn.textContent = '✕';
      deleteBtn.disabled = false;
    }
  }
}

/**
 * Render the benchmark chart.
 */
function renderBenchmarkChart(accuracyBenchmarks, qualityBenchmarks, pageHistory = []) {
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

  // Use detailed page history if available, otherwise fall back to benchmark-derived data
  let pageCountPoints;
  let commitCoveragePoints = [];
  let fileCoveragePoints = [];

  if (pageHistory && pageHistory.length > 0) {
    pageCountPoints = pageHistory.map(p => ({ x: p.iteration, y: p.pageCount }));

    // Extract coverage metrics from page history (when available from KPI snapshots)
    commitCoveragePoints = pageHistory
      .filter(p => p.commitCoverage !== undefined)
      .map(p => ({ x: p.iteration, y: p.commitCoverage }));

    fileCoveragePoints = pageHistory
      .filter(p => p.fileCoverage !== undefined)
      .map(p => ({ x: p.iteration, y: p.fileCoverage }));
  } else {
    const pageCountMap = new Map();
    [...sortedAccuracy, ...sortedQuality].forEach(b => {
      if (b.pageCount != null && b.pageCount > 0) {
        const existing = pageCountMap.get(b.iterationCount);
        if (!existing || b.pageCount > existing) {
          pageCountMap.set(b.iterationCount, b.pageCount);
        }
      }
    });
    pageCountPoints = Array.from(pageCountMap.entries())
      .map(([iteration, count]) => ({ x: iteration, y: count }))
      .sort((a, b) => a.x - b.x);
  }

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
      pointRadius: 0,
      pointHoverRadius: 4,
      yAxisID: 'y2',
      borderDash: [5, 5],
    });
  }

  // Add commit coverage (percentage of commits processed)
  if (commitCoveragePoints.length > 0) {
    datasets.push({
      label: 'Commit Coverage',
      data: commitCoveragePoints,
      borderColor: '#8b5cf6',
      backgroundColor: 'rgba(139, 92, 246, 0.1)',
      borderWidth: 2,
      fill: false,
      tension: 0.3,
      pointBackgroundColor: '#8b5cf6',
      pointRadius: 0,
      pointHoverRadius: 4,
      yAxisID: 'y',
      borderDash: [2, 2],
    });
  }

  // Add file coverage (percentage of source files documented)
  if (fileCoveragePoints.length > 0) {
    datasets.push({
      label: 'File Coverage',
      data: fileCoveragePoints,
      borderColor: '#ec4899',
      backgroundColor: 'rgba(236, 72, 153, 0.1)',
      borderWidth: 2,
      fill: false,
      tension: 0.3,
      pointBackgroundColor: '#ec4899',
      pointRadius: 0,
      pointHoverRadius: 4,
      yAxisID: 'y',
      borderDash: [4, 2],
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

  if (pageCountPoints.length > 0) {
    scales.y2 = {
      type: 'linear',
      position: 'right',
      min: 0,
      max: Math.ceil(maxPageCount * 1.1),
      ticks: {
        color: '#f59e0b',
      },
      grid: {
        drawOnChartArea: false,
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

/**
 * Render an accuracy benchmark card.
 */
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

  const deleteBtn = benchmark.status !== 'running'
    ? `<button class="btn danger small benchmark-delete-btn" data-id="${benchmark.id}" data-type="${type}" data-iteration="${benchmark.iterationCount}" title="Delete benchmark">✕</button>`
    : '';

  return `
    <div class="benchmark-card" data-id="${benchmark.id}" data-type="${type}">
      ${deleteBtn}
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

/**
 * Render a quality benchmark card.
 */
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

  const deleteBtn = benchmark.status !== 'running'
    ? `<button class="btn danger small benchmark-delete-btn" data-id="${benchmark.id}" data-type="quality" data-iteration="${benchmark.iterationCount}" title="Delete benchmark">✕</button>`
    : '';

  return `
    <div class="benchmark-card quality" data-id="${benchmark.id}" data-type="quality">
      ${deleteBtn}
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

/**
 * Run an accuracy benchmark.
 */
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

/**
 * Start polling for accuracy benchmark status.
 */
function startBenchmarkPolling(repoId) {
  stopBenchmarkPolling();

  const progressDiv = document.getElementById('benchmark-progress');
  const progressFill = document.getElementById('benchmark-progress-fill');
  const progressText = document.getElementById('benchmark-progress-text');
  progressDiv.classList.remove('hidden');

  benchmarkPollingInterval = setInterval(async () => {
    try {
      const data = await api(`/repos/${repoId}/benchmarks?limit=1`);
      const benchmarks = data.benchmarks || [];
      const latest = benchmarks[0];

      if (!latest || latest.status !== 'running') {
        stopBenchmarkPolling();
        progressDiv.classList.add('hidden');
        await loadBenchmarkHistory(repoId);
        return;
      }

      try {
        const progressData = await api(`/repos/${repoId}/benchmarks/${latest.id}/progress`);
        const { completedCount, totalQuestions } = progressData;
        const percent = totalQuestions > 0 ? Math.round((completedCount / totalQuestions) * 100) : 0;
        progressFill.style.width = `${percent}%`;
        progressText.textContent = `Accuracy benchmark: ${completedCount} of ${totalQuestions} questions (${percent}%)`;
      } catch {
        progressFill.style.width = '0%';
        progressText.textContent = 'Accuracy benchmark in progress...';
      }
    } catch (error) {
      console.error('Error polling benchmark status:', error);
    }
  }, 2000);
}

/**
 * Stop accuracy benchmark polling.
 */
function stopBenchmarkPolling() {
  if (benchmarkPollingInterval) {
    clearInterval(benchmarkPollingInterval);
    benchmarkPollingInterval = null;
  }
}

/**
 * Show accuracy benchmark detail.
 */
async function showBenchmarkDetail(benchmarkId) {
  const detailPanel = document.getElementById('benchmark-detail');
  const contentDiv = document.getElementById('benchmark-detail-content');

  openSidePanel(detailPanel);
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

/**
 * Run a quality benchmark.
 */
async function runQualityBenchmark() {
  if (!currentRepo) return;

  const runBtn = document.getElementById('run-quality-benchmark-btn');
  const statusText = document.getElementById('benchmark-status-text');
  const progressDiv = document.getElementById('quality-benchmark-progress');

  runBtn.disabled = true;
  statusText.textContent = 'Starting quality benchmark...';
  progressDiv.classList.remove('hidden');
  document.getElementById('quality-benchmark-progress-fill').style.width = '0%';
  document.getElementById('quality-benchmark-progress-text').textContent = 'Starting quality benchmark...';

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

/**
 * Run both benchmarks in parallel.
 */
async function runBothBenchmarks() {
  if (!currentRepo) return;

  const bothBtn = document.getElementById('run-both-benchmarks-btn');
  const statusText = document.getElementById('benchmark-status-text');
  const accuracyProgressDiv = document.getElementById('benchmark-progress');
  const qualityProgressDiv = document.getElementById('quality-benchmark-progress');

  bothBtn.disabled = true;
  statusText.textContent = 'Starting both benchmarks...';

  // Show and reset both progress bars
  accuracyProgressDiv.classList.remove('hidden');
  qualityProgressDiv.classList.remove('hidden');
  document.getElementById('benchmark-progress-fill').style.width = '0%';
  document.getElementById('benchmark-progress-text').textContent = 'Starting accuracy benchmark...';
  document.getElementById('quality-benchmark-progress-fill').style.width = '0%';
  document.getElementById('quality-benchmark-progress-text').textContent = 'Starting quality benchmark...';

  try {
    await Promise.allSettled([
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

    await loadBenchmarkHistory(currentRepo.id);
  } catch (error) {
    bothBtn.disabled = false;
    statusText.textContent = `Error: ${error.message}`;
    accuracyProgressDiv.classList.add('hidden');
    qualityProgressDiv.classList.add('hidden');
  }
}

/**
 * Start polling for quality benchmark status.
 */
function startQualityBenchmarkPolling(repoId) {
  stopQualityBenchmarkPolling();

  const progressDiv = document.getElementById('quality-benchmark-progress');
  const progressFill = document.getElementById('quality-benchmark-progress-fill');
  const progressText = document.getElementById('quality-benchmark-progress-text');
  progressDiv.classList.remove('hidden');

  qualityBenchmarkPollingInterval = setInterval(async () => {
    try {
      const data = await api(`/repos/${repoId}/quality-benchmarks?limit=1`);
      const benchmarks = data.qualityBenchmarks || [];
      const latest = benchmarks[0];

      if (!latest || latest.status !== 'running') {
        stopQualityBenchmarkPolling();
        progressDiv.classList.add('hidden');
        await loadBenchmarkHistory(repoId);
        return;
      }

      try {
        const progressData = await api(`/repos/${repoId}/quality-benchmarks/${latest.id}/progress`);
        const { completedCount, totalPages } = progressData;
        const percent = totalPages > 0 ? Math.round((completedCount / totalPages) * 100) : 0;
        progressFill.style.width = `${percent}%`;
        progressText.textContent = `Quality benchmark: ${completedCount} of ${totalPages} pages (${percent}%)`;
      } catch {
        progressFill.style.width = '0%';
        progressText.textContent = 'Quality benchmark in progress...';
      }
    } catch (error) {
      console.error('Error polling quality benchmark status:', error);
    }
  }, 2000);
}

/**
 * Stop quality benchmark polling.
 */
function stopQualityBenchmarkPolling() {
  if (qualityBenchmarkPollingInterval) {
    clearInterval(qualityBenchmarkPollingInterval);
    qualityBenchmarkPollingInterval = null;
  }
}

/**
 * Show quality benchmark detail.
 */
async function showQualityBenchmarkDetail(benchmarkId) {
  const detailPanel = document.getElementById('benchmark-detail');
  const contentDiv = document.getElementById('benchmark-detail-content');

  openSidePanel(detailPanel);
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

/**
 * Run auto-benchmark cycle (server-side orchestration).
 * Starts the auto-benchmark on the server and polls for status.
 */
async function runAutoBenchmark() {
  if (!currentRepo || autoBenchmarkRunning) return;

  const iterationsPerCycle = parseInt(document.getElementById('auto-benchmark-iterations').value, 10) || 5;
  const maxCycles = parseInt(document.getElementById('auto-benchmark-max-cycles').value, 10) || 10;
  const includeQuality = document.getElementById('auto-benchmark-include-quality').checked;

  autoBenchmarkRunning = true;
  autoBenchmarkStopping = false;
  currentAutoBenchmarkRunId = null;

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

  document.getElementById('run-benchmark-btn').disabled = true;
  document.getElementById('run-quality-benchmark-btn').disabled = true;
  document.getElementById('run-both-benchmarks-btn').disabled = true;

  try {
    // Start auto-benchmark on server
    statusText.textContent = 'Starting auto-benchmark...';
    phaseSpan.textContent = 'Initializing...';

    const response = await fetch(`/api/repos/${currentRepo.id}/auto-benchmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iterationsPerCycle, maxCycles, includeQuality }),
    });

    if (response.status === 409) {
      const data = await response.json();
      currentAutoBenchmarkRunId = data.runId;
      statusText.textContent = 'Resuming existing run...';
    } else if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start auto-benchmark');
    } else {
      const data = await response.json();
      currentAutoBenchmarkRunId = data.runId;
    }

    // Poll for status
    await pollAutoBenchmarkStatus(currentRepo.id, currentAutoBenchmarkRunId, {
      cycleSpan,
      phaseSpan,
      statusText,
      progressFill,
      maxCycles,
    });

    // Reload benchmark history when complete
    await loadBenchmarkHistory(currentRepo.id);

  } catch (error) {
    statusText.textContent = `Error: ${error.message}`;
    phaseSpan.textContent = 'Failed';
  } finally {
    autoBenchmarkRunning = false;
    currentAutoBenchmarkRunId = null;
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

/**
 * Poll for auto-benchmark status from server.
 */
async function pollAutoBenchmarkStatus(repoId, runId, ui) {
  const { cycleSpan, phaseSpan, statusText, progressFill, maxCycles } = ui;

  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const response = await fetch(`/api/repos/${repoId}/auto-benchmarks/${runId}`);
        if (!response.ok) {
          throw new Error('Failed to get auto-benchmark status');
        }

        const run = await response.json();

        // Update UI based on server state
        cycleSpan.textContent = `Cycle ${run.currentCycle}/${run.config.maxCycles}`;

        const phaseLabels = {
          iterations: 'Running iterations...',
          accuracy: 'Running accuracy benchmark...',
          quality: 'Running quality benchmark...',
          complete: 'Complete',
        };
        phaseSpan.textContent = phaseLabels[run.currentPhase] || run.currentPhase;

        // Calculate progress
        const cycleProgress = ((run.currentCycle - 1) / run.config.maxCycles) * 100;
        const phaseBonus = run.currentPhase === 'complete' ? (100 / run.config.maxCycles) : 0;
        progressFill.style.width = `${Math.min(cycleProgress + phaseBonus, 100)}%`;

        if (run.status === 'completed') {
          statusText.textContent = `All ${run.config.maxCycles} cycles completed`;
          progressFill.style.width = '100%';
          phaseSpan.textContent = 'Complete';
          resolve();
          return;
        }

        if (run.status === 'stopped') {
          statusText.textContent = 'Stopped by user';
          phaseSpan.textContent = 'Stopped';
          resolve();
          return;
        }

        if (run.status === 'failed') {
          statusText.textContent = `Failed: ${run.error || 'Unknown error'}`;
          phaseSpan.textContent = 'Failed';
          reject(new Error(run.error || 'Auto-benchmark failed'));
          return;
        }

        // Still running, continue polling
        statusText.textContent = `${phaseLabels[run.currentPhase] || 'Processing'}`;
        setTimeout(poll, 2000);
      } catch (error) {
        reject(error);
      }
    };

    setTimeout(poll, 500);
  });
}

/**
 * Stop auto-benchmark (server-side).
 */
async function stopAutoBenchmark() {
  if (autoBenchmarkRunning && currentAutoBenchmarkRunId && currentRepo) {
    autoBenchmarkStopping = true;
    document.getElementById('stop-auto-benchmark-btn').textContent = 'Stopping...';
    document.getElementById('stop-auto-benchmark-btn').disabled = true;
    document.getElementById('auto-benchmark-phase').textContent = 'Stopping after current phase...';

    try {
      await fetch(`/api/repos/${currentRepo.id}/auto-benchmarks/${currentAutoBenchmarkRunId}/stop`, {
        method: 'POST',
      });
    } catch (error) {
      console.error('Failed to stop auto-benchmark:', error);
    }
  }
}

/**
 * Check for running auto-benchmark and resume UI polling on page load.
 * This ensures the UI reflects server state after a page refresh.
 */
async function checkAndResumeAutoBenchmark(repoId) {
  // Don't check if already running locally
  if (autoBenchmarkRunning) return;

  try {
    // Fetch auto-benchmark history to find any running runs
    const response = await fetch(`/api/repos/${repoId}/auto-benchmarks?limit=1`);
    if (!response.ok) return;

    const data = await response.json();
    const runs = data.runs || [];
    const runningRun = runs.find(r => r.status === 'running');

    if (!runningRun) return;

    // Found a running auto-benchmark - resume UI state
    autoBenchmarkRunning = true;
    autoBenchmarkStopping = false;
    currentAutoBenchmarkRunId = runningRun.id;

    const startBtn = document.getElementById('auto-benchmark-btn');
    const stopBtn = document.getElementById('stop-auto-benchmark-btn');
    const progressDiv = document.getElementById('auto-benchmark-progress');
    const cycleSpan = document.getElementById('auto-benchmark-cycle');
    const phaseSpan = document.getElementById('auto-benchmark-phase');
    const statusText = document.getElementById('auto-benchmark-status-text');
    const progressFill = document.getElementById('auto-benchmark-progress-fill');

    // Update UI to reflect running state
    startBtn.disabled = true;
    stopBtn.classList.remove('hidden');
    stopBtn.textContent = 'Stop';
    stopBtn.disabled = false;
    document.getElementById('auto-benchmark-iterations').disabled = true;
    document.getElementById('auto-benchmark-max-cycles').disabled = true;
    document.getElementById('auto-benchmark-include-quality').disabled = true;
    progressDiv.classList.remove('hidden');

    document.getElementById('run-benchmark-btn').disabled = true;
    document.getElementById('run-quality-benchmark-btn').disabled = true;
    document.getElementById('run-both-benchmarks-btn').disabled = true;

    statusText.textContent = 'Resuming auto-benchmark...';

    // Update form values to match the running config
    document.getElementById('auto-benchmark-iterations').value = runningRun.config.iterationsPerCycle;
    document.getElementById('auto-benchmark-max-cycles').value = runningRun.config.maxCycles;
    document.getElementById('auto-benchmark-include-quality').checked = runningRun.config.includeQuality;

    // Poll for status (async - don't await to allow page to continue loading)
    pollAutoBenchmarkStatus(repoId, runningRun.id, {
      cycleSpan,
      phaseSpan,
      statusText,
      progressFill,
      maxCycles: runningRun.config.maxCycles,
    }).then(async () => {
      // Reload benchmark history when complete
      await loadBenchmarkHistory(repoId);
    }).catch(error => {
      statusText.textContent = `Error: ${error.message}`;
      phaseSpan.textContent = 'Failed';
    }).finally(() => {
      autoBenchmarkRunning = false;
      currentAutoBenchmarkRunId = null;
      startBtn.disabled = false;
      stopBtn.classList.add('hidden');
      document.getElementById('auto-benchmark-iterations').disabled = false;
      document.getElementById('auto-benchmark-max-cycles').disabled = false;
      document.getElementById('auto-benchmark-include-quality').disabled = false;
      document.getElementById('run-benchmark-btn').disabled = false;
      document.getElementById('run-quality-benchmark-btn').disabled = false;
      document.getElementById('run-both-benchmarks-btn').disabled = false;
    });
  } catch (error) {
    console.error('Failed to check for running auto-benchmark:', error);
  }
}

/**
 * Run iterations and wait for completion.
 */
async function runIterationsAndWait(repoId, iterations, onProgress) {
  await api(`/repos/${repoId}/process`, {
    method: 'POST',
    body: JSON.stringify({ iterations }),
  });

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
  const response = await fetch(`/api/repos/${repoId}/benchmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (response.status === 409) {
    // Already running
  } else if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to start benchmark');
  }

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
  const response = await fetch(`/api/repos/${repoId}/quality-benchmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (response.status === 409) {
    // Already running
  } else if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to start quality benchmark');
  }

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

/**
 * Render the benchmark selector for self-improvement analysis.
 */
function renderBenchmarkSelector(accuracyBenchmarks) {
  const selector = document.getElementById('benchmark-selector');
  const runBtn = document.getElementById('run-self-improvement-btn');

  const completedBenchmarks = accuracyBenchmarks.filter(b => b.status === 'completed');

  if (completedBenchmarks.length === 0) {
    selector.innerHTML = '<p class="placeholder">Run benchmarks to enable analysis.</p>';
    runBtn.disabled = true;
    return;
  }

  completedBenchmarks.sort((a, b) => a.iterationCount - b.iterationCount);

  selector.innerHTML = completedBenchmarks.map(b => {
    const isSelected = selectedBenchmarkIds.has(b.id);
    const score = b.score ?? b.summary?.score ?? 0;
    return `
      <label class="benchmark-checkbox ${isSelected ? 'selected' : ''}" data-id="${b.id}">
        <input type="checkbox" ${isSelected ? 'checked' : ''}>
        <span class="benchmark-label">Iter ${b.iterationCount}</span>
        <span class="benchmark-score">${score.toFixed(0)}%</span>
      </label>
    `;
  }).join('');

  selector.querySelectorAll('.benchmark-checkbox input').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const label = e.target.closest('.benchmark-checkbox');
      const id = label.dataset.id;
      if (e.target.checked) {
        selectedBenchmarkIds.add(id);
        label.classList.add('selected');
      } else {
        selectedBenchmarkIds.delete(id);
        label.classList.remove('selected');
      }
      updateSelfImprovementButton();
    });
  });

  updateSelfImprovementButton();
}

/**
 * Update the self-improvement button state based on selection.
 */
function updateSelfImprovementButton() {
  const btn = document.getElementById('run-self-improvement-btn');
  btn.disabled = selectedBenchmarkIds.size < 2;
}

/**
 * Start a self-improvement analysis.
 */
async function runSelfImprovement() {
  if (!currentRepo || selectedBenchmarkIds.size < 2) return;

  const statusEl = document.getElementById('self-improvement-status');
  const reportEl = document.getElementById('self-improvement-report');
  const runBtn = document.getElementById('run-self-improvement-btn');

  statusEl.classList.remove('hidden');
  reportEl.classList.add('hidden');
  runBtn.disabled = true;

  try {
    const response = await api(`/repos/${currentRepo.id}/self-improvements`, {
      method: 'POST',
      body: JSON.stringify({ benchmarkRunIds: Array.from(selectedBenchmarkIds) }),
    });

    if (response.runId) {
      pollSelfImprovementStatus(response.runId);
    }
  } catch (error) {
    console.error('Failed to start self-improvement:', error);
    statusEl.innerHTML = `<p style="color: var(--error);">Failed to start analysis: ${escapeHtml(error.message)}</p>`;
    runBtn.disabled = false;
  }
}

/**
 * Poll for self-improvement analysis completion.
 */
function pollSelfImprovementStatus(runId) {
  const statusEl = document.getElementById('self-improvement-status');
  const reportEl = document.getElementById('self-improvement-report');
  const reportContent = document.getElementById('report-content');
  const runBtn = document.getElementById('run-self-improvement-btn');

  selfImprovementPollingInterval = setInterval(async () => {
    try {
      const response = await api(`/repos/${currentRepo.id}/self-improvements/${runId}`);
      const run = response.run;

      if (run.status === 'completed') {
        clearInterval(selfImprovementPollingInterval);
        selfImprovementPollingInterval = null;

        statusEl.classList.add('hidden');
        reportEl.classList.remove('hidden');
        reportContent.innerHTML = markdownToHtml(run.report);
        renderAnalysisTrace(run.analysisTrace);
        runBtn.disabled = false;

        initChatSession(runId);
      } else if (run.status === 'failed') {
        clearInterval(selfImprovementPollingInterval);
        selfImprovementPollingInterval = null;

        statusEl.innerHTML = `<p style="color: var(--error);">Analysis failed: ${escapeHtml(run.error || 'Unknown error')}</p>`;
        runBtn.disabled = false;
      }
    } catch (error) {
      console.error('Failed to poll self-improvement status:', error);
    }
  }, 3000);
}

/**
 * Select all benchmarks for analysis.
 */
function selectAllBenchmarks() {
  const selector = document.getElementById('benchmark-selector');
  selector.querySelectorAll('.benchmark-checkbox input').forEach(checkbox => {
    if (!checkbox.checked) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

/**
 * Clear benchmark selection.
 */
function clearBenchmarkSelection() {
  selectedBenchmarkIds.clear();
  const selector = document.getElementById('benchmark-selector');
  selector.querySelectorAll('.benchmark-checkbox').forEach(label => {
    label.classList.remove('selected');
    label.querySelector('input').checked = false;
  });
  updateSelfImprovementButton();
}

/**
 * Close the self-improvement report.
 */
function closeReport() {
  document.getElementById('self-improvement-report').classList.add('hidden');
  const traceSection = document.getElementById('analysis-trace-section');
  const traceContent = document.getElementById('analysis-trace-content');
  const toggleBtn = document.getElementById('toggle-trace-btn');
  traceSection.classList.add('hidden');
  traceContent.classList.add('hidden');
  toggleBtn.classList.remove('expanded');

  closeChatSession();
}

/**
 * Render the analysis trace if available.
 */
function renderAnalysisTrace(analysisTrace) {
  const traceSection = document.getElementById('analysis-trace-section');
  const traceContent = document.getElementById('analysis-trace-content');
  const traceSummary = document.getElementById('trace-summary');
  const toggleBtn = document.getElementById('toggle-trace-btn');
  const toggleText = toggleBtn.querySelector('.toggle-text');

  if (!analysisTrace || !analysisTrace.toolCalls || analysisTrace.toolCalls.length === 0) {
    traceSection.classList.add('hidden');
    return;
  }

  traceSection.classList.remove('hidden');
  traceContent.classList.add('hidden');
  toggleBtn.classList.remove('expanded');
  toggleText.textContent = 'Show Analysis Trace';

  const callCount = analysisTrace.toolCalls.length;
  const roundCount = analysisTrace.toolRounds;
  traceSummary.textContent = `${callCount} tool calls in ${roundCount} rounds`;

  traceContent.innerHTML = analysisTrace.toolCalls.map((call, index) => {
    const inputStr = typeof call.input === 'object'
      ? JSON.stringify(call.input, null, 2)
      : String(call.input);
    const resultStr = call.result || '(no result)';
    const truncatedResult = resultStr.length > 2000
      ? resultStr.substring(0, 2000) + '\n... (truncated)'
      : resultStr;

    return `
      <div class="trace-tool-call">
        <div class="trace-tool-header" data-index="${index}">
          <span class="tool-index">#${index + 1}</span>
          <span class="tool-name">${escapeHtml(call.name)}</span>
          <span class="tool-expand-icon">▶</span>
        </div>
        <div class="trace-tool-details hidden" data-index="${index}">
          <div class="detail-section">
            <div class="detail-label">Input</div>
            <div class="detail-content">${escapeHtml(inputStr)}</div>
          </div>
          <div class="detail-section">
            <div class="detail-label">Result</div>
            <div class="detail-content">${escapeHtml(truncatedResult)}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  traceContent.querySelectorAll('.trace-tool-header').forEach(header => {
    header.addEventListener('click', () => {
      const index = header.dataset.index;
      const details = traceContent.querySelector(`.trace-tool-details[data-index="${index}"]`);
      const isExpanded = !details.classList.contains('hidden');

      if (isExpanded) {
        details.classList.add('hidden');
        header.classList.remove('expanded');
      } else {
        details.classList.remove('hidden');
        header.classList.add('expanded');
      }
    });
  });
}

/**
 * Toggle the analysis trace visibility.
 */
function toggleAnalysisTrace() {
  const traceContent = document.getElementById('analysis-trace-content');
  const toggleBtn = document.getElementById('toggle-trace-btn');
  const toggleText = toggleBtn.querySelector('.toggle-text');
  const isExpanded = !traceContent.classList.contains('hidden');

  if (isExpanded) {
    traceContent.classList.add('hidden');
    toggleBtn.classList.remove('expanded');
    toggleText.textContent = 'Show Analysis Trace';
  } else {
    traceContent.classList.remove('hidden');
    toggleBtn.classList.add('expanded');
    toggleText.textContent = 'Hide Analysis Trace';
  }
}

/**
 * Initialize benchmark event listeners.
 */
function initBenchmarkListeners() {
  document.getElementById('run-benchmark-btn').addEventListener('click', runBenchmark);
  document.getElementById('run-quality-benchmark-btn').addEventListener('click', runQualityBenchmark);
  document.getElementById('run-both-benchmarks-btn').addEventListener('click', runBothBenchmarks);
  document.getElementById('close-benchmark-detail').addEventListener('click', () => {
    closeSidePanel('benchmark-detail');
  });
  document.getElementById('back-to-repos-benchmark').addEventListener('click', () => {
    stopBenchmarkPolling();
    stopAutoBenchmark();
    showView('repos');
    loadRepos();
  });
  document.getElementById('auto-benchmark-btn').addEventListener('click', runAutoBenchmark);
  document.getElementById('stop-auto-benchmark-btn').addEventListener('click', stopAutoBenchmark);
  document.getElementById('run-self-improvement-btn').addEventListener('click', runSelfImprovement);
  document.getElementById('select-all-benchmarks-btn').addEventListener('click', selectAllBenchmarks);
  document.getElementById('clear-benchmark-selection-btn').addEventListener('click', clearBenchmarkSelection);
  document.getElementById('close-report-btn').addEventListener('click', closeReport);
  document.getElementById('toggle-trace-btn').addEventListener('click', toggleAnalysisTrace);
}
