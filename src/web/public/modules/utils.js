/**
 * Utility functions for CodeWiki frontend.
 */

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML string
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Convert markdown to HTML using the marked library.
 * Output is sanitized with DOMPurify to prevent XSS attacks.
 * Falls back to escaped HTML with basic formatting if libraries aren't loaded.
 *
 * @param {string} md - Markdown content to convert
 * @returns {string} Sanitized HTML string
 */
function markdownToHtml(md) {
  if (!md) return '';

  // Check if marked library is available
  if (typeof marked === 'undefined') {
    // Fallback: escape HTML and convert newlines to <br> for basic formatting
    const escaped = escapeHtml(md);
    return escaped.replace(/\n/g, '<br>');
  }

  // Configure marked for GitHub Flavored Markdown
  marked.setOptions({
    gfm: true,        // GitHub Flavored Markdown
    breaks: true,     // Convert \n to <br>
  });

  // Parse markdown and sanitize to prevent XSS
  const rawHtml = marked.parse(md);

  // Use DOMPurify if available, otherwise return raw HTML (already escaped by marked)
  if (typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(rawHtml);
  }
  return rawHtml;
}

/**
 * Format duration between two dates.
 * @param {string} startedAt - Start timestamp
 * @param {string} completedAt - End timestamp
 * @returns {string} Formatted duration string
 */
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

/**
 * Format agent type to human readable name.
 * @param {string} type - Agent type identifier
 * @returns {string} Human readable name
 */
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

/**
 * Get a human-readable priority label.
 * @param {number} priority - Priority value
 * @returns {string} Priority label
 */
function getPriorityLabel(priority) {
  if (priority >= 100) return 'Urgent';
  if (priority >= 80) return 'High';
  if (priority >= 50) return 'Normal';
  if (priority >= 20) return 'Low';
  return 'Background';
}

/**
 * Format grade to human readable string.
 * @param {string} grade - Grade identifier
 * @returns {string} Human readable grade
 */
function formatGrade(grade) {
  const labels = {
    'accurate': 'Accurate',
    'partial': 'Partial',
    'inaccurate': 'Inaccurate',
    'no_answer': 'No Answer',
  };
  return labels[grade] || grade;
}

/**
 * Format quality dimension name.
 * @param {string} dimension - Dimension identifier
 * @returns {string} Human readable dimension name
 */
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

/**
 * Truncate text to a maximum length.
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '... (truncated)';
}
