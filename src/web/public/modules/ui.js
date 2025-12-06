/**
 * UI utilities for CodeWiki frontend.
 * Toast notifications and modal dialogs.
 */

// ============================================================================
// Toast Notifications
// ============================================================================

/**
 * Show a toast notification.
 * @param {string} message - The message to display
 * @param {'success' | 'error' | 'warning' | 'info'} type - The type of toast
 * @param {number} duration - Duration in ms before auto-dismiss (default: 4000)
 */
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');

  const icons = {
    success: '&#10003;', // checkmark
    error: '&#10005;',   // X
    warning: '&#9888;',  // warning triangle
    info: '&#8505;',     // info
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type]}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Close">&times;</button>
  `;

  // Close button handler
  toast.querySelector('.toast-close').addEventListener('click', () => {
    dismissToast(toast);
  });

  container.appendChild(toast);

  // Auto-dismiss after duration
  if (duration > 0) {
    setTimeout(() => {
      dismissToast(toast);
    }, duration);
  }

  return toast;
}

/**
 * Dismiss a toast with animation.
 * @param {HTMLElement} toast - Toast element to dismiss
 */
function dismissToast(toast) {
  if (!toast || toast.classList.contains('toast-exit')) return;

  toast.classList.add('toast-exit');
  setTimeout(() => {
    toast.remove();
  }, 300); // Match animation duration
}

// ============================================================================
// Confirmation Modal
// ============================================================================

let modalConfirmCallback = null;

/**
 * Show a confirmation modal.
 * @param {Object} options - Modal configuration
 * @param {string} options.title - Modal title
 * @param {string} options.message - Modal message
 * @param {string} options.details - HTML for the details section (optional)
 * @param {string} options.confirmText - Text for the confirm button (default: 'Confirm')
 * @param {string} options.confirmClass - CSS class for confirm button (default: 'danger')
 * @param {Function} options.onConfirm - Callback when confirmed
 */
function showConfirmModal(options) {
  const modal = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('modal-title');
  const messageEl = document.getElementById('modal-message');
  const detailsEl = document.getElementById('modal-details');
  const confirmBtn = document.getElementById('modal-confirm-btn');

  titleEl.textContent = options.title || 'Confirm Action';
  messageEl.textContent = options.message || 'Are you sure?';
  detailsEl.innerHTML = options.details || '';
  detailsEl.style.display = options.details ? 'block' : 'none';

  confirmBtn.textContent = options.confirmText || 'Confirm';
  confirmBtn.className = `btn ${options.confirmClass || 'danger'}`;

  modalConfirmCallback = options.onConfirm || null;

  modal.classList.remove('hidden');

  // Focus the cancel button for safety
  document.getElementById('modal-cancel-btn').focus();
}

/**
 * Hide the confirmation modal.
 */
function hideConfirmModal() {
  const modal = document.getElementById('confirm-modal');
  modal.classList.add('hidden');
  modalConfirmCallback = null;
}

/**
 * Initialize modal event listeners.
 * Call this once when the DOM is ready.
 */
function initModalListeners() {
  document.getElementById('modal-cancel-btn').addEventListener('click', hideConfirmModal);
  document.getElementById('modal-confirm-btn').addEventListener('click', () => {
    if (modalConfirmCallback) {
      modalConfirmCallback();
    }
    hideConfirmModal();
  });

  // Close modal on backdrop click
  document.getElementById('confirm-modal').addEventListener('click', (e) => {
    if (e.target.id === 'confirm-modal') {
      hideConfirmModal();
    }
  });

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('confirm-modal');
      if (!modal.classList.contains('hidden')) {
        hideConfirmModal();
      }
    }
  });
}

// ============================================================================
// Side Panel Utilities (for mobile-friendly detail panels)
// ============================================================================

const MOBILE_BREAKPOINT = 768;

/**
 * Check if we're on a mobile-sized viewport.
 * @returns {boolean}
 */
function isMobileViewport() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

/**
 * Open a side panel with backdrop on mobile.
 * @param {HTMLElement|string} panel - The panel element or its ID
 */
function openSidePanel(panel) {
  if (typeof panel === 'string') {
    panel = document.getElementById(panel);
  }
  if (!panel) return;

  panel.classList.remove('hidden');

  // On mobile, show backdrop and lock body scroll
  if (isMobileViewport()) {
    const backdrop = document.getElementById('side-panel-backdrop');
    if (backdrop) {
      backdrop.classList.add('active');
    }
    document.body.classList.add('side-panel-open');
  }
}

/**
 * Close a side panel and remove backdrop.
 * @param {HTMLElement|string} panel - The panel element or its ID
 */
function closeSidePanel(panel) {
  if (typeof panel === 'string') {
    panel = document.getElementById(panel);
  }
  if (!panel) return;

  panel.classList.add('hidden');

  // Remove backdrop and unlock body scroll
  const backdrop = document.getElementById('side-panel-backdrop');
  if (backdrop) {
    backdrop.classList.remove('active');
  }
  document.body.classList.remove('side-panel-open');
}

/**
 * Initialize side panel backdrop click handler.
 * Call this once when the DOM is ready.
 */
function initSidePanelListeners() {
  const backdrop = document.getElementById('side-panel-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      // Close any open side panels
      document.querySelectorAll('.benchmark-detail:not(.hidden), .debug-detail-panel:not(.hidden)').forEach(panel => {
        closeSidePanel(panel);
      });
    });
  }

  // Also close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.benchmark-detail:not(.hidden), .debug-detail-panel:not(.hidden)').forEach(panel => {
        closeSidePanel(panel);
      });
    }
  });
}
