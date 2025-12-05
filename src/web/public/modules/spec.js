/**
 * Spec generation module for CodeWiki frontend.
 * Handles generating coding agent specifications.
 */

// Module state
let lastSpecResult = null;

/**
 * Open the spec view for a repository.
 */
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

/**
 * Submit a spec generation request.
 */
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

/**
 * Copy the spec to clipboard in markdown format.
 */
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

/**
 * Initialize spec event listeners.
 */
function initSpecListeners() {
  document.getElementById('submit-spec').addEventListener('click', submitSpec);
  document.getElementById('spec-task').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitSpec();
    }
  });
  document.getElementById('copy-spec').addEventListener('click', copySpec);
}
