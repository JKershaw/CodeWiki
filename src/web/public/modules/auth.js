/**
 * Authentication module for CodeWiki frontend.
 * Handles user authentication and login/logout UI.
 */

/**
 * Load current user from session.
 */
async function loadCurrentUser() {
  try {
    const response = await fetch('/auth/me');
    if (response.ok) {
      const data = await response.json();
      currentUser = data.user;
    } else {
      currentUser = null;
    }
  } catch (error) {
    console.log('Not authenticated');
    currentUser = null;
  }
  renderUserSection();
}

/**
 * Render the user section in the header.
 */
function renderUserSection() {
  const userSection = document.getElementById('user-section');
  if (!userSection) return;

  if (currentUser) {
    userSection.innerHTML = `
      <div class="user-info">
        <img src="${escapeHtml(currentUser.avatarUrl)}" alt="${escapeHtml(currentUser.login)}" class="user-avatar" />
        <span class="user-login">${escapeHtml(currentUser.login)}</span>
      </div>
      <button class="logout-btn" onclick="logout()">Logout</button>
    `;
  } else {
    // Check if GitHub auth is available by trying to get the installation URL
    fetch('/auth/github/installation')
      .then(response => {
        // Verify response is JSON (not HTML from catch-all route)
        const contentType = response.headers.get('content-type');
        if (response.ok && contentType && contentType.includes('application/json')) {
          return response.json().then(data => {
            // Verify we got a valid installation URL
            if (data && data.url) {
              userSection.innerHTML = `
                <a href="/auth/github" class="github-login-btn">
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                  </svg>
                  Login with GitHub
                </a>
              `;
            } else {
              userSection.innerHTML = '';
            }
          });
        } else {
          // GitHub auth not configured, hide the section
          userSection.innerHTML = '';
        }
      })
      .catch(() => {
        userSection.innerHTML = '';
      });
  }
}

/**
 * Log out the current user.
 */
function logout() {
  window.location.href = '/auth/logout';
}
