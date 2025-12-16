/**
 * Wiki module for CodeWiki frontend.
 * Handles wiki tree expand/collapse, wiki selection, and wiki deletion.
 *
 * Note: Page content and tree structure are now server-rendered.
 * This module only handles client-side UI interactions.
 */

// Track expanded tree nodes (by path) - persisted in memory during session
const expandedTreeNodes = new Set();

/**
 * Initialize the wiki page.
 * Called on page load when on the wiki page.
 */
function initWikiPage() {
  // Initialize current state from server-provided values
  if (window.currentWikiId) {
    currentWiki = { id: window.currentWikiId };
  }

  // Auto-expand tree to show current page
  if (window.currentPath) {
    expandParentNodes(window.currentPath);
  }

  // Initialize collapsible metadata sections
  initMetadataSections();
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
  if (!path) return;

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
 * Initialize collapsible metadata sections.
 */
function initMetadataSections() {
  document.querySelectorAll('.meta-section-header').forEach(header => {
    header.addEventListener('click', () => {
      const section = header.closest('.meta-section');
      section.classList.toggle('collapsed');
    });
  });
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
  if (!window.currentRepoId || !currentWiki) {
    showToast('No wiki selected', 'error');
    return;
  }

  // Fetch wiki details to show in confirmation
  let wikiDetails;
  try {
    wikiDetails = await api(`/repos/${window.currentRepoId}/wikis/${currentWiki.id}`);
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
    onConfirm: () => deleteWiki(window.currentRepoId, currentWiki.id, wikiDetails.name),
  });
}

/**
 * Delete a wiki and redirect to repos page.
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

    // Redirect to wiki page (will show remaining wikis or empty state)
    window.location.href = `/wiki/${repoId}`;

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
  // Tree node toggle handlers
  document.querySelectorAll('.tree-node-header').forEach(header => {
    header.addEventListener('click', (e) => {
      const path = header.dataset.path;
      const hasChildren = header.dataset.hasChildren === 'true';

      // If clicking the toggle area, toggle expand/collapse
      if (e.target.closest('.tree-toggle') && hasChildren) {
        e.preventDefault();
        toggleTreeNode(path);
      }
      // Links handle their own navigation via href
    });
  });

  // Wiki selector change handler - navigate to new URL
  const wikiSelector = document.getElementById('wiki-selector');
  if (wikiSelector) {
    wikiSelector.addEventListener('change', (e) => {
      if (e.target.value) {
        currentWiki = { id: e.target.value };
        // Navigate to wiki root with new wiki selected
        window.location.href = `/wiki/${window.currentRepoId}?wikiId=${e.target.value}`;
      }
      updateDeleteWikiButton();
    });
  }

  // Delete wiki button
  const deleteBtn = document.getElementById('delete-wiki-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', confirmDeleteWiki);
  }
}
