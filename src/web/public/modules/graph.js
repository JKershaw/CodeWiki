/**
 * Graph visualization module for CodeWiki frontend.
 * Displays wiki pages as an interactive force-directed graph.
 */

// Graph state
let cy = null; // Cytoscape instance
let eventSource = null; // SSE connection
let graphRepoId = null;
let graphWikiId = null;

// Category colors for node styling
const CATEGORY_COLORS = {
  architecture: '#4a90d9',
  guides: '#50c878',
  api: '#50c878',
  security: '#e74c3c',
  testing: '#9b59b6',
  commits: '#95a5a6',
  database: '#f39c12',
  deployment: '#1abc9c',
  documentation: '#3498db',
  configuration: '#7f8c8d',
  default: '#6c7a89',
};

// Color for orphaned nodes (no connections)
const ORPHAN_COLOR = '#e67e22';

/**
 * Initialize the graph visualization.
 */
async function initGraph(repoId, wikiId) {
  graphRepoId = repoId;
  graphWikiId = wikiId;

  const container = document.getElementById('graph-container');
  if (!container) return;

  // Show loading state
  container.innerHTML = '<p class="loading">Loading graph...</p>';

  // Check if Cytoscape is loaded
  if (typeof cytoscape === 'undefined') {
    container.innerHTML = '<p class="error">Graph library failed to load. Please refresh the page.</p>';
    return;
  }

  try {
    // Load graph data
    const url = wikiId
      ? `/repos/${repoId}/wiki-graph?wikiId=${wikiId}`
      : `/repos/${repoId}/wiki-graph`;
    const graph = await api(url);

    // Clear loading state
    container.innerHTML = '';

    // Wait for container to be rendered with proper dimensions
    await new Promise(resolve => requestAnimationFrame(resolve));

    // Initialize Cytoscape
    cy = cytoscape({
      container,
      elements: transformGraphData(graph),
      style: getGraphStyles(),
      layout: getLayout(graph.nodes.length),
      minZoom: 0.1,
      maxZoom: 3,
      wheelSensitivity: 0.3,
    });

    // Set up interactions
    setupInteractions();

    // Update stats (include orphan count from transform)
    updateGraphStats({
      ...graph.stats,
      orphanCount: graph._orphanCount || 0,
    });

    // Connect to real-time updates
    connectToEvents(repoId, wikiId);

  } catch (error) {
    container.innerHTML = `<p class="error">Failed to load graph: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Truncate a label to a maximum length.
 */
function truncateLabel(label, maxLength = 25) {
  if (label.length <= maxLength) return label;
  return label.substring(0, maxLength - 1) + '…';
}

/**
 * Transform API graph data to Cytoscape format.
 */
function transformGraphData(graph) {
  const elements = [];
  let orphanCount = 0;

  // Add nodes
  for (const node of graph.nodes) {
    const totalLinks = (node.linkCount || 0) + (node.backlinkCount || 0);
    const isOrphan = totalLinks === 0;
    if (isOrphan) orphanCount++;

    elements.push({
      group: 'nodes',
      data: {
        id: node.id,
        label: node.title,
        shortLabel: truncateLabel(node.title),
        path: node.path,
        category: node.category || 'default',
        confidence: node.confidence,
        linkCount: node.linkCount || 0,
        backlinkCount: node.backlinkCount || 0,
        isOrphan: isOrphan,
        // Size based on connectivity
        size: Math.max(20, Math.min(60, 20 + totalLinks * 3)),
      },
    });
  }

  // Add edges
  for (const edge of graph.edges) {
    elements.push({
      group: 'edges',
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
      },
    });
  }

  // Store orphan count for stats
  graph._orphanCount = orphanCount;

  return elements;
}

/**
 * Get Cytoscape styles for graph elements.
 */
function getGraphStyles() {
  return [
    // Node styles - labels hidden by default for cleaner look
    {
      selector: 'node',
      style: {
        'label': '',
        'width': 'data(size)',
        'height': 'data(size)',
        'background-color': function(node) {
          // Orphaned nodes get special color
          if (node.data('isOrphan')) {
            return ORPHAN_COLOR;
          }
          const category = node.data('category');
          return CATEGORY_COLORS[category] || CATEGORY_COLORS.default;
        },
        'background-opacity': function(node) {
          // Orphans are more opaque to stand out
          if (node.data('isOrphan')) return 0.9;
          return 0.6 + node.data('confidence') * 0.4;
        },
        'border-width': 2,
        'border-color': function(node) {
          if (node.data('isOrphan')) {
            return '#d35400';
          }
          const category = node.data('category');
          return CATEGORY_COLORS[category] || CATEGORY_COLORS.default;
        },
        'font-size': '11px',
        'font-weight': 500,
        'text-valign': 'bottom',
        'text-margin-y': 8,
        'color': '#ecf0f1',
        'text-background-color': 'rgba(44, 62, 80, 0.85)',
        'text-background-opacity': 1,
        'text-background-padding': '4px',
        'text-background-shape': 'roundrectangle',
        'min-zoomed-font-size': 10,
      },
    },
    // Show truncated labels for larger/important nodes (high connectivity)
    {
      selector: 'node[size >= 35]',
      style: {
        'label': 'data(shortLabel)',
      },
    },
    // Orphan nodes - show label always to highlight they need attention
    {
      selector: 'node[?isOrphan]',
      style: {
        'label': 'data(shortLabel)',
        'border-style': 'dashed',
        'text-background-color': 'rgba(211, 84, 0, 0.85)',
      },
    },
    // Edge styles
    {
      selector: 'edge',
      style: {
        'width': 1.5,
        'line-color': '#5d6d7e',
        'target-arrow-color': '#5d6d7e',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'opacity': 0.5,
      },
    },
    // Highlighted node (selected)
    {
      selector: 'node:selected',
      style: {
        'border-width': 4,
        'border-color': '#3498db',
        'background-opacity': 1,
        'label': 'data(label)',
      },
    },
    // Show full label on hover
    {
      selector: 'node.hover',
      style: {
        'label': 'data(label)',
        'border-width': 3,
        'border-color': '#3498db',
        'z-index': 999,
      },
    },
    {
      selector: 'edge.highlighted',
      style: {
        'line-color': '#3498db',
        'target-arrow-color': '#3498db',
        'width': 2.5,
        'opacity': 1,
      },
    },
    // New node animation
    {
      selector: 'node.new',
      style: {
        'border-width': 4,
        'border-color': '#27ae60',
        'border-style': 'dashed',
        'label': 'data(shortLabel)',
      },
    },
    // Search highlighted
    {
      selector: 'node.highlighted',
      style: {
        'border-width': 4,
        'border-color': '#f1c40f',
        'background-opacity': 1,
        'label': 'data(label)',
      },
    },
  ];
}

/**
 * Get layout configuration based on graph size.
 */
function getLayout(nodeCount) {
  // Use different layouts based on graph size
  if (nodeCount < 10) {
    return {
      name: 'circle',
      padding: 50,
    };
  } else if (nodeCount < 50) {
    return {
      name: 'cose',
      animate: true,
      animationDuration: 500,
      nodeRepulsion: 8000,
      idealEdgeLength: 100,
      edgeElasticity: 100,
      padding: 50,
    };
  } else {
    // For large graphs, use a faster layout
    return {
      name: 'cose',
      animate: false,
      nodeRepulsion: 10000,
      idealEdgeLength: 150,
      edgeElasticity: 50,
      padding: 50,
      randomize: false,
    };
  }
}

/**
 * Set up graph interactions.
 */
function setupInteractions() {
  if (!cy) return;

  // Node hover - highlight connected edges
  cy.on('mouseover', 'node', (event) => {
    const node = event.target;
    node.addClass('hover');
    node.connectedEdges().addClass('highlighted');
  });

  cy.on('mouseout', 'node', (event) => {
    const node = event.target;
    node.removeClass('hover');
    node.connectedEdges().removeClass('highlighted');
  });

  // Node click - show details and navigate
  cy.on('tap', 'node', (event) => {
    const node = event.target;
    const path = node.data('path');

    // Show node details in tooltip
    showNodeTooltip(node);

    // Double-click to navigate to page
    if (event.originalEvent.detail === 2) {
      navigateToWikiPage(path);
    }
  });

  // Background click - hide tooltip
  cy.on('tap', (event) => {
    if (event.target === cy) {
      hideNodeTooltip();
    }
  });
}

/**
 * Show tooltip with node details.
 */
function showNodeTooltip(node) {
  const tooltip = document.getElementById('graph-tooltip');
  if (!tooltip) return;

  const data = node.data();
  const position = node.renderedPosition();
  const container = document.getElementById('graph-container');
  const containerRect = container.getBoundingClientRect();

  tooltip.innerHTML = `
    <div class="tooltip-header">${escapeHtml(data.label)}</div>
    <div class="tooltip-body">
      <div><strong>Path:</strong> ${escapeHtml(data.path)}</div>
      <div><strong>Category:</strong> ${escapeHtml(data.category)}</div>
      <div><strong>Confidence:</strong> ${Math.round(data.confidence * 100)}%</div>
      <div><strong>Links:</strong> ${data.linkCount} outgoing, ${data.backlinkCount} incoming</div>
    </div>
    <div class="tooltip-footer">Double-click to view page</div>
  `;

  tooltip.style.left = `${containerRect.left + position.x + 20}px`;
  tooltip.style.top = `${containerRect.top + position.y - 20}px`;
  tooltip.classList.remove('hidden');
}

/**
 * Hide the node tooltip.
 */
function hideNodeTooltip() {
  const tooltip = document.getElementById('graph-tooltip');
  if (tooltip) {
    tooltip.classList.add('hidden');
  }
}

/**
 * Navigate to a wiki page from graph node click.
 */
function navigateToWikiPage(path) {
  if (graphRepoId) {
    // Navigate to wiki page with the path as a query parameter
    window.location.href = `/wiki/${graphRepoId}?page=${encodeURIComponent(path)}`;
  }
}

/**
 * Update graph statistics display.
 */
function updateGraphStats(stats) {
  const statsEl = document.getElementById('graph-stats');
  if (!statsEl) return;

  const orphanWarning = stats.orphanCount > 0
    ? `<span class="orphan-stat"><strong>${stats.orphanCount}</strong> orphaned pages</span>`
    : '';

  statsEl.innerHTML = `
    <div class="stats-row">
      <span><strong>${stats.nodeCount}</strong> pages</span>
      <span><strong>${stats.edgeCount}</strong> links</span>
      <span><strong>${stats.avgLinks.toFixed(1)}</strong> avg links/page</span>
      ${orphanWarning}
    </div>
    <div class="graph-legend">
      <span class="legend-title">Legend:</span>
      <span class="legend-item">
        <span class="legend-dot" style="background: ${ORPHAN_COLOR}; border-style: dashed;"></span>
        Orphaned (needs links)
      </span>
      <span class="legend-item">
        <span class="legend-dot" style="background: ${CATEGORY_COLORS.architecture};"></span>
        Architecture
      </span>
      <span class="legend-item">
        <span class="legend-dot" style="background: ${CATEGORY_COLORS.guides};"></span>
        Guides
      </span>
      <span class="legend-item">
        <span class="legend-dot" style="background: ${CATEGORY_COLORS.security};"></span>
        Security
      </span>
      <span class="legend-item">
        <span class="legend-dot" style="background: ${CATEGORY_COLORS.testing};"></span>
        Testing
      </span>
      <span class="legend-item">
        <span class="legend-dot" style="background: ${CATEGORY_COLORS.commits};"></span>
        Commits
      </span>
      <span class="legend-item">
        <span class="legend-dot" style="background: ${CATEGORY_COLORS.default};"></span>
        Other
      </span>
      <span class="legend-size-info">
        (Size = link count)
      </span>
    </div>
  `;
}

/**
 * Connect to Server-Sent Events for real-time updates.
 */
function connectToEvents(repoId, wikiId) {
  // Close existing connection
  if (eventSource) {
    eventSource.close();
  }

  const url = wikiId
    ? `/api/repos/${repoId}/wiki-events?wikiId=${wikiId}`
    : `/api/repos/${repoId}/wiki-events`;

  eventSource = new EventSource(url);

  eventSource.addEventListener('connected', (event) => {
    console.log('Connected to wiki events:', JSON.parse(event.data));
    updateConnectionStatus(true);
  });

  eventSource.addEventListener('page-created', (event) => {
    const data = JSON.parse(event.data);
    handlePageCreated(data);
  });

  eventSource.addEventListener('page-updated', (event) => {
    const data = JSON.parse(event.data);
    handlePageUpdated(data);
  });

  eventSource.addEventListener('page-deleted', (event) => {
    const data = JSON.parse(event.data);
    handlePageDeleted(data);
  });

  eventSource.addEventListener('link-added', (event) => {
    const data = JSON.parse(event.data);
    handleLinkAdded(data);
  });

  eventSource.addEventListener('link-removed', (event) => {
    const data = JSON.parse(event.data);
    handleLinkRemoved(data);
  });

  eventSource.onerror = () => {
    updateConnectionStatus(false);
  };
}

/**
 * Handle page created event - add new node to graph.
 */
function handlePageCreated(event) {
  if (!cy) return;

  const { page } = event;

  // Check if node already exists
  if (cy.getElementById(page.id).length > 0) return;

  // Add new node
  cy.add({
    group: 'nodes',
    data: {
      id: page.id,
      label: page.title,
      path: page.path,
      category: page.category || 'default',
      confidence: page.confidence,
      linkCount: 0,
      backlinkCount: 0,
      size: 20,
    },
    classes: 'new',
  });

  // Animate the new node
  const newNode = cy.getElementById(page.id);
  setTimeout(() => {
    newNode.removeClass('new');
  }, 3000);

  // Re-run layout with animation
  cy.layout({
    name: 'cose',
    animate: true,
    animationDuration: 300,
    fit: false,
    randomize: false,
  }).run();

  // Update stats
  refreshGraphStats();
}

/**
 * Handle page updated event - update existing node.
 */
function handlePageUpdated(event) {
  if (!cy) return;

  const { page } = event;
  const node = cy.getElementById(page.id);

  if (node.length > 0) {
    node.data('label', page.title);
    node.data('category', page.category || 'default');
    node.data('confidence', page.confidence);
  }
}

/**
 * Handle page deleted event - remove node from graph.
 */
function handlePageDeleted(event) {
  if (!cy) return;

  const node = cy.getElementById(event.pageId);
  if (node.length > 0) {
    // Remove connected edges first
    node.connectedEdges().remove();
    node.remove();
  }

  // Update stats
  refreshGraphStats();
}

/**
 * Handle link added event - add new edge to graph.
 */
function handleLinkAdded(event) {
  if (!cy) return;

  const edgeId = `${event.sourcePageId}->${event.targetPageId}`;

  // Check if edge already exists
  if (cy.getElementById(edgeId).length > 0) return;

  // Check if both nodes exist
  if (cy.getElementById(event.sourcePageId).length === 0) return;
  if (cy.getElementById(event.targetPageId).length === 0) return;

  // Add new edge
  cy.add({
    group: 'edges',
    data: {
      id: edgeId,
      source: event.sourcePageId,
      target: event.targetPageId,
    },
  });

  // Update link counts
  const sourceNode = cy.getElementById(event.sourcePageId);
  const targetNode = cy.getElementById(event.targetPageId);
  sourceNode.data('linkCount', (sourceNode.data('linkCount') || 0) + 1);
  targetNode.data('backlinkCount', (targetNode.data('backlinkCount') || 0) + 1);

  // Update node sizes
  updateNodeSize(sourceNode);
  updateNodeSize(targetNode);

  // Update stats
  refreshGraphStats();
}

/**
 * Handle link removed event - remove edge from graph.
 */
function handleLinkRemoved(event) {
  if (!cy) return;

  const edgeId = `${event.sourcePageId}->${event.targetPageId}`;
  const edge = cy.getElementById(edgeId);

  if (edge.length > 0) {
    edge.remove();

    // Update link counts
    const sourceNode = cy.getElementById(event.sourcePageId);
    const targetNode = cy.getElementById(event.targetPageId);
    if (sourceNode.length > 0) {
      sourceNode.data('linkCount', Math.max(0, (sourceNode.data('linkCount') || 0) - 1));
      updateNodeSize(sourceNode);
    }
    if (targetNode.length > 0) {
      targetNode.data('backlinkCount', Math.max(0, (targetNode.data('backlinkCount') || 0) - 1));
      updateNodeSize(targetNode);
    }

    // Update stats
    refreshGraphStats();
  }
}

/**
 * Update node size based on connectivity.
 */
function updateNodeSize(node) {
  const linkCount = node.data('linkCount') || 0;
  const backlinkCount = node.data('backlinkCount') || 0;
  const size = Math.max(20, Math.min(60, 20 + (linkCount + backlinkCount) * 3));
  node.data('size', size);
}

/**
 * Refresh graph statistics.
 */
function refreshGraphStats() {
  if (!cy) return;

  const nodeCount = cy.nodes().length;
  const edgeCount = cy.edges().length;
  const avgLinks = nodeCount > 0 ? edgeCount / nodeCount : 0;

  // Count orphaned nodes
  let orphanCount = 0;
  cy.nodes().forEach(node => {
    if (node.data('isOrphan')) orphanCount++;
  });

  updateGraphStats({
    nodeCount,
    edgeCount,
    avgLinks,
    orphanCount,
  });
}

/**
 * Update connection status indicator.
 */
function updateConnectionStatus(connected) {
  const indicator = document.getElementById('graph-connection-status');
  if (indicator) {
    indicator.className = connected ? 'status-connected' : 'status-disconnected';
    indicator.title = connected ? 'Connected - receiving live updates' : 'Disconnected';
  }
}

/**
 * Disconnect from events.
 */
function disconnectFromEvents() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  updateConnectionStatus(false);
}

/**
 * Re-center the graph.
 */
function centerGraph() {
  if (cy) {
    cy.fit(50);
  }
}

/**
 * Toggle layout between force-directed and hierarchical.
 */
function toggleLayout() {
  if (!cy) return;

  const currentLayout = cy.options().layout?.name;

  if (currentLayout === 'cose' || currentLayout === 'circle') {
    // Switch to breadthfirst (hierarchical)
    cy.layout({
      name: 'breadthfirst',
      directed: true,
      padding: 50,
      animate: true,
      animationDuration: 500,
    }).run();
  } else {
    // Switch back to cose (force-directed)
    cy.layout(getLayout(cy.nodes().length)).run();
  }
}

/**
 * Filter graph by category.
 */
function filterByCategory(category) {
  if (!cy) return;

  if (category === 'all') {
    cy.nodes().show();
    cy.edges().show();
  } else {
    cy.nodes().forEach(node => {
      if (node.data('category') === category) {
        node.show();
        node.connectedEdges().show();
      } else {
        node.hide();
      }
    });
  }
}

/**
 * Search and highlight nodes by label.
 */
function searchNodes(query) {
  if (!cy || !query) {
    cy?.nodes().removeClass('highlighted');
    return;
  }

  const lowerQuery = query.toLowerCase();

  cy.nodes().forEach(node => {
    const label = node.data('label').toLowerCase();
    const path = node.data('path').toLowerCase();

    if (label.includes(lowerQuery) || path.includes(lowerQuery)) {
      node.addClass('highlighted');
      // Center on first match
      if (cy.nodes('.highlighted').length === 1) {
        cy.animate({
          center: { eles: node },
          duration: 300,
        });
      }
    } else {
      node.removeClass('highlighted');
    }
  });
}

/**
 * Clean up graph resources.
 */
function destroyGraph() {
  disconnectFromEvents();
  if (cy) {
    cy.destroy();
    cy = null;
  }
  graphRepoId = null;
  graphWikiId = null;
}

/**
 * Initialize the graph page.
 * Called on page load when on the graph page.
 */
async function initGraphPage() {
  const repoId = window.currentRepoId;
  if (!repoId) return;

  try {
    currentRepo = await api(`/repos/${repoId}`);
    document.getElementById('graph-repo-name').textContent = currentRepo.fullName;

    // Get the active wiki for this repo
    const wikis = await api(`/repos/${repoId}/wikis`);
    const activeWiki = wikis.find(w => w.isActive) || wikis[0];

    if (activeWiki) {
      currentWiki = activeWiki;

      // Populate category filter
      try {
        const graph = await api(`/repos/${repoId}/wiki-graph?wikiId=${activeWiki.id}`);
        const categoryFilter = document.getElementById('graph-category-filter');
        if (categoryFilter && graph.stats.categories.length > 0) {
          categoryFilter.innerHTML = `
            <option value="all">All Categories</option>
            ${graph.stats.categories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('')}
          `;
        }
      } catch (e) {
        // Ignore category filter error
      }

      // Initialize the graph
      await initGraph(repoId, activeWiki.id);
    } else {
      document.getElementById('graph-container').innerHTML = '<p class="placeholder">No wiki available. Process the repository first.</p>';
    }
  } catch (error) {
    console.error('Failed to initialize graph page:', error);
    document.getElementById('graph-container').innerHTML = `<p class="placeholder">Error: ${escapeHtml(error.message)}</p>`;
  }
}

/**
 * Initialize graph event listeners.
 */
function initGraphListeners() {
  // Center button
  document.getElementById('graph-center-btn')?.addEventListener('click', centerGraph);

  // Layout toggle
  document.getElementById('graph-layout-btn')?.addEventListener('click', toggleLayout);

  // Category filter
  document.getElementById('graph-category-filter')?.addEventListener('change', (e) => {
    filterByCategory(e.target.value);
  });

  // Search
  document.getElementById('graph-search')?.addEventListener('input', (e) => {
    searchNodes(e.target.value);
  });

  // Refresh button
  document.getElementById('graph-refresh-btn')?.addEventListener('click', () => {
    if (graphRepoId) {
      initGraph(graphRepoId, graphWikiId);
    }
  });
}
