export function generateWebUIHtml(pluginScripts: Array<{ id: string; script: string }> = []): string {
  // Inline script bodies are terminated by the *parser*, not by JavaScript: a
  // literal `</script` anywhere in the source — even inside a string or a
  // comment — ends the element right there. That turns one careless plugin file
  // into markup the browser executes in the origin that holds the auth cookie,
  // and leaves the rest of the plugin as visibly broken HTML. `<\\/script` is
  // equivalent to `</script` to a JS parser, so a plugin that means it still
  // means it after this rewrite. Nothing else needs neutralising: `\x3C/script`
  // and friends never matched the tag close to begin with.
  const inlineSafe = (source: string): string => source.replace(/<\/(script)/gi, '<\\/$1')
  const pluginTags = pluginScripts
    .map((p) => `\n<!-- Plugin: ${p.id} -->\n<script>\n${inlineSafe(p.script)}\n</script>`)
    .join('\n')

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MeowCode WebUI — Material 3 Expressive Studio</title>
  <meta name="description" content="MeowCode WebUI built-in harness with Google Material 3 Expressive (M3E) design, theme switching, and extension SDK." />
  <!-- Inline SVG mark, so the tab icon costs no request and never 404s. It hardcodes
       the light-scheme primary from client/css.ts rather than a token: a favicon is
       resolved by the browser before any stylesheet is parsed, so a CSS custom property
       would not be defined yet. '#' is percent-encoded because this sits in a data URI. -->
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231A73E8'/%3E%3Cpath d='M9 22V10l7 7 7-7v12' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
  <link rel="stylesheet" href="/style.css" />
  <script type="module" src="/material-web.js"></script>
</head>
<body>
  <div id="app">
    <!-- M3 Expressive Top App Bar -->
    <header class="app-header">
      <div class="header-left-cluster">
        <button id="toggle-sidebar-btn" class="header-icon-btn" title="Toggle Navigation Rail" aria-label="Toggle Sidebar">
          <span class="material-symbols-outlined">menu</span>
        </button>
        <div class="brand-badge" id="brand-home-btn" title="MeowCode Agent Studio">
          <div class="brand-icon-mark">
            <span class="material-symbols-outlined">terminal</span>
          </div>
          <span class="brand-title">MeowCode</span>
          <span class="brand-tag">M3E Studio</span>
        </div>
        <!-- Slot: header:left -->
        <div class="meow-slot header-left-slot" data-slot="header:left"></div>
      </div>

      <div class="header-center-cluster">
        <!-- Slot: header:center (Model chip, Status indicator) -->
        <div class="meow-slot header-center-slot" data-slot="header:center"></div>
      </div>

      <div class="header-right-cluster">
        <!-- Modern M3 Sliding Theme Switch -->
        <div class="m3-theme-toggle" id="theme-switch" role="button" tabindex="0" data-i18n-title="header.themeToggle" title="Toggle Light / Dark Mode">
          <span class="material-symbols-outlined theme-icon light-icon" title="Light">light_mode</span>
          <span class="material-symbols-outlined theme-icon dark-icon" title="Dark">dark_mode</span>
          <div class="theme-switch-thumb"></div>
        </div>

        <!-- Hidden buttons for backwards-compatible test / JS selectors -->
        <div style="display:none;">
          <button id="theme-btn-light"></button>
          <button id="theme-btn-dark"></button>
          <button id="theme-btn-system"></button>
        </div>

        <button id="demo-showcase-btn" class="m3-action-btn m3-btn-tonal" data-i18n-title="header.demoShowcaseTitle" title="Load Interactive Demo Showcase">
          <span class="material-symbols-outlined btn-sparkle">auto_awesome</span>
          <span class="btn-text" data-i18n="header.demo">Demo Showcase</span>
        </button>

        <button id="new-session-btn" class="m3-action-btn m3-btn-filled" data-i18n-title="header.newSessionTitle" title="Start a fresh conversation">
          <span class="material-symbols-outlined btn-icon">add</span>
          <span class="btn-text" data-i18n="header.newSession">New Session</span>
        </button>

        <!-- Slot: header:actions -->
        <div class="meow-slot header-actions-slot" data-slot="header:actions"></div>
      </div>
    </header>

    <!-- M3 Running Progress Bar Indicator -->
    <md-linear-progress indeterminate id="app-linear-progress" class="app-progress-bar hidden"></md-linear-progress>

    <!-- Main Workspace -->
    <main class="main-workspace">
      <!-- M3 Navigation Rail / Left Sidebar -->
      <aside id="app-sidebar" class="sidebar">
        <div class="sidebar-header">
          <!-- Slot: sidebar:header -->
          <div class="meow-slot" data-slot="sidebar:header"></div>
          <div class="sidebar-nav-tabs">
            <button class="sidebar-tab-btn active" data-tab="chat">
              <span class="material-symbols-outlined tab-icon">chat_bubble</span>
              <span class="tab-label" data-i18n="sidebar.tab.chat">Chat</span>
            </button>
            <button class="sidebar-tab-btn" data-tab="files">
              <span class="material-symbols-outlined tab-icon">folder</span>
              <span class="tab-label" data-i18n="sidebar.tab.files">Files</span>
            </button>
            <button class="sidebar-tab-btn" data-tab="tools">
              <span class="material-symbols-outlined tab-icon">construction</span>
              <span class="tab-label" data-i18n="sidebar.tab.tools">Tools</span>
            </button>
          </div>
        </div>

        <div class="sidebar-content">
          <div class="sidebar-section-title" data-i18n="sidebar.savedConversations">Saved Conversations</div>
          <div id="sidebar-session-list" class="session-list">
            <!-- Dynamic session items -->
          </div>
          <!-- Slot: sidebar:nav -->
          <div class="meow-slot sidebar-nav-slot" data-slot="sidebar:nav" style="margin-top: 14px;"></div>
        </div>

        <div class="sidebar-footer">
          <div class="workspace-info-chip" id="workspace-info-chip" data-i18n-title="sidebar.workspaceTitle" title="Workspace & Git Branch">
            <span class="ws-dot">●</span>
            <span class="ws-name">harmess</span>
            <span class="ws-branch">main</span>
          </div>
          <button id="open-settings-btn" class="sidebar-settings-btn" data-i18n-title="sidebar.settings" title="Settings">
            <span class="material-symbols-outlined settings-icon">settings</span>
            <span class="settings-btn-label" data-i18n="sidebar.settings">设置</span>
          </button>
          <!-- Slot: sidebar:footer -->
          <div class="meow-slot" data-slot="sidebar:footer"></div>
        </div>
      </aside>

      <!-- Sidebar Backdrop for Mobile Overlay Drawer -->
      <div id="sidebar-backdrop" class="sidebar-backdrop"></div>

      <!-- Content Area -->
      <section class="content-area">
        <!-- Chat View -->
        <div id="chat-view" class="chat-view">
          <!-- Slot: chat:top -->
          <div class="meow-slot chat-top-slot" data-slot="chat:top"></div>

          <!-- Chat Transcript -->
          <div id="chat-transcript" class="chat-transcript">
            <!-- M3 Expressive Welcome Studio Hub -->
            <div id="chat-welcome" class="welcome-container">
              <div class="welcome-header">
                <div class="welcome-hero-badge">
                  <span class="material-symbols-outlined hero-badge-icon">auto_awesome</span>
                  <span class="hero-badge-tag" data-i18n="welcome.badge">Material 3 Expressive Studio</span>
                </div>
                <h1 class="welcome-title" data-i18n="welcome.title">What would you like to build?</h1>
                <p class="welcome-subtitle" data-i18n="welcome.subtitle">
                  Autonomous agentic pair programmer equipped with self-healing tool loops, terminal execution, and live code refactoring.
                </p>
              </div>

              <!-- M3 2x2 Action Cards Grid -->
              <div class="welcome-grid">
                <!-- Card 1: Interactive Demo -->
                <div class="welcome-card card-primary" id="hero-demo-card">
                  <div class="card-icon-wrap icon-primary">
                    <span class="material-symbols-outlined">auto_awesome</span>
                  </div>
                  <div class="card-body">
                    <div class="card-title-row">
                      <span class="card-title" data-i18n="welcome.card.demo.title">Run Interactive Demo</span>
                      <span class="material-symbols-outlined card-arrow">arrow_forward</span>
                    </div>
                    <p class="card-desc" data-i18n="welcome.card.demo.desc">Simulate agent reasoning, test execution via bash, and visual diff review.</p>
                  </div>
                  <button id="hero-demo-btn" class="card-action-btn" data-i18n="welcome.card.demo.btn">Experience Demo</button>
                </div>

                <!-- Card 2: Workspace Files -->
                <div class="welcome-card card-tertiary" id="hero-files-card">
                  <div class="card-icon-wrap icon-tertiary">
                    <span class="material-symbols-outlined">folder</span>
                  </div>
                  <div class="card-body">
                    <div class="card-title-row">
                      <span class="card-title" data-i18n="welcome.card.files.title">Browse Workspace Files</span>
                      <span class="material-symbols-outlined card-arrow">arrow_forward</span>
                    </div>
                    <p class="card-desc" data-i18n="welcome.card.files.desc">Inspect project tree, view file contents, and insert @paths into chat prompt.</p>
                  </div>
                  <button id="hero-files-btn" class="card-action-btn" data-i18n="welcome.card.files.btn">Explore Files</button>
                </div>

                <!-- Card 3: Run Project Tests -->
                <div class="welcome-card card-success" id="hero-test-card">
                  <div class="card-icon-wrap icon-success">
                    <span class="material-symbols-outlined">fact_check</span>
                  </div>
                  <div class="card-body">
                    <div class="card-title-row">
                      <span class="card-title" data-i18n="welcome.card.test.title">Run Test Suite</span>
                      <span class="material-symbols-outlined card-arrow">arrow_forward</span>
                    </div>
                    <p class="card-desc" data-i18n="welcome.card.test.desc">Execute test diagnostics across the repository to verify harness integrity.</p>
                  </div>
                  <button id="hero-test-btn" class="card-action-btn" data-i18n="welcome.card.test.btn">Run Tests</button>
                </div>

                <!-- Card 4: Tools & Runtime -->
                <div class="welcome-card card-secondary" id="hero-tools-card">
                  <div class="card-icon-wrap icon-secondary">
                    <span class="material-symbols-outlined">construction</span>
                  </div>
                  <div class="card-body">
                    <div class="card-title-row">
                      <span class="card-title" data-i18n="welcome.card.tools.title">Tools Inspector</span>
                      <span class="material-symbols-outlined card-arrow">arrow_forward</span>
                    </div>
                    <p class="card-desc" data-i18n="welcome.card.tools.desc">Examine registered tools, schema definitions, and interactive diagnostics.</p>
                  </div>
                  <button id="hero-tools-btn" class="card-action-btn" data-i18n="welcome.card.tools.btn">Inspect Tools</button>
                </div>
              </div>
            </div>
            <!-- Message rows will be appended here -->
          </div>

          <!-- M3 Expressive Floating Input Dock -->
          <div class="input-dock-container">
            <!-- Collapsible Session Tasks Drawer (Docked Above Input Box) -->
            <div id="todo-floating-dock" class="todo-floating-dock" style="display:none;">
              <div id="todo-dock-header" class="todo-dock-header" role="button" tabindex="0" title="Click to expand/collapse tasks">
                <div class="todo-dock-header-left">
                  <span class="material-symbols-outlined todo-dock-icon">checklist</span>
                  <span class="todo-dock-title" data-i18n="todo.title">Task Checklist</span>
                  <div class="todo-dock-active-pill" id="todo-dock-active-pill" style="display:none;">
                    <span class="todo-dock-active-dot"></span>
                    <span id="todo-dock-active-text" class="todo-dock-active-text"></span>
                  </div>
                </div>
                <div class="todo-dock-header-right">
                  <span id="todo-dock-count-badge" class="todo-dock-count-badge">0 / 0 Done (0%)</span>
                  <div class="todo-dock-mini-track">
                    <div id="todo-dock-mini-bar" class="todo-dock-mini-bar" style="width: 0%;"></div>
                  </div>
                  <button id="todo-dock-chevron-btn" class="todo-dock-chevron-btn" aria-label="Toggle task checklist" tabindex="-1">
                    <span id="todo-dock-chevron" class="material-symbols-outlined">expand_less</span>
                  </button>
                </div>
              </div>
              <div id="todo-dock-body" class="todo-dock-body" style="display:none;">
                <div id="todo-dock-items" class="todo-dock-items"></div>
              </div>
            </div>

            <div class="input-dock-card">
              <!-- Transient provider-retry notice (see app.ts appendRetryNotice) -->
              <div id="retry-notice" class="retry-notice hidden" role="status" aria-live="polite"></div>
              <!-- Live sub-agent / workflow chips (see app.ts updateAgentView) -->
              <div id="subagent-strip" class="subagent-strip hidden"></div>

              <!-- Slot: chat:toolbar (Quick Filter Chips / Prompt Pills) -->
              <div class="meow-slot chat-toolbar-slot" data-slot="chat:toolbar"></div>

              <div class="input-main-row">
                <textarea
                  id="prompt-input"
                  class="chat-input"
                  data-i18n-placeholder="input.placeholder"
                  placeholder="Ask MeowCode anything, request refactorings, or reference @files... (Shift+Enter for newline, Enter to send)"
                  rows="1"
                ></textarea>
              </div>

              <div class="input-bottom-row">
                <div class="input-left-tools">
                  <button class="input-tool-chip" id="mention-file-btn" data-i18n-title="chat.dock.fileTitle" title="Reference workspace file (@)">
                    <span class="material-symbols-outlined tool-chip-icon">attach_file</span>
                    <span data-i18n="chat.dock.file">File</span>
                  </button>
                  <button class="input-tool-chip" id="slash-cmd-btn" data-i18n-title="chat.dock.commandTitle" title="Slash commands (/)">
                    <span class="material-symbols-outlined tool-chip-icon">terminal</span>
                    <span data-i18n="chat.dock.command">Command</span>
                  </button>
                  <!-- Slot: chat:input_actions -->
                  <div class="meow-slot chat-input-actions-slot" data-slot="chat:input_actions"></div>
                </div>

                <div class="input-right-actions">
                  <button id="queue-btn" class="m3-btn" style="display:none;" data-i18n-title="common.queueTitle" title="Queue for the running turn">
                    <span class="material-symbols-outlined">playlist_add</span>
                    <span data-i18n="common.queue">Queue</span>
                  </button>
                  <button id="abort-btn" class="m3-btn m3-btn-danger" style="display:none;" data-i18n-title="common.stopTitle" title="Stop generation (Esc)">
                    <span class="material-symbols-outlined">stop</span>
                    <span data-i18n="common.stop">Stop</span>
                  </button>
                  <button id="send-btn" class="m3-send-btn" data-i18n-title="common.sendTitle" title="Send message (Enter)">
                    <span class="material-symbols-outlined send-icon">arrow_upward</span>
                    <span class="send-text" data-i18n="common.send">Send</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Custom Panel View (Mount point for registered tabs/panels) -->
        <div id="custom-panel-view" class="custom-panel-view" style="display:none;"></div>
      </section>
    </main>

    <!-- M3 Bottom Statusbar -->
    <footer class="app-statusbar">
      <div class="statusbar-left">
        <span id="connection-status" class="status-indicator" data-i18n="statusbar.connected">● Connected</span>
        <!-- Slot: statusbar:left -->
        <span class="meow-slot statusbar-left-slot" data-slot="statusbar:left"></span>
      </div>
      <div class="statusbar-center">
        <span id="agent-activity-status" data-i18n="statusbar.ready">Ready</span>
        <!-- Slot: statusbar:center -->
        <span class="meow-slot statusbar-center-slot" data-slot="statusbar:center"></span>
      </div>
      <div class="statusbar-right">
        <!-- Slot: statusbar:right -->
        <span class="meow-slot statusbar-right-slot" data-slot="statusbar:right"></span>
      </div>
    </footer>
  </div>

  <!-- Toast Notification Host -->
  <div id="toast-host" class="toast-host"></div>

  <!-- Single polite live region. app.js speaks into it at turn/command
       milestones — streaming text is far too chatty to announce per chunk. -->
  <div id="meow-live-announcer" class="sr-only" aria-live="polite" aria-atomic="true"></div>

  <!-- M3 File Picker Modal Dialog -->
  <div id="file-picker-modal" class="modal-backdrop" style="display:none;">
    <div class="modal-container file-picker-container">
      <div class="modal-header">
        <div class="modal-header-title-cluster">
          <span class="material-symbols-outlined modal-icon">folder_open</span>
          <span class="modal-title" data-i18n="modal.files.title">Select Workspace File</span>
        </div>
        <button class="modal-close-btn" id="file-picker-close-btn" data-i18n-title="common.close" title="Close (Esc)"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="modal-search-bar">
        <span class="material-symbols-outlined search-icon">search</span>
        <input type="text" id="file-picker-search-input" class="modal-search-input" data-i18n-placeholder="modal.files.searchPlaceholder" placeholder="Search workspace files by path or name..." />
      </div>
      <div class="modal-body file-picker-body" id="file-picker-list">
        <!-- Dynamic file items -->
      </div>
      <div class="modal-footer">
        <span class="modal-footer-hint text-dim text-xs" data-i18n="modal.files.hint">Click any file to insert @path into prompt</span>
        <button class="m3-action-btn m3-btn-tonal" id="file-picker-cancel-btn" data-i18n="common.cancel">Cancel</button>
      </div>
    </div>
  </div>

  <!-- M3 Command Palette Modal Dialog: master (list) + detail (preview) -->
  <div id="cmd-palette-modal" class="modal-backdrop" style="display:none;">
    <div class="modal-container cmd-palette-container" role="dialog" aria-modal="true" aria-labelledby="cmd-palette-title">
      <div class="modal-header">
        <div class="modal-header-title-cluster">
          <span class="material-symbols-outlined modal-icon">terminal</span>
          <span class="modal-title" id="cmd-palette-title" data-i18n="modal.cmd.title">Command Palette</span>
        </div>
        <button class="modal-close-btn" id="cmd-palette-close-btn" data-i18n-title="common.close" title="Close (Esc)"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="modal-search-bar">
        <span class="material-symbols-outlined search-icon">search</span>
        <input type="text" id="cmd-palette-search-input" class="modal-search-input" data-i18n-placeholder="modal.cmd.searchPlaceholder" placeholder="Type a slash command or search..." />
      </div>
      <div class="cmd-palette-body">
        <div class="cmd-palette-list-pane" id="cmd-palette-list" role="listbox" aria-label="Commands" data-i18n-aria-label="modal.cmd.list"></div>
        <div class="cmd-palette-preview-pane" id="cmd-palette-preview" aria-live="polite"></div>
      </div>
      <div class="modal-footer">
        <span class="modal-footer-hint text-dim text-xs" id="cmd-palette-hint" data-i18n="modal.cmd.hint">Press Enter or click to execute</span>
        <span class="text-dim text-xs" id="cmd-palette-count"></span>
        <button class="m3-action-btn m3-btn-tonal" id="cmd-palette-cancel-btn" data-i18n="common.cancel">Cancel</button>
      </div>
    </div>
  </div>

  <!-- M3 Model Selector Modal Dialog -->
  <div id="model-selector-modal" class="modal-backdrop" style="display:none;">
    <div class="modal-container model-selector-container">
      <div class="modal-header">
        <div class="modal-header-title-cluster">
          <span class="material-symbols-outlined modal-icon">psychology</span>
          <span class="modal-title" data-i18n="modal.model.title">Select AI Model & Provider</span>
        </div>
        <button class="modal-close-btn" id="model-selector-close-btn" data-i18n-title="common.close" title="Close (Esc)"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="modal-body model-selector-body" id="model-selector-list">
        <!-- Dynamic models -->
      </div>
      <div class="modal-footer">
        <span class="modal-footer-hint text-dim text-xs" data-i18n="modal.model.hint">Select model to update studio configuration</span>
        <button class="m3-action-btn m3-btn-tonal" id="model-selector-cancel-btn" data-i18n="common.close">Close</button>
      </div>
    </div>
  </div>

  <!-- M3 Workspace Info Modal Dialog -->
  <div id="workspace-info-modal" class="modal-backdrop" style="display:none;">
    <div class="modal-container workspace-info-container">
      <div class="modal-header">
        <div class="modal-header-title-cluster">
          <span class="material-symbols-outlined modal-icon">developer_board</span>
          <span class="modal-title" data-i18n="modal.ws.title">Workspace Environment</span>
        </div>
        <button class="modal-close-btn" id="workspace-info-close-btn" data-i18n-title="common.close" title="Close (Esc)"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="modal-body workspace-info-body">
        <div class="workspace-info-row">
          <span class="ws-label" data-i18n="modal.ws.repo">Repository</span>
          <span class="ws-val">harmess (MeowCode Agent Harness)</span>
        </div>
        <div class="workspace-info-row">
          <span class="ws-label" data-i18n="modal.ws.branch">Branch</span>
          <span class="ws-val badge-git">git:main</span>
        </div>
        <div class="workspace-info-row">
          <span class="ws-label" data-i18n="modal.ws.runtime">Runtime</span>
          <span class="ws-val">Bun / Node.js 22 (Linux)</span>
        </div>
        <div class="workspace-info-row">
          <span class="ws-label" data-i18n="modal.ws.provider">Provider</span>
          <span class="ws-val" id="ws-modal-provider">Offline Simulator / Mock</span>
        </div>
        <div class="workspace-info-row">
          <span class="ws-label" data-i18n="modal.ws.model">Active Model</span>
          <span class="ws-val" id="ws-modal-model">claude-opus-4-8</span>
        </div>
        <div class="workspace-info-row">
          <span class="ws-label" data-i18n="modal.ws.tools">Tools</span>
          <span class="ws-val">12 tools (bash, read_file, edit_file, workflow...)</span>
        </div>
      </div>
      <div class="modal-footer">
        <button class="m3-action-btn m3-btn-tonal" id="ws-open-files-btn"><span class="material-symbols-outlined">folder</span> <span data-i18n="modal.ws.openFiles">Open Files</span></button>
        <button class="m3-action-btn m3-btn-tonal" id="ws-open-tools-btn"><span class="material-symbols-outlined">construction</span> <span data-i18n="modal.ws.openTools">Open Tools</span></button>
        <md-filled-button id="workspace-info-ok-btn"><span class="material-symbols-outlined" slot="icon">check</span> <span data-i18n="common.done">Done</span></md-filled-button>
      </div>
    </div>
  </div>

  <!-- Floating Settings Modal Dialog (Claude Code Style) -->
  <div id="settings-modal" class="modal-backdrop modal-backdrop-settings" style="display:none;">
    <div class="settings-dialog-card" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
      <!-- Top-right Close Button -->
      <button id="settings-close-btn" class="settings-close-btn" data-i18n-title="common.close" title="Close (Esc)">
        <span class="material-symbols-outlined">close</span>
      </button>

      <!-- Left Column: Navigation Sidebar -->
      <aside class="settings-sidebar">
        <!-- Search bar -->
        <div class="settings-search-box">
          <span class="material-symbols-outlined search-icon">search</span>
          <input type="text" id="settings-search-input" class="settings-search-field" data-i18n-placeholder="settings.searchPlaceholder" placeholder="搜索..." />
        </div>

        <!-- One scrolling list of the six real SETTINGS groups, rendered from
             /api/settings so it can never drift from /config. Scrollspy
             highlights the group whose rows fill the viewport. -->
        <div class="settings-nav-scroll" id="settings-nav-scroll"></div>
      </aside>

      <!-- Right Column: Settings Content -->
      <main class="settings-main-content" id="settings-main-content">
        <!-- Dynamically rendered tab contents -->
      </main>
    </div>
  </div>

  <!-- Load SDK -->
  <script src="/sdk.js"></script>

  <!-- Injected Plugins -->
  ${pluginTags}

  <!-- Main App Script -->
  <script src="/app.js"></script>
</body>
</html>`
}
