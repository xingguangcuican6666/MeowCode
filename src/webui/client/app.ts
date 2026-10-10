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
  const queueBtn = document.querySelector('#queue-btn');
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
  // Which side panel the layout is actually showing. The DOM is the source of
  // truth (chatView / customPanelView), and this mirrors it so a panel switch
  // triggered from outside — a plugin calling sdk.panels.setActivePanel(), or a
  // command's openPanel callback — is distinguishable from one this file
  // started. Without it, switchPanel() -> setActivePanel() -> panel:active ->
  // switchPanel() recurses until the stack gives out.
  let currentPanelId = 'chat';
  let activeTurnAssistantEl = null;
  let activeTurnAssistantMessage = null;
  let activeTurnThinkingBody = null;
  let activeTurnThinkingCard = null;
  let currentToolCards = new Map();
  let appConfig = {};
  let seenSubagents = [];
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
  if (queueBtn) queueBtn.addEventListener('click', handleSend);
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

    // Set before setActivePanel: the panel:active handler below ignores an event
    // for the panel already showing, and this call is about to emit one.
    currentPanelId = panelId;

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
        customPanelView.innerHTML = '<div class="empty-state">Panel ' + escapeHtml(panelId) + ' not found</div>';
      }
    }
  }

  document.querySelectorAll('.sidebar-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchPanel(tab);
    });
  });

  // A tab click already goes through switchPanel directly, so this subscription
  // is only the *other* direction: a plugin, or a slash command's openPanel
  // callback, switching panels through the SDK. It must not re-enter
  // switchPanel for the panel it already shows — setActivePanel is called from
  // inside switchPanel, and routing its own event back here recursed until the
  // stack overflowed on every tab click.
  sdk.on('panel:active', (panelId) => {
    if (panelId === currentPanelId) return;
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
      btn.innerHTML = '<span class="material-symbols-outlined tab-icon">' + escapeHtml(iconName) + '</span><span class="tab-label">' + escapeHtml(panel.title) + '</span>';
      btn.addEventListener('click', () => switchPanel(panel.id));
      tabContainer.appendChild(btn);
    }
  });

  // --- Slot Mounting ---
  // Per-message slots are rendered as each row is created, not by the
  // whole-page renderAllSlots() pass: a turn appends rows while the page sweep
  // is not running, so a plugin putting something in message:header would only
  // ever see the rows that existed at the last sweep. The cleanup is stored on
  // the row so removing it (session reset, re-render) unmounts the plugin.
  function slotContext(message) {
    return {
      session: {
        id: currentSessionId,
        title: 'Current Session',
        messages,
        usage: currentUsage,
      },
      message,
      config: appConfig,
      activePanel: sdk.panels.getActivePanel(),
      sdk,
    };
  }

  function renderMessageSlots(row, message) {
    if (!row) return;
    const context = slotContext(message);
    const cleanups = [];
    row.querySelectorAll('[data-slot]').forEach(el => {
      const slotId = el.getAttribute('data-slot');
      if (!slotId) return;
      const cleanup = sdk.slots.renderSlot(slotId, el, context);
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    });
    // Only meaningful while the row is in the transcript; a re-render throws the
    // old rows away wholesale, so expose it rather than tracking a WeakMap.
    row.__slotCleanups = cleanups;
  }

  function disposeMessageSlots(row) {
    if (!row || !row.__slotCleanups) return;
    row.__slotCleanups.forEach(fn => { try { fn(); } catch (e) {} });
    row.__slotCleanups = [];
  }

  function disposeAllMessageSlots(root) {
    (root || chatTranscript).querySelectorAll('.message-row').forEach(disposeMessageSlots);
  }

  function renderAllSlots() {
    slotCleanups.forEach(fn => { try { fn(); } catch(e){} });
    slotCleanups = [];

    const slotElements = document.querySelectorAll('[data-slot]');
    // Skip the per-message mounts: they belong to their own rows and carry the
    // message they render for, which a page-level sweep cannot supply.
    const context = {
      session: {
        id: currentSessionId,
        title: 'Current Session',
        messages,
        usage: currentUsage,
      },
      config: appConfig,
      activePanel: sdk.panels.getActivePanel(),
      sdk,
    };

    slotElements.forEach(el => {
      const slotId = el.getAttribute('data-slot');
      if (!slotId || slotId.startsWith('message:')) return;
      const cleanup = sdk.slots.renderSlot(slotId, el, context);
      if (typeof cleanup === 'function') slotCleanups.push(cleanup);
    });

    // A re-sweep must not stack listeners on slots that were already rendered
    // with their own message context — dispose old cleanups first, then re-render
    // with the correct message for each row.
    chatTranscript.querySelectorAll('.message-row').forEach((row) => {
      const msgId = row.getAttribute('data-message-id');
      if (!msgId) return;
      const message = messages.find(m => m.id === msgId);
      if (message) {
        disposeMessageSlots(row);
        renderMessageSlots(row, message);
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
    // GFM tables. Done with string ops, not a regex: this file is a template
    // literal, so a pipe or backslash inside a /regex/ here would be mangled by
    // the outer template before the browser ever sees it. Must run BEFORE the
    // newline pass below, which would otherwise shatter a table into loose rows.
    html = renderTables(html);
    // Newlines outside code blocks
    const parts = html.split(/(<div class="code-block-wrap">[\\s\\S]*?<\\/div>)/);
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i].split('\\n').join('<br/>').split('\\r').join('');
    }
    return parts.join('');
  }

  // A GitHub-flavored table (header row, a |---|---| separator, then body rows)
  // into <table>. Cells keep whatever inline formatting ran before this (code,
  // bold); their text was escaped at the top of formatMarkdown, so nothing here
  // re-introduces an injection. A pipe inside a cell is the one unsupported case
  // (GFM wants it backslash-escaped), accepted rather than parsed.
  function renderTables(src) {
    const NL = String.fromCharCode(10);
    const lines = src.split(NL);
    const cellsOf = (line) => {
      let s = line.trim();
      if (s.charAt(0) === '|') s = s.slice(1);
      if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
      return s.split('|').map((c) => c.trim());
    };
    const isSeparator = (line) => {
      const s = line.split(' ').join('').split(String.fromCharCode(9)).join('');
      if (!s || s.indexOf('-') < 0) return false;
      for (let k = 0; k < s.length; k++) {
        const ch = s.charAt(k);
        if (ch !== '|' && ch !== ':' && ch !== '-') return false;
      }
      return true;
    };
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const header = lines[i];
      const hasHeaderBar = header && header.indexOf('|') >= 0;
      if (hasHeaderBar && i + 1 < lines.length && isSeparator(lines[i + 1])) {
        const head = cellsOf(header);
        const rows = [];
        let j = i + 2;
        while (j < lines.length && lines[j].indexOf('|') >= 0 && lines[j].trim() !== '') {
          rows.push(cellsOf(lines[j]));
          j++;
        }
        // Build the markup through a wrap() helper and fragment VARIABLES, never a
        // "<tag>" + value literal. Those cell values are already escaped (the whole
        // text passed through escapeHtml at the top of formatMarkdown), so escaping
        // again here would double-encode; and the injection-sink test forbids a
        // bare "<tag>" + value concat precisely because it cannot see that. Routing
        // through wrap(), whose only literals are "<", ">" and "</" (no "<letter"),
        // keeps the markup safe AND out of that forbidden shape.
        const wrap = (tag, inner) => '<' + tag + '>' + inner + '</' + tag + '>';
        let headCells = '';
        for (let h = 0; h < head.length; h++) headCells += wrap('th', head[h]);
        let bodyRows = '';
        for (const r of rows) {
          let tds = '';
          for (let c = 0; c < head.length; c++) tds += wrap('td', r[c] || '');
          bodyRows += wrap('tr', tds);
        }
        const TABLE_OPEN = '<table class="md-table"><thead>';
        const THEAD_CLOSE = '</thead><tbody>';
        const TABLE_CLOSE = '</tbody></table>';
        const t = TABLE_OPEN + wrap('tr', headCells) + THEAD_CLOSE + bodyRows + TABLE_CLOSE;
        out.push(t);
        i = j;
      } else {
        out.push(header);
        i++;
      }
    }
    return out.join(NL);
  }

  function appendUserMessage(content, message) {
    if (chatWelcome) chatWelcome.style.display = 'none';

    const row = document.createElement('div');
    row.className = 'message-row user';

    row.innerHTML = \`
      <div class="message-meta-row">
        <span>You</span>
        <span>•</span>
        <span>\${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div class="meow-slot message-header-slot" data-slot="message:header"></div>
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
    renderMessageSlots(row, message || { id: 'pending', role: 'user', content });
    scrollToBottom();
    return row;
  }

  function ensureAssistantCard() {
    if (activeTurnAssistantEl) return activeTurnAssistantEl;
    if (chatWelcome) chatWelcome.style.display = 'none';
    activeTurnAssistantMessage = { id: 'streaming-' + Date.now(), role: 'assistant', content: '' };

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
      <div class="meow-slot message-header-slot" data-slot="message:header"></div>
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
    // Streaming rows carry the message being built, so its slots see a live
    // content instead of nothing at all.
    renderMessageSlots(row, activeTurnAssistantMessage);
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
    // Keep the streaming row's slots in step with its own content.
    if (activeTurnAssistantMessage) {
      activeTurnAssistantMessage.content = textNode.dataset.raw;
    }
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
        // A todo's status arrives from the model's todo_write payload and lands in a
        // class attribute, so it is filtered down to the three states this
        // renderer knows how to draw rather than interpolated as written.
        const state = status === 'completed' || status === 'in_progress' ? status : 'pending';
        const isDone = state === 'completed';
        const isProg = state === 'in_progress';
        const icon = isDone ? 'check_circle' : isProg ? 'sync' : 'radio_button_unchecked';
        const statusLabel = isDone ? t('todo.completed', 'Completed') : isProg ? t('todo.inProgress', 'In Progress') : t('todo.pending', 'Pending');
        const tagClass = isDone ? 'todo-tag-completed' : isProg ? 'todo-tag-progress' : 'todo-tag-pending';
        const displayText = isProg && item.activeForm ? item.activeForm : (item.content || '');

        return \`
          <div class="todo-item \${state}">
            <span class="material-symbols-outlined todo-item-icon \${isProg ? 'icon-spin' : ''}">\${escapeHtml(icon)}</span>
            <span class="todo-item-text">\${escapeHtml(displayText)}</span>
            <span class="todo-status-tag \${tagClass}">\${escapeHtml(statusLabel)}</span>
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

  // A command's own output lands in the transcript. Errors get the same styling
  // the server-side system rows use, so a failed /model reads the same whether it
  // came from a reload or from the palette.
  function appendNotice(content, isError) {
    const row = document.createElement('div');
    row.className = 'message-row system' + (isError ? ' is-error' : '');
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    // Render markdown, not plain text: a command's output is markdown (/help is a
    // bulleted list, /status has code spans), and textContent collapsed every
    // newline to a space — "/help" came out as one unreadable wall with literal
    // ** and backticks. formatMarkdown escapes before it formats, so this is safe.
    bubble.innerHTML = formatMarkdown(String(content == null ? '' : content));
    row.appendChild(bubble);
    chatTranscript.appendChild(row);
    scrollToBottom();
  }

  // Render ONE tool card from a (call, result) pair — the same shape the live
  // SSE path builds in handleToolUse + handleToolResult, so a reloaded transcript
  // and a live one are identical. result is null for a call whose result has not
  // arrived (an in-flight call, or an interrupted one restored from history);
  // then the card reads as running rather than inventing a finished state.
  function renderToolMessageCard(wrap, call, result, preferGeneric) {
    const customRenderer = !preferGeneric && call.name ? sdk.tools.getRenderer(call.name) : null;
    if (customRenderer) {
      wrap.innerHTML = '';
      customRenderer.render(wrap, call, result || undefined);
      return;
    }
    // No registered renderer (grep, list_dir, web_fetch, …), OR a lossy history
    // row we only have text for (preferGeneric): a generic terminal card, matching
    // handleToolUse's fallback so the two paths cannot diverge.
    const isError = Boolean(result && result.isError);
    const tag = result
      ? '<span class="tool-tag ' + (isError ? 'tag-error' : 'tag-success') + '">' + (isError ? 'Failed' : 'Success') + '</span>'
      : '<span class="tool-tag tag-running">Running...</span>';
    const bodySrc = result ? (result.display || result.content || '') : JSON.stringify(call.input || {}, null, 2);
    const body = bodySrc
      ? '<pre class="terminal-output ' + (isError ? 'output-error' : '') + '">' + escapeHtml(bodySrc) + '</pre>'
      : '';
    wrap.className = 'tool-card';
    wrap.innerHTML = \`
      <div class="terminal-header">
        <span style="display:inline-flex;align-items:center;gap:6px;">
          <span class="material-symbols-outlined icon-sm">terminal</span>
          <span>\${escapeHtml(call.name || 'tool')}</span>
        </span>
        \${tag}
      </div>
      \${body}
    \`;
  }

  function renderExistingMessages(msgs) {
    disposeAllMessageSlots();
    chatTranscript.innerHTML = '';
    activeTurnAssistantEl = null;
    activeTurnAssistantMessage = null;
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

    // A tool call is persisted as TWO messages: a header (id = the call id,
    // meta.toolInput, content "● name · arg") and a result (id = call id + "-r",
    // meta.toolContent / diff). The live path pairs them into one card by id;
    // rendering each as its own card here is what produced a duplicate — a card
    // showing the raw "● read_file · path" header, then a second card with the
    // real output. So pair them: the header creates the card, the result fills
    // it in place, and an unmatched header stays as a running card.
    const pendingToolWraps = new Map();
    // Shape-2 (text transcript) pairing is positional, not by id — the previous
    // "● name · arg" header waiting for its "⎿ …" result line.
    let textPending = null;

    msgs.forEach(m => {
      if (m.content === '__banner__') return;
      if (m.role === 'user') {
        appendUserMessage(m.content, m);
      } else if (m.role === 'assistant') {
        if (m.meta?.thinking) {
          appendThinking(m.content);
        } else {
          appendAssistantText(m.content);
        }
      } else if (m.role === 'tool') {
        const toolName = m.meta?.toolName;
        const content = typeof m.content === 'string' ? m.content : '';

        // Todo lists live in the floating dock, never the transcript — either shape.
        if (toolName === 'todo_write' || content.startsWith('● todo_write') || content.startsWith('⎿ todo_write')) {
          return;
        }

        // Shape 1 — WebUI AgentBridge persistence: meta.toolName + id/"id-r"
        // pairing, routed through the real per-tool renderers (bash terminal,
        // read card, diff viewer).
        if (toolName) {
          const isResult = typeof m.id === 'string' && m.id.endsWith('-r');
          if (isResult) {
            const result = {
              id: m.id,
              name: toolName,
              content: m.meta?.toolContent || m.content,
              display: m.meta?.toolDisplay,
              diff: m.meta?.diff,
              isError: Boolean(m.meta?.error),
            };
            const pending = pendingToolWraps.get(m.id.slice(0, -2));
            if (pending) {
              renderToolMessageCard(pending.wrap, pending.call, result);
              pendingToolWraps.delete(m.id.slice(0, -2));
            } else {
              const container = ensureAssistantCard();
              const div = document.createElement('div');
              renderToolMessageCard(div, { id: result.id, name: toolName, input: {} }, result);
              container.appendChild(div);
            }
            return;
          }
          const container = ensureAssistantCard();
          const div = document.createElement('div');
          const call = { id: m.id, name: toolName, input: m.meta?.toolInput || {} };
          renderToolMessageCard(div, call, null);
          container.appendChild(div);
          pendingToolWraps.set(m.id, { wrap: div, call });
          return;
        }

        // Shape 2 — TUI/launcher persistence: no meta, raw glyph transcript text.
        // "● name · arg" is a header, "⎿ …" its result, paired positionally (ids
        // are sequential, not id/"id-r"). Parsed into a generic card so a reloaded
        // TUI session reads as cards, not the ●/⎿ lines the user reported.
        // preferGeneric: the structured input is gone, so the per-tool renderers
        // (which read call.input) would draw an empty card.
        if (content.charAt(0) === '●') {
          const rest = content.slice(1).trim();
          const dotIdx = rest.indexOf('·');
          const name = (dotIdx >= 0 ? rest.slice(0, dotIdx) : rest).trim();
          const arg = dotIdx >= 0 ? rest.slice(dotIdx + 1).trim() : '';
          const container = ensureAssistantCard();
          const div = document.createElement('div');
          const call = { name: name, input: {} };
          renderToolMessageCard(div, call, arg ? { content: arg } : null, true);
          container.appendChild(div);
          textPending = { wrap: div, call: call, arg: arg };
          return;
        }
        if (content.charAt(0) === '⎿') {
          const body = content.slice(1).trim();
          if (textPending) {
            renderToolMessageCard(textPending.wrap, textPending.call, { content: body || textPending.arg }, true);
            textPending = null;
          } else {
            const container = ensureAssistantCard();
            const div = document.createElement('div');
            div.className = 'tool-card';
            div.innerHTML = \`<div class="terminal-output">\${escapeHtml(body)}</div>\`;
            container.appendChild(div);
          }
          return;
        }

        // Neither shape — a plain tool message (e.g. a demo fixture). Keep it legible.
        const container = ensureAssistantCard();
        const div = document.createElement('div');
        div.className = 'tool-card';
        div.innerHTML = \`<div class="terminal-output">\${escapeHtml(content)}</div>\`;
        container.appendChild(div);
      } else if (m.role === 'system' && m.meta?.error) {
        const errRow = document.createElement('div');
        errRow.className = 'message-row system';
        errRow.innerHTML = \`<div class="message-bubble">\${escapeHtml(m.content)}</div>\`;
        chatTranscript.appendChild(errRow);
      }
    });

    activeTurnAssistantEl = null;
    activeTurnAssistantMessage = null;
    activeTurnThinkingCard = null;
    activeTurnThinkingBody = null;
    scrollToBottom();
  }

  function scrollToBottom() {
    chatTranscript.scrollTop = chatTranscript.scrollHeight;
  }

  // The TUI's own test for "this line is a slash command" (commands/isCommand),
  // restated because the client is served as a raw string with no module graph:
  // the browser and the server must agree on which lines are commands, or a line
  // this side queues as prose comes back from the server as a command.
  function isCommand(text) {
    return String(text).trim().startsWith('/');
  }

  // --- Send / Abort Turn ---
  // Is this command terminal-only? Read from the fetched /api/commands metadata
  // (paletteCommands, populated at boot). A tuiOnly command — /login, /vim,
  // /editor — has no browser action, so running it just prints "terminal only";
  // the palette turns it into "copy the CLI line" instead, and the composer must
  // do the same or typing /login looks broken (it used to hit the model and get
  // "Not logged in to MeowArch API").
  function commandIsTuiOnly(name) {
    const c = paletteCommands.find((x) => x.name === name || (x.aliases || []).indexOf(name) >= 0);
    return !!(c && c.tuiOnly);
  }
  async function copyCliForCommand(name) {
    const cli = 'meowcode ' + name;
    try {
      await navigator.clipboard.writeText(cli);
      sdk.ui.showToast({ message: sdk.i18n.t('palette.copied', { cmd: cli }), type: 'info' });
    } catch (e) {
      sdk.ui.showToast({ message: cli, type: 'info' });
    }
  }

  async function handleSend() {
    const text = promptInput.value.trim();
    if (!text) return;

    promptInput.value = '';
    autoResizeInput();

    // A slash command is NOT a prompt — route it to the command runner, never to
    // the model. Hoisted ABOVE the running/idle split: the idle path used to fall
    // straight through to sendMessage(), so typing "/login" while idle posted it
    // to /api/turn and the provider answered "⚠ Not logged in to MeowArch API…"
    // instead of the command running. (The type-ahead branch already did this; the
    // idle branch did not.) Echo the typed line first, like the TUI does.
    if (isCommand(text)) {
      const name = text.slice(1).split(/\s+/)[0];
      // Terminal-only command: copy the CLI line (same as the palette), don't run
      // it as a prompt and don't fake a transcript row.
      if (commandIsTuiOnly(name)) {
        await copyCliForCommand(name);
        return;
      }
      appendUserMessage(text);
      await runSlashCommand(name, text.slice(1 + name.length).trim());
      return;
    }

    // Type-ahead: a turn is already streaming, so queue the line instead of
    // dropping it. The agent loop drains it after the next tool batch (takePending),
    // which is exactly how the TUI behaves while it streams.
    if (isRunning) {
      appendUserMessage(text);
      try {
        await sdk.api.queueTurnText(text);
        sdk.ui.showToast({ message: sdk.i18n.t('chat.queued'), type: 'info' });
      } catch (e) {
        sdk.ui.showToast({ message: 'Error: ' + e.message, type: 'error' });
      }
      return;
    }

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
    if (queueBtn) queueBtn.style.display = running ? 'inline-flex' : 'none';
    // Stay typeable while a turn streams: Enter then queues the line for the
    // running turn (handleSend → /api/turn/queue) instead of being dropped.
    promptInput.disabled = false;
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

  // --- Provider retry / workflow / sub-agent chrome ---
  // These three agent events used to be dropped on the floor even though the bridge
  // emits them: a silent retry looks like a hang, and an invisible workflow looks
  // like the model stopped working.

  let activeRetryUntil = null;

  function appendRetryNotice(ev) {
    const host = document.querySelector('#retry-notice');
    if (!host) return;
    activeRetryUntil = Date.now() + (ev.delayMs || 0);
    const secs = Math.max(0, Math.round((ev.delayMs || 0) / 1000));
    host.textContent = sdk.i18n.t('chat.retrying', {
      attempt: ev.attempt,
      max: ev.max,
      secs: secs,
      reason: ev.reason || '',
    });
    host.classList.remove('hidden');
    sdk.emit('agent:retry', ev);
  }

  function clearRetryNotice() {
    activeRetryUntil = null;
    const host = document.querySelector('#retry-notice');
    if (host) {
      host.textContent = '';
      host.classList.add('hidden');
    }
  }

  function renderAgentList(list, activeId, kind) {
    const host = document.querySelector('#subagent-strip');
    if (!host) return;
    const items = (list || []).map((a) => {
      const sel = a.id === activeId ? ' active' : '';
      const st = a.state || 'running';
      // steps is a count, but it arrives over SSE like every other field here,
      // so it gets the same treatment rather than being trusted by type.
      const steps = Number(a.steps) > 0 ? String(Math.floor(Number(a.steps))) : '';
      return '<button type="button" class="subagent-chip' + sel + '" data-subagent-id="' +
        escapeHtml(a.id) + '" data-subagent-kind="' + escapeHtml(kind || 'agent') + '">' +
        '<span class="material-symbols-outlined icon-xs">' +
        (st === 'done' ? 'check_circle' : st === 'error' ? 'error' : 'pending') +
        '</span><span class="subagent-chip-label">' + escapeHtml(a.label || a.id) + '</span>' +
        (steps ? '<span class="subagent-chip-steps">' + escapeHtml(steps) + '</span>' : '') +
        '</button>';
    });
    host.innerHTML = items.join('');
    host.classList.toggle('hidden', items.length === 0);
  }

  function updateWorkflowView(snap) {
    if (!snap) return;
    renderAgentList(snap.agents, null, 'workflow');
    if (snap.done) {
      if (agentActivityStatus) agentActivityStatus.textContent = sdk.i18n.t('statusbar.ready');
    } else if (agentActivityStatus) {
      const running = (snap.agents || []).filter((a) => a.state === 'running').length;
      agentActivityStatus.textContent = snap.title +
        ' (' + running + '/' + (snap.agents || []).length + ')';
    }
    sdk.emit('agent:workflow', snap);
  }

  function updateAgentView(snap) {
    if (!snap) return;
    // AgentSnapshot is one live sub-agent transcript; keep a strip of every one
    // seen this turn so the user can tell what the model delegated.
    seenSubagents = seenSubagents.filter((a) => a.id !== snap.id);
    seenSubagents.push({ id: snap.id, label: snap.label || snap.type || snap.id, state: snap.state, steps: snap.steps });
    renderAgentList(seenSubagents, snap.id, 'agent');
    if (agentActivityStatus) {
      agentActivityStatus.textContent = snap.done
        ? sdk.i18n.t('statusbar.ready')
        : (snap.activity || snap.type || sdk.i18n.t('statusbar.running'));
    }
    sdk.emit('agent:subagent', snap);
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
  const cmdPalettePreview = document.querySelector('#cmd-palette-preview');
  const cmdPaletteHint = document.querySelector('#cmd-palette-hint');
  const cmdPaletteCount = document.querySelector('#cmd-palette-count');
  const cmdPaletteCloseBtn = document.querySelector('#cmd-palette-close-btn');
  const cmdPaletteCancelBtn = document.querySelector('#cmd-palette-cancel-btn');

  // --- Dialog widgets ------------------------------------------------------
  // Four shapes cover every interactive question a command can ask. Each returns
  // null on cancel, so a caller can distinguish "declined" from "answered with
  // the same value" without a sentinel.

  function askEnum(title, options, opts = {}) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'dialog-enum';
      options.forEach((opt, i) => {
        const row = document.createElement('button');
        const selected = opts.current !== undefined && String(opt.value) === String(opts.current);
        row.type = 'button';
        row.className = 'dialog-enum-row' + (selected ? ' is-active' : '');
        row.setAttribute('role', 'radio');
        row.setAttribute('aria-checked', selected ? 'true' : 'false');
        // 1-9 selects directly; the hint says so rather than leaving the user
        // to discover it.
        row.innerHTML = \`
          <span class="dialog-enum-key">\${i < 9 ? i + 1 : ''}</span>
          <span class="dialog-enum-text">
            <span class="dialog-enum-label">\${escapeHtml(opt.label)}</span>
            \${opt.description ? \`<span class="dialog-enum-desc">\${escapeHtml(opt.description)}</span>\` : ''}
          </span>
        \`;
        row.onclick = () => {
          close();
          resolve(opt.value);
        };
        wrap.appendChild(row);
      });
      // Focus lands on the current value so Enter is never a blind commit.
      const initial = wrap.querySelector('.is-active') || wrap.querySelector('.dialog-enum-row');
      if (initial) initial.dataset.autofocus = '';
      const close = sdk.ui.showModal({
        title,
        width: '460px',
        content: wrap,
        cancelText: sdk.i18n.t('common.cancel'),
        confirmText: sdk.i18n.t('common.apply'),
        onCancel: () => resolve(null),
        onConfirm: () => {
          const active = wrap.querySelector('.is-active');
          if (!active) return false;
          resolve(Number(active.dataset.index));
          return undefined;
        },
      });
      // data-index is what onConfirm reads back; assign after the listeners.
      wrap.querySelectorAll('.dialog-enum-row').forEach((row, i) => { row.dataset.index = String(i); });
      // 1-9 pick a row directly; Enter commits the current one.
      wrap.addEventListener('keydown', (e) => {
        if (!/^[1-9]$/.test(e.key)) return;
        const row = wrap.querySelectorAll('.dialog-enum-row')[Number(e.key) - 1];
        if (row) row.click();
      });
    });
  }

  function askChoice(title, items, opts = {}) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'dialog-choice';
      const search = document.createElement('input');
      search.type = 'text';
      search.className = 'dialog-choice-search';
      search.placeholder = opts.placeholder || sdk.i18n.t('common.search');
      const list = document.createElement('div');
      list.className = 'dialog-choice-list';
      list.setAttribute('role', 'listbox');
      wrap.appendChild(search);
      wrap.appendChild(list);

      function draw() {
        const q = search.value.trim().toLowerCase();
        const filtered = items.filter((it) =>
          !q || String(it.label).toLowerCase().includes(q) || String(it.value).toLowerCase().includes(q));
        list.innerHTML = '';
        if (!filtered.length) {
          list.innerHTML = \`<div class="empty-state text-dim text-xs">\${escapeHtml(sdk.i18n.t('dialog.noResults'))}</div>\`;
          return;
        }
        filtered.forEach((it) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'dialog-choice-row';
          row.setAttribute('role', 'option');
          row.innerHTML = \`<span>\${escapeHtml(it.label)}</span>\${it.description ? \`<span class="dialog-choice-desc">\${escapeHtml(it.description)}</span>\` : ''}\`;
          row.onclick = () => {
            close();
            resolve(it.value);
          };
          list.appendChild(row);
        });
      }

      search.addEventListener('input', draw);
      search.dataset.autofocus = '';
      draw();
      const close = sdk.ui.showModal({
        title,
        width: '440px',
        content: wrap,
        cancelText: sdk.i18n.t('common.cancel'),
        confirmText: sdk.i18n.t('common.save'),
        onCancel: () => resolve(null),
      });
    });
  }

  function askConfirm(title, message, opts = {}) {
    return new Promise((resolve) => {
      const wrap = document.createElement('p');
      wrap.className = 'dialog-confirm';
      wrap.textContent = message;
      sdk.ui.showModal({
        title,
        width: '400px',
        content: wrap,
        cancelText: sdk.i18n.t('common.cancel'),
        confirmText: opts.confirmText || sdk.i18n.t('common.done'),
        onCancel: () => resolve(false),
        onConfirm: () => { resolve(true); },
        className: opts.destructive ? 'is-destructive' : '',
        // A destructive action starts on Cancel: Enter must never be the
        // dangerous answer to a question you did not read.
        autofocusCancel: opts.destructive,
      });
    });
  }

  function askText(title, opts = {}) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'dialog-text';
      const input = document.createElement(opts.multiline ? 'textarea' : 'input');
      if (!opts.multiline) input.type = 'text';
      input.className = 'dialog-text-input';
      input.placeholder = opts.placeholder || '';
      input.value = opts.value || '';
      if (opts.multiline) input.rows = 4;
      input.dataset.autofocus = '';
      const hint = document.createElement('p');
      hint.className = 'dialog-text-hint text-dim text-xs';
      hint.textContent = sdk.i18n.t('dialog.text.submitHint');
      wrap.appendChild(input);
      wrap.appendChild(hint);
      // Ctrl/Cmd+Enter submits: a textarea eats plain Enter as a newline.
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          wrap.closest('.modal-container').querySelector('.modal-btn-confirm').click();
        }
      });
      sdk.ui.showModal({
        title,
        width: opts.width || '520px',
        content: wrap,
        cancelText: sdk.i18n.t('common.cancel'),
        confirmText: opts.confirmText || sdk.i18n.t('common.send'),
        onCancel: () => resolve(null),
        onConfirm: () => {
          const text = input.value.trim();
          if (!text) return false;
          resolve(text);
          return undefined;
        },
      });
    });
  }

  // --- Command Palette: the real slash-command registry -------------------
  // Was nine hardcoded entries that shared nothing with the TUI's ~45. The list
  // now comes from GET /api/commands, so a command added as a Markdown file
  // under .meowcode/commands appears here without touching the browser.

  const CLIENT_COMMANDS = [
    { name: 'demo', icon: 'auto_awesome', title: 'Demo Showcase', desc: 'Experience the full agent reasoning & tool showcase', local: true, run: () => playDemoShowcase() },
    { name: 'files', icon: 'folder', title: 'Browse Files', desc: 'Switch to the workspace file explorer', local: true, run: () => switchPanel('files') },
    { name: 'tools', icon: 'construction', title: 'Inspect Tools', desc: 'Switch to the agent tool inspector', local: true, run: () => switchPanel('tools') },
    { name: 'ws', icon: 'developer_board', title: 'Workspace Info', desc: 'Repository, branch, provider and model', local: true, run: () => openWorkspaceInfo() },
    { name: 'model', icon: 'psychology', title: 'Switch Model', desc: 'Pick the model from a list', local: true, run: () => askEnum(sdk.i18n.t('modal.model.title'), MODELS.map((m) => ({ value: m.id, label: m.name, description: m.desc })), { current: appConfig.model }).then((id) => { if (id) sdk.api.updateConfig({ model: id }); }) },
  ];

  let paletteCommands = [];

  // The five groups from the design spec. A command lands in the first bucket
  // whose name list contains it; anything unrecognised falls through to the
  // last, so a new command is never invisible.
  const PALETTE_GROUPS = [
    { id: 'recent', label: 'palette.group.recent', names: ['demo', 'files', 'tools', 'ws', 'help', 'init'] },
    { id: 'orchestration', label: 'palette.group.orchestration', names: ['loop', 'goal', 'plan', 'review', 'agents', 'dm', 'skill', 'memory'] },
    { id: 'context', label: 'palette.group.context', names: ['model', 'provider', 'effort', 'output-style', 'autocompact', 'compact', 'config', 'theme', 'vim', 'statusline', 'permissions', 'editor', 'status', 'usage', 'stats', 'copy', 'rewind'] },
    { id: 'session', label: 'palette.group.session', names: ['clear', 'new', 'sessions', 'resume', 'fork', 'exit', 'version', 'doctor', 'hooks', 'mcp', 'entry', 'worktree', 'ide', 'chrome', 'feedback', 'export', 'login', 'logout', 'terminal-setup', 'web', 'webui'] },
    { id: 'custom', label: 'palette.group.custom', names: [] },
  ];

  function paletteGroupFor(name) {
    for (const group of PALETTE_GROUPS) {
      if (group.names.includes(name)) return group.id;
    }
    return 'custom';
  }

  const CMD_ICONS = {
    help: 'help_outline', clear: 'delete_sweep', new: 'add', model: 'psychology',
    provider: 'cloud', login: 'login', logout: 'logout', effort: 'speed',
    'output-style': 'format_ink_highlighter', vim: 'keyboard', theme: 'palette',
    goal: 'flag', plan: 'architecture', loop: 'loop', memory: 'brain',
    config: 'tune', usage: 'monitoring', status: 'info', stats: 'query_stats',
    compact: 'compress', autocompact: 'compress', skill: 'school', init: 'rocket_launch',
    hooks: 'webhook', mcp: 'hub', agents: 'groups', doctor: 'health_and_safety',
    export: 'download', review: 'rate_review', 'terminal-setup': 'terminal',
    statusline: 'view_agenda', permissions: 'lock', copy: 'content_copy',
    worktree: 'account_tree', editor: 'edit', feedback: 'rate_review',
    rewind: 'undo', dm: 'forum', sessions: 'chat', ide: 'code', chrome: 'travel_explore',
    entry: 'dashboard_customize', resume: 'history', fork: 'call_split',
    version: 'tag', exit: 'logout', web: 'language',
  };

  async function loadPaletteCommands() {
    try {
      const data = await sdk.api.listCommands();
      paletteCommands = Array.isArray(data.commands) ? data.commands : [];
    } catch (e) {
      console.warn('Could not load commands:', e);
      paletteCommands = [];
    }
    if (cmdPaletteModal && cmdPaletteModal.style.display !== 'none') renderCommandPaletteList();
  }

  // Every row the palette can show: registry commands plus the browser-only
  // extras, each tagged with the group and the shape of its argument.
  function paletteRows() {
    const rows = CLIENT_COMMANDS.concat(pluginRows()).map((c) => ({
      key: c.name,
      name: c.name,
      title: c.title,
      desc: c.desc,
      icon: c.icon,
      group: paletteGroupFor(c.name),
      local: true,
      tuiOnly: false,
      run: c.run,
    }));
    // A browser-native row replaces the registry entry of the same name, so
    // /model appears once — as the dialog, not as the terminal command.
    const native = new Set(rows.map((r) => r.name));
    for (const cmd of paletteCommands) {
      if (native.has(cmd.name)) continue;
      rows.push({
        key: cmd.name,
        name: cmd.name,
        title: '/' + cmd.name,
        desc: cmd.description || '',
        icon: CMD_ICONS[cmd.name] || 'terminal',
        group: paletteGroupFor(cmd.name),
        local: false,
        tuiOnly: cmd.tuiOnly === true,
        aliases: cmd.aliases || [],
      });
    }
    return rows;
  }

  // Plugins register through sdk.commands.register(); they arrive as plain
  // {id, title, execute} entries, so they join the palette as a custom group
  // rather than needing a server round-trip.
  sdk.on('command:registered', () => {
    if (cmdPaletteModal && cmdPaletteModal.style.display !== 'none') renderCommandPaletteList();
  });

  function pluginRows() {
    return (sdk.commands.getCommands() || [])
      .filter((c) => c && c.id)
      .map((c) => ({
        key: 'plugin:' + c.id,
        name: c.id,
        title: c.title || c.id,
        desc: c.description || sdk.i18n.t('palette.pluginSource'),
        icon: c.icon || 'extension',
        group: 'custom',
        local: true,
        tuiOnly: false,
        run: () => sdk.commands.execute(c.id),
      }));
  }

  let paletteFiltered = [];
  let paletteIndex = 0;
  let paletteInPreview = false;

  function openCommandPalette() {
    if (!cmdPaletteModal) return;
    cmdPaletteModal.style.display = 'flex';
    paletteInPreview = false;
    if (cmdPaletteSearchInput) {
      cmdPaletteSearchInput.value = '';
      setTimeout(() => cmdPaletteSearchInput.focus(), 60);
    }
    renderCommandPaletteList();
  }

  function renderCommandPaletteList() {
    if (!cmdPaletteList) return;
    const q = (cmdPaletteSearchInput ? cmdPaletteSearchInput.value : '').trim().toLowerCase();
    // Snapshot before reassigning: the "keep the selection across a re-filter"
    // lookup below reads paletteFiltered, so reading the key after the assignment
    // looks for the old key in the new list and lands on -1 — which Math.max(0, …)
    // turns into a reset to the first row on every keystroke.
    const previousKey = paletteFiltered[paletteIndex] ? paletteFiltered[paletteIndex].key : null;
    const all = paletteRows();
    const matches = all.filter((c) =>
      !q || c.title.toLowerCase().includes(q) || (c.desc || '').toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) || (c.aliases || []).some((a) => a.includes(q)) ||
      // The CLI chip is drawn on every terminal-only row, so it has to be
      // searchable too — otherwise "cli" and "terminal" match nothing at all.
      (c.tuiOnly ? 'cli terminal only' : '').includes(q));

    // Grouped, in PALETTE_GROUPS order. The rows arrive in registry order, which
    // interleaves the groups ("最近与推荐, 上下文与模型, … 最近与推荐, …"), and a
    // header is emitted per change of group — so unsorted, 57 rows printed 24
    // headers, most of them for a group the reader had already left. Sorting is
    // what makes the header mean "everything below this until the next one".
    // The sort is stable, so a query's own ordering survives inside each group.
    const rank = new Map(PALETTE_GROUPS.map((g, i) => [g.id, i]));
    paletteFiltered = matches
      .map((c, i) => [c, i])
      .sort((a, b) => (rank.get(a[0].group) ?? 99) - (rank.get(b[0].group) ?? 99) || a[1] - b[1])
      .map((p) => p[0]);

    if (!paletteFiltered.length) {
      cmdPaletteList.innerHTML = \`<div class="empty-state text-dim text-xs" style="padding:16px;">\${escapeHtml(sdk.i18n.t('dialog.noResults'))}</div>\`;
      // The hint and the count are still the user's next click of information;
      // returning early without them leaves a stale "12" and a stale Enter hint
      // beside an empty list.
      renderCommandPreview(null);
      updatePaletteHint();
      return;
    }
    // Preserve the selection across a re-filter when the row survives it.
    paletteIndex = Math.max(0, paletteFiltered.findIndex((c) => c.key === previousKey));

    cmdPaletteList.innerHTML = '';
    let lastGroup = null;
    paletteFiltered.forEach((cmd, i) => {
      if (cmd.group !== lastGroup) {
        lastGroup = cmd.group;
        const head = document.createElement('div');
        head.className = 'cmd-palette-group';
        head.textContent = sdk.i18n.t(PALETTE_GROUPS.find((g) => g.id === cmd.group)?.label || 'palette.group.custom');
        cmdPaletteList.appendChild(head);
      }
      const row = document.createElement('div');
      row.className = 'cmd-palette-row' + (i === paletteIndex ? ' is-focused' : '') + (cmd.tuiOnly ? ' is-tui-only' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', i === paletteIndex ? 'true' : 'false');
      // The row's identity, for the palette's own tests and for a probe that
      // wants to say which command it drove without reading its label.
      row.setAttribute('data-command', cmd.key);
      row.innerHTML = \`
        <span class="material-symbols-outlined cmd-palette-icon">\${escapeHtml(cmd.icon || 'terminal')}</span>
        <span class="cmd-palette-info">
          <span class="cmd-palette-title">\${escapeHtml(cmd.title)}\${cmd.tuiOnly ? '<span class="cmd-chip-terminal" title="Runs in the terminal only">CLI</span>' : ''}</span>
          <span class="cmd-palette-desc">\${escapeHtml(cmd.desc || '')}</span>
        </span>
      \`;
      row.onclick = () => {
        paletteIndex = i;
        paletteInPreview = true;
        renderCommandPaletteList();
      };
      row.ondblclick = () => { paletteIndex = i; executePaletteCommand(cmd); };
      cmdPaletteList.appendChild(row);
    });

    const focused = cmdPaletteList.querySelector('.cmd-palette-row.is-focused');
    if (focused) focused.scrollIntoView({ block: 'nearest' });
    updatePaletteHint();
    renderCommandPreview(paletteFiltered[paletteIndex] || null);
  }

  // The footer hint is the only place that states the keyboard contract, so it
  // changes with the focus: what Enter will do depends on whether the preview
  // pane holds the focus, and a TUI-only row's Enter copies rather than runs.
  function updatePaletteHint() {
    if (cmdPaletteModal) cmdPaletteModal.querySelector('.cmd-palette-container').classList.toggle('is-in-preview', paletteInPreview);
    if (cmdPaletteCount) {
      const total = paletteRows().length;
      cmdPaletteCount.textContent = paletteFiltered.length === total
        ? String(total)
        : sdk.i18n.t('palette.count', { n: paletteFiltered.length, total });
    }
    if (!cmdPaletteHint) return;
    const cmd = paletteFiltered[paletteIndex];
    if (!cmd) {
      cmdPaletteHint.textContent = sdk.i18n.t('palette.hint.none');
      return;
    }
    const enterKey = paletteInPreview
      ? sdk.i18n.t('palette.hint.runButton')
      : cmd.tuiOnly
        ? sdk.i18n.t('palette.hint.copy')
        : sdk.i18n.t('palette.hint.run');
    cmdPaletteHint.textContent = enterKey + ' · ' + sdk.i18n.t('palette.hint.navigate');
  }

  // Moving focus into the preview pane puts it on the action button, so Tab and
  // Enter both act on what the pane describes. Tab there is a no-op bounce back,
  // which is what makes Tab a reliable "toggle columns" key.
  function focusPreview() {
    const btn = cmdPalettePreview && cmdPalettePreview.querySelector('.cmd-preview-run');
    if (btn) btn.focus();
  }

  function renderCommandPreview(cmd) {
    if (!cmdPalettePreview) return;
    if (!cmd) {
      cmdPalettePreview.innerHTML = \`<div class="cmd-preview-empty text-dim text-xs">\${escapeHtml(sdk.i18n.t('palette.preview.empty'))}</div>\`;
      return;
    }
    const aliases = (cmd.aliases || []).length
      ? \`<div class="cmd-preview-aliases"><span class="cmd-preview-label">\${escapeHtml(sdk.i18n.t('palette.preview.aliases'))}</span>\${cmd.aliases.map((a) => \`<code>/\${escapeHtml(a)}</code>\`).join(' ')}</div>\`
      : '';
    const status = cmd.tuiOnly
      ? \`<span class="cmd-preview-pill is-terminal">\${escapeHtml(sdk.i18n.t('palette.tuiOnly'))}</span>\`
      : \`<span class="cmd-preview-pill is-web">\${escapeHtml(sdk.i18n.t('palette.webRunnable'))}</span>\`;
    cmdPalettePreview.innerHTML = \`
      <div class="cmd-preview-head">
        <span class="material-symbols-outlined cmd-preview-icon">\${escapeHtml(cmd.icon || 'terminal')}</span>
        <div>
          <div class="cmd-preview-title">\${escapeHtml(cmd.title)}</div>
          <div class="cmd-preview-desc">\${escapeHtml(cmd.desc || '')}</div>
        </div>
      </div>
      \${aliases}
      <div class="cmd-preview-status">\${status}</div>
      <p class="cmd-preview-hint text-dim text-xs">\${escapeHtml(cmd.tuiOnly ? sdk.i18n.t('palette.copyHint') : sdk.i18n.t('palette.runHint'))}</p>
      <button class="m3-action-btn m3-btn-filled cmd-preview-run" type="button">
        \${escapeHtml(cmd.tuiOnly ? sdk.i18n.t('palette.copyAction') : sdk.i18n.t('palette.runAction'))}
      </button>
    \`;
    const runBtn = cmdPalettePreview.querySelector('.cmd-preview-run');
    if (runBtn) runBtn.onclick = () => executePaletteCommand(cmd);
    updatePaletteHint();
  }

  function movePaletteSelection(delta) {
    if (!paletteFiltered.length) return;
    paletteIndex = (paletteIndex + delta + paletteFiltered.length) % paletteFiltered.length;
    paletteInPreview = false;
    renderCommandPaletteList();
  }

  // TUI-only commands are copied rather than run: their CommandContext callbacks
  // (overlay pickers, the loop driver, the login panel) have no browser host, so
  // running one would print "terminal only" and do nothing.
  async function executePaletteCommand(cmd) {
    if (!cmd) return;
    if (cmd.local) {
      closeCommandPalette();
      await cmd.run();
      return;
    }
    if (cmd.tuiOnly) {
      closeCommandPalette();
      await copyCliForCommand(cmd.name);
      return;
    }
    closeCommandPalette();
    await runSlashCommand(cmd.name, '');
  }

  // What a command wants before it can run. Most are derived from the SETTINGS
  // row the command writes to (via \`setting\`), so /effort and /effort <value>
  // stay in step with the schema by construction; only the free-text commands
  // need a hand-written entry.
  const CMD_TEXT_ARGS = {
    goal: { placeholder: 'palette.arg.goal', multiline: true },
    loop: { placeholder: 'palette.arg.loop' },
    feedback: { placeholder: 'palette.arg.feedback', multiline: true },
    memory: { placeholder: 'palette.arg.memory' },
    agents: { placeholder: 'palette.arg.agents' },
    mcp: { placeholder: 'palette.arg.mcp' },
    statusline: { placeholder: 'palette.arg.statusline' },
    skill: { placeholder: 'palette.arg.skill' },
    ide: { placeholder: 'palette.arg.ide' },
  };

  // Commands that mean something destructive even in their bare form: the palette
  // asks first instead of firing them on a stray Enter.
  const CMD_CONFIRM_BARE = {
    compact: { message: 'palette.confirm.compact', destructive: true },
    clear: { message: 'palette.confirm.clear', destructive: true },
    reset: { message: 'palette.confirm.clear', destructive: true },
    rewind: { message: 'palette.confirm.rewind', destructive: true },
    exit: { message: 'palette.confirm.exit', destructive: false },
  };

  // Maps a command name to the SETTINGS key it drives. A command absent here and
  // absent from CMD_TEXT_ARGS runs bare — /help, /version, /doctor and friends.
  // A command whose argument is a setting *value*. The palette sends the chosen
  // value as the command's argument rather than writing the config itself: the
  // command stays the one place that decides what a value means, prints the
  // confirmation, and broadcasts the change, so the browser and the terminal can
  // never disagree about what "/effort high" just did.
  const CMD_ENUM_ARGS = {
    effort: 'effort',
    'output-style': 'outputStyle',
    language: 'language',
    'thinking-mode': 'thinkingMode',
    permissions: 'permissionMode',
    vim: 'editorMode',
  };

  // /autocompact has three states (auto / off / an explicit token window) that no
  // single setting row expresses, so it gets its own small enum.
  const CMD_ENUM_ARGS_CUSTOM = {
    autocompact: {
      values: ['auto', 'off'],
      current: () => {
        if (settingValue('autoCompact') === false) return 'off';
        return Number(settingValue('autoCompactWindow')) > 0 ? 'custom' : 'auto';
      },
    },
  };

  function settingSpecFor(key) {
    if (!settingsSchema) return null;
    return (settingsSchema.settings || []).find((s) => s.key === key) || null;
  }

  function currentProviderId() {
    return appConfig.provider || 'mock';
  }

  function providerChoices() {
    const ids = ['mock', 'anthropic'];
    for (const p of (appConfig.customProviders || [])) if (p && p.id) ids.push(p.id);
    const seen = new Set();
    return ids.filter((id) => !seen.has(id) && seen.add(id)).map((id) => ({ value: id, label: id }));
  }

  function modelChoices() {
    const list = MODELS.map((m) => ({ value: m.id, label: m.name, description: m.desc }));
    return list.length ? list : [{ value: appConfig.model, label: appConfig.model }];
  }

  // The theme list is the server's, not the schema's: themeList() includes the
  // user's own themes, so GET /api/config carries the names and the browser asks
  // rather than guessing. Falling back to the current value keeps the dialog
  // usable if the field is missing (older server, or a failed config fetch).
  function themeChoices() {
    const rows = (appConfig.themes || []).map((t2) => ({ value: t2.name, label: t2.label || t2.name }));
    if (rows.length) return rows;
    const current = appConfig.theme || 'default';
    return [{ value: current, label: current }];
  }

  function enumChoices(spec) {
    return ((spec && spec.values) || []).map((v) => ({ value: v, label: String(v) }));
  }

  function currentFor(spec) {
    if (spec.type === 'boolean') return settingValue(spec.key) === true;
    return settingValue(spec.key);
  }

  function argSpecFor(name) {
    const text = CMD_TEXT_ARGS[name];
    if (text) return { kind: 'text', placeholder: sdk.i18n.t(text.placeholder), multiline: text.multiline === true };
    const confirm = CMD_CONFIRM_BARE[name];
    if (confirm) return { kind: 'confirm', message: sdk.i18n.t(confirm.message), destructive: confirm.destructive };

    if (name === 'theme') {
      const items = themeChoices();
      return { kind: 'enum', items, current: () => appConfig.theme };
    }
    if (name === 'model') {
      const items = modelChoices();
      return { kind: 'choice', items, current: () => appConfig.model };
    }
    if (name === 'provider') {
      const items = providerChoices();
      return { kind: 'enum', items, current: () => currentProviderId() };
    }
    const custom = CMD_ENUM_ARGS_CUSTOM[name];
    if (custom) {
      return { kind: 'enum', items: custom.values.map((v) => ({ value: v, label: v })), current: custom.current };
    }
    const key = CMD_ENUM_ARGS[name];
    if (key) {
      const spec = settingSpecFor(key);
      const items = spec ? ((spec.values) || []).map((v) => ({ value: v, label: String(v) })) : [];
      if (items.length) return { kind: 'enum', items, current: () => settingValue(key) };
    }
    return { kind: 'bare' };
  }

  async function runSlashCommand(name, args) {
    const spec = argSpecFor(name);
    let finalArgs = args || '';

    if (!finalArgs) {
      if (spec.kind === 'enum') {
        const value = await askEnum('/' + name, spec.items, { current: spec.current && spec.current() });
        if (value === null || value === undefined) return;
        finalArgs = String(value);
      } else if (spec.kind === 'choice') {
        if (!spec.items.length) return;
        const value = await askChoice('/' + name, spec.items, { placeholder: sdk.i18n.t('common.search') });
        if (value === null) return;
        finalArgs = String(value);
      } else if (spec.kind === 'confirm') {
        const ok = await askConfirm('/' + name, spec.message, { destructive: spec.destructive, confirmText: sdk.i18n.t('palette.runAction') });
        if (!ok) return;
      } else if (spec.kind === 'text') {
        const value = await askText('/' + name, { placeholder: spec.placeholder, multiline: spec.multiline === true });
        if (!value) return;
        finalArgs = value;
      }
    }

    const line = '/' + name + (finalArgs ? ' ' + finalArgs : '');
    try {
      const res = await sdk.api.runCommand(line);
      // The command's own prints come back as messages. Render them, THEN refresh
      // the lightweight state (config/usage/running) with keepTranscript so the
      // refresh does not wipe what we just rendered — the bug behind "命令输入无效,
      // 什么都没发生" was syncState() re-rendering from the server's persisted
      // messages, which never include a command's transient output.
      for (const msg of (res.messages || [])) {
        // \`print\` produced it: a real transcript row, not a toast. \`send\` produced
        // it: the command wanted to talk to the agent, so the server already ran
        // the turn and the content is the prompt text.
        if (msg && msg.role === 'user') {
          appendUserMessage(msg.content, msg);
        } else if (msg && msg.content) {
          appendNotice(msg.content, msg.meta && msg.meta.error);
        }
      }
      await syncState({ keepTranscript: true });
    } catch (e) {
      sdk.ui.showToast({ message: '/' + name + ': ' + e.message, type: 'error' });
    }
  }

  function closeCommandPalette() {
    if (cmdPaletteModal) cmdPaletteModal.style.display = 'none';
    paletteInPreview = false;
  }

  if (slashCmdBtn) slashCmdBtn.onclick = openCommandPalette;
  if (cmdPaletteCloseBtn) cmdPaletteCloseBtn.onclick = closeCommandPalette;
  if (cmdPaletteCancelBtn) cmdPaletteCancelBtn.onclick = closeCommandPalette;
  if (cmdPaletteSearchInput) cmdPaletteSearchInput.addEventListener('input', () => {
    paletteIndex = 0;
    renderCommandPaletteList();
  });

  if (cmdPaletteModal) {
    cmdPaletteModal.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); movePaletteSelection(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); movePaletteSelection(-1); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        paletteInPreview = !paletteInPreview;
        renderCommandPaletteList();
        if (paletteInPreview) focusPreview();
        else if (cmdPaletteSearchInput) cmdPaletteSearchInput.focus();
      } else if (e.key === 'ArrowRight') {
        paletteInPreview = true;
        renderCommandPaletteList();
        focusPreview();
      } else if (e.key === 'ArrowLeft') {
        paletteInPreview = false;
        renderCommandPaletteList();
        if (cmdPaletteSearchInput) cmdPaletteSearchInput.focus();
      }
      else if (e.key === 'Enter') {
        // Enter on a search box would submit a filter we already applied
        // on every keystroke; with the preview pane focused it runs instead.
        if (paletteInPreview) {
          e.preventDefault();
          const runBtn = cmdPalettePreview && cmdPalettePreview.querySelector('.cmd-preview-run');
          if (runBtn) runBtn.click();
          return;
        }
        e.preventDefault();
        executePaletteCommand(paletteFiltered[paletteIndex]);
      } else if (e.key === 'Escape') {
        // Esc clears the search before it closes the palette: a half-typed query
        // that silently vanishes is the worse of the two behaviours.
        if (cmdPaletteSearchInput && cmdPaletteSearchInput.value) {
          e.preventDefault();
          e.stopPropagation();
          cmdPaletteSearchInput.value = '';
          paletteIndex = 0;
          renderCommandPaletteList();
        }
      }
    });
  }

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

// --- Settings Modal, driven entirely by the SETTINGS schema (/api/settings) ---
  // The old version hard-coded 17 tabs of which 6 had content, and kept chat
  // width / font / speech in localStorage — a second copy of preferences that
  // the TUI could not see. Everything below now comes from the one table.
  const settingsModal = document.querySelector('#settings-modal');
  const openSettingsBtn = document.querySelector('#open-settings-btn');
  const settingsCloseBtn = document.querySelector('#settings-close-btn');
  const settingsSearchInput = document.querySelector('#settings-search-input');
  const settingsNavScroll = document.querySelector('#settings-nav-scroll');
  const settingsMainContent = document.querySelector('#settings-main-content');

  const FONT_STACKS = {
    'Outfit': "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    'Anthropic Serif': "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
    'JetBrains Mono': "'JetBrains Mono', Consolas, Monaco, monospace",
    'system-ui': '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
  };

  // { lang, groups: string[], settings: Array<{ key, group, type, values, min,
  //   max, unit, surfaces, label, description, value }> } — null until loaded.
  let settingsSchema = null;
  let settingsQuery = '';
  let settingsFetchSeq = 0;

  async function loadSettingsSchema() {
    // A config write triggers a refetch; if two overlap, only the newest wins,
    // otherwise a slow earlier response can overwrite fresher values.
    const seq = ++settingsFetchSeq;
    try {
      const res = await fetch('/api/settings');
      if (res.ok && seq === settingsFetchSeq) settingsSchema = await res.json();
    } catch (e) {
      console.warn('Could not load the settings schema:', e);
    }
  }

  function settingRow(key) {
    return settingsSchema ? settingsSchema.settings.find((s) => s.key === key) : null;
  }

  function settingValue(key) {
    const row = settingRow(key);
    return row ? row.value : undefined;
  }

  // The language setting is 'auto' | 'zh' | 'en'. 'auto' means "whatever the
  // server's locale resolves to", which /api/settings has already done for us —
  // it hands back a concrete lang. Fall back to the browser only on fetch failure.
  function syncLanguageFromConfig(cfg) {
    const bag = (cfg && cfg.settings) || {};
    const raw = bag.language || 'auto';
    const want = raw === 'zh' || raw === 'en' ? raw
      : (settingsSchema && settingsSchema.lang) || sdk.i18n.getLang();
    if (want && want !== sdk.i18n.getLang()) sdk.i18n.setLang(want);
  }

  // The settings that only make sense in a browser, applied straight to the DOM
  // rather than persisted anywhere: CSS variables, a body class, and a flag the
  // turn-complete handler reads for the desktop notification.
  function applyVisualSettings() {
    const width = settingValue('chatWidth');
    if (width) document.documentElement.style.setProperty('--chat-max-width', width + 'px');
    const font = settingValue('chatFont');
    if (font && FONT_STACKS[font]) {
      document.documentElement.style.setProperty('--chat-font-family', FONT_STACKS[font]);
    }
    document.body.classList.toggle('reduced-motion', settingValue('reduceMotion') === true);
  }

  async function saveSetting(key, value) {
    const res = await sdk.api.updateConfig({ settings: { [key]: value } });
    if (settingsSchema) {
      const row = settingRow(key);
      if (row) row.value = value;
    }
    // Turning notifications on has to happen inside the click that enabled them:
    // the permission prompt needs the gesture, and a later programmatic call is
    // blocked in every modern browser.
    if (key === 'notifyTurn' && value === true && window.Notification && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    applyVisualSettings();
    renderSettingsPane();
    return res;
  }

  function isWebOnly(row) {
    return Array.isArray(row.surfaces) && row.surfaces.indexOf('web') >= 0;
  }

  // A row the TUI owns is shown but not editable here: the browser has no way to
  // apply it, and silently hiding it would read as "this app has no such switch".
  function isTuiOnly(row) {
    return !Array.isArray(row.surfaces) || row.surfaces.indexOf('web') < 0;
  }

  // --- Controls (one per SettingSpec.type) ---

  function booleanControl(row, disabled) {
    const on = row.value === true;
    return '<button type="button" class="settings-ctrl-switch' + (on ? ' active' : '') +
      '" role="switch" aria-checked="' + on + '" data-setting="' + escapeHtml(row.key) +
      '"' + (disabled ? ' disabled' : '') + '><span class="switch-thumb"></span></button>';
  }

  function segmentedControl(row, labels, disabled) {
    const cur = String(row.value);
    const btns = (row.values || []).map((v, i) =>
      '<button type="button" class="m3-segmented-btn' + (v === cur ? ' active' : '') +
      '" data-setting="' + escapeHtml(row.key) + '" data-value="' + escapeHtml(v) + '"' +
      (disabled ? ' disabled' : '') + '>' + escapeHtml(labels ? labels[i] : v) + '</button>').join('');
    return '<div class="m3-segmented-group">' + btns + '</div>';
  }

  function selectControl(row, disabled) {
    const opts = (row.values || []).map((v) =>
      '<option value="' + escapeHtml(v) + '"' + (String(row.value) === v ? ' selected' : '') +
      '>' + escapeHtml(v) + '</option>').join('');
    return '<select class="settings-ctrl-select" data-setting="' + escapeHtml(row.key) + '"' +
      (disabled ? ' disabled' : '') + '>' + opts + '</select>';
  }

  function numberControl(row, disabled) {
    const max = typeof row.max === 'number' ? row.max : 100;
    const min = typeof row.min === 'number' ? row.min : 0;
    const cur = Number(row.value) || 0;
    if (max <= 100) {
      // Small ranges: a stepper, because typing "37" out of context is error-prone.
      const step = max <= 10 ? 1 : max <= 50 ? 5 : 10;
      return '<div class="settings-ctrl-stepper"' + (disabled ? ' data-disabled="1"' : '') + '>' +
        '<button type="button" class="stepper-btn" aria-label="−" data-setting="' + escapeHtml(row.key) +
        '" data-delta="' + (-step) + '"' + (disabled ? ' disabled' : '') + '>−</button>' +
        '<input class="settings-ctrl-input" type="number" value="' + cur + '" min="' + min +
        '" max="' + max + '" step="' + step + '" data-setting="' + escapeHtml(row.key) + '"' +
        (disabled ? ' disabled' : '') + ' aria-label="' + escapeHtml(row.label) + '" />' +
        '<button type="button" class="stepper-btn" aria-label="+" data-setting="' + escapeHtml(row.key) +
        '" data-delta="' + step + '"' + (disabled ? ' disabled' : '') + '>+</button>' +
        '<span class="settings-ctrl-unit">' + escapeHtml(row.unit || '') + '</span></div>';
    }
    // Huge ranges (context windows in the 10^6–10^7 tokens): a stepper would take
    // forever, so pair a number field with the sizes people actually pick.
    const presets = [min, Math.round(max * 0.1), Math.round(max * 0.5), max]
      .filter((n, i, a) => a.indexOf(n) === i && n >= min);
    const chips = presets.map((n) =>
      '<button type="button" class="settings-preset-chip' + (n === cur ? ' active' : '') +
      '" data-setting="' + escapeHtml(row.key) + '" data-value="' + n + '"' +
      (disabled ? ' disabled' : '') + '>' + (n === min && min === 0 ? 'Auto' : n >= 1000 ?
        (n / 1000) + 'k' : n) + '</button>').join('');
    return '<div class="settings-ctrl-number">' +
      '<input class="settings-ctrl-input" type="number" value="' + cur + '" min="' + min +
      '" max="' + max + '" data-setting="' + escapeHtml(row.key) + '"' +
      (disabled ? ' disabled' : '') + ' aria-label="' + escapeHtml(row.label) + '" />' +
      '<span class="settings-ctrl-unit">' + escapeHtml(row.unit || '') + '</span>' +
      '<div class="settings-preset-row">' + chips + '</div></div>';
  }

  function stringControl(row, disabled) {
    // A secret row (the API key) is a password field showing the set/unset marker
    // the server sent — /api/settings never transmits the value itself. Leaving
    // the field untouched writes the marker back verbatim, so an untouched secret
    // row must not be submitted at all.
    if (row.secret) {
      return '<input class="settings-ctrl-input settings-ctrl-text" type="password" value=""' +
        ' data-setting="' + escapeHtml(row.key) + '" data-secret-display="' +
        escapeHtml(String(row.display == null ? '' : row.display)) + '" spellcheck="false"' +
        (disabled ? ' disabled' : '') + ' aria-label="' + escapeHtml(row.label) + '" />';
    }
    return '<input class="settings-ctrl-input settings-ctrl-text" type="text" value="' +
      escapeHtml(String(row.value == null ? '' : row.value)) + '" data-setting="' +
      escapeHtml(row.key) + '" spellcheck="false"' + (disabled ? ' disabled' : '') +
      ' aria-label="' + escapeHtml(row.label) + '" />';
  }

  // Wide enums read better as a list of options than as three cramped segments.
  const ENUM_LABELS = {
    language: { auto: 'Auto', zh: '中文', en: 'English' },
    thinkingMode: { auto: 'Auto', off: 'Off', on: 'On' },
    outputStyle: { default: 'Default', concise: 'Concise', explanatory: 'Explanatory' },
    permissionMode: {
      default: 'Ask', acceptEdits: 'Accept edits', plan: 'Plan', bypassPermissions: 'Bypass',
    },
  };

  function controlFor(row) {
    const disabled = isTuiOnly(row);
    if (row.type === 'boolean') return booleanControl(row, disabled);
    if (row.type === 'enum') {
      const labels = ENUM_LABELS[row.key];
      const values = row.values || [];
      // ≤3 short options fit a segmented row; more need a real dropdown.
      if (values.length <= 3 && values.every((v) => v.length <= 14)) {
        return segmentedControl(row, values.map((v) => (labels ? labels[v] || v : v)), disabled);
      }
      return selectControl(row, disabled);
    }
    if (row.type === 'number') return numberControl(row, disabled);
    return stringControl(row, disabled);
  }

  // --- Rendering ---

  function highlight(text, query) {
    const safe = escapeHtml(text);
    if (!query) return safe;
    const needle = escapeHtml(query).toLowerCase();
    const hay = safe.toLowerCase();
    let out = '';
    let at = 0;
    for (;;) {
      const hit = hay.indexOf(needle, at);
      if (hit < 0) { out += safe.slice(at); break; }
      out += safe.slice(at, hit) + '<mark class="settings-search-highlight">' + safe.slice(hit, hit + needle.length) + '</mark>';
      at = hit + needle.length;
    }
    return out;
  }

  function rowHtml(row, query) {
    const tuiOnly = isTuiOnly(row);
    const dirty = String(row.value) !== String(row.default);
    const tag = query && settingsSchema
      ? '<span class="settings-group-tag">' + escapeHtml(row.group) + '</span>' : '';
    const badges =
      (tuiOnly ? '<span class="settings-badge settings-badge-tui">TUI</span>' : '') +
      (isWebOnly(row) ? '<span class="settings-badge settings-badge-web">Web</span>' : '');
    return '<div class="settings-row' + (tuiOnly ? ' is-tui-only' : '') + '" data-setting-row="' +
      escapeHtml(row.key) + '"><div class="settings-row-info">' +
      '<div class="settings-row-label">' + highlight(row.label, query) + badges +
      (dirty ? '<span class="settings-badge-dirty" title="Changed from the default"></span>' : '') +
      tag + '</div>' +
      '<div class="settings-row-desc">' + highlight(row.description || '', query) +
      (tuiOnly ? ' <em>' + escapeHtml(sdk.i18n.t('settings.tuiOnly.hint')) + '</em>' : '') +
      '</div></div>' +
      '<div class="settings-row-ctrl">' + controlFor(row) +
      (dirty ? '<button type="button" class="settings-reset-btn" data-reset="' +
        escapeHtml(row.key) + '" title="' + escapeHtml(sdk.i18n.t('settings.reset')) + '">↺</button>' : '') +
      '</div></div>';
  }

  function matches(row, query) {
    if (!query) return true;
    const hay = (row.label + ' ' + (row.description || '') + ' ' + row.key + ' ' + row.group).toLowerCase();
    return hay.indexOf(query) >= 0;
  }

  function renderSettingsNav(rows) {
    if (!settingsNavScroll || !settingsSchema) return;
    const groups = [];
    rows.forEach((r) => { if (groups.indexOf(r.group) < 0) groups.push(r.group); });
    settingsNavScroll.innerHTML = groups.map((g) =>
      '<button type="button" class="settings-nav-item" data-group="' + escapeHtml(g) + '">' +
      '<span class="material-symbols-outlined nav-item-icon">tune</span>' +
      '<span class="nav-item-text">' + escapeHtml(g) + '</span></button>').join('');
  }

  function renderSettingsPane() {
    if (!settingsMainContent) return;
    if (!settingsSchema) {
      settingsMainContent.innerHTML =
        '<div class="settings-row-desc">' + escapeHtml(sdk.i18n.t('settings.loading')) + '</div>';
      return;
    }
    const query = settingsQuery.trim().toLowerCase();
    const all = settingsSchema.settings;
    const rows = all.filter((r) => matches(r, query));
    const hits = rows.length;

    const sections = [];
    settingsSchema.groups.forEach((group) => {
      const inGroup = rows.filter((r) => r.group === group);
      if (inGroup.length === 0) return;
      sections.push('<section class="settings-section-block" data-group-section="' +
        escapeHtml(group) + '"><div class="settings-section-header">' +
        escapeHtml(group) + '</div>' + inGroup.map((r) => rowHtml(r, query)).join('') + '</section>');
    });

    const footer = query
      ? '<div class="settings-search-count">' + escapeHtml(sdk.i18n.t('settings.searchCount', { n: hits })) + '</div>'
      : '<div class="settings-search-count">' + escapeHtml(sdk.i18n.t('settings.footerHint')) + '</div>';

    settingsMainContent.innerHTML =
      (sections.length ? sections.join('') :
        '<div class="settings-row-desc">' + escapeHtml(sdk.i18n.t('settings.noResults')) + '</div>') + footer;

    renderSettingsNav(rows);
    if (!query) markActiveGroup(settingsMainContent.scrollTop);
  }

  // Scrollspy: the nav highlights whichever group's heading owns the top of the
  // viewport, so a 53-row pane stays navigable without a second click.
  function markActiveGroup(scrollTop) {
    if (!settingsMainContent || !settingsNavScroll) return;
    let active = '';
    settingsMainContent.querySelectorAll('[data-group-section]').forEach((sec) => {
      if (sec.offsetTop - settingsMainContent.offsetTop <= scrollTop + 24) active = sec.getAttribute('data-group-section');
    });
    settingsNavScroll.querySelectorAll('.settings-nav-item').forEach((item) => {
      item.classList.toggle('active', item.getAttribute('data-group') === active);
    });
  }

  function openSettingsModal() {
    if (settingsModal) settingsModal.style.display = 'flex';
    applyVisualSettings();
    renderSettingsPane();
    if (settingsSearchInput && settingsMainContent) settingsSearchInput.focus();
  }

  function closeSettingsModal() {
    if (settingsModal) settingsModal.style.display = 'none';
  }

  if (openSettingsBtn) openSettingsBtn.onclick = openSettingsModal;
  if (settingsCloseBtn) settingsCloseBtn.onclick = closeSettingsModal;
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeSettingsModal();
    });
  }

  if (settingsSearchInput) {
    settingsSearchInput.addEventListener('input', (e) => {
      settingsQuery = e.target.value || '';
      renderSettingsPane();
      if (settingsMainContent) settingsMainContent.scrollTop = 0;
    });
  }

  if (settingsNavScroll) {
    settingsNavScroll.addEventListener('click', (e) => {
      const item = e.target.closest('.settings-nav-item');
      if (!item || !settingsMainContent) return;
      const sec = settingsMainContent.querySelector('[data-group-section="' +
        CSS.escape(item.getAttribute('data-group')) + '"]');
      if (sec) settingsMainContent.scrollTo({ top: sec.offsetTop - settingsMainContent.offsetTop, behavior: 'smooth' });
    });
  }

  if (settingsMainContent) {
    settingsMainContent.addEventListener('scroll', () => {
      if (!settingsQuery) markActiveGroup(settingsMainContent.scrollTop);
    });
  }

  // One delegated handler for every control the renderer can emit.
  if (settingsMainContent) {
    settingsMainContent.addEventListener('click', async (e) => {
      const reset = e.target.closest('[data-reset]');
      if (reset) {
        const row = settingRow(reset.getAttribute('data-reset'));
        if (row) await saveSetting(row.key, row.default);
        return;
      }
      const btn = e.target.closest('[data-setting]');
      if (!btn || btn.disabled) return;
      const row = settingRow(btn.getAttribute('data-setting'));
      if (!row) return;
      if (btn.classList.contains('stepper-btn')) {
        const delta = Number(btn.getAttribute('data-delta')) || 0;
        const min = typeof row.min === 'number' ? row.min : 0;
        const max = typeof row.max === 'number' ? row.max : Number.MAX_SAFE_INTEGER;
        await saveSetting(row.key, Math.min(max, Math.max(min, Number(row.value) + delta)));
        return;
      }
      if (btn.tagName === 'BUTTON') {
        if (btn.classList.contains('settings-preset-chip')) {
          await saveSetting(row.key, Number(btn.getAttribute('data-value')));
        } else if (btn.classList.contains('settings-ctrl-switch')) {
          await saveSetting(row.key, !row.value);
        } else {
          // Segmented buttons and preset chips both carry the value.
          await saveSetting(row.key, btn.getAttribute('data-value'));
        }
      }
    });

    settingsMainContent.addEventListener('change', (e) => {
      const el = e.target.closest('[data-setting]');
      if (!el || el.tagName === 'BUTTON' || el.disabled) return;
      const row = settingRow(el.getAttribute('data-setting'));
      if (!row) return;
      // An untouched secret field is empty (the value never reaches the browser),
      // so submitting it would erase a stored key. Only a typed value writes.
      if (row.secret && !el.value) { renderSettingsPane(); return; }
      const raw = el.value;
      const value = row.type === 'number' ? Number(raw) : row.type === 'boolean' ? raw === 'true' : raw;
      saveSetting(row.key, value);
    });
  }

  sdk.on('config:changed', () => {
    if (settingsModal && settingsModal.style.display !== 'none') renderSettingsPane();
  });

  sdk.on('i18n:change', () => {
    // The settings schema comes back localized, so a language switch re-renders
    // the open pane from a fresh fetch rather than re-translating stale labels.
    if (settingsModal && settingsModal.style.display !== 'none') {
      loadSettingsSchema().then(renderSettingsPane);
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
  async function syncState(opts) {
    try {
      const st = await sdk.api.getState();
      currentSessionId = st.sessionId;
      messages = st.messages || [];
      appConfig = st.config || {};
      currentUsage = st.usage || { inputTokens: 0, outputTokens: 0, toolCalls: 0, turns: 0 };
      // Language is a shared setting, not a browser preference: 'auto' follows
      // the server's shell locale so a remote browser sees the host's language.
      syncLanguageFromConfig(appConfig);
      setRunningState(Boolean(st.isRunning));
      // keepTranscript: a command just rendered its own output (and the user's
      // command line) into the transcript, and that output is NOT part of the
      // server's persisted messages — re-rendering here would wipe it, which is
      // exactly why "/help" and friends looked like they did nothing. The meta
      // above (config/usage/running) still refreshes; only the destructive
      // re-render is skipped. A session-mutating command (/clear, /new) re-renders
      // through its own session:state SSE broadcast, not through here.
      if (!(opts && opts.keepTranscript)) renderExistingMessages(messages);
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
      // A permission prompt raised while the stream was down was broadcast to
      // nobody, so it never reached openPermissionDialog — the turn would sit
      // parked for the full INTERACTION_TIMEOUT_MS with no dialog to answer it.
      // Polling /api/interaction on (re)connect is what recovers those; the server
      // marks each prompt as re-broadcast exactly once, so tabs already showing it
      // do not get a duplicate dialog.
      catchUpInteractions();
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
        // Any non-retry event means the request is moving again — drop the
        // transient retry notice so it doesn't linger (mirrors useChat).
        if (ev.type !== 'retry') clearRetryNotice();
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
        } else if (ev.type === 'retry') {
          appendRetryNotice(ev);
        } else if (ev.type === 'workflow') {
          updateWorkflowView(ev.snap);
        } else if (ev.type === 'agent') {
          updateAgentView(ev.snap);
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
      clearRetryNotice();
      closeStaleInteractions();
      seenSubagents = [];
      renderAgentList([], null, 'agent');
      setRunningState(false);
      // Re-read the transcript, not just the session list: a turn that failed
      // mid-flight appended its system error row to the bridge's messages after
      // the last agent:event, so without this the failure is never rendered —
      // the toast is gone and the transcript looks like the turn succeeded.
      syncState();
      loadSessionList();
      announce(sdk.i18n.t('a11y.turnDone'));
      if (settingValue('notifyTurn') === true && window.Notification && Notification.permission === 'granted') {
        try {
          new Notification(sdk.i18n.t('settings.notifyDone.title'), {
            body: sdk.i18n.t('settings.notifyDone.body'),
            tag: 'meowcode-turn',
          });
        } catch (e) {
          console.warn('Turn notification failed:', e);
        }
      }
    });

    sse.addEventListener('session:state', () => {
      syncState();
    });

    sse.addEventListener('config:update', (e) => {
      // Another tab or a plugin changed the config server-side; adopt it so the
      // model chip, theme and settings pane don't drift apart.
      try {
        const cfg = JSON.parse(e.data);
        if (cfg && typeof cfg === 'object') applyRemoteConfig(cfg);
      } catch (_) {}
      sdk.emit('config:update');
    });

    sse.addEventListener('interaction:request', (e) => {
      try {
        const req = JSON.parse(e.data);
        showInteraction(req);
      } catch (err) {
        console.error('Error handling SSE interaction:request', err);
      }
    });

    sse.addEventListener('interaction:settled', (e) => {
      // The server gives up on a prompt the turn already walked away from (a
      // timeout, an abort, a failed wait). Until it said so, this tab kept the
      // dialog on screen and re-opened it on every poll of /api/interaction,
      // because a pending prompt is indistinguishable from an answerable one.
      try {
        const data = JSON.parse(e.data);
        const close = data && data.id ? openInteractionDialogs.get(data.id) : null;
        if (close) { close(); openInteractionDialogs.delete(data.id); }
      } catch (err) {
        console.error('Error handling SSE interaction:settled', err);
      }
    });

    sse.addEventListener('plugin:event', (e) => {
      try {
        const payload = JSON.parse(e.data);
        sdk.emit('plugin:event:' + payload.pluginId, payload.data);
      } catch (_) {}
    });
  }

  // --- Interaction dialogs (permission prompt + ask_user) ---
  // The bridge raises these mid-turn and parks the turn until an answer arrives
  // (see the interaction broker in server.ts). They are the WebUI counterpart of
  // the TUI's PermissionDialog / AskUserDialog: without them the WebUI could only
  // ever run in bypass mode.

  const openInteractionDialogs = new Map();

  // Prompts already on screen. The server re-broadcasts everything still parked
  // whenever a client asks (see /api/interaction), which is what lets a reconnecting
  // tab or a second tab answer a prompt it never saw — but it also means this
  // handler can see the same prompt twice, and a second dialog for an id already
  // on screen would leave two live buttons settling one promise. The map is the
  // dedupe; it already has to exist to drop stale dialogs at end of turn.
  function showInteraction(req) {
    if (!req || !req.id) return;
    if (openInteractionDialogs.has(req.id)) return;
    if (req.kind === 'permission') openPermissionDialog(req);
    else if (req.kind === 'userInput') openAskUserDialog(req);
  }

  // Pull prompts that were raised while this tab had no stream. The server's list
  // is the authority; the per-id dedupe above is what makes re-polling cheap.
  async function catchUpInteractions() {
    try {
      await sdk.api.pendingInteractions();
    } catch (e) {
      console.warn('Could not read pending interactions:', e);
    }
  }

  function settleInteraction(id, response) {
    const close = openInteractionDialogs.get(id);
    openInteractionDialogs.delete(id);
    if (close) close();
    sdk.api.respondInteraction(id, response).catch((e) => {
      // 409 means another tab answered first. The turn moves on either way, so
      // this is a note, not an error the user needs to act on.
      console.warn('Interaction response failed:', e && e.status ? e.status : e);
    });
  }

  // The turn is over — an unanswered prompt can no longer be answered, so drop
  // any dialog still on screen instead of leaving a dead button behind.
  function closeStaleInteractions() {
    for (const close of openInteractionDialogs.values()) close();
    openInteractionDialogs.clear();
  }

  function openPermissionDialog(req) {
    const close = sdk.ui.showModal({
      title: sdk.i18n.t('modal.permission.title'),
      width: '520px',
      cancelText: sdk.i18n.t('modal.permission.deny'),
      confirmText: sdk.i18n.t('modal.permission.allow'),
      content:
        '<div class="interaction-tool">' +
        '<span class="material-symbols-outlined">build</span>' +
        '<code>' + escapeHtml(req.tool) + '</code></div>' +
        '<div class="interaction-summary">' + escapeHtml(req.summary || '') + '</div>' +
        '<pre class="interaction-input">' + escapeHtml(JSON.stringify(req.input, null, 2)) + '</pre>',
      // Deny is the safe default focus (and Esc), matching the TUI.
      onCancel: () => settleInteraction(req.id, { decision: 'deny' }),
      onConfirm: () => settleInteraction(req.id, { decision: 'allow' }),
    });
    openInteractionDialogs.set(req.id, close);
  }

  function openAskUserDialog(req) {
    const answers = new Array(req.questions.length).fill(null);
    const wrap = document.createElement('div');
    wrap.className = 'ask-user-questions';

    req.questions.forEach((q, qi) => {
      const block = document.createElement('div');
      block.className = 'ask-user-question';

      const head = document.createElement('div');
      head.className = 'ask-user-head';
      head.innerHTML =
        '<span class="ask-user-chip">' + escapeHtml(q.header || '') + '</span>' +
        '<span class="ask-user-question-text">' + escapeHtml(q.question || '') + '</span>';
      block.appendChild(head);

      const list = document.createElement('div');
      list.className = 'ask-user-options';
      const picks = [];

      const rowFor = (label, description, isOther) => {
        const row = document.createElement('label');
        row.className = 'ask-user-option';
        const input = document.createElement('input');
        input.type = q.multiSelect ? 'checkbox' : 'radio';
        input.name = 'ask-user-' + qi;
        input.className = 'ask-user-radio';
        const text = document.createElement('span');
        text.className = 'ask-user-option-text';
        text.textContent = label;
        row.appendChild(input);
        row.appendChild(text);
        if (description) {
          const desc = document.createElement('span');
          desc.className = 'ask-user-option-desc';
          desc.textContent = description;
          row.appendChild(desc);
        }
        const sync = () => {
          if (!q.multiSelect) {
            picks.length = 0;
            list.querySelectorAll('input').forEach((el) => { el.checked = false; });
            if (input.checked) picks.push(label);
          } else {
            const at = picks.indexOf(label);
            if (input.checked && at < 0) picks.push(label);
            if (!input.checked && at >= 0) picks.splice(at, 1);
          }
          answers[qi] = picks.slice();
        };
        input.addEventListener('change', sync);
        if (isOther) {
          const free = document.createElement('input');
          free.type = 'text';
          free.className = 'ask-user-other';
          free.placeholder = sdk.i18n.t('modal.askUser.other');
          free.addEventListener('input', () => {
            answers[qi] = free.value.trim() ? [free.value.trim()] : picks.slice();
          });
          row.appendChild(free);
        }
        return row;
      };

      (q.options || []).forEach((o) => list.appendChild(rowFor(o.label, o.description, false)));
      list.appendChild(rowFor(sdk.i18n.t('modal.askUser.other'), '', true));
      block.appendChild(list);
      wrap.appendChild(block);
    });

    const close = sdk.ui.showModal({
      title: sdk.i18n.t('modal.askUser.title'),
      width: '620px',
      cancelText: sdk.i18n.t('common.cancel'),
      confirmText: sdk.i18n.t('modal.askUser.submit'),
      content: wrap,
      onCancel: () => settleInteraction(req.id, { answers: [], cancelled: true }),
      onConfirm: () => settleInteraction(req.id, { answers: answers.map((a) => a || []) }),
    });
    openInteractionDialogs.set(req.id, close);
  }

  function applyRemoteConfig(cfg) {
    appConfig = cfg;
    syncLanguageFromConfig(cfg);
    // The schema is now stale (values and labels both moved), so refetch it
    // before re-rendering the pane rather than patching rows one at a time.
    loadSettingsSchema().then(() => {
      applyVisualSettings();
      renderSettingsPane();
    });
    const model = cfg && cfg.model;
    const headerModelName = document.querySelector('.model-name');
    if (headerModelName && model) headerModelName.textContent = model;
    const wsModalModel = document.querySelector('#ws-modal-model');
    if (wsModalModel && model) wsModalModel.textContent = model;
    renderModelSelectorList();
    renderAllSlots();
    sdk.emit('config:changed', cfg);
  }

  // --- Screen-reader announcements ---
  // One polite region for the whole app. Only milestones are spoken: a live
  // region fed every streamed token would talk over the user, and clearing it
  // between utterances is what makes a repeat of the same sentence re-announce.
  const liveAnnouncer = document.querySelector('#meow-live-announcer');
  function announce(text) {
    if (!liveAnnouncer || !text) return;
    liveAnnouncer.textContent = '';
    // A tick's gap is enough: setting identical text twice in one task is a
    // mutation the assistive tech may collapse into no change at all.
    setTimeout(() => { liveAnnouncer.textContent = text; }, 50);
  }
  sdk.on('toast', ({ message, type }) => {
    if (type === 'error') announce(message);
  });

  // --- Auth gate ---
  // The server guards every /api/* with a per-process token. The happy path is
  // silent (the URL fragment is spent for a cookie on load); this only appears
  // when there is no credential — a hand-typed http://localhost:4040, or a
  // fragment that has already been consumed and whose cookie was dropped.
  function renderAuthGate() {
    const wrap = document.createElement('div');
    wrap.id = 'auth-gate';
    wrap.className = 'auth-gate';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'auth-gate-title');
    wrap.innerHTML = \`
      <div class="auth-gate-card">
        <div class="auth-gate-icon"><span class="material-symbols-outlined">lock</span></div>
        <h2 id="auth-gate-title" class="auth-gate-title">\${sdk.i18n.t('auth.gate.title')}</h2>
        <p class="auth-gate-desc">\${sdk.i18n.t('auth.gate.desc')}</p>
        <form id="auth-gate-form" class="auth-gate-form">
          <input type="password" id="auth-gate-input" class="auth-gate-input" autocomplete="off"
                 spellcheck="false" placeholder="\${sdk.i18n.t('auth.gate.placeholder')}" aria-label="Token" />
          <button type="submit" class="m3-action-btn m3-btn-filled">\${sdk.i18n.t('auth.gate.submit')}</button>
        </form>
        <p id="auth-gate-error" class="auth-gate-error" role="alert"></p>
        <p class="auth-gate-hint">\${sdk.i18n.t('auth.gate.hint')}</p>
      </div>
    \`;
    document.body.appendChild(wrap);

    const form = wrap.querySelector('#auth-gate-form');
    const input = wrap.querySelector('#auth-gate-input');
    const error = wrap.querySelector('#auth-gate-error');
    input.focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      const ok = await sdk.auth.submit(input.value);
      if (!ok) {
        error.textContent = sdk.i18n.t('auth.gate.badToken');
        input.select();
        return;
      }
      wrap.remove();
      boot();
    });
  }

  // A standing reminder that this server is deliberately unprotected. Loud on
  // purpose: --no-auth hands the agent to anyone who can reach the port.
  function renderAuthBanner() {
    const st = sdk.auth.state;
    if (!st.bypass) return;
    const bar = document.createElement('div');
    bar.id = 'auth-bypass-banner';
    bar.className = 'auth-bypass-banner';
    bar.setAttribute('role', 'status');
    bar.innerHTML = \`
      <span class="material-symbols-outlined auth-banner-icon">warning</span>
      <span class="auth-banner-text">\${sdk.i18n.t('auth.bypass')}</span>
    \`;
    const header = document.querySelector('.app-header');
    if (header && header.parentNode) header.parentNode.insertBefore(bar, header.nextSibling);
  }

  function boot() {
    connectSSE();
    void syncState();
    // The palette is populated from GET /api/commands, so the rows are only there
    // once that resolves. Opening the palette first is why it used to show five
    // hardcoded rows and nothing else: nothing had ever asked for the list.
    void loadPaletteCommands();
  }

  // --- Init ---
  window.addEventListener('DOMContentLoaded', async () => {
    const authState = await sdk.auth.ready;
    if (!authState.authenticated) {
      renderAuthGate();
      return;
    }
    renderAuthBanner();
    // The settings schema decides the pane's shape, so fetch it before anything
    // reads a setting — applyVisualSettings() runs off these values.
    await loadSettingsSchema();
    applyVisualSettings();
    boot();
  });
})();
`
