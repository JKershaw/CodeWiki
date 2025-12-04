/**
 * API helper for CodeWiki frontend.
 */

/**
 * Make an API request to the backend.
 * @param {string} path - API path (without /api prefix)
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} Parsed JSON response
 * @throws {Error} If response is not ok
 */
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API Error');
  }
  return response.json();
}
