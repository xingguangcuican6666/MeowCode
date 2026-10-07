export const CLIENT_APP_JS = `/**
 * MeowCode WebUI Client Application (M3E Edition)
 */
(function() {
  const sdk = window.MeowSDK;
  if (!sdk) {
    console.error('MeowSDK not found');
    return;
  }

  // DOM Elements
  const chatTranscript = document.querySelector('#chat-transcript');
  const chatWelcome = document.querySelector('#chat-welcome');
  const promptInput = document.querySelector('#prompt-input');
  const sendBtn = document.querySelector('#send-btn');
  const abortBtn = document.querySelector('#abort-btn');
  const newSessionBtn = document.querySelector('#new-session-btn');
  const sidebarSessionList = document.querySelector('#sidebar-session-list');
  const toggleSidebarBtn = document.querySelector('#toggle-sidebar-btn');
  const appSidebar = document.querySelector('#app-sidebar');
  const chatView = document.querySelector('#chat-view');
  const customPanelView = document.querySelector('#custom-panel-view');
  const connectionStatus = document.querySelector('#connection-status');
  const agentActivityStatus = document.querySelector('#agent-activity-status');
  const demoShowcaseBtn = document.querySelector('#demo-showcase-btn');
  const heroDemoBtn = document.querySelector('#hero-demo-btn');
  const heroFilesBtn = document.querySelector('#hero-files-btn');
  const heroTestBtn = document.querySelector('#hero-test-btn');
  const heroToolsBtn = document.querySelector('#hero-tools-btn');
  const heroDemoCard = document.querySelector('#hero-demo-card');
  const heroFilesCard = document.querySelector('#hero-files-card');
  const heroTestCard = document.querySelector('#hero-test-card');
  const heroToolsCard = document.querySelector('#hero-tools-card');
  const mentionFileBtn = document.querySelector('#mention-file-btn');
  const slashCmdBtn = document.querySelector('#slash-cmd-btn');
  const brandHomeBtn = document.querySelector('#brand-home-btn');

  // Theme Elements
  const themeSwitch = document.querySelector('#theme-switch');
  const themeLightBtn = document.querySelector('#theme-btn-light');
  const themeDarkBtn = document.querySelector('#theme-btn-dark');
  const themeSystemBtn = document.querySelector('#theme-btn-system');

  // App State
  let currentSessionId = '';
  let messages = [];
  let isRunning = false;
  let activeTurnAssistantEl = null;
  let activeTurnThinkingBody = null;
  let activeTurnThinkingCard = null;
  let currentToolCards = new Map();
  let appConfig = {};
  let currentUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, turns: 0 };
  let slotCleanups = [];

  // Expose session access to plugins
  sdk.session = {
    getMessages: () => messages,
    getSessionId: () => currentSessionId,
  };

  // --- Theme Switching ---
  function updateThemeUI(mode) {
    if (themeLightBtn) themeLightBtn.classList.toggle('active', mode === 'light');
    if (themeDarkBtn) themeDarkBtn.classList.toggle('active', mode === 'dark');
    if (themeSystemBtn) themeSystemBtn.classList.toggle('active', mode === 'system');
  }

  if (themeSwitch) {
    themeSwitch.onclick = () => {
      const next = sdk.theme.getEffectiveTheme() === 'dark' ? 'light' : 'dark';
      sdk.theme.setTheme(next);
      sdk.ui.showToast({ message: next === 'light' ? 'Light Theme Active' : 'Dark Theme Active', type: 'info' });
    };
  }

  if (themeLightBtn) themeLightBtn.onclick = () => { sdk.theme.setTheme('light'); updateThemeUI('light'); };
  if (themeDarkBtn) themeDarkBtn.onclick = () => { sdk.theme.setTheme('dark'); updateThemeUI('dark'); };
  if (themeSystemBtn) themeSystemBtn.onclick = () => { sdk.theme.setTheme('system'); updateThemeUI('system'); };

  updateThemeUI(sdk.theme.getTheme());
  sdk.on('theme:change', ({ mode }) => updateThemeUI(mode));

  // --- Auto-resize Textarea ---
  function autoResizeInput() {
    promptInput.style.height = 'auto';
    const newHeight = Math.min(promptInput.scrollHeight, 180);
    promptInput.style.height = newHeight + 'px';
  }
  promptInput.addEventListener('input', autoResizeInput);

  // --- Input Shortcuts ---
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === 'Escape' && isRunning) {
      handleAbort();
    }
  });

  sendBtn.addEventListener('click', handleSend);
  abortBtn.addEventListener('click', handleAbort);
  newSessionBtn.addEventListener('click', handleNewSession);
  if (brandHomeBtn) brandHomeBtn.onclick = () => switchPanel('chat');

  const sidebarBackdrop = document.querySelector('#sidebar-backdrop');
  toggleSidebarBtn.addEventListener('click', () => {
    appSidebar.classList.toggle('collapsed');
  });
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => {
      appSidebar.classList.add('collapsed');
    });
  }

  // Auto-collapse sidebar on narrow screens on initial load
  if (window.innerWidth <= 768 && appSidebar) {
    appSidebar.classList.add('collapsed');
  }

  // --- Tab & Panel Switching ---
  function switchPanel(panelId) {
    if (window.innerWidth <= 768 && appSidebar) {
      appSidebar.classList.add('collapsed');
    }
    document.querySelectorAll('.sidebar-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === panelId);
    });

    if (panelId === 'chat') {
      chatView.style.display = 'flex';
      customPanelView.style.display = 'none';
      customPanelView.innerHTML = '';
      sdk.panels.setActivePanel('chat');
    } else {
      chatView.style.display = 'none';
      customPanelView.style.display = 'block';
      customPanelView.innerHTML = '';
      sdk.panels.setActivePanel(panelId);

      const panel = sdk.panels.getPanels().find(p => p.id === panelId);
      if (panel) {
        panel.render(customPanelView, { sdk, container: customPanelView });
      } else {
        customPanelView.innerHTML = '<div class="empty-state">Panel ' + panelId + ' not found</div>';
      }
    }
  }

  document.querySelectorAll('.sidebar-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchPanel(tab);
    });
  });

  sdk.on('panel:active', (panelId) => {
    switchPanel(panelId);
  });

  sdk.on('panel:registered', (panel) => {
    if (document.querySelector('.sidebar-tab-btn[data-tab="' + panel.id + '"]')) return;
    const tabContainer = document.querySelector('.sidebar-nav-tabs');
    if (tabContainer) {
      const btn = document.createElement('button');
      btn.className = 'sidebar-tab-btn';
      btn.setAttribute('data-tab', panel.id);
      const iconName = panel.icon || 'extension';
      btn.innerHTML = '<span class="material-symbols-outlined tab-icon">' + iconName + '</span><span class="tab-label">' + escapeHtml(panel.title) + '</span>';
      btn.addEventListener('click', () => switchPanel(panel.id));
      tabContainer.appendChild(btn);
    }
  });

  // --- Slot Mounting ---
  function renderAllSlots() {
    slotCleanups.forEach(fn => { try { fn(); } catch(e){} });
    slotCleanups = [];

    const slotElements = document.querySelectorAll('[data-slot]');
    const context = {
      session: {
        id: currentSessionId,
        title: 'Current Session',
        messages,
        usage: currentUsage,
      },
      config: appConfig,
      sdk,
    };

    slotElements.forEach(el => {
      const slotId = el.getAttribute('data-slot');
      if (slotId) {
        const cleanup = sdk.slots.renderSlot(slotId, el, context);
        if (typeof cleanup === 'function') slotCleanups.push(cleanup);
      }
    });
  }

  sdk.on('slot:registered', () => renderAllSlots());

  // --- Message Formatting & Markdown ---
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    const B = String.fromCharCode(96);
    // Code blocks with syntax header and copy button
    const codeBlockRe = new RegExp(B + '{3}([a-zA-Z0-9_-]*)[\\\\r\\\\n]+([\\\\s\\\\S]*?)' + B + '{3}', 'g');
    html = html.replace(codeBlockRe, (_m, lang, code) => {
      return '<div class="code-block-wrap"><div class="code-header"><span class="code-lang">' + (lang || 'code') + '</span><button class="copy-code-btn" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.innerText);window.MeowSDK.ui.showToast(\\'Copied code to clipboard\\')"><span class="material-symbols-outlined icon-xs">content_copy</span><span>Copy</span></button></div><pre class="code-body"><code>' + code + '</code></pre></div>';
    });
    // Inline code
    const inlineCodeRe = new RegExp(B + '([^' + B + ']+)' + B, 'g');
    html = html.replace(inlineCodeRe, '<code class="inline-code">$1</code>');
    // Bold
    const boldRe = new RegExp('\\\\*\\\\*([^\\\\*]+)\\\\*\\\\*', 'g');
    html = html.replace(boldRe, '<strong>$1</strong>');
    // Italic
    const italicRe = new RegExp('\\\\*([^\\\\*]+)\\\\*', 'g');
    html = html.replace(italicRe, '<em>$1</em>');
    // Lists
    const listRe = new RegExp('^[ \\\\t]*-[ \\\\t]+(.*)$', 'gm');
    html = html.replace(listRe, '<li>$1</li>');
    const ulRe = new RegExp('(<li>[\\\\s\\\\S]*?<\\\\/li>)', 'g');
    html = html.replace(ulRe, '<ul>$1</ul>');
    // Newlines outside code blocks
    const parts = html.split(/(<div class="code-block-wrap">[\\s\\S]*?<\\/div>)/);
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i].split('\\n').join('<br/>').split('\\r').join('');
    }
    return parts.join('');
  }

  function appendUserMessage(content) {
    if (chatWelcome) chatWelcome.style.display = 'none';

    const row = document.createElement('div');
    row.className = 'message-row user';

    row.innerHTML = \`
      <div class="message-meta-row">
        <span>You</span>
        <span>•</span>
        <span>\${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div class="message-bubble">
        <div class="message-text">\${escapeHtml(content)}</div>
        <div class="message-action-bar">
          <button class="msg-action-btn copy-msg-btn" title="Copy prompt">
            <span class="material-symbols-outlined icon-xs">content_copy</span>
            <span>Copy</span>
          </button>
        </div>
      </div>
      <div class="meow-slot message-actions-slot" data-slot="message:actions"></div>
    \`;

    const copyBtn = row.querySelector('.copy-msg-btn');
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(content);
        sdk.ui.showToast({ message: 'Copied prompt to clipboard', type: 'info' });
      };
    }

    chatTranscript.appendChild(row);
    scrollToBottom();
    return row;
  }

  function ensureAssistantCard() {
    if (activeTurnAssistantEl) return activeTurnAssistantEl;
    if (chatWelcome) chatWelcome.style.display = 'none';

    const row = document.createElement('div');
    row.className = 'message-row assistant';

    row.innerHTML = \`
      <div class="message-meta-row">
        <span style="display:inline-flex;align-items:center;gap:5px;">
          <span class="material-symbols-outlined assistant-avatar-icon">smart_toy</span>
          <span>MeowCode Assistant</span>
        </span>
        <span>•</span>
        <span>\${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div class="message-bubble assistant-bubble">
        <div class="assistant-content"></div>
        <div class="message-action-bar">
          <button class="msg-action-btn copy-msg-btn" title="Copy response">
            <span class="material-symbols-outlined icon-xs">content_copy</span>
            <span>Copy</span>
          </button>
          <button class="msg-action-btn retry-msg-btn" title="Regenerate">
            <span class="material-symbols-outlined icon-xs">refresh</span>
            <span>Retry</span>
          </button>
          <button class="msg-action-btn thumbs-up-btn" title="Helpful">
            <span class="material-symbols-outlined icon-xs">thumb_up</span>
          </button>
          <button class="msg-action-btn thumbs-down-btn" title="Not helpful">
            <span class="material-symbols-outlined icon-xs">thumb_down</span>
          </button>
        </div>
      </div>
      <div class="meow-slot message-footer-slot" data-slot="message:footer"></div>
    \`;

    const copyBtn = row.querySelector('.copy-msg-btn');
    if (copyBtn) {
      copyBtn.onclick = () => {
        const text = row.querySelector('.assistant-content')?.innerText || '';
        navigator.clipboard.writeText(text);
        sdk.ui.showToast({ message: 'Copied response to clipboard', type: 'info' });
      };
    }
    const retryBtn = row.querySelector('.retry-msg-btn');
    if (retryBtn) {
      retryBtn.onclick = () => {
        const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
        if (lastUser) {
          promptInput.value = lastUser;
          handleSend();
        }
      };
    }
    const thumbsUp = row.querySelector('.thumbs-up-btn');
    if (thumbsUp) {
      thumbsUp.onclick = () => {
        thumbsUp.classList.toggle('active');
        sdk.ui.showToast({ message: 'Marked as helpful', type: 'success' });
      };
    }
    const thumbsDown = row.querySelector('.thumbs-down-btn');
    if (thumbsDown) {
      thumbsDown.onclick = () => {
        thumbsDown.classList.toggle('active');
        sdk.ui.showToast({ message: 'Feedback noted', type: 'info' });
      };
    }

    chatTranscript.appendChild(row);
    activeTurnAssistantEl = row.querySelector('.assistant-content');
    scrollToBottom();
    return activeTurnAssistantEl;
  }

  function appendThinking(text) {
    const cardWrap = ensureAssistantCard();
    if (!activeTurnThinkingCard) {
      const card = document.createElement('div');
      card.className = 'thinking-card';
      card.innerHTML = \`
        <div class="thinking-header">
          <span style="display:inline-flex;align-items:center;gap:6px;">
            <span class="material-symbols-outlined icon-sm" style="color:var(--md-sys-color-primary);">psychology</span>
            <span>Reasoning & Exploration</span>
          </span>
          <span class="material-symbols-outlined thinking-toggle-icon icon-sm">expand_more</span>
        </div>
        <div class="thinking-body"></div>
      \`;
      const header = card.querySelector('.thinking-header');
      const body = card.querySelector('.thinking-body');
      header.addEventListener('click', () => {
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? 'block' : 'none';
        header.querySelector('.thinking-toggle-icon').textContent = isHidden ? 'expand_more' : 'chevron_right';
      });

      cardWrap.prepend(card);
      activeTurnThinkingCard = card;
      activeTurnThinkingBody = body;
    }

    if (activeTurnThinkingBody) {
      activeTurnThinkingBody.textContent += text;
      scrollToBottom();
    }
  }

  function appendAssistantText(chunk) {
    const container = ensureAssistantCard();
    if (activeTurnThinkingCard) {
      const pulse = activeTurnThinkingCard.querySelector('.thinking-pulse');
      if (pulse) pulse.style.animation = 'none';
    }

    let textNode = container.querySelector('.assistant-live-text');
    if (!textNode) {
      textNode = document.createElement('div');
      textNode.className = 'assistant-live-text';
      container.appendChild(textNode);
    }

    textNode.dataset.raw = (textNode.dataset.raw || '') + chunk;
    textNode.innerHTML = formatMarkdown(textNode.dataset.raw);
    scrollToBottom();
  }

  // --- M3 Collapsible Session Tasks Dock (Above Dialogue Box) ---
  let currentSessionTodos = [];
  let isTodoDockExpanded = false;

  function updateSessionTodoDock(todos) {
    const dock = document.querySelector('#todo-floating-dock');
    if (!dock) return;

    if (!Array.isArray(todos) || todos.length === 0) {
      currentSessionTodos = [];
      dock.style.display = 'none';
      return;
    }

    currentSessionTodos = todos;
    dock.style.display = 'block';

    const activeTaskPill = dock.querySelector('#todo-dock-active-pill');
    const activeTaskText = dock.querySelector('#todo-dock-active-text');
    const countBadge = dock.querySelector('#todo-dock-count-badge');
    const miniBar = dock.querySelector('#todo-dock-mini-bar');
    const itemsList = dock.querySelector('#todo-dock-items');

    const total = todos.length;
    const completed = todos.filter(t => t.status === 'completed').length;
    const percent = Math.round((completed / total) * 100);

    const inProgressTask = todos.find(t => t.status === 'in_progress');
    if (inProgressTask && activeTaskPill && activeTaskText) {
      activeTaskPill.style.display = 'inline-flex';
      const displayText = inProgressTask.activeForm || inProgressTask.content || '';
      activeTaskText.textContent = displayText;
      activeTaskText.title = displayText;
    } else if (activeTaskPill) {
      activeTaskPill.style.display = 'none';
    }

    if (countBadge) {
      const t = sdk.i18n ? sdk.i18n.t : (k, d) => d;
      countBadge.textContent = completed + ' / ' + total + ' ' + t('todo.done', 'Done') + ' (' + percent + '%)';
    }

    if (miniBar) {
      miniBar.style.width = percent + '%';
    }

    if (itemsList) {
      const t = sdk.i18n ? sdk.i18n.t : (k, d) => d;
      itemsList.innerHTML = todos.map(item => {
        const status = item.status || 'pending';
        const isDone = status === 'completed';
        const isProg = status === 'in_progress';
        const icon = isDone ? 'check_circle' : isProg ? 'sync' : 'radio_button_unchecked';
        const statusLabel = isDone ? t('todo.completed', 'Completed') : isProg ? t('todo.inProgress', 'In Progress') : t('todo.pending', 'Pending');
        const tagClass = isDone ? 'todo-tag-completed' : isProg ? 'todo-tag-progress' : 'todo-tag-pending';
        const displayText = isProg && item.activeForm ? item.activeForm : (item.content || '');

        return \`
          <div class="todo-item \${status}">
            <span class="material-symbols-outlined todo-item-icon \${isProg ? 'icon-spin' : ''}">\${icon}</span>
            <span class="todo-item-text">\${escapeHtml(displayText)}</span>
            <span class="todo-status-tag \${tagClass}">\${statusLabel}</span>
          </div>
        \`;
      }).join('');
    }
  }

  function toggleTodoDock(expand) {
    const dock = document.querySelector('#todo-floating-dock');
    const body = document.querySelector('#todo-dock-body');
    const chevron = document.querySelector('#todo-dock-chevron');
    if (!dock || !body) return;

    if (typeof expand === 'boolean') {
      isTodoDockExpanded = expand;
    } else {
      isTodoDockExpanded = !isTodoDockExpanded;
    }

    if (isTodoDockExpanded) {
      body.style.display = 'block';
      dock.classList.add('is-expanded');
      if (chevron) chevron.textContent = 'expand_more';
    } else {
      body.style.display = 'none';
      dock.classList.remove('is-expanded');
      if (chevron) chevron.textContent = 'expand_less';
    }
  }

  function handleToolUse(ev) {
    if (ev.name === 'todo_write') {
      let todos = [];
      const raw = ev.input?.todos;
      if (Array.isArray(raw)) {
        todos = raw;
      } else if (typeof raw === 'string') {
        try { todos = JSON.parse(raw); } catch (_) {}
      }
      updateSessionTodoDock(todos);
      return;
    }

    const container = ensureAssistantCard();
    const toolWrap = document.createElement('div');
    toolWrap.className = 'tool-wrap-entry';
    toolWrap.id = 'tool-use-' + ev.id;
    container.appendChild(toolWrap);

    currentToolCards.set(ev.id, {
      wrap: toolWrap,
      call: { id: ev.id, name: ev.name, input: ev.input || {} },
    });

    const customRenderer = sdk.tools.getRenderer(ev.name);
    if (customRenderer) {
      customRenderer.render(toolWrap, { id: ev.id, name: ev.name, input: ev.input || {} });
    } else {
      toolWrap.className = 'tool-card';
      toolWrap.innerHTML = \`
        <div class="terminal-header">
          <span style="display:inline-flex;align-items:center;gap:6px;">
            <span class="material-symbols-outlined icon-sm">terminal</span>
            <span>\${escapeHtml(ev.name)}</span>
          </span>
          <span class="tool-tag tag-running">Running...</span>
        </div>
        <pre class="terminal-output">\${escapeHtml(JSON.stringify(ev.input || {}, null, 2))}</pre>
      \`;
    }

    scrollToBottom();
  }

  function handleToolResult(ev) {
    if (ev.name === 'todo_write') return;
    const entry = currentToolCards.get(ev.id);
    if (!entry) return;
    if (entry.call.name === 'todo_write') {
      currentToolCards.delete(ev.id);
      return;
    }

    const resultData = {
      id: ev.id,
      name: entry.call.name,
      content: ev.content,
      display: ev.display,
      diff: ev.diff,
      isError: ev.isError,
    };

    const customRenderer = sdk.tools.getRenderer(entry.call.name);
    if (customRenderer) {
      entry.wrap.innerHTML = '';
      customRenderer.render(entry.wrap, entry.call, resultData);
    } else {
      const tag = entry.wrap.querySelector('.tool-tag');
      if (tag) {
        tag.className = 'tool-tag ' + (ev.isError ? 'tag-error' : 'tag-success');
        tag.textContent = ev.isError ? 'Failed' : 'Success';
      }
      if (ev.content || ev.display) {
        let resPre = entry.wrap.querySelector('.tool-result-output');
        if (!resPre) {
          resPre = document.createElement('pre');
          resPre.className = 'terminal-output tool-result-output';
          entry.wrap.appendChild(resPre);
        }
        resPre.textContent = ev.display || ev.content;
      }
    }

    scrollToBottom();
  }

  function renderExistingMessages(msgs) {
    chatTranscript.innerHTML = '';
    activeTurnAssistantEl = null;
    activeTurnThinkingCard = null;
    activeTurnThinkingBody = null;
    currentToolCards.clear();

    const validCount = Array.isArray(msgs) ? msgs.filter(m => m.content !== '__banner__').length : 0;
    sdk.emit('chat:messages', { count: validCount });

    // Extract latest todo list from session history
    let latestTodos = null;
    if (Array.isArray(msgs)) {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.meta?.toolName === 'todo_write' && m.meta?.toolInput?.todos) {
          latestTodos = m.meta.toolInput.todos;
          break;
        }
      }
    }
    updateSessionTodoDock(latestTodos);

    if (!msgs || msgs.length === 0) {
      if (chatWelcome) {
        chatTranscript.appendChild(chatWelcome);
        chatWelcome.style.display = 'flex';
      }
      return;
    }

    msgs.forEach(m => {
      if (m.content === '__banner__') return;
      if (m.role === 'user') {
        appendUserMessage(m.content);
      } else if (m.role === 'assistant') {
        if (m.meta?.thinking) {
          appendThinking(m.content);
        } else {
          appendAssistantText(m.content);
        }
      } else if (m.role === 'tool') {
        const toolName = m.meta?.toolName;
        // Do not display todo list in the chat transcript!
        if (toolName === 'todo_write' || (typeof m.content === 'string' && m.content.startsWith('● todo_write'))) {
          return;
        }

        const container = ensureAssistantCard();
        const div = document.createElement('div');
        const customRenderer = toolName ? sdk.tools.getRenderer(toolName) : null;
        if (customRenderer) {
          customRenderer.render(
            div,
            { id: m.id, name: toolName, input: m.meta?.toolInput || {} },
            {
              id: m.id,
              name: toolName,
              content: m.meta?.toolContent || m.content,
              display: m.meta?.toolDisplay,
              diff: m.meta?.diff,
              isError: Boolean(m.meta?.error),
            }
          );
        } else {
          div.className = 'tool-card';
          div.innerHTML = \`<div class="terminal-output">\${escapeHtml(m.content)}</div>\`;
        }
        container.appendChild(div);
      } else if (m.role === 'system' && m.meta?.error) {
        const errRow = document.createElement('div');
        errRow.className = 'message-row system';
        errRow.innerHTML = \`<div class="message-bubble">\${escapeHtml(m.content)}</div>\`;
        chatTranscript.appendChild(errRow);
      }
    });

    activeTurnAssistantEl = null;
    activeTurnThinkingCard = null;
    activeTurnThinkingBody = null;
    scrollToBottom();
  }

  function scrollToBottom() {
    chatTranscript.scrollTop = chatTranscript.scrollHeight;
  }

  // --- Send / Abort Turn ---
  async function handleSend() {
    const text = promptInput.value.trim();
    if (!text || isRunning) return;

    promptInput.value = '';
    autoResizeInput();
    appendUserMessage(text);
    sdk.emit('chat:messages', { count: (messages?.length || 0) + 1 });
    sdk.emit('turn:start', { prompt: text });

    activeTurnAssistantEl = null;
    activeTurnThinkingCard = null;
    activeTurnThinkingBody = null;
    currentToolCards.clear();

    setRunningState(true);

    try {
      await sdk.api.sendMessage(text);
    } catch (e) {
      sdk.ui.showToast({ message: 'Error: ' + e.message, type: 'error' });
      setRunningState(false);
    }
  }

  async function handleAbort() {
    if (!isRunning) return;
    try {
      await sdk.api.abort();
      sdk.ui.showToast({ message: 'Aborted generation', type: 'info' });
    } catch (e) {
      sdk.ui.showToast({ message: 'Abort failed: ' + e.message, type: 'error' });
    }
  }

  async function handleNewSession() {
    if (isRunning) {
      await handleAbort();
    }
    try {
      const res = await sdk.api.resetSession();
      currentSessionId = res.sessionId;
      messages = [];
      currentUsage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, turns: 0 };
      renderExistingMessages([]);
      sdk.emit('session:reset');
      sdk.emit('chat:messages', { count: 0 });
      sdk.emit('usage:update', currentUsage);
      renderAllSlots();
      await loadSessionList();
      sdk.ui.showToast({ message: 'Fresh session created', type: 'success' });
    } catch (e) {
      sdk.ui.showToast({ message: 'Failed to reset session: ' + e.message, type: 'error' });
    }
  }

  const appLinearProgress = document.querySelector('#app-linear-progress');

  function setRunningState(running) {
    isRunning = running;
    sendBtn.style.display = running ? 'none' : 'inline-flex';
    abortBtn.style.display = running ? 'inline-flex' : 'none';
    promptInput.disabled = running;
    if (appLinearProgress) {
      if (running) {
        appLinearProgress.classList.remove('hidden');
      } else {
        appLinearProgress.classList.add('hidden');
      }
    }
    agentActivityStatus.textContent = running ? sdk.i18n.t('statusbar.running') : sdk.i18n.t('statusbar.ready');
    sdk.emit('status:change', { isRunning });
  }

  // --- Interactive Demo Showcase Generator ---
  function playDemoShowcase() {
    switchPanel('chat');
    chatTranscript.innerHTML = '';
    activeTurnAssistantEl = null;
    activeTurnThinkingCard = null;
    activeTurnThinkingBody = null;
    currentToolCards.clear();

    setRunningState(true);

    appendUserMessage("Add a caching layer to our fetchAPI client and write unit tests.");

    const reasoningChunks = [
      "1. Analyzing project structure and locating HTTP client at src/lib/api.ts...\\n",
      "2. Verifying existing cache policies: TTL based in-memory Map with max-size eviction...\\n",
      "3. Determining required tools: bash (run tests), read_file (inspect existing code), edit_file (apply patch)...\\n",
      "4. Ensuring concurrency safety with LRU eviction policy.\\n"
    ];

    let rIdx = 0;
    const rInterval = setInterval(() => {
      if (rIdx < reasoningChunks.length) {
        appendThinking(reasoningChunks[rIdx]);
        rIdx++;
      } else {
        clearInterval(rInterval);
        step2Tools();
      }
    }, 400);

    function step2Tools() {
      // Step A: todo_write - Initialize task checklist
      const todoId = 't_demo_todo';
      const tasks = [
        { content: 'Verify existing test suite with bash', status: 'in_progress', activeForm: 'Running bun run test on src/lib/api.test.ts' },
        { content: 'Implement LRU Cache with TTL in src/lib/api.ts', status: 'pending' },
        { content: 'Verify build integrity & export summary', status: 'pending' },
      ];

      handleToolUse({
        id: todoId,
        name: 'todo_write',
        input: { todos: tasks }
      });

      setTimeout(() => {
        handleToolResult({
          id: todoId,
          content: 'Task list initialized (1 in progress, 2 pending)',
          isError: false,
        });

        // Step B: Tool 1 - bash
        setTimeout(() => {
          const tool1Id = 't_demo_1';
          handleToolUse({
            id: tool1Id,
            name: 'bash',
            input: { command: 'bun run test src/lib/api.test.ts' }
          });

          setTimeout(() => {
            handleToolResult({
              id: tool1Id,
              content: '✓ src/lib/api.test.ts (4 tests) 18ms\\nAll 4 tests passed.',
              isError: false,
            });

            // Update todo list - progress to second task
            tasks[0].status = 'completed';
            tasks[1].status = 'in_progress';
            tasks[1].activeForm = 'Patching src/lib/api.ts with TTL LRU cache';
            handleToolUse({
              id: todoId + '_2',
              name: 'todo_write',
              input: { todos: tasks }
            });
            handleToolResult({
              id: todoId + '_2',
              content: 'Task list updated (1 completed, 1 in progress, 1 pending)',
              isError: false,
            });

            // Step C: Tool 2 - edit_file with diff
            setTimeout(() => {
              const tool2Id = 't_demo_2';
              handleToolUse({
                id: tool2Id,
                name: 'edit_file',
                input: { path: 'src/lib/api.ts' }
              });

              setTimeout(() => {
                handleToolResult({
                  id: tool2Id,
                  diff: [
                    { type: 'same', line: 'export class ApiClient {' },
                    { type: 'add', line: '  private cache = new Map<string, { data: any; expiry: number }>()' },
                    { type: 'same', line: '  async fetch(url: string, opts?: RequestInit) {' },
                    { type: 'del', line: '    return fetch(url, opts)' },
                    { type: 'add', line: '    if (this.cache.has(url)) return this.cache.get(url)!.data' },
                    { type: 'add', line: '    const res = await fetch(url, opts)' },
                    { type: 'same', line: '    return res' },
                    { type: 'same', line: '  }' },
                  ],
                  isError: false,
                });

                // Final todo update: all completed
                tasks[1].status = 'completed';
                tasks[2].status = 'completed';
                handleToolUse({
                  id: todoId + '_3',
                  name: 'todo_write',
                  input: { todos: tasks }
                });
                handleToolResult({
                  id: todoId + '_3',
                  content: 'All tasks completed successfully.',
                  isError: false,
                });

                // Final assistant text
                setTimeout(() => {
                  const b = String.fromCharCode(96);
                  const b3 = b + b + b;
                  const answer = "### Implementation Complete\\n\\nI have successfully implemented the caching layer:\\n- **In-memory LRU Cache** with TTL invalidation.\\n- Unit tests in " + b + "src/lib/api.test.ts" + b + " passed successfully.\\n\\n" + b3 + "typescript\\nconst client = new ApiClient({ cacheTtlMs: 60_000 });\\nconst data = await client.fetch('https://api.example.com/status');\\n" + b3 + "\\n\\nEverything is verified and ready!";
                  appendAssistantText(answer);
                  setRunningState(false);

                  currentUsage.inputTokens += 1680;
                  currentUsage.outputTokens += 750;
                  currentUsage.toolCalls += 3;
                  currentUsage.turns += 1;
                  sdk.emit('usage:update', currentUsage);
                  renderAllSlots();
                  sdk.ui.showToast({ message: 'Demo Showcase completed!', type: 'success' });
                }, 500);
              }, 600);
            }, 600);
          }, 700);
        }, 600);
      }, 700);
    }
  }

  // --- Welcome & Hero Button Listeners ---
  if (demoShowcaseBtn) demoShowcaseBtn.addEventListener('click', playDemoShowcase);
  if (heroDemoBtn) heroDemoBtn.addEventListener('click', playDemoShowcase);
  if (heroFilesBtn) heroFilesBtn.addEventListener('click', () => switchPanel('files'));
  if (heroDemoCard) heroDemoCard.addEventListener('click', playDemoShowcase);
  if (heroFilesCard) heroFilesCard.addEventListener('click', () => switchPanel('files'));
  if (heroToolsCard) heroToolsCard.addEventListener('click', () => switchPanel('tools'));
  if (heroToolsBtn) heroToolsBtn.addEventListener('click', () => switchPanel('tools'));
  if (heroTestCard) heroTestCard.addEventListener('click', () => {
    promptInput.value = 'Run project test suite and verify harness health';
    handleSend();
  });
  if (heroTestBtn) heroTestBtn.addEventListener('click', () => {
    promptInput.value = 'Run project test suite and verify harness health';
    handleSend();
  });

  // --- Todo Dock Toggle Listeners ---
  const todoDockHeader = document.querySelector('#todo-dock-header');
  if (todoDockHeader) {
    todoDockHeader.addEventListener('click', () => toggleTodoDock());
    todoDockHeader.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleTodoDock();
      }
    });
  }
  const todoDockChevronBtn = document.querySelector('#todo-dock-chevron-btn');
  if (todoDockChevronBtn) {
    todoDockChevronBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTodoDock();
    });
  }
  sdk.on('i18n:change', () => {
    if (currentSessionTodos.length > 0) {
      updateSessionTodoDock(currentSessionTodos);
    }
  });

  // --- Interactive File Picker Modal Dialog ---
  const filePickerModal = document.querySelector('#file-picker-modal');
  const filePickerSearchInput = document.querySelector('#file-picker-search-input');
  const filePickerList = document.querySelector('#file-picker-list');
  const filePickerCloseBtn = document.querySelector('#file-picker-close-btn');
  const filePickerCancelBtn = document.querySelector('#file-picker-cancel-btn');
  let cachedWorkspaceFiles = [];

  async function openFilePicker() {
    if (!filePickerModal) return;
    filePickerModal.style.display = 'flex';
    if (filePickerSearchInput) {
      filePickerSearchInput.value = '';
      setTimeout(() => filePickerSearchInput.focus(), 60);
    }
    filePickerList.innerHTML = '<div class="muted-loading" style="padding:14px;">Loading workspace files...</div>';

    try {
      if (cachedWorkspaceFiles.length === 0) {
        const res = await sdk.api.callBackendPlugin('workspace-files', 'tree');
        cachedWorkspaceFiles = (res.items || []).filter(f => !f.isDirectory);
      }
      renderFilePickerList(cachedWorkspaceFiles);
    } catch {
      cachedWorkspaceFiles = [
        { path: 'package.json', size: 3820 },
        { path: 'tsconfig.json', size: 1240 },
        { path: 'MEOWCODE.md', size: 8450 },
        { path: 'src/cli.tsx', size: 14200 },
        { path: 'src/agent.ts', size: 28400 },
        { path: 'src/webui/server.ts', size: 12530 },
        { path: 'src/webui/client/html.ts', size: 14100 },
        { path: 'src/webui/client/css.ts', size: 38400 },
        { path: 'src/webui/client/app.ts', size: 29500 },
        { path: 'src/webui/agent-bridge.ts', size: 26500 },
        { path: 'src/tools/index.ts', size: 8900 },
        { path: 'src/providers/index.ts', size: 3560 },
      ];
      renderFilePickerList(cachedWorkspaceFiles);
    }
  }

  function renderFilePickerList(files) {
    if (!filePickerList) return;
    const q = (filePickerSearchInput ? filePickerSearchInput.value : '').trim().toLowerCase();
    const filtered = files.filter(f => !q || f.path.toLowerCase().includes(q));

    if (!filtered.length) {
      filePickerList.innerHTML = '<div class="empty-state text-dim text-xs" style="padding:16px;">No matching files found</div>';
      return;
    }

    filePickerList.innerHTML = '';
    filtered.forEach(file => {
      const row = document.createElement('div');
      row.className = 'file-picker-row';
      const iconName = file.path.endsWith('.ts') || file.path.endsWith('.tsx') ? 'code' : file.path.endsWith('.json') ? 'data_object' : file.path.endsWith('.md') ? 'article' : 'description';
      const sizeStr = file.size ? (file.size < 1024 ? file.size + ' B' : (file.size / 1024).toFixed(1) + ' KB') : '';

      row.innerHTML = \`
        <div class="file-picker-left">
          <span class="material-symbols-outlined file-picker-icon">\${iconName}</span>
          <span class="file-picker-path">\${escapeHtml(file.path)}</span>
        </div>
        <span class="file-picker-size">\${sizeStr}</span>
      \`;

      row.addEventListener('click', () => {
        const space = promptInput.value.length && !promptInput.value.endsWith(' ') ? ' ' : '';
        promptInput.value = promptInput.value + space + '@' + file.path + ' ';
        autoResizeInput();
        promptInput.focus();
        closeFilePicker();
        sdk.ui.showToast({ message: 'Inserted @' + file.path, type: 'info' });
      });

      filePickerList.appendChild(row);
    });
  }

  function closeFilePicker() {
    if (filePickerModal) filePickerModal.style.display = 'none';
  }

  if (mentionFileBtn) mentionFileBtn.onclick = openFilePicker;
  if (filePickerCloseBtn) filePickerCloseBtn.onclick = closeFilePicker;
  if (filePickerCancelBtn) filePickerCancelBtn.onclick = closeFilePicker;
  if (filePickerSearchInput) filePickerSearchInput.addEventListener('input', () => renderFilePickerList(cachedWorkspaceFiles));

  // --- Interactive Command Palette Modal Dialog ---
  const cmdPaletteModal = document.querySelector('#cmd-palette-modal');
  const cmdPaletteSearchInput = document.querySelector('#cmd-palette-search-input');
  const cmdPaletteList = document.querySelector('#cmd-palette-list');
  const cmdPaletteCloseBtn = document.querySelector('#cmd-palette-close-btn');
  const cmdPaletteCancelBtn = document.querySelector('#cmd-palette-cancel-btn');

  const COMMANDS = [
    { icon: 'auto_awesome', title: '/demo', desc: 'Experience the full agent reasoning & tool showcase', run: () => playDemoShowcase() },
    { icon: 'fact_check', title: '/test', desc: 'Run project test suite and verify harness health', run: () => { promptInput.value = 'Run project test suite and verify harness health'; handleSend(); } },
    { icon: 'folder', title: '/files', desc: 'Switch to Workspace Files Explorer', run: () => switchPanel('files') },
    { icon: 'construction', title: '/tools', desc: 'Switch to Agent Toolset Inspector', run: () => switchPanel('tools') },
    { icon: 'palette', title: '/theme', desc: 'Toggle Dark / Light theme mode', run: () => { if (themeSwitch) themeSwitch.click(); } },
    { icon: 'delete_sweep', title: '/clear', desc: 'Reset conversation session and start fresh', run: () => handleNewSession() },
    { icon: 'psychology', title: '/model', desc: 'Switch AI model & reasoning configuration', run: () => openModelSelectorModal() },
    { icon: 'monitoring', title: '/tokens', desc: 'View token usage metrics and statistics', run: () => sdk.ui.showToast({ message: 'Token usage: in=' + (currentUsage.inputTokens||0) + ', out=' + (currentUsage.outputTokens||0), type: 'info' }) },
    { icon: 'help_outline', title: '/help', desc: 'Display agent architecture & quick tips', run: () => { promptInput.value = 'Explain the architecture and main workflows of this project'; handleSend(); } },
  ];

  function openCommandPalette() {
    if (!cmdPaletteModal) return;
    cmdPaletteModal.style.display = 'flex';
    if (cmdPaletteSearchInput) {
      cmdPaletteSearchInput.value = '';
      setTimeout(() => cmdPaletteSearchInput.focus(), 60);
    }
    renderCommandPaletteList(COMMANDS);
  }

  function renderCommandPaletteList(cmds) {
    if (!cmdPaletteList) return;
    const q = (cmdPaletteSearchInput ? cmdPaletteSearchInput.value : '').trim().toLowerCase();
    const filtered = cmds.filter(c => !q || c.title.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));

    if (!filtered.length) {
      cmdPaletteList.innerHTML = '<div class="empty-state text-dim text-xs" style="padding:16px;">No matching commands</div>';
      return;
    }

    cmdPaletteList.innerHTML = '';
    filtered.forEach(cmd => {
      const row = document.createElement('div');
      row.className = 'cmd-palette-row';
      row.innerHTML = \`
        <div class="cmd-palette-left">
          <span class="material-symbols-outlined cmd-palette-icon">\${cmd.icon}</span>
          <div class="cmd-palette-info">
            <span class="cmd-palette-title">\${cmd.title}</span>
            <span class="cmd-palette-desc">\${cmd.desc}</span>
          </div>
        </div>
        <span class="cmd-palette-chip">↵ Run</span>
      \`;
      row.addEventListener('click', () => {
        closeCommandPalette();
        cmd.run();
      });
      cmdPaletteList.appendChild(row);
    });
  }

  function closeCommandPalette() {
    if (cmdPaletteModal) cmdPaletteModal.style.display = 'none';
  }

  if (slashCmdBtn) slashCmdBtn.onclick = openCommandPalette;
  if (cmdPaletteCloseBtn) cmdPaletteCloseBtn.onclick = closeCommandPalette;
  if (cmdPaletteCancelBtn) cmdPaletteCancelBtn.onclick = closeCommandPalette;
  if (cmdPaletteSearchInput) cmdPaletteSearchInput.addEventListener('input', () => renderCommandPaletteList(COMMANDS));

  // --- Interactive Model Selector Modal Dialog ---
  const modelSelectorModal = document.querySelector('#model-selector-modal');
  const modelSelectorList = document.querySelector('#model-selector-list');
  const modelSelectorCloseBtn = document.querySelector('#model-selector-close-btn');
  const modelSelectorCancelBtn = document.querySelector('#model-selector-cancel-btn');

  const MODELS = [
    { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', desc: 'Hybrid extended thinking & deep code synthesis', badge: '200k · Hybrid' },
    { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', desc: 'State of the art reasoning & multi-step tool execution', badge: '200k · Recommended' },
    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', desc: 'High speed coding assistant and refactoring partner', badge: '200k · Fast' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: 'Massive context window & multimodal understanding', badge: '1M Context' },
    { id: 'mock-offline', name: 'Offline Simulated Engine', desc: 'Instant local responses & tool simulations (no API key needed)', badge: 'Offline' },
  ];

  function openModelSelectorModal() {
    if (!modelSelectorModal) return;
    modelSelectorModal.style.display = 'flex';
    renderModelSelectorList();
  }

  function renderModelSelectorList() {
    if (!modelSelectorList) return;
    modelSelectorList.innerHTML = '';
    const currentModel = appConfig.model || 'claude-opus-4-8';

    MODELS.forEach(m => {
      const card = document.createElement('div');
      const isActive = m.id === currentModel;
      card.className = 'model-option-card ' + (isActive ? 'active' : '');
      card.innerHTML = \`
        <div>
          <div class="model-card-title">
            <span>\${isActive ? '✓ ' : ''}\${m.name}</span>
          </div>
          <div class="model-card-desc">\${m.desc}</div>
        </div>
        <span class="model-card-badge">\${m.badge}</span>
      \`;
      card.addEventListener('click', async () => {
        try {
          await sdk.api.updateConfig({ model: m.id });
          appConfig.model = m.id;
          const headerModelName = document.querySelector('.model-name');
          if (headerModelName) headerModelName.textContent = m.id;
          const wsModalModel = document.querySelector('#ws-modal-model');
          if (wsModalModel) wsModalModel.textContent = m.id;
          sdk.ui.showToast({ message: 'Active model switched to ' + m.name, type: 'success' });
          closeModelSelectorModal();
        } catch (err) {
          sdk.ui.showToast({ message: 'Failed to switch model: ' + err.message, type: 'error' });
        }
      });
      modelSelectorList.appendChild(card);
    });
  }

  function closeModelSelectorModal() {
    if (modelSelectorModal) modelSelectorModal.style.display = 'none';
  }

  if (modelSelectorCloseBtn) modelSelectorCloseBtn.onclick = closeModelSelectorModal;
  if (modelSelectorCancelBtn) modelSelectorCancelBtn.onclick = closeModelSelectorModal;

  document.addEventListener('click', (e) => {
    if (e.target.closest('.header-model-chip')) {
      openModelSelectorModal();
    }
  });

  // --- Interactive Workspace Info Modal Dialog ---
  const workspaceInfoModal = document.querySelector('#workspace-info-modal');
  const workspaceInfoChip = document.querySelector('.workspace-info-chip');
  const workspaceInfoCloseBtn = document.querySelector('#workspace-info-close-btn');
  const workspaceInfoOkBtn = document.querySelector('#workspace-info-ok-btn');
  const wsOpenFilesBtn = document.querySelector('#ws-open-files-btn');
  const wsOpenToolsBtn = document.querySelector('#ws-open-tools-btn');

  function openWorkspaceInfo() {
    if (workspaceInfoModal) workspaceInfoModal.style.display = 'flex';
  }
  function closeWorkspaceInfo() {
    if (workspaceInfoModal) workspaceInfoModal.style.display = 'none';
  }

  if (workspaceInfoChip) workspaceInfoChip.onclick = openWorkspaceInfo;
  if (workspaceInfoCloseBtn) workspaceInfoCloseBtn.onclick = closeWorkspaceInfo;
  if (workspaceInfoOkBtn) workspaceInfoOkBtn.onclick = closeWorkspaceInfo;
  if (wsOpenFilesBtn) wsOpenFilesBtn.onclick = () => { closeWorkspaceInfo(); switchPanel('files'); };
  if (wsOpenToolsBtn) wsOpenToolsBtn.onclick = () => { closeWorkspaceInfo(); switchPanel('tools'); };

  // Global Escape key to dismiss modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeFilePicker();
      closeCommandPalette();
      closeModelSelectorModal();
      closeWorkspaceInfo();
      closeSettingsModal();
    }
  });

  // --- Floating Settings Modal Dialog (Claude Code Style) ---
  const settingsModal = document.querySelector('#settings-modal');
  const openSettingsBtn = document.querySelector('#open-settings-btn');
  const settingsCloseBtn = document.querySelector('#settings-close-btn');
  const settingsSearchInput = document.querySelector('#settings-search-input');
  const settingsMainContent = document.querySelector('#settings-main-content');
  let currentSettingsTab = 'general';

  const storedChatFont = localStorage.getItem('meowcode_chat_font');
  if (storedChatFont) {
    const fontMap = {
      'Anthropic Serif': "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
      'Outfit': "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      'JetBrains Mono': "'JetBrains Mono', Consolas, Monaco, monospace",
      'system-ui': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    };
    document.documentElement.style.setProperty('--chat-font-family', fontMap[storedChatFont] || storedChatFont);
  }
  const storedChatWidth = localStorage.getItem('meowcode_chat_width');
  if (storedChatWidth) {
    document.documentElement.style.setProperty('--chat-max-width', storedChatWidth + 'px');
  }
  const storedMotion = localStorage.getItem('meowcode_motion');
  if (storedMotion === 'reduced') {
    document.body.classList.add('reduced-motion');
  }

  function openSettingsModal(tab = 'general') {
    currentSettingsTab = tab;
    if (settingsModal) {
      settingsModal.style.display = 'flex';
      selectSettingsTab(tab);
    }
  }

  function closeSettingsModal() {
    if (settingsModal) settingsModal.style.display = 'none';
  }

  if (openSettingsBtn) openSettingsBtn.onclick = () => openSettingsModal('general');
  if (settingsCloseBtn) settingsCloseBtn.onclick = closeSettingsModal;
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeSettingsModal();
    });
  }

  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.getAttribute('data-tab');
      if (tab) selectSettingsTab(tab);
    });
  });

  function selectSettingsTab(tab) {
    currentSettingsTab = tab;
    document.querySelectorAll('.settings-nav-item').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-tab') === tab);
    });
    renderSettingsContent(tab);
  }

  if (settingsSearchInput) {
    settingsSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll('.settings-nav-item').forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = (!q || text.includes(q)) ? 'flex' : 'none';
      });
      document.querySelectorAll('.settings-row').forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = (!q || text.includes(q)) ? 'flex' : 'none';
      });
    });
  }

  function renderSettingsContent(tab) {
    if (!settingsMainContent) return;
    const t = sdk.i18n ? sdk.i18n.t : (k) => k;
    const currentLang = sdk.i18n ? sdk.i18n.getLang() : 'zh';
    const currentTheme = sdk.theme.getTheme();
    const currentChatWidth = localStorage.getItem('meowcode_chat_width') || '860';
    const currentChatFont = localStorage.getItem('meowcode_chat_font') || 'Outfit';
    const currentMotion = localStorage.getItem('meowcode_motion') || 'system';
    const currentVoiceStyle = localStorage.getItem('meowcode_speech_style') || 'soft';
    const currentVoiceSpeed = localStorage.getItem('meowcode_speech_speed') || 'normal';
    const notifyTurn = localStorage.getItem('meowcode_notify_turn') !== 'false';

    if (tab === 'general') {
      settingsMainContent.innerHTML = \`
        <div class="settings-section-block">
          <div class="settings-section-header">\${t('settings.appearance.title')}</div>

          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">\${t('settings.appearance.theme')}</div>
            </div>
            <div class="settings-row-ctrl">
              <div class="m3-segmented-group" id="settings-theme-group">
                <button class="m3-segmented-btn \${currentTheme === 'system' ? 'active' : ''}" data-theme="system" title="\${t('settings.appearance.theme.system')}">
                  <span class="material-symbols-outlined" style="font-size:16px;">desktop_windows</span>
                </button>
                <button class="m3-segmented-btn \${currentTheme === 'light' ? 'active' : ''}" data-theme="light" title="\${t('settings.appearance.theme.light')}">
                  <span class="material-symbols-outlined" style="font-size:16px;">light_mode</span>
                </button>
                <button class="m3-segmented-btn \${currentTheme === 'dark' ? 'active' : ''}" data-theme="dark" title="\${t('settings.appearance.theme.dark')}">
                  <span class="material-symbols-outlined" style="font-size:16px;">dark_mode</span>
                </button>
              </div>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">\${t('settings.appearance.font')}</div>
            </div>
            <div class="settings-row-ctrl">
              <select class="m3-select" id="settings-font-select">
                <option value="Anthropic Serif" \${currentChatFont === 'Anthropic Serif' ? 'selected' : ''}>Anthropic Serif</option>
                <option value="Outfit" \${currentChatFont === 'Outfit' ? 'selected' : ''}>Outfit / Inter</option>
                <option value="JetBrains Mono" \${currentChatFont === 'JetBrains Mono' ? 'selected' : ''}>JetBrains Mono</option>
                <option value="system-ui" \${currentChatFont === 'system-ui' ? 'selected' : ''}>System Sans</option>
              </select>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">\${t('settings.appearance.chatWidth')}</div>
              <div class="settings-row-desc">\${t('settings.appearance.chatWidth.desc')}</div>
            </div>
            <div class="settings-row-ctrl">
              <div class="m3-segmented-group" id="settings-width-group">
                <button class="m3-segmented-btn \${currentChatWidth === '640' ? 'active' : ''}" data-width="640">\${t('settings.appearance.chatWidth.narrow')}</button>
                <button class="m3-segmented-btn \${currentChatWidth === '860' ? 'active' : ''}" data-width="860">\${t('settings.appearance.chatWidth.medium')}</button>
                <button class="m3-segmented-btn \${currentChatWidth === '1200' ? 'active' : ''}" data-width="1200">\${t('settings.appearance.chatWidth.wide')}</button>
              </div>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">\${t('settings.appearance.motion')}</div>
              <div class="settings-row-desc">\${t('settings.appearance.motion.desc')}</div>
            </div>
            <div class="settings-row-ctrl">
              <div class="m3-segmented-group" id="settings-motion-group">
                <button class="m3-segmented-btn \${currentMotion === 'system' ? 'active' : ''}" data-motion="system">\${t('settings.appearance.motion.system')}</button>
                <button class="m3-segmented-btn \${currentMotion === 'reduced' ? 'active' : ''}" data-motion="reduced">\${t('settings.appearance.motion.reduced')}</button>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section-block">
          <div class="settings-section-header">\${t('settings.voice.title')}</div>

          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">\${t('settings.voice.language')}</div>
            </div>
            <div class="settings-row-ctrl">
              <select class="m3-select" id="settings-lang-select">
                <option value="zh" \${currentLang === 'zh' ? 'selected' : ''}>\${t('settings.voice.language.zh')}</option>
                <option value="en" \${currentLang === 'en' ? 'selected' : ''}>\${t('settings.voice.language.en')}</option>
              </select>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">\${t('settings.voice.style')}</div>
            </div>
            <div class="settings-row-ctrl">
              <select class="m3-select" id="settings-style-select">
                <option value="soft" \${currentVoiceStyle === 'soft' ? 'selected' : ''}>\${t('settings.voice.style.soft')}</option>
                <option value="professional" \${currentVoiceStyle === 'professional' ? 'selected' : ''}>\${t('settings.voice.style.professional')}</option>
              </select>
            </div>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">\${t('settings.voice.speed')}</div>
            </div>
            <div class="settings-row-ctrl">
              <select class="m3-select" id="settings-speed-select">
                <option value="normal" \${currentVoiceSpeed === 'normal' ? 'selected' : ''}>\${t('settings.voice.speed.normal')}</option>
                <option value="fast" \${currentVoiceSpeed === 'fast' ? 'selected' : ''}>\${t('settings.voice.speed.fast')}</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-section-block">
          <div class="settings-section-header">\${t('settings.notification.title')}</div>

          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">\${t('settings.notification.turnDone')}</div>
              <div class="settings-row-desc">\${t('settings.notification.turnDone.desc')}</div>
            </div>
            <div class="settings-row-ctrl">
              <button class="m3-switch \${notifyTurn ? 'active' : ''}" id="settings-notify-switch" role="switch" aria-checked="\${notifyTurn}">
                <div class="switch-thumb"></div>
              </button>
            </div>
          </div>
        </div>
      \`;

      document.querySelectorAll('#settings-theme-group .m3-segmented-btn').forEach(btn => {
        btn.onclick = () => {
          const m = btn.getAttribute('data-theme');
          sdk.theme.setTheme(m);
          document.querySelectorAll('#settings-theme-group .m3-segmented-btn').forEach(b => b.classList.toggle('active', b === btn));
        };
      });

      const fontSelect = document.querySelector('#settings-font-select');
      if (fontSelect) {
        fontSelect.onchange = () => {
          const f = fontSelect.value;
          localStorage.setItem('meowcode_chat_font', f);
          const fontMap = {
            'Anthropic Serif': "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
            'Outfit': "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            'JetBrains Mono': "'JetBrains Mono', Consolas, Monaco, monospace",
            'system-ui': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          };
          document.documentElement.style.setProperty('--chat-font-family', fontMap[f] || f);
          sdk.ui.showToast({ message: 'Font: ' + f, type: 'info' });
        };
      }

      document.querySelectorAll('#settings-width-group .m3-segmented-btn').forEach(btn => {
        btn.onclick = () => {
          const w = btn.getAttribute('data-width');
          localStorage.setItem('meowcode_chat_width', w);
          document.documentElement.style.setProperty('--chat-max-width', w + 'px');
          document.querySelectorAll('#settings-width-group .m3-segmented-btn').forEach(b => b.classList.toggle('active', b === btn));
          sdk.ui.showToast({ message: 'Chat width: ' + w + 'px', type: 'info' });
        };
      });

      document.querySelectorAll('#settings-motion-group .m3-segmented-btn').forEach(btn => {
        btn.onclick = () => {
          const m = btn.getAttribute('data-motion');
          localStorage.setItem('meowcode_motion', m);
          document.body.classList.toggle('reduced-motion', m === 'reduced');
          document.querySelectorAll('#settings-motion-group .m3-segmented-btn').forEach(b => b.classList.toggle('active', b === btn));
        };
      });

      const langSelect = document.querySelector('#settings-lang-select');
      if (langSelect) {
        langSelect.onchange = () => {
          const l = langSelect.value;
          sdk.i18n.setLang(l);
          sdk.ui.showToast({ message: l === 'zh' ? '已切换至中文' : 'Switched to English', type: 'info' });
        };
      }

      const styleSelect = document.querySelector('#settings-style-select');
      if (styleSelect) styleSelect.onchange = () => localStorage.setItem('meowcode_speech_style', styleSelect.value);
      const speedSelect = document.querySelector('#settings-speed-select');
      if (speedSelect) speedSelect.onchange = () => localStorage.setItem('meowcode_speech_speed', speedSelect.value);

      const notifySwitch = document.querySelector('#settings-notify-switch');
      if (notifySwitch) {
        notifySwitch.onclick = () => {
          const active = notifySwitch.classList.toggle('active');
          notifySwitch.setAttribute('aria-checked', String(active));
          localStorage.setItem('meowcode_notify_turn', String(active));
          if (active && window.Notification && Notification.permission !== 'granted') {
            Notification.requestPermission();
          }
        };
      }
    } else if (tab === 'meowcode') {
      settingsMainContent.innerHTML = \`
        <div class="settings-section-block">
          <div class="settings-section-header">Claude Code / MeowCode Engine</div>
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">Default Model</div>
              <div class="settings-row-desc">Autonomous agent model used for reasoning and multi-turn loops.</div>
            </div>
            <div class="settings-row-ctrl">
              <select class="m3-select" id="settings-model-choice">
                <option value="claude-opus-4-8" selected>claude-opus-4-8</option>
                <option value="claude-3-7-sonnet">claude-3-7-sonnet</option>
                <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                <option value="gpt-4o">gpt-4o</option>
              </select>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">Thinking Budget</div>
              <div class="settings-row-desc">Extended reasoning and self-healing trace budget.</div>
            </div>
            <div class="settings-row-ctrl">
              <span class="badge" style="font-size:12px;padding:4px 10px;background:var(--md-sys-color-primary-container);color:var(--md-sys-color-on-primary-container);border-radius:var(--md-shape-full);">Adaptive (Auto)</span>
            </div>
          </div>
        </div>
      \`;
    } else if (tab === 'system' || tab === 'developer') {
      settingsMainContent.innerHTML = \`
        <div class="settings-section-block">
          <div class="settings-section-header">\${tab === 'system' ? 'System Environment' : 'Developer Console'}</div>
          <div class="settings-row">
            <div class="settings-row-info"><div class="settings-row-label">Harness Repository</div></div>
            <div class="settings-row-ctrl"><code style="font-family:var(--font-family-code);font-size:12px;">harmess (git:main)</code></div>
          </div>
          <div class="settings-row">
            <div class="settings-row-info"><div class="settings-row-label">Runtime</div></div>
            <div class="settings-row-ctrl"><code style="font-family:var(--font-family-code);font-size:12px;">Node.js / Bun on Linux</code></div>
          </div>
          <div class="settings-row">
            <div class="settings-row-info"><div class="settings-row-label">WebUI Port</div></div>
            <div class="settings-row-ctrl"><code style="font-family:var(--font-family-code);font-size:12px;">\${window.location.port || '4040'}</code></div>
          </div>
        </div>
      \`;
    } else if (tab === 'plugins' || tab === 'extensions') {
      const panels = sdk.panels.getPanels();
      const panelsList = panels.map(p => \`
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">\${escapeHtml(p.title)}</div>
            <div class="settings-row-desc">Panel ID: \${escapeHtml(p.id)}</div>
          </div>
          <div class="settings-row-ctrl">
            <span class="badge" style="font-size:11px;padding:3px 8px;background:var(--md-sys-color-secondary-container);color:var(--md-sys-color-on-secondary-container);border-radius:var(--md-shape-full);">Active</span>
          </div>
        </div>
      \`).join('');
      settingsMainContent.innerHTML = \`
        <div class="settings-section-block">
          <div class="settings-section-header">Loaded Plugins & Extensions</div>
          \${panelsList || '<div class="text-dim text-xs">No extra panels loaded</div>'}
        </div>
      \`;
    } else if (tab === 'skills') {
      settingsMainContent.innerHTML = \`
        <div class="settings-section-block">
          <div class="settings-section-header">Skills Customizations</div>
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">agy-customizations</div>
              <div class="settings-row-desc">Customizations system, skills, rules, and plugins manager.</div>
            </div>
            <div class="settings-row-ctrl"><span class="badge" style="font-size:11px;padding:3px 8px;background:var(--md-sys-color-primary-container);color:var(--md-sys-color-on-primary-container);border-radius:var(--md-shape-full);">Loaded</span></div>
          </div>
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">antigravity-guide</div>
              <div class="settings-row-desc">Antigravity CLI and IDE comprehensive developer guide.</div>
            </div>
            <div class="settings-row-ctrl"><span class="badge" style="font-size:11px;padding:3px 8px;background:var(--md-sys-color-primary-container);color:var(--md-sys-color-on-primary-container);border-radius:var(--md-shape-full);">Loaded</span></div>
          </div>
        </div>
      \`;
    } else if (tab === 'connectors') {
      settingsMainContent.innerHTML = \`
        <div class="settings-section-block">
          <div class="settings-section-header">Connectors (MCP Servers)</div>
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">Model Context Protocol (MCP)</div>
              <div class="settings-row-desc">Standard protocol for connecting external toolsets and resource servers.</div>
            </div>
            <div class="settings-row-ctrl"><span class="badge" style="font-size:11px;padding:3px 8px;background:var(--md-sys-color-surface-container-high);border-radius:var(--md-shape-full);">Ready</span></div>
          </div>
        </div>
      \`;
    } else {
      settingsMainContent.innerHTML = \`
        <div class="settings-section-block">
          <div class="settings-section-header">\${tab.charAt(0).toUpperCase() + tab.slice(1)}</div>
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">\${tab.charAt(0).toUpperCase() + tab.slice(1)} Configuration</div>
              <div class="settings-row-desc">Manage preferences, sync states, and defaults for this workspace.</div>
            </div>
            <div class="settings-row-ctrl">
              <span class="badge" style="font-size:11px;padding:3px 8px;background:var(--md-sys-color-surface-container-high);border-radius:var(--md-shape-full);">Configured</span>
            </div>
          </div>
        </div>
      \`;
    }
  }

  sdk.on('i18n:change', () => {
    if (settingsModal && settingsModal.style.display !== 'none') {
      renderSettingsContent(currentSettingsTab);
    }
    loadSessionList();
    if (agentActivityStatus) {
      agentActivityStatus.textContent = isRunning ? sdk.i18n.t('statusbar.running') : sdk.i18n.t('statusbar.ready');
    }
    if (connectionStatus) {
      connectionStatus.textContent = sdk.i18n.t('statusbar.connected');
    }
  });

  // --- Prepopulated Sample Conversations & Session List ---
  const SAMPLE_SESSIONS = [
    {
      id: 'sample_m3e_refactor',
      title: 'Architecture & M3E UI',
      messageCount: 4,
      savedAt: Date.now() - 3600000,
      messages: [
        { role: 'user', content: 'Refactor WebUI using Google Material 3 Expressive guidelines and add dynamic light/dark theme switching.' },
        { role: 'assistant', meta: { thinking: true }, content: '1. Designing 5-tier surface containers (--md-sys-color-surface-container-*)\\n2. Implementing sliding M3 theme toggle with spring curves\\n3. Applying asymmetric curvature tokens (--md-shape-xxl)...' },
        { role: 'tool', content: '● edit_file: src/webui/client/css.ts', meta: { diff: [
          { tag: 'context', text: ':root, [data-theme="dark"] {' },
          { tag: 'del', text: '  --bg-primary: #000000;' },
          { tag: 'add', text: '  --md-sys-color-surface-container: #181C23;' },
          { tag: 'add', text: '  --md-sys-color-primary: #8AB4F8;' },
          { tag: 'context', text: '}' }
        ]}},
        { role: 'assistant', content: '### Material 3 Expressive Design System Applied\\n\\nI have modernized the entire WebUI with Google M3 Expressive standards:\\n- **Tonal Palette**: Pure slate dark (#0E1015) and porcelain light (#F7F9FC).\\n- **Sliding Toggle**: Integrated theme switch with animated thumb.\\n- **Official Custom Elements**: Loaded @material/web elements locally without runtime CDN dependencies.' }
      ],
      usage: { inputTokens: 1420, outputTokens: 680, toolCalls: 1, turns: 1 }
    },
    {
      id: 'sample_test_diagnostics',
      title: 'Vitest Diagnostics & CI Suite',
      messageCount: 3,
      savedAt: Date.now() - 86400000,
      messages: [
        { role: 'user', content: 'Run project test suite and verify harness health' },
        { role: 'assistant', meta: { thinking: true }, content: '1. Executing bun run test across all test suites...\\n2. Checking CLI, tools, and webui assertions...' },
        { role: 'tool', content: '● bash: bun run test\\n✓ src/webui/webui.test.ts (11 tests)\\n✓ test/tools.test.ts (24 tests)\\nAll 9 test suites passed (159 passed, 0 failures)' },
        { role: 'assistant', content: '### Test Suite Green\\n\\nAll **159 automated tests** passed with zero failures. Harness integrity is verified.' }
      ],
      usage: { inputTokens: 980, outputTokens: 420, toolCalls: 1, turns: 1 }
    },
    {
      id: 'sample_plugin_sdk',
      title: 'Extension SDK & Plugin Slots',
      messageCount: 2,
      savedAt: Date.now() - 172800000,
      messages: [
        { role: 'user', content: 'How do I build a custom WebUI plugin to add a slot action?' },
        { role: 'assistant', content: '### WebUI Plugin Creation Guide\\n\\nYou can register extensions on the client via window.MeowSDK slots and panels.' }
      ],
      usage: { inputTokens: 850, outputTokens: 390, toolCalls: 0, turns: 1 }
    }
  ];

  function cleanSessionTitle(rawTitle) {
    if (!rawTitle) return sdk.i18n.t('common.untitledConversation');
    let t = String(rawTitle).trim();
    if (t.startsWith('{')) {
      try {
        const obj = JSON.parse(t);
        if (obj.reason) return String(obj.reason);
        if (obj.message) return String(obj.message);
        if (obj.prompt) return String(obj.prompt);
        if (obj.decision) return 'Decision: ' + obj.decision;
      } catch (e) {}
      const reasonMatch = t.match(/"reason"\\s*:\\s*"([^"]+)/);
      if (reasonMatch && reasonMatch[1]) return reasonMatch[1].replace(/…$/, '...');
      const msgMatch = t.match(/"message"\\s*:\\s*"([^"]+)/);
      if (msgMatch && msgMatch[1]) return msgMatch[1];
      const promptMatch = t.match(/"prompt"\\s*:\\s*"([^"]+)/);
      if (promptMatch && promptMatch[1]) return promptMatch[1];
      const decMatch = t.match(/"decision"\\s*:\\s*"([^"]+)/);
      if (decMatch && decMatch[1]) return 'Decision: ' + decMatch[1];
    }
    if (t.startsWith('"') && t.endsWith('"')) {
      t = t.slice(1, -1);
    }
    return t;
  }

  async function loadSessionList() {
    if (!sidebarSessionList) return;
    try {
      const realSessions = await sdk.api.listSessions();
      sidebarSessionList.innerHTML = '';

      const sessionItems = (realSessions && realSessions.length > 0) ? realSessions : SAMPLE_SESSIONS;

      sessionItems.slice(0, 30).forEach(s => {
        const item = document.createElement('div');
        const isActive = s.id === currentSessionId;
        item.className = 'session-item ' + (isActive ? 'active' : '');
        const isSample = Boolean(s.id.startsWith('sample_'));
        const displayTitle = cleanSessionTitle(s.title);
        item.innerHTML = \`
          <div class="session-item-header">
            <div class="session-title-wrap">
              <span class="material-symbols-outlined icon-xs session-icon">chat_bubble</span>
              <span class="session-title" title="\${escapeHtml(displayTitle)}">\${escapeHtml(displayTitle)}</span>
            </div>
            <div class="session-actions">
              <button class="session-action-btn btn-rename" title="\${escapeHtml(sdk.i18n.t('session.rename'))}" aria-label="\${escapeHtml(sdk.i18n.t('session.rename'))}">
                <span class="material-symbols-outlined" style="font-size:15px;">edit</span>
              </button>
              <button class="session-action-btn btn-delete" title="\${escapeHtml(sdk.i18n.t('session.delete'))}" aria-label="\${escapeHtml(sdk.i18n.t('session.delete'))}">
                <span class="material-symbols-outlined" style="font-size:15px;">delete</span>
              </button>
            </div>
            \${isSample ? '<span class="sample-session-pill">' + escapeHtml(sdk.i18n.t('sidebar.sample')) + '</span>' : ''}
          </div>
          <div class="session-meta">
            <span>\${s.messageCount || 0} \${escapeHtml(sdk.i18n.t('sidebar.msgs'))}</span>
            <span>\${new Date(s.savedAt).toLocaleDateString(sdk.i18n.getLang() === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}</span>
          </div>
        \`;

        const renameBtn = item.querySelector('.btn-rename');
        if (renameBtn) {
          renameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (item.classList.contains('editing')) return;
            item.classList.add('editing');

            const titleWrap = item.querySelector('.session-title-wrap');
            const originalTitleEl = item.querySelector('.session-title');
            if (!titleWrap || !originalTitleEl) return;

            const currentRawTitle = s.title || displayTitle;
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'session-rename-input';
            input.value = currentRawTitle;
            input.placeholder = sdk.i18n.t('session.titlePlaceholder');
            input.maxLength = 100;

            input.addEventListener('click', (ev) => ev.stopPropagation());

            let finished = false;
            const finish = async (commit) => {
              if (finished) return;
              finished = true;
              item.classList.remove('editing');

              if (!commit) {
                if (input.parentNode) input.replaceWith(originalTitleEl);
                return;
              }

              const newTitle = input.value.trim();
              if (!newTitle || newTitle === currentRawTitle) {
                if (input.parentNode) input.replaceWith(originalTitleEl);
                return;
              }

              try {
                if (isSample) {
                  s.title = newTitle;
                  originalTitleEl.textContent = cleanSessionTitle(newTitle);
                  if (input.parentNode) input.replaceWith(originalTitleEl);
                  sdk.ui.showToast({ message: sdk.i18n.t('session.renamed'), type: 'success' });
                  return;
                }

                await sdk.api.renameSession(s.id, newTitle);
                sdk.ui.showToast({ message: sdk.i18n.t('session.renamed'), type: 'success' });
                await loadSessionList();
              } catch (err) {
                sdk.ui.showToast({ message: 'Failed to rename: ' + err.message, type: 'error' });
                if (input.parentNode) input.replaceWith(originalTitleEl);
              }
            };

            input.addEventListener('keydown', (ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault();
                ev.stopPropagation();
                finish(true);
              } else if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                finish(false);
              }
            });

            input.addEventListener('blur', () => {
              finish(true);
            });

            originalTitleEl.replaceWith(input);
            input.focus();
            input.select();
          });
        }

        const deleteBtn = item.querySelector('.btn-delete');
        if (deleteBtn) {
          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();

            const confirmMsg = sdk.i18n.t('session.confirmDelete');
            if (!window.confirm(confirmMsg)) return;

            if (isSample) {
              const idx = SAMPLE_SESSIONS.findIndex(sm => sm.id === s.id);
              if (idx !== -1) SAMPLE_SESSIONS.splice(idx, 1);
              sdk.ui.showToast({ message: sdk.i18n.t('session.deleted'), type: 'info' });
              if (s.id === currentSessionId) {
                await handleNewSession();
              } else {
                await loadSessionList();
              }
              return;
            }

            try {
              await sdk.api.deleteSession(s.id);
              sdk.ui.showToast({ message: sdk.i18n.t('session.deleted'), type: 'info' });
              if (s.id === currentSessionId) {
                await handleNewSession();
              } else {
                await loadSessionList();
              }
            } catch (err) {
              sdk.ui.showToast({ message: 'Failed to delete: ' + err.message, type: 'error' });
            }
          });
        }

        item.addEventListener('click', async () => {
          if (item.classList.contains('editing')) return;
          if (window.innerWidth <= 768 && appSidebar) {
            appSidebar.classList.add('collapsed');
          }
          if (s.id === currentSessionId) return;
          if (isSample) {
            currentSessionId = s.id;
            messages = (s.messages || []).slice();
            currentUsage = { ...(s.usage || { inputTokens: 0, outputTokens: 0, toolCalls: 0, turns: 0 }) };
            switchPanel('chat');
            renderExistingMessages(messages);
            sdk.emit('usage:update', currentUsage);
            renderAllSlots();
            document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            sdk.ui.showToast({ message: 'Loaded session: ' + displayTitle, type: 'info' });
            return;
          }
          try {
            await sdk.api.loadSession(s.id);
            await syncState();
            sdk.ui.showToast({ message: 'Loaded session', type: 'info' });
          } catch (err) {
            sdk.ui.showToast({ message: 'Failed to load session: ' + err.message, type: 'error' });
          }
        });
        sidebarSessionList.appendChild(item);
      });
    } catch (e) {
      sidebarSessionList.innerHTML = '<div class="text-error text-xs">Failed to list sessions</div>';
    }
  }

  // --- Sync State from Server ---
  async function syncState() {
    try {
      const st = await sdk.api.getState();
      currentSessionId = st.sessionId;
      messages = st.messages || [];
      appConfig = st.config || {};
      currentUsage = st.usage || { inputTokens: 0, outputTokens: 0, toolCalls: 0, turns: 0 };
      setRunningState(Boolean(st.isRunning));
      renderExistingMessages(messages);
      sdk.emit('usage:update', currentUsage);
      renderAllSlots();
      await loadSessionList();
    } catch (e) {
      console.error('Failed to sync state:', e);
    }
  }

  // --- SSE Event Stream ---
  function connectSSE() {
    // EventSource can't send headers, so the token goes in the query string.
    const sseToken = typeof window !== 'undefined' && window.__MEOWCODE_API_TOKEN__ ? window.__MEOWCODE_API_TOKEN__ : '';
    const sse = new EventSource(sseToken ? '/api/events?token=' + encodeURIComponent(sseToken) : '/api/events');

    sse.onopen = () => {
      connectionStatus.textContent = sdk.i18n.t('statusbar.connected');
      connectionStatus.style.color = 'var(--md-sys-color-primary)';
      sdk.emit('connection:open');
    };

    sse.onerror = () => {
      connectionStatus.textContent = sdk.i18n.t('statusbar.disconnected');
      connectionStatus.style.color = '#F59E0B';
      sdk.emit('connection:error');
    };

    sse.addEventListener('agent:event', (e) => {
      try {
        const payload = JSON.parse(e.data);
        const ev = payload.event;
        sdk.emit('agent:event', ev);

        if (ev.type === 'thinking') {
          appendThinking(ev.text);
        } else if (ev.type === 'text') {
          appendAssistantText(ev.text);
        } else if (ev.type === 'tool_use') {
          handleToolUse(ev);
        } else if (ev.type === 'tool_result') {
          handleToolResult(ev);
        } else if (ev.type === 'usage') {
          currentUsage.inputTokens += ev.inputTokens || 0;
          currentUsage.outputTokens += ev.outputTokens || 0;
          sdk.emit('usage:update', currentUsage);
        } else if (ev.type === 'error') {
          sdk.ui.showToast({ message: ev.message, type: 'error' });
        }
      } catch (err) {
        console.error('Error handling SSE agent:event', err);
      }
    });

    sse.addEventListener('turn:start', () => {
      setRunningState(true);
      sdk.emit('turn:start');
    });

    sse.addEventListener('turn:end', () => {
      setRunningState(false);
      loadSessionList();
    });

    sse.addEventListener('session:state', () => {
      syncState();
    });

    sse.addEventListener('plugin:event', (e) => {
      try {
        const payload = JSON.parse(e.data);
        sdk.emit('plugin:event:' + payload.pluginId, payload.data);
      } catch (_) {}
    });
  }

  // --- Init ---
  window.addEventListener('DOMContentLoaded', async () => {
    connectSSE();
    await syncState();
  });
})();
`
