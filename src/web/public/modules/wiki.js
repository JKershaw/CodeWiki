/**
 * Wiki module for CodeWiki frontend.
 * Handles wiki tree, page viewing, and wiki management.
 */

// Track expanded tree nodes (by path)
const expandedTreeNodes = new Set();

/**
 * Open the wiki view for a repository.
 */
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
