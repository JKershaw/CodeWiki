/**
 * Configuration module for CodeWiki frontend.
 * Handles model selection and configuration loading.
 */

/**
 * Load configuration and populate model selector.
 */
async function loadConfig() {
  try {
    const config = await api('/config/models');
    const selector = document.getElementById('model-selector');
    if (selector) {
      // Populate the dropdown with available models
      selector.innerHTML = config.models
        .map(
          (m) =>
            `<option value="${escapeHtml(m.id)}" ${m.id === config.current ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
        )
        .join('');

      // Add change handler
      selector.addEventListener('change', handleModelChange);
    }
  } catch (error) {
    console.error('Failed to load config:', error);
    const selector = document.getElementById('model-selector');
    if (selector) {
      selector.innerHTML = '<option value="">Failed to load</option>';
    }
  }
}

/**
 * Handle model selection change.
 */
async function handleModelChange(event) {
  const model = event.target.value;
  const selector = event.target;

  // Disable selector during update
  selector.disabled = true;

  try {
    await api('/config/model', {
      method: 'POST',
      body: JSON.stringify({ model }),
    });
    showToast('Model changed successfully', 'success');
  } catch (error) {
    console.error('Failed to change model:', error);
    showToast('Failed to change model', 'error');
    // Reload config to reset selector to actual value
    await loadConfig();
  } finally {
    selector.disabled = false;
  }
}

/**
 * Load and display version info in footer.
 */
async function loadVersionInfo() {
  const versionText = document.getElementById('version-text');
  if (!versionText) return;

  try {
    const info = await api('/config/version');
    const parts = [];

    // Always show version
    parts.push(`v${info.version}`);

    // Show commit hash if available
    if (info.commit) {
      parts.push(info.commit);
    }

    // Show release date/time if available (from Heroku dyno metadata)
    if (info.releasedAt) {
      const date = new Date(info.releasedAt);
      const formatted = date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      parts.push(formatted);
    }

    versionText.textContent = parts.join(' • ');
  } catch (error) {
    console.error('Failed to load version info:', error);
    versionText.textContent = 'Version unavailable';
  }
}
