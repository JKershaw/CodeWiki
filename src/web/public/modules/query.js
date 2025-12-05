/**
 * Query module for CodeWiki frontend.
 * Handles asking questions about the wiki.
 */

/**
 * Open the query view for a repository.
 */
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

/**
 * Submit a query to the wiki.
 */
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

/**
 * Initialize query event listeners.
 */
function initQueryListeners() {
  document.getElementById('submit-query').addEventListener('click', submitQuery);
  document.getElementById('query-question').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitQuery();
    }
  });
}
