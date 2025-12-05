/**
 * Chat module for CodeWiki frontend.
 * Handles chat sessions for self-improvement analysis.
 */

// Module state
let currentChatSessionId = null;
let currentSelfImprovementRunId = null;
let chatTotalCost = 0;

/**
 * Initialize a chat session for the current self-improvement run.
 */
async function initChatSession(runId) {
  currentSelfImprovementRunId = runId;
  currentChatSessionId = null;
  chatTotalCost = 0;

  // Reset UI
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-chat-btn');
  const chatStatus = document.getElementById('chat-status');
  const chatCost = document.getElementById('chat-cost');

  chatMessages.innerHTML = `
    <div class="chat-welcome">
      <p>Ask questions about this analysis. The AI has access to the report and can investigate further using the same tools.</p>
    </div>
  `;
  chatInput.value = '';
  chatInput.disabled = true;
  sendBtn.disabled = true;
  chatStatus.textContent = 'Starting chat...';
  chatStatus.className = 'chat-status sending';
  chatCost.textContent = '';

  try {
    // Create a new chat session
    const response = await api(`/repos/${currentRepo.id}/self-improvements/${runId}/chat`, {
      method: 'POST',
    });

    currentChatSessionId = response.sessionId;
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatStatus.textContent = 'Ready';
    chatStatus.className = 'chat-status';

    // Focus the input
    chatInput.focus();
  } catch (error) {
    console.error('Failed to start chat session:', error);
    chatStatus.textContent = 'Failed to start chat';
    chatStatus.className = 'chat-status error';
  }
}

/**
 * Send a chat message.
 */
async function sendChatMessage() {
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-chat-btn');
  const chatStatus = document.getElementById('chat-status');
  const message = chatInput.value.trim();

  if (!message || !currentChatSessionId) return;

  // Add user message to UI
  appendChatMessage('user', message);
  chatInput.value = '';
  chatInput.disabled = true;
  sendBtn.disabled = true;

  // Show typing indicator
  showTypingIndicator();
  chatStatus.textContent = 'Thinking...';
  chatStatus.className = 'chat-status sending';

  try {
    const response = await api(
      `/repos/${currentRepo.id}/self-improvements/${currentSelfImprovementRunId}/chat/${currentChatSessionId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ message }),
      }
    );

    // Remove typing indicator and add response
    hideTypingIndicator();
    appendChatMessage('assistant', response.message.content, response.message.toolCalls);

    // Update cost display
    chatTotalCost += 0.05; // Approximate
    updateChatCost();

    chatStatus.textContent = 'Ready';
    chatStatus.className = 'chat-status';
  } catch (error) {
    console.error('Failed to send message:', error);
    hideTypingIndicator();
    appendChatError('Failed to get response: ' + error.message);
    chatStatus.textContent = 'Error';
    chatStatus.className = 'chat-status error';
  } finally {
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

/**
 * Append a message to the chat.
 */
function appendChatMessage(role, content, toolCalls) {
  const chatMessages = document.getElementById('chat-messages');

  // Remove welcome message if present
  const welcome = chatMessages.querySelector('.chat-welcome');
  if (welcome) {
    welcome.remove();
  }

  const messageHtml = role === 'user'
    ? `<div class="message-content">${escapeHtml(content)}</div>`
    : `<div class="message-content">${markdownToHtml(content)}</div>`;

  let toolCallsHtml = '';
  if (toolCalls && toolCalls.length > 0) {
    toolCallsHtml = `
      <div class="chat-tool-calls">
        <div class="chat-tool-calls-header" onclick="toggleChatToolCalls(this)">
          <span class="expand-icon">▶</span>
          <span>Used ${toolCalls.length} tool${toolCalls.length > 1 ? 's' : ''}</span>
        </div>
        <div class="chat-tool-calls-content hidden">
          ${toolCalls.map(call => `
            <div class="chat-tool-call">
              <span class="tool-name">${escapeHtml(call.name)}</span>
              <div class="tool-result">${escapeHtml(truncateText(call.result || '', 500))}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  const messageEl = document.createElement('div');
  messageEl.className = `chat-message ${role}`;
  messageEl.innerHTML = `
    ${messageHtml}
    ${toolCallsHtml}
  `;

  chatMessages.appendChild(messageEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Append an error message to the chat.
 */
function appendChatError(errorText) {
  const chatMessages = document.getElementById('chat-messages');
  const errorEl = document.createElement('div');
  errorEl.className = 'chat-message assistant';
  errorEl.innerHTML = `
    <div class="message-content" style="color: var(--error);">
      ⚠️ ${escapeHtml(errorText)}
    </div>
  `;
  chatMessages.appendChild(errorEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Show typing indicator.
 */
function showTypingIndicator() {
  const chatMessages = document.getElementById('chat-messages');
  const typingEl = document.createElement('div');
  typingEl.id = 'chat-typing-indicator';
  typingEl.className = 'chat-typing';
  typingEl.innerHTML = `
    <span class="dot"></span>
    <span class="dot"></span>
    <span class="dot"></span>
    <span style="margin-left: 8px;">AI is thinking...</span>
  `;
  chatMessages.appendChild(typingEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Hide typing indicator.
 */
function hideTypingIndicator() {
  const typingEl = document.getElementById('chat-typing-indicator');
  if (typingEl) {
    typingEl.remove();
  }
}

/**
 * Update the cost display.
 */
function updateChatCost() {
  const chatCost = document.getElementById('chat-cost');
  if (chatTotalCost > 0) {
    chatCost.textContent = `~$${chatTotalCost.toFixed(2)}`;
  }
}

/**
 * Toggle tool calls visibility in chat.
 */
function toggleChatToolCalls(header) {
  const content = header.nextElementSibling;
  const isExpanded = !content.classList.contains('hidden');

  if (isExpanded) {
    content.classList.add('hidden');
    header.classList.remove('expanded');
  } else {
    content.classList.remove('hidden');
    header.classList.add('expanded');
  }
}

/**
 * Close the current chat session.
 */
async function closeChatSession() {
  if (!currentChatSessionId) return;

  try {
    await api(
      `/repos/${currentRepo.id}/self-improvements/${currentSelfImprovementRunId}/chat/${currentChatSessionId}/close`,
      { method: 'POST' }
    );
  } catch (error) {
    console.error('Failed to close chat session:', error);
  }

  currentChatSessionId = null;
  currentSelfImprovementRunId = null;
  chatTotalCost = 0;
}

/**
 * Initialize chat event listeners.
 */
function initChatListeners() {
  document.getElementById('send-chat-btn').addEventListener('click', sendChatMessage);
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  document.getElementById('chat-input').addEventListener('input', (e) => {
    const sendBtn = document.getElementById('send-chat-btn');
    sendBtn.disabled = !e.target.value.trim() || !currentChatSessionId;
  });
}
