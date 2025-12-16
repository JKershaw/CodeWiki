/**
 * Wiki module for CodeWiki frontend.
 * Handles wiki tree, page viewing, and wiki management.
 */

// Track expanded tree nodes (by path)
const expandedTreeNodes = new Set();

/**
 * Initialize the wiki page.
 * Called on page load when on the wiki page.
 */
async function initWikiPage() {
  const repoId = window.currentRepoId;
  if (!repoId) return;

  try {
    currentRepo = await api(`/repos/${repoId}`);
    document.getElementById('wiki-repo-name').textContent = currentRepo.fullName;

    // Load wikis for selector
    await loadWikiSelector(repoId);

    // Check if a specific page was requested via query parameter
    const urlParams = new URLSearchParams(window.location.search);
    const requestedPage = urlParams.get('page');
    if (requestedPage && currentWiki) {
      loadWikiPage(repoId, requestedPage, currentWiki.id);
    }
  } catch (error) {
    console.error('Failed to initialize wiki page:', error);
    document.getElementById('wiki-content').innerHTML = `<p class="placeholder">Error: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Load and populate the wiki selector dropdown.
 */
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
    updateDeleteWikiButton();
  } catch (error) {
    selector.innerHTML = '<option value="">Error loading wikis</option>';
    updateDeleteWikiButton();
  }
}

/**
 * Load wiki pages into the sidebar tree.
 */
async function loadWikiPages(repoId, wikiId) {
  const sidebar = document.getElementById('wiki-categories');
  sidebar.innerHTML = '<p class="loading">Loading...</p>';

  try {
    const url = wikiId ? `/repos/${repoId}/wiki-tree?wikiId=${wikiId}` : `/repos/${repoId}/wiki-tree`;
    const tree = await api(url);

    if (tree.length === 0) {
      sidebar.innerHTML = '<p class="placeholder">No pages yet</p>';
      return;
    }

    sidebar.innerHTML = `<div class="wiki-tree">${tree.map(node => renderTreeNode(node)).join('')}</div>`;

    // Add event listeners for tree interactions
    sidebar.querySelectorAll('.tree-node-header').forEach(header => {
      header.addEventListener('click', (e) => {
        const path = header.dataset.path;
        const hasPage = header.dataset.hasPage === 'true';
        const hasChildren = header.dataset.hasChildren === 'true';

        // If clicking the toggle area or node has no page, toggle expand/collapse
        if (e.target.closest('.tree-toggle') || !hasPage) {
          if (hasChildren) {
            toggleTreeNode(path);
          }
        } else {
          // Load the page
          loadWikiPage(repoId, path, wikiId);
        }
      });
    });
  } catch (error) {
    sidebar.innerHTML = `<p class="placeholder">Error: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Render a tree node and its children recursively.
 */
function renderTreeNode(node) {
  const hasChildren = node.children && node.children.length > 0;
  const hasPage = !!node.page;
  const isExpanded = expandedTreeNodes.has(node.path);
  const displayName = hasPage ? node.page.title : node.name;

  return `
    <div class="tree-node" data-path="${escapeHtml(node.path)}">
      <div class="tree-node-header"
           data-path="${escapeHtml(node.path)}"
           data-has-page="${hasPage}"
           data-has-children="${hasChildren}">
        <span class="tree-toggle ${hasChildren ? (isExpanded ? 'expanded' : '') : 'hidden'}">&#9654;</span>
        <span class="tree-node-name ${hasPage ? 'has-page' : 'no-page'}">${escapeHtml(displayName)}</span>
      </div>
      ${hasChildren ? `
        <div class="tree-children ${isExpanded ? 'expanded' : ''}" data-path="${escapeHtml(node.path)}">
          ${node.children.map(child => renderTreeNode(child)).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Toggle expansion of a tree node.
 */
function toggleTreeNode(path) {
  const childrenContainer = document.querySelector(`.tree-children[data-path="${CSS.escape(path)}"]`);
  const toggle = document.querySelector(`.tree-node-header[data-path="${CSS.escape(path)}"] .tree-toggle`);

  if (!childrenContainer) return;

  if (expandedTreeNodes.has(path)) {
    expandedTreeNodes.delete(path);
    childrenContainer.classList.remove('expanded');
    toggle?.classList.remove('expanded');
  } else {
    expandedTreeNodes.add(path);
    childrenContainer.classList.add('expanded');
    toggle?.classList.add('expanded');
  }
}

/**
 * Expand all ancestor nodes so the target path is visible.
 */
function expandParentNodes(path) {
  const segments = path.split('/');
  let currentPath = '';

  for (let i = 0; i < segments.length - 1; i++) {
    currentPath = currentPath ? `${currentPath}/${segments[i]}` : segments[i];

    if (!expandedTreeNodes.has(currentPath)) {
      const childrenContainer = document.querySelector(`.tree-children[data-path="${CSS.escape(currentPath)}"]`);
      const toggle = document.querySelector(`.tree-node-header[data-path="${CSS.escape(currentPath)}"] .tree-toggle`);

      if (childrenContainer) {
        expandedTreeNodes.add(currentPath);
        childrenContainer.classList.add('expanded');
        toggle?.classList.add('expanded');
      }
    }
  }
}

/**
 * Load and display a wiki page.
 */
async function loadWikiPage(repoId, path, wikiId) {
  const content = document.getElementById('wiki-content');
  content.innerHTML = '<p class="loading">Loading...</p>';

  // Update active state on tree headers
  document.querySelectorAll('.tree-node-header').forEach(header => {
    header.classList.toggle('active', header.dataset.path === path);
  });

  // Expand parent nodes to show the active page
  expandParentNodes(path);

  try {
    const url = wikiId ? `/repos/${repoId}/wiki/${path}?wikiId=${wikiId}` : `/repos/${repoId}/wiki/${path}`;
    const page = await api(url);
    currentPage = page;

    content.innerHTML = `
      <div class="wiki-body">${markdownToHtml(page.content)}</div>
      <div class="wiki-meta">
        ${renderMetadataPanel(page)}
      </div>
    `;

    // Add event listeners for collapsible sections
    content.querySelectorAll('.meta-section-header').forEach(header => {
      header.addEventListener('click', () => {
        const section = header.closest('.meta-section');
        section.classList.toggle('collapsed');
      });
    });
  } catch (error) {
    content.innerHTML = `<p class="placeholder">Error: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Render the full metadata panel for a wiki page.
 */
function renderMetadataPanel(page) {
  return `
    <!-- Overview Section -->
    <div class="meta-section">
      <div class="meta-section-header">
        <span class="meta-section-toggle">▼</span>
        <span class="meta-section-title">Overview</span>
      </div>
      <div class="meta-section-content">
        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">Confidence</span>
            <span class="meta-value">
              ${(page.confidence * 100).toFixed(0)}%
              <div class="confidence-bar">
                <div class="confidence-fill" style="width: ${page.confidence * 100}%"></div>
              </div>
            </span>
          </div>
          ${page.category ? `
          <div class="meta-item">
            <span class="meta-label">Category</span>
            <span class="meta-value">
              <span class="meta-badge">${escapeHtml(page.category)}</span>
              ${page.categoryConfidence ? `<span class="meta-confidence">(${(page.categoryConfidence * 100).toFixed(0)}% confidence)</span>` : ''}
            </span>
          </div>
          ` : ''}
          ${page.synthesisType ? `
          <div class="meta-item">
            <span class="meta-label">Page Type</span>
            <span class="meta-value"><span class="meta-badge synthesis">${escapeHtml(formatSynthesisType(page.synthesisType))}</span></span>
          </div>
          ` : ''}
          <div class="meta-item">
            <span class="meta-label">Created</span>
            <span class="meta-value">${new Date(page.createdAt).toLocaleString()}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Last Updated</span>
            <span class="meta-value">${new Date(page.updatedAt).toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Provenance Section -->
    <div class="meta-section">
      <div class="meta-section-header">
        <span class="meta-section-toggle">▼</span>
        <span class="meta-section-title">Provenance</span>
        <span class="meta-section-count">${page.sourceCommits.length + page.sourceAgentRunIds.length} sources</span>
      </div>
      <div class="meta-section-content">
        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">Source Commits</span>
            <span class="meta-value">${renderIdList(page.sourceCommits, 'commit')}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Agent Runs</span>
            <span class="meta-value">${renderIdList(page.sourceAgentRunIds, 'agent')}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- File Coverage Section -->
    <div class="meta-section${hasNoFileData(page) ? ' collapsed' : ''}">
      <div class="meta-section-header">
        <span class="meta-section-toggle">▼</span>
        <span class="meta-section-title">File Coverage</span>
        <span class="meta-section-count">${getTotalFileCount(page)} files</span>
      </div>
      <div class="meta-section-content">
        <div class="meta-grid">
          <div class="meta-item full-width">
            <span class="meta-label">Target Paths</span>
            <span class="meta-value">${renderPathList(page.targetPaths, 'Paths agents were asked to analyze')}</span>
          </div>
          <div class="meta-item full-width">
            <span class="meta-label">Files Accessed</span>
            <span class="meta-value">${renderPathList(page.filesAccessed, 'Files read by agents')}</span>
          </div>
          <div class="meta-item full-width">
            <span class="meta-label">Files Referenced</span>
            <span class="meta-value">${renderPathList(page.filesReferenced, 'Files mentioned in content')}</span>
          </div>
          ${page.brokenReferences && page.brokenReferences.length > 0 ? `
          <div class="meta-item full-width">
            <span class="meta-label">Broken References</span>
            <span class="meta-value">${renderPathList(page.brokenReferences, 'Invalid file references', true)}</span>
          </div>
          ` : ''}
        </div>
      </div>
    </div>

    <!-- Connections Section -->
    <div class="meta-section${hasNoConnections(page) ? ' collapsed' : ''}">
      <div class="meta-section-header">
        <span class="meta-section-toggle">▼</span>
        <span class="meta-section-title">Connections</span>
        <span class="meta-section-count">${page.links.length + page.backlinks.length} links</span>
      </div>
      <div class="meta-section-content">
        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">Links To</span>
            <span class="meta-value">${renderLinkList(page.links, 'Pages this page links to')}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Linked From</span>
            <span class="meta-value">${renderLinkList(page.backlinks, 'Pages linking to this page')}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Technical IDs Section (collapsed by default) -->
    <div class="meta-section collapsed">
      <div class="meta-section-header">
        <span class="meta-section-toggle">▼</span>
        <span class="meta-section-title">Technical Details</span>
      </div>
      <div class="meta-section-content">
        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">Page ID</span>
            <span class="meta-value"><code class="meta-id">${escapeHtml(page.id)}</code></span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Wiki ID</span>
            <span class="meta-value"><code class="meta-id">${escapeHtml(page.wikiId)}</code></span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Path</span>
            <span class="meta-value"><code class="meta-id">${escapeHtml(page.path)}</code></span>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Format synthesis type for display.
 */
function formatSynthesisType(type) {
  const typeLabels = {
    'project-overview': 'Project Overview',
    'getting-started': 'Getting Started Guide',
    'testing-guide': 'Testing Guide',
    'extension-guide': 'Extension Guide'
  };
  return typeLabels[type] || type;
}

/**
 * Render a list of IDs (commits or agent runs).
 */
function renderIdList(ids, type) {
  if (!ids || ids.length === 0) {
    return '<span class="meta-empty">None</span>';
  }
  const maxDisplay = 5;
  const displayed = ids.slice(0, maxDisplay);
  const remaining = ids.length - maxDisplay;

  let html = '<div class="meta-id-list">';
  displayed.forEach(id => {
    const shortId = id.length > 12 ? id.substring(0, 12) : id;
    html += `<code class="meta-id" title="${escapeHtml(id)}">${escapeHtml(shortId)}</code>`;
  });
  if (remaining > 0) {
    html += `<span class="meta-more">+${remaining} more</span>`;
  }
  html += '</div>';
  return html;
}

/**
 * Render a list of file paths.
 */
function renderPathList(paths, emptyText, isError = false) {
  if (!paths || paths.length === 0) {
    return `<span class="meta-empty">${emptyText ? 'None' : 'None'}</span>`;
  }
  const maxDisplay = 8;
  const displayed = paths.slice(0, maxDisplay);
  const remaining = paths.length - maxDisplay;

  let html = `<div class="meta-path-list${isError ? ' error' : ''}">`;
  displayed.forEach(path => {
    html += `<code class="meta-path" title="${escapeHtml(path)}">${escapeHtml(path)}</code>`;
  });
  if (remaining > 0) {
    html += `<span class="meta-more">+${remaining} more</span>`;
  }
  html += '</div>';
  return html;
}

/**
 * Render a list of wiki page links.
 */
function renderLinkList(links, emptyText) {
  if (!links || links.length === 0) {
    return `<span class="meta-empty">None</span>`;
  }
  const maxDisplay = 10;
  const displayed = links.slice(0, maxDisplay);
  const remaining = links.length - maxDisplay;

  let html = '<div class="meta-link-list">';
  displayed.forEach(link => {
    html += `<a href="#" class="meta-link" onclick="loadWikiPage(window.currentRepoId, '${escapeHtml(link)}', currentWiki?.id); return false;">${escapeHtml(link)}</a>`;
  });
  if (remaining > 0) {
    html += `<span class="meta-more">+${remaining} more</span>`;
  }
  html += '</div>';
  return html;
}

/**
 * Check if page has no file-related data.
 */
function hasNoFileData(page) {
  return (!page.targetPaths || page.targetPaths.length === 0) &&
         (!page.filesAccessed || page.filesAccessed.length === 0) &&
         (!page.filesReferenced || page.filesReferenced.length === 0) &&
         (!page.brokenReferences || page.brokenReferences.length === 0);
}

/**
 * Check if page has no connections.
 */
function hasNoConnections(page) {
  return (!page.links || page.links.length === 0) &&
         (!page.backlinks || page.backlinks.length === 0);
}

/**
 * Get total file count across all file arrays.
 */
function getTotalFileCount(page) {
  return (page.targetPaths?.length || 0) +
         (page.filesAccessed?.length || 0) +
         (page.filesReferenced?.length || 0);
}

/**
 * Update the delete wiki button state based on whether a wiki is selected.
 */
function updateDeleteWikiButton() {
  const deleteBtn = document.getElementById('delete-wiki-btn');
  if (!deleteBtn) return;

  if (!currentWiki) {
    deleteBtn.disabled = true;
    deleteBtn.title = 'No wiki selected';
  } else {
    deleteBtn.disabled = false;
    deleteBtn.title = 'Delete this wiki and all its data';
  }
}

/**
 * Show confirmation dialog and delete the current wiki if confirmed.
 */
async function confirmDeleteWiki() {
  if (!currentRepo || !currentWiki) {
    showToast('No wiki selected', 'error');
    return;
  }

  // Fetch wiki details to show in confirmation
  let wikiDetails;
  try {
    wikiDetails = await api(`/repos/${currentRepo.id}/wikis/${currentWiki.id}`);
  } catch (error) {
    // Fall back to current wiki info
    wikiDetails = currentWiki;
  }

  const pageCount = wikiDetails.pageCount || 0;

  showConfirmModal({
    title: 'Delete Wiki',
    message: `Are you sure you want to delete "${wikiDetails.name || 'this wiki'}"?`,
    details: `
      <div class="detail-item">
        <span class="detail-label">Wiki Name</span>
        <span class="detail-value">${escapeHtml(wikiDetails.name || currentWiki.id)}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Pages</span>
        <span class="detail-value">${pageCount}</span>
      </div>
      <p class="warning-text">This will permanently delete all wiki pages, findings, benchmarks, and other associated data. This action cannot be undone.</p>
    `,
    confirmText: 'Delete Wiki',
    confirmClass: 'danger',
    onConfirm: () => deleteWiki(currentRepo.id, currentWiki.id, wikiDetails.name),
  });
}

/**
 * Delete a wiki and refresh the UI.
 */
async function deleteWiki(repoId, wikiId, wikiName) {
  const deleteBtn = document.getElementById('delete-wiki-btn');
  const originalText = deleteBtn.textContent;
  deleteBtn.textContent = 'Deleting...';
  deleteBtn.disabled = true;

  try {
    await fetch(`/api/repos/${repoId}/wikis/${wikiId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete wiki');
      }
    });

    showToast(`Wiki "${wikiName}" deleted successfully`, 'success');

    // Refresh wiki selector and pages
    await loadWikiSelector(repoId);

    // If there are still wikis, load the first one
    const selector = document.getElementById('wiki-selector');
    if (selector.options.length > 0 && selector.value) {
      loadWikiPages(repoId, selector.value);
    } else {
      // No more wikis, go back to repos
      document.getElementById('wiki-content').innerHTML = '<p class="placeholder">No wikis available</p>';
      document.getElementById('wiki-categories').innerHTML = '<p class="placeholder">No pages</p>';
    }

    // Refresh repos list to update wiki counts
    loadRepos();

  } catch (error) {
    showToast(`Failed to delete wiki: ${error.message}`, 'error');
    deleteBtn.textContent = originalText;
    updateDeleteWikiButton();
  }
}

/**
 * Initialize wiki event listeners.
 */
function initWikiListeners() {
  // Wiki selector change handler
  document.getElementById('wiki-selector').addEventListener('change', async (e) => {
    if (currentRepo && e.target.value) {
      // Fetch the full wiki details to get isActive status
      try {
        const wiki = await api(`/repos/${currentRepo.id}/wikis/${e.target.value}`);
        currentWiki = wiki;
      } catch (error) {
        // Fall back to partial info if fetch fails
        currentWiki = { id: e.target.value, isActive: false };
      }
      loadWikiPages(currentRepo.id, e.target.value);
      updateDeleteWikiButton();
    }
  });

  // Delete wiki button
  document.getElementById('delete-wiki-btn').addEventListener('click', confirmDeleteWiki);
}
