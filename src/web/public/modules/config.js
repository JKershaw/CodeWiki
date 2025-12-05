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
