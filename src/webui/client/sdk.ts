export const CLIENT_SDK_JS = `/**
 * MeowCode WebUI Client SDK (window.MeowSDK)
 * Provides Extension Slots, Custom Panels, Tool Visualizers, Command Registry, Theme Manager, and Event Bus.
 */
(function() {
  if (window.MeowSDK) return;

  const eventListeners = new Map();

  function on(event, callback) {
    if (!eventListeners.has(event)) eventListeners.set(event, new Set());
    eventListeners.get(event).add(callback);
    return () => off(event, callback);
  }

  function off(event, callback) {
    const set = eventListeners.get(event);
    if (set) set.delete(callback);
  }

  function emit(event, ...args) {
    const set = eventListeners.get(event);
    if (set) {
      set.forEach(cb => {
        try { cb(...args); } catch (e) { console.error('[MeowSDK Event Error]', event, e); }
      });
    }
  }

  // --- Theme Manager (M3 Expressive Light / Dark / System) ---
  let currentThemeMode = localStorage.getItem('meowcode-theme-mode') || 'dark';

  function applyTheme(mode) {
    let effective = mode;
    if (mode === 'system') {
      effective = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', effective);
    localStorage.setItem('meowcode-theme-mode', mode);
    emit('theme:change', { mode, effective });
    return effective;
  }

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (currentThemeMode === 'system') applyTheme('system');
    });
  }

  // Initial theme application
  applyTheme(currentThemeMode);

  const theme = {
    getTheme() {
      return currentThemeMode;
    },
    getEffectiveTheme() {
      return document.documentElement.getAttribute('data-theme') || 'dark';
    },
    setTheme(mode) {
      currentThemeMode = mode;
      return applyTheme(mode);
    },
    toggleTheme() {
      const next = theme.getEffectiveTheme() === 'dark' ? 'light' : 'dark';
      theme.setTheme(next);
      return next;
    },
    register(name, tokens) {
      const style = document.createElement('style');
      const declarations = Object.entries(tokens).map(([k, v]) => \`\${k}: \${v};\`).join('\\n');
      style.textContent = \`[data-theme="\${name}"] { \${declarations} }\`;
      document.head.appendChild(style);
      emit('theme:registered', name);
    }
  };

  // --- i18n Internationalization Manager ---
  const i18nDict = {
      'chat.dock.command': { zh: '命令', en: 'Command' },
      'chat.dock.commandTitle': { zh: '执行斜杠命令 (/)', en: 'Slash commands (/)' },
      'chat.dock.file': { zh: '文件', en: 'File' },
      'chat.dock.fileTitle': { zh: '引用项目文件 (@)', en: 'Reference workspace file (@)' },
      'chat.input.placeholder': { zh: '向 MeowCode 提问、请求重构或引用 @文件... (Shift+Enter 换行，Enter 发送)', en: 'Ask MeowCode anything, request refactorings, or reference @files... (Shift+Enter for newline, Enter to send)' },
      'chat.queued': { zh: '已排队，将在当前回合的下一个工具批次后插入', en: 'Queued — it joins the running turn after the next tool batch' },
      'chat.retrying': { zh: '✳ {reason} · {secs}s 后重试 · 第 {attempt}/{max} 次', en: '✳ {reason} · Retrying in {secs}s · attempt {attempt}/{max}' },
      'chat.subagent.none': { zh: '暂无子智能体', en: 'No sub-agents' },
      'common.apply': { zh: '应用', en: 'Apply' },
      'common.cancel': { zh: '取消', en: 'Cancel' },
      'common.close': { zh: '关闭', en: 'Close' },
      'common.command': { zh: '命令', en: 'Command' },
      'common.connected': { zh: '● 已连接', en: '● Connected' },
      'common.disconnected': { zh: '● 连接已断开', en: '● Disconnected' },
      'common.done': { zh: '完成', en: 'Done' },
      'common.file': { zh: '文件', en: 'File' },
      'common.generating': { zh: '思考与生成中...', en: 'Generating...' },
      'common.queue': { zh: '排队', en: 'Queue' },
      'common.queueTitle': { zh: '排队，插入当前回合', en: 'Queue this line for the running turn' },
      'common.ready': { zh: '就绪', en: 'Ready' },
      'common.refresh': { zh: '刷新', en: 'Refresh' },
      'common.save': { zh: '保存', en: 'Save' },
      'common.search': { zh: '搜索', en: 'Search' },
      'common.send': { zh: '发送', en: 'Send' },
      'common.sendTitle': { zh: '发送消息 (Enter)', en: 'Send message (Enter)' },
      'common.stop': { zh: '停止', en: 'Stop' },
      'common.stopTitle': { zh: '停止生成 (Esc)', en: 'Stop generation (Esc)' },
      'common.untitledConversation': { zh: '未命名会话', en: 'Untitled Conversation' },
      'header.brandTag': { zh: 'M3E 智能体工作室', en: 'M3E Studio' },
      'header.demo': { zh: '示例演示', en: 'Demo Showcase' },
      'header.demoShowcaseTitle': { zh: '加载交互式演示示例', en: 'Load Interactive Demo Showcase' },
      'header.newSession': { zh: '新建会话', en: 'New Session' },
      'header.newSessionTitle': { zh: '开始全新的对话', en: 'Start a fresh conversation' },
      'header.themeToggle': { zh: '切换浅色/深色主题', en: 'Toggle Light / Dark Mode' },
      'header.toggleSidebar': { zh: '切换侧边栏', en: 'Toggle Sidebar' },
      'input.placeholder': { zh: '向 MeowCode 提问、请求重构或引用 @文件... (Shift+Enter 换行，Enter 发送)', en: 'Ask MeowCode anything, request refactorings, or reference @files... (Shift+Enter for newline, Enter to send)' },
      'modal.askUser.cancelled': { zh: '已取消', en: 'Cancelled' },
      'modal.askUser.other': { zh: '其他（手动输入）', en: 'Other (type your own)' },
      'modal.askUser.submit': { zh: '提交', en: 'Submit' },
      'modal.askUser.title': { zh: '需要你的选择', en: 'The agent needs your call' },
      'modal.cmd.hint': { zh: '按 Enter 或点击即可执行', en: 'Press Enter or click to execute' },
      'modal.cmd.searchPlaceholder': { zh: '输入斜杠命令或搜索...', en: 'Type a slash command or search...' },
      'modal.cmd.title': { zh: '命令面板', en: 'Command Palette' },
      'modal.files.hint': { zh: '点击任意文件插入 @路径 到对话中', en: 'Click any file to insert @path into prompt' },
      'modal.files.searchPlaceholder': { zh: '输入路径或文件名快速搜索...', en: 'Search workspace files by path or name...' },
      'modal.files.title': { zh: '选择项目工作区文件', en: 'Select Workspace File' },
      'modal.model.hint': { zh: '选择模型以更新智能体工作室配置', en: 'Select model to update studio configuration' },
      'modal.model.title': { zh: '选择 AI 模型与提供商', en: 'Select AI Model & Provider' },
      'modal.permission.allow': { zh: '允许', en: 'Allow' },
      'modal.permission.deny': { zh: '拒绝', en: 'Deny' },
      'modal.permission.title': { zh: '需要授权', en: 'Permission required' },
      'modal.ws.branch': { zh: '分支', en: 'Branch' },
      'modal.ws.model': { zh: '当前模型', en: 'Active Model' },
      'modal.ws.openFiles': { zh: '浏览文件', en: 'Browse Files' },
      'modal.ws.openTools': { zh: '检查工具', en: 'Inspect Tools' },
      'modal.ws.provider': { zh: '提供商', en: 'Provider' },
      'modal.ws.repo': { zh: '仓库', en: 'Repository' },
      'modal.ws.runtime': { zh: '运行时', en: 'Runtime' },
      'modal.ws.title': { zh: '工作区环境概览', en: 'Workspace Environment' },
      'modal.ws.tools': { zh: '工具', en: 'Tools' },
      'plugins.files.filterPlaceholder': { zh: '筛选文件...', en: 'Filter files...' },
      'plugins.files.insert': { zh: '插入 @路径', en: 'Insert @path' },
      'plugins.files.loading': { zh: '正在加载工作区文件...', en: 'Loading workspace files...' },
      'plugins.files.refresh': { zh: '刷新文件列表', en: 'Refresh files' },
      'plugins.tools.runTool': { zh: '运行工具', en: 'Run Tool' },
      'plugins.tools.test': { zh: '测试', en: 'Test' },
      'plugins.tools.testTitle': { zh: '测试工具: ', en: 'Test Tool: ' },
      'session.confirmDelete': { zh: '确定要删除此会话吗？删除后将无法恢复。', en: 'Are you sure you want to delete this session? This cannot be undone.' },
      'session.delete': { zh: '删除会话', en: 'Delete session' },
      'session.deleted': { zh: '会话已删除', en: 'Session deleted' },
      'session.rename': { zh: '重命名会话', en: 'Rename session' },
      'session.renamed': { zh: '会话已重命名', en: 'Session renamed' },
      'session.titlePlaceholder': { zh: '输入新会话标题...', en: 'Enter new session title...' },
      'settings.appearance.chatWidth': { zh: '对话记录宽度', en: 'Chat Width' },
      'settings.appearance.chatWidth.desc': { zh: '对话记录栏和输入栏的最大宽度。', en: 'Maximum width for conversation transcript and input dock.' },
      'settings.appearance.chatWidth.medium': { zh: '中等', en: 'Medium' },
      'settings.appearance.chatWidth.narrow': { zh: '窄版', en: 'Narrow' },
      'settings.appearance.chatWidth.wide': { zh: '宽幅', en: 'Wide' },
      'settings.appearance.font': { zh: '对话字体', en: 'Chat Font' },
      'settings.appearance.motion': { zh: '动效', en: 'Motion' },
      'settings.appearance.motion.desc': { zh: '减少流式回复和其他界面元素中的动画效果。', en: 'Reduce motion and animations in streaming responses and UI.' },
      'settings.appearance.motion.reduced': { zh: '减弱', en: 'Reduced' },
      'settings.appearance.motion.system': { zh: '系统', en: 'System' },
      'settings.appearance.theme': { zh: '主题', en: 'Theme' },
      'settings.appearance.theme.dark': { zh: '深色', en: 'Dark' },
      'settings.appearance.theme.light': { zh: '浅色', en: 'Light' },
      'settings.appearance.theme.system': { zh: '系统', en: 'System' },
      'settings.appearance.title': { zh: '外观', en: 'Appearance' },
      'settings.nav.account': { zh: '账户', en: 'Account' },
      'settings.nav.apiKeys': { zh: 'API 密钥', en: 'API Keys' },
      'settings.nav.billing': { zh: '账单', en: 'Billing' },
      'settings.nav.capabilities': { zh: '功能', en: 'Capabilities' },
      'settings.nav.connectors': { zh: '连接器', en: 'Connectors' },
      'settings.nav.developer': { zh: '开发者', en: 'Developer' },
      'settings.nav.extensions': { zh: '扩展', en: 'Extensions' },
      'settings.nav.focus': { zh: '时间与专注', en: 'Time & Focus' },
      'settings.nav.general': { zh: '常规', en: 'General' },
      'settings.nav.memory': { zh: '记忆', en: 'Memory' },
      'settings.nav.meowcode': { zh: 'Claude Code', en: 'Claude Code' },
      'settings.nav.plugins': { zh: '插件', en: 'Plugins' },
      'settings.nav.privacy': { zh: '隐私', en: 'Privacy' },
      'settings.nav.reflection': { zh: '反思', en: 'Reflection' },
      'settings.nav.skills': { zh: 'Skills', en: 'Skills' },
      'settings.nav.system': { zh: '系统', en: 'System' },
      'settings.notification.title': { zh: '通知', en: 'Notifications' },
      'settings.notification.turnDone': { zh: '回复完成', en: 'Turn Complete' },
      'settings.notification.turnDone.desc': { zh: '在 Claude 完成回复时接收通知，适用于长时间运行的任务。', en: 'Receive notifications when Claude completes a response, useful for long-running tasks.' },
      'settings.searchPlaceholder': { zh: '搜索...', en: 'Search...' },
      'settings.section.custom': { zh: '自定义', en: 'CUSTOMIZATION' },
      'settings.section.machine': { zh: '此电脑', en: 'THIS MACHINE' },
      'settings.section.platform': { zh: '平台', en: 'PLATFORM' },
      'settings.section.settings': { zh: '设置', en: 'SETTINGS' },
      'settings.title': { zh: '设置', en: 'Settings' },
      'settings.voice.language': { zh: '语言', en: 'Language' },
      'settings.voice.language.en': { zh: 'English ( US )', en: 'English (US)' },
      'settings.voice.language.zh': { zh: '中文 ( 普通话 )', en: 'Chinese (Mandarin)' },
      'settings.voice.speed': { zh: '速度', en: 'Speed' },
      'settings.voice.speed.fast': { zh: '稍快', en: 'Fast' },
      'settings.voice.speed.normal': { zh: '正常', en: 'Normal' },
      'settings.voice.style': { zh: '风格', en: 'Style' },
      'settings.voice.style.professional': { zh: '严谨', en: 'Professional' },
      'settings.voice.style.soft': { zh: '柔和', en: 'Soft' },
      'settings.voice.title': { zh: '语音与语言', en: 'Voice & Language' },
      'sidebar.msgs': { zh: '条消息', en: 'msgs' },
      'sidebar.sample': { zh: '示例', en: 'Sample' },
      'sidebar.savedConversations': { zh: '对话和任务', en: 'Saved Conversations' },
      'sidebar.settings': { zh: '设置', en: 'Settings' },
      'sidebar.tab.chat': { zh: '对话', en: 'Chat' },
      'sidebar.tab.files': { zh: '文件', en: 'Files' },
      'sidebar.tab.tools': { zh: '工具', en: 'Tools' },
      'sidebar.workspaceTitle': { zh: '工作区与 Git 分支', en: 'Workspace & Git Branch' },
      'statusbar.connected': { zh: '● 已连接', en: '● Connected' },
      'statusbar.disconnected': { zh: '● 连接断开', en: '● Disconnected' },
      'statusbar.executingTool': { zh: '正在执行工具: {name}', en: 'Executing tool: {name}' },
      'statusbar.ready': { zh: '就绪', en: 'Ready' },
      'statusbar.running': { zh: '智能体运行中...', en: 'Agent running...' },
      'statusbar.thinking': { zh: '思考与推理中...', en: 'Thinking & reasoning...' },
      'template.document': { zh: '编写文档', en: 'Document' },
      'template.document.prompt': { zh: '为最近添加的特性编写详尽的文档与注释。', en: 'Write comprehensive documentation for recently added features.' },
      'template.explainCode': { zh: '解释代码', en: 'Explain Code' },
      'template.explainCode.prompt': { zh: '解释当前项目的核心架构与主要工作流。', en: 'Explain the architecture and main workflows of this project.' },
      'template.fixBug': { zh: '修复缺陷', en: 'Fix Bug' },
      'template.fixBug.prompt': { zh: '协助诊断并修复最近的错误或失败测试。', en: 'Help diagnose and fix the latest error or failing test.' },
      'template.optimize': { zh: '性能优化', en: 'Optimize' },
      'template.optimize.prompt': { zh: '识别潜在的性能瓶颈并提供优化建议。', en: 'Identify performance bottlenecks and recommend optimizations.' },
      'template.refactor': { zh: '重构代码', en: 'Refactor' },
      'template.refactor.prompt': { zh: '分析近期的代码变动并提出优雅的代码重构建议。', en: 'Analyze recent changes and propose clean code refactorings.' },
      'template.runTests': { zh: '运行测试', en: 'Run Tests' },
      'template.runTests.prompt': { zh: '运行当前项目的测试套件并检查是否有错误。', en: 'Run the project tests and check if everything passes.' },
      'todo.collapse': { zh: '收起任务清单', en: 'Collapse tasks' },
      'todo.completed': { zh: '已完成', en: 'Completed' },
      'todo.done': { zh: '已完成', en: 'Done' },
      'todo.expand': { zh: '展开任务清单', en: 'Expand tasks' },
      'todo.inProgress': { zh: '进行中', en: 'In Progress' },
      'todo.pending': { zh: '待处理', en: 'Pending' },
      'todo.title': { zh: '任务清单', en: 'Task Checklist' },
      'tools.ask.title': { zh: '需要用户确认', en: 'User Decision Required' },
      'tools.read.title': { zh: '读取文件', en: 'Read File' },
      'tools.search.title': { zh: '网页搜索', en: 'Web Search' },
      'welcome.badge': { zh: 'Material 3 Expressive 智能体工作室', en: 'Material 3 Expressive Studio' },
      'welcome.card.demo.btn': { zh: '体验示例', en: 'Experience Demo' },
      'welcome.card.demo.desc': { zh: '模拟智能体推理过程、通过 Bash 运行测试及代码审查。', en: 'Simulate agent reasoning, test execution via bash, and visual diff review.' },
      'welcome.card.demo.title': { zh: '运行交互式演示', en: 'Run Interactive Demo' },
      'welcome.card.files.btn': { zh: '浏览文件', en: 'Explore Files' },
      'welcome.card.files.desc': { zh: '查看项目目录树结构、查看文件内容并插入 @路径 到对话。', en: 'Inspect project tree, view file contents, and insert @paths into chat prompt.' },
      'welcome.card.files.title': { zh: '浏览项目工作区', en: 'Browse Workspace Files' },
      'welcome.card.test.btn': { zh: '运行测试', en: 'Run Tests' },
      'welcome.card.test.desc': { zh: '执行全项目测试诊断，验证系统套件完整性。', en: 'Execute test diagnostics across the repository to verify harness integrity.' },
      'welcome.card.test.title': { zh: '运行项目测试套件', en: 'Run Test Suite' },
      'welcome.card.tools.btn': { zh: '检查工具', en: 'Inspect Tools' },
      'welcome.card.tools.desc': { zh: '审查已注册工具定义、参数规范及交互诊断。', en: 'Examine registered tools, schema definitions, and interactive diagnostics.' },
      'welcome.card.tools.title': { zh: '智能体工具检查器', en: 'Tools Inspector' },
      'welcome.subtitle': { zh: '具备自愈工具循环、终端执行与代码实时重构能力的自主结对编程智能体。', en: 'Autonomous agentic pair programmer equipped with self-healing tool loops, terminal execution, and live code refactoring.' },
      'welcome.title': { zh: '今天想构建什么？', en: 'What would you like to build?' },
  };

  // Both tables arrive as \`{ key: { zh, en } }\` from GET /api/i18n; the local
  // table above only fills the gap until that fetch lands, so the first paint is
  // never a wall of raw keys.
  const remoteTable = {};

  // The server inlines the full catalog as window.__MEOWCODE_BOOT_I18N__ (see
  // client/html.ts), so the catalog is already in hand before the first paint —
  // crucially before authReady, which is what lets the TOKEN GATE render
  // translated even though /api/i18n sits behind the gate it is trying to get
  // past. Same { lang, messages } shape as /api/i18n, so it merges identically.
  // Defensive: a plugin-less or older host may ship no boot catalog, and the
  // messages object may be empty — in that case loadRemoteCatalog still fetches.
  const bootI18n = (typeof window !== 'undefined' && window.__MEOWCODE_BOOT_I18N__) || null;
  if (bootI18n && bootI18n.messages) Object.assign(remoteTable, bootI18n.messages);

  const detectedLang = (function() {
    const saved = localStorage.getItem('meowcode_lang');
    if (saved === 'zh' || saved === 'en') return saved;
    // The server resolved a language for this run; honour it before falling back
    // to the browser's, so a Chinese-configured session does not open in English
    // just because the navigator says so.
    if (bootI18n && (bootI18n.lang === 'zh' || bootI18n.lang === 'en')) return bootI18n.lang;
    const nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
    return nav.startsWith('zh') ? 'zh' : 'en';
  })();

  let currentLang = detectedLang;

  // Mirror the boot language onto <html lang> immediately, before the catalog
  // fetch resolves. The static HTML ships lang="en" so the server-rendered shell
  // is well-formed for a client that never boots the SDK at all; everything that
  // actually renders text goes through setLang or loadRemoteCatalog, and both set
  // this again. Doing it here too means the very first paint already announces
  // the right language rather than flashing a wrong one.
  document.documentElement.setAttribute('lang', currentLang);

  function lookup(key) {
    const remote = remoteTable[key];
    if (remote) return remote[currentLang] || remote.en;
    const local = i18nDict[currentLang] || {};
    return local[key] || (i18nDict.en && i18nDict.en[key]);
  }

  function t(key, params) {
    const str = lookup(key) || key;
    if (!params) return str;
    // A callback, not a plain string: \`\${...}\` replacements would otherwise let
    // a value containing \`$&\` rewrite the surrounding message.
    return str.replace(/\\{(\\w+)\\}/g, (whole, k) => (k in params ? String(params[k]) : whole));
  }

  function updateDomI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key));
    });
    // An untranslated aria-label is a screen reader reading English at a Chinese
    // user, so the label is translated like any other string.
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
      const key = el.getAttribute('data-i18n-aria-label');
      if (key) el.setAttribute('aria-label', t(key));
    });
  }

  const i18n = {
    getLang() { return currentLang; },
    setLang(lang) {
      if (lang !== 'zh' && lang !== 'en') return;
      currentLang = lang;
      localStorage.setItem('meowcode_lang', lang);
      // <html lang> ships as "en" in the static HTML and nothing else touched it,
      // so the document kept claiming English while the page rendered Chinese —
      // which is what tells a screen reader which pronunciation table to use, and
      // what makes Chrome's translate prompt offer the wrong language. setLang is
      // the one place the language changes (settings panel, /config language, a
      // plugin calling sdk.i18n.setLang), so this is the one place it is mirrored.
      document.documentElement.setAttribute('lang', lang);
      updateDomI18n();
      emit('i18n:change', { lang });
    },
    t,
    updateDom: updateDomI18n,
    addDict(lang, entries) {
      if (!i18nDict[lang]) i18nDict[lang] = {};
      Object.assign(i18nDict[lang], entries);
      updateDomI18n();
    }
  };

  // Pull the shared catalog (the TUI's ~650 keys plus the WebUI-only strings) so
  // both surfaces translate identically. Failure is non-fatal: the local table
  // above keeps the UI readable, which is what a plugin-less static host needs.
  // One fetch is enough for the page's lifetime — the reply carries both
  // languages, so switching with i18n.setLang re-resolves every label without
  // going back to the server, and there is no second response that could land
  // late and revert it.
  //
  // When the server inlined a boot catalog (the common case), the table is
  // ALREADY full before authReady, so this fetch is skipped: it would be the same
  // bytes a second time, and it rides authReady, so it is also the one /api call
  // that would wait on the gate the boot catalog exists to let us draw. The fetch
  // stays as the fallback for a host that shipped no boot messages.
  //
  // Declared here, called below authReady: calling it at this point would hit
  // that const's temporal dead zone and take the whole SDK down with it.
  function loadRemoteCatalog() {
    if (Object.keys(remoteTable).length > 0) {
      // Boot catalog already in hand — just make the first paint reflect it.
      document.documentElement.setAttribute('lang', currentLang);
      updateDomI18n();
      emit('i18n:change', { lang: currentLang });
      return Promise.resolve();
    }
    return authReady
      .then(() => fetch('/api/i18n?lang=' + encodeURIComponent(currentLang), { credentials: 'same-origin' }))
      .then((r) => (r && r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !data.messages) return;
        Object.assign(remoteTable, data.messages);
        // This is the boot path, and boot decides which language the catalog was
        // resolved for before any setLang call — so it is where <html lang> has to
        // be corrected from the static "en", not only where a later switch is
        // mirrored. Without it the first paint announces English to assistive tech
        // even when the session is configured for Chinese.
        document.documentElement.setAttribute('lang', currentLang);
        updateDomI18n();
        emit('i18n:change', { lang: currentLang });
      })
      .catch(() => {});
  }

  // Run initial DOM update when ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => updateDomI18n());
  } else {
    setTimeout(updateDomI18n, 0);
  }

  // --- Slot Registry ---
  const slotsRegistry = new Map(); // slotId -> Map<itemId, SlotItem>

  const slots = {
    register(slotId, item) {
      if (!slotId || !item || !item.id || typeof item.render !== 'function') {
        throw new Error('Invalid slot registration');
      }
      if (!slotsRegistry.has(slotId)) slotsRegistry.set(slotId, new Map());
      slotsRegistry.get(slotId).set(item.id, item);
      emit('slot:registered', { slotId, itemId: item.id });
      return () => slots.unregister(slotId, item.id);
    },
    unregister(slotId, itemId) {
      const map = slotsRegistry.get(slotId);
      if (map) {
        map.delete(itemId);
        emit('slot:unregistered', { slotId, itemId });
      }
    },
    getSlotItems(slotId) {
      const map = slotsRegistry.get(slotId);
      if (!map) return [];
      return Array.from(map.values()).sort((a, b) => (b.priority || 0) - (a.priority || 0));
    },
    renderSlot(slotId, container, context = {}) {
      if (!container) return () => {};
      container.innerHTML = '';
      const items = slots.getSlotItems(slotId);
      const cleanups = [];
      const ctx = { ...context, sdk: window.MeowSDK };

      items.forEach(item => {
        const itemWrap = document.createElement('div');
        itemWrap.className = 'slot-item slot-item-' + item.id.replace(/[^a-zA-Z0-9_-]/g, '-');
        container.appendChild(itemWrap);
        try {
          const cleanup = item.render(itemWrap, ctx);
          if (typeof cleanup === 'function') cleanups.push(cleanup);
        } catch (e) {
          console.error('[Slot Render Error]', slotId, item.id, e);
          itemWrap.innerHTML = '<span class="slot-error">!</span>';
        }
      });

      return () => {
        cleanups.forEach(fn => { try { fn(); } catch(e){} });
      };
    }
  };

  // --- Panel Registry ---
  const panelsRegistry = new Map();
  let activePanelId = 'chat';

  const panels = {
    register(panel) {
      if (!panel || !panel.id || typeof panel.render !== 'function') {
        throw new Error('Invalid panel definition');
      }
      panelsRegistry.set(panel.id, panel);
      emit('panel:registered', panel);
      return () => panels.unregister(panel.id);
    },
    unregister(panelId) {
      panelsRegistry.delete(panelId);
      emit('panel:unregistered', panelId);
    },
    getPanels() {
      return Array.from(panelsRegistry.values()).sort((a, b) => (b.priority || 0) - (a.priority || 0));
    },
    getActivePanel() {
      return activePanelId;
    },
    setActivePanel(panelId) {
      activePanelId = panelId;
      emit('panel:active', panelId);
    }
  };

  // --- Tool Renderer Registry ---
  const toolRenderers = new Map();

  const tools = {
    register(renderer) {
      if (!renderer || !renderer.toolName || typeof renderer.render !== 'function') {
        throw new Error('Invalid tool renderer');
      }
      toolRenderers.set(renderer.toolName, renderer);
      emit('tool:registered', renderer.toolName);
      return () => tools.unregister(renderer.toolName);
    },
    unregister(toolName) {
      toolRenderers.delete(toolName);
      emit('tool:unregistered', toolName);
    },
    getRenderer(toolName) {
      return toolRenderers.get(toolName);
    }
  };

  // --- Commands Registry ---
  const commandRegistry = new Map();

  // The server registry (commands/index.ts, plus whatever the user dropped in
  // .meowcode/commands) is the source of truth. It is fetched through apiFetch
  // rather than folded into this map so the two never drift: a command added on
  // the terminal side shows up in the palette without touching the browser.
  // Declared here and called later, because apiFetch is a function declaration
  // further down and hoists — but the const api object below does not.
  async function loadServerCommands() {
    const data = await apiFetch('/api/commands');
    const list = Array.isArray(data.commands) ? data.commands : [];
    return list.map((cmd) => ({
      ...cmd,
      id: 'server:' + cmd.name,
      source: 'server',
      // A command the terminal can drive but the browser cannot still belongs in
      // the palette — the client renders it as a copy-to-clipboard row instead of
      // pretending it can be run here.
      runnable: cmd.tuiOnly !== true,
    }));
  }

  const commands = {
    loadServerCommands,
    register(command) {
      if (!command || !command.id || typeof command.execute !== 'function') {
        throw new Error('Invalid command');
      }
      commandRegistry.set(command.id, command);
      emit('command:registered', command.id);
      return () => commands.unregister(command.id);
    },
    unregister(commandId) {
      commandRegistry.delete(commandId);
    },
    getCommands() {
      return Array.from(commandRegistry.values());
    },
    async execute(commandId) {
      const cmd = commandRegistry.get(commandId);
      if (cmd) await cmd.execute(window.MeowSDK);
    }
  };

  // --- Auth ---
  // The server hands the token to the browser in the URL *fragment*, which
  // browsers never transmit: it is spent here on a POST /api/auth, exchanged for
  // an HttpOnly cookie, and then scrubbed from the address bar so it cannot be
  // copied, screenshotted into a bug report, or restored by Back. From then on
  // every apiFetch rides the cookie (which is also what lets EventSource
  // authenticate — it cannot send headers).
  const auth = { authRequired: false, bypass: false, authenticated: false };

  // This tab's identity, for the interaction broker's claim protocol. Random per
  // page load and deliberately not persisted: the claim is about "these two live
  // tabs", not "this browser", so a reload is a new claimant and a second tab is a
  // different one. It is read as a free variable inside respondInteraction, which
  // is defined above this — hoisting is fine, but keeping it here means the id's
  // lifetime is obvious.
  const clientId =
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'tab-' + Math.random().toString(36).slice(2) + '-' + String(Date.now())) ;

  // The token may sit in either half of the URL. The fragment is what this build
  // prints (a server or a proxy log never sees it); the query is what EARLIER
  // builds printed and what is sitting in everyone's history and bookmarks, so it
  // still has to be read. Both are spent exactly once and both are scrubbed — a
  // query-param credential is leaked to every proxy and to Referer headers on
  // every outbound link the page makes.
  function tokenFromFragment() {
    const raw = /[#&]token=([^&]+)/.exec(location.hash || '')
      ?? /[?&]token=([^&]+)/.exec(location.search || '')
    if (!raw) return ''
    // A hand-edited or half-pasted link can carry a broken escape sequence, and
    // decodeURIComponent throws URIError on one. Taking the page down over the
    // credential would be absurd: fall back to the raw text, which the server
    // rejects on its own, and land in the gate.
    try { return decodeURIComponent(raw[1]) } catch (_) { return raw[1] }
  }

  function scrubFragment() {
    if (!location.hash && !location.search) return;
    history.replaceState(null, '', location.pathname);
  }

  async function spendToken(token) {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'same-origin',
    });
    if (!res.ok) return false;
    const data = await res.json();
    Object.assign(auth, { authRequired: !!data.authRequired, bypass: !!data.bypass, authenticated: true });
    return true;
  }

  function probeSecurity() {
    return fetch('/api/security', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) Object.assign(auth, data);
        return auth;
      })
      .catch(() => auth);
  }

  const authReady = (async () => {
    const fragmentToken = tokenFromFragment();
    // Scrub BEFORE the exchange, not after it: a slow or hanging POST /api/auth
    // would otherwise leave the credential sitting in the address bar for the
    // whole round-trip — the one window where a screenshot catches it. The token
    // is already in a local by now, so nothing downstream needs the URL.
    scrubFragment();
    // The very first probe rides no credential, so /api/security must be public.
    await probeSecurity();
    if (auth.bypass) {
      emit('auth:change', { ...auth });
      return auth;
    }
    if (fragmentToken) {
      const ok = await spendToken(fragmentToken).catch(() => false);
      if (ok) {
        emit('auth:change', { ...auth });
        return auth;
      }
    }
    // No fragment, or it was rejected: a cookie from an earlier visit may still
    // be good, so ask before declaring the page locked.
    try {
      const res = await fetch('/api/session/state', { credentials: 'same-origin' });
      if (res.ok) {
        auth.authenticated = true;
        emit('auth:change', { ...auth });
        return auth;
      }
    } catch (_) {}
    auth.authenticated = false;
    emit('auth:change', { ...auth });
    return auth;
  })();

  // /api/i18n sits behind the token, so the catalog fetch has to ride the
  // exchange above. This is its only call site — see loadRemoteCatalog.
  loadRemoteCatalog();

  const authApi = {
    ready: authReady,
    get state() { return { ...auth }; },
    /** Re-run the exchange (used by the unlock form when the first token failed). */
    async submit(token) {
      const ok = await spendToken(String(token || '').trim());
      scrubFragment();
      auth.authenticated = ok;
      emit('auth:change', { ...auth });
      return ok;
    },
  };

  // --- API Client ---
  // This run's API token, embedded in the page by the server. Sent on every call;
  // the server refuses /api without it (see webui/server.ts).
  const API_TOKEN = typeof window !== 'undefined' && window.__MEOWCODE_API_TOKEN__ ? window.__MEOWCODE_API_TOKEN__ : '';

  // EventSource can't set headers, so the token rides in the query string there.
  function withToken(endpoint) {
    if (!API_TOKEN) return endpoint;
    return endpoint + (endpoint.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(API_TOKEN);
  }

  async function apiFetch(endpoint, options = {}) {
    // Every API call waits on the cookie exchange, so no caller has to remember.
    await authReady;
    const res = await fetch(endpoint, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(API_TOKEN ? { 'X-MeowCode-Token': API_TOKEN } : {}),
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      let errText = res.statusText;
      try {
        const j = await res.json();
        if (j.error) errText = j.error;
      } catch (_) {}
      throw new Error(errText);
    }
    return await res.json();
  }

  const api = {
    async sendMessage(prompt) {
      return await apiFetch('/api/turn', { method: 'POST', body: JSON.stringify({ prompt }) });
    },
    async abort() {
      return await apiFetch('/api/abort', { method: 'POST' });
    },
    async queueTurnText(text) {
      return await apiFetch('/api/turn/queue', { method: 'POST', body: JSON.stringify({ text }) });
    },
    async respondInteraction(id, response) {
      // The clientId is what makes a double-answer honest: the server claims the
      // prompt on the first response and 409s anyone else, so two tabs racing on
      // the same permission cannot both believe they allowed it.
      return await apiFetch('/api/interaction/respond', {
        method: 'POST',
        body: JSON.stringify({ id, response, clientId: clientId }),
      });
    },
    // Prompts this client has not seen yet. Called on boot and after every SSE
    // reconnect, because a prompt raised while the stream was down has no other
    // way to reach the dialog that answers it.
    async pendingInteractions() {
      return await apiFetch('/api/interaction');
    },
    async getState() {
      return await apiFetch('/api/session/state');
    },
    async resetSession() {
      return await apiFetch('/api/session/reset', { method: 'POST' });
    },
    async listSessions() {
      return await apiFetch('/api/session/list');
    },
    async loadSession(id) {
      return await apiFetch('/api/session/load', { method: 'POST', body: JSON.stringify({ id }) });
    },
    async renameSession(id, title) {
      return await apiFetch('/api/session/rename', { method: 'POST', body: JSON.stringify({ id, title }) });
    },
    async deleteSession(id) {
      return await apiFetch('/api/session/delete', { method: 'POST', body: JSON.stringify({ id }) });
    },
    async getConfig() {
      return await apiFetch('/api/config');
    },
    async updateConfig(patch) {
      return await apiFetch('/api/config', { method: 'POST', body: JSON.stringify(patch) });
    },
    async listTools() {
      return await apiFetch('/api/tools');
    },
    async callTool(name, input) {
      return await apiFetch('/api/tools/call', { method: 'POST', body: JSON.stringify({ name, input }) });
    },
    async listCommands() {
      return await apiFetch('/api/commands');
    },
    async runCommand(command) {
      return await apiFetch('/api/commands/run', { method: 'POST', body: JSON.stringify({ command }) });
    },
    async loginInfo() {
      return await apiFetch('/api/login/info');
    },
    async login(body) {
      return await apiFetch('/api/login', { method: 'POST', body: JSON.stringify(body || {}) });
    },
    async logout() {
      return await apiFetch('/api/logout', { method: 'POST' });
    },
    async listSettings() {
      return await apiFetch('/api/settings');
    },
    async callBackendPlugin(pluginId, action, payload = {}) {
      const res = await apiFetch('/api/plugins/' + encodeURIComponent(pluginId) + '/' + encodeURIComponent(action), {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      // PluginManager wraps every route result in {ok, result} / {ok, error}, but
      // callers want the payload itself. Unwrap here, once, so no plugin has to
      // know the envelope — and getting this wrong is silent, because the old
      // call sites read .items off the wrapper, got undefined, and rendered an
      // empty list instead of an error.
      if (res && res.ok === false) throw new Error(res.error || (pluginId + ' ' + action + ' failed'));
      if (res && Object.prototype.hasOwnProperty.call(res, 'result')) return res.result;
      return res;
    },
  };

  // --- UI Helpers ---
  const ui = {
    showToast(opts) {
      const msg = typeof opts === 'string' ? opts : opts.message;
      const type = (typeof opts === 'object' && opts.type) || 'info';
      const duration = (typeof opts === 'object' && opts.durationMs) || 3000;

      let host = document.querySelector('#toast-host');
      if (!host) {
        host = document.createElement('div');
        host.id = 'toast-host';
        host.className = 'toast-host';
        document.body.appendChild(host);
      }

      const toast = document.createElement('div');
      toast.className = 'toast-item toast-' + type;
      toast.innerHTML = \`<span class="toast-dot"></span><span class="toast-text">\${escapeHtml(msg)}</span>\`;
      host.appendChild(toast);
      // Errors are also spoken through the live region: a toast is visual-only,
      // so a screen-reader user would otherwise never learn the call failed.
      if (type === 'error') emit('toast', { message: msg, type });

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 250);
      }, duration);
    },
    showModal(opts) {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';

      const box = document.createElement('div');
      box.className = 'modal-container' + (opts.className ? ' ' + opts.className : '');
      if (opts.width) box.style.maxWidth = opts.width;

      box.innerHTML = \`
        <div class="modal-header">
          <h3 class="modal-title">\${escapeHtml(opts.title || '')}</h3>
          <button class="modal-close-btn" title="Close">✕</button>
        </div>
        <div class="modal-body"></div>
        <div class="modal-footer">
          <button class="btn btn-ghost modal-btn-cancel">\${escapeHtml(opts.cancelText || 'Cancel')}</button>
          <button class="btn btn-primary modal-btn-confirm">\${escapeHtml(opts.confirmText || 'OK')}</button>
        </div>
      \`;

      const bodyEl = box.querySelector('.modal-body');
      if (typeof opts.content === 'string') {
        bodyEl.innerHTML = opts.content;
      } else if (opts.content instanceof HTMLElement) {
        bodyEl.appendChild(opts.content);
      }

      backdrop.appendChild(box);
      document.body.appendChild(backdrop);

      // Focus trap: while the dialog is up, Tab stays inside it and Esc closes.
      // Without this, Tab walks into the chat transcript behind the backdrop and
      // the user's next keystroke lands in the prompt input, not the dialog.
      const previousFocus = document.activeElement;
      const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
      function focusables() {
        return Array.from(box.querySelectorAll(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
      }
      function onKeydown(e) {
        if (e.key === 'Escape' && !opts.disableEscape) {
          e.stopPropagation();
          box.querySelector('.modal-btn-cancel').onclick();
          return;
        }
        if (e.key !== 'Tab') return;
        const items = focusables();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
      document.addEventListener('keydown', onKeydown, true);

      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeydown, true);
        backdrop.style.opacity = '0';
        setTimeout(() => backdrop.remove(), 160);
        // Hand focus back where it came from, so keyboard users are not dumped
        // at the top of the document by a dialog they just dismissed.
        if (previousFocus && typeof previousFocus.focus === 'function') {
          try { previousFocus.focus(); } catch (_) {}
        }
      };

      box.querySelector('.modal-close-btn').onclick = () => {
        close();
        if (opts.onCancel) opts.onCancel();
      };
      box.querySelector('.modal-btn-cancel').onclick = () => {
        close();
        if (opts.onCancel) opts.onCancel();
      };
      box.querySelector('.modal-btn-confirm').onclick = async () => {
        if (opts.onConfirm) {
          const res = await opts.onConfirm();
          if (res === false) return;
        }
        close();
      };

      // Land focus inside the dialog: a field marked with data-autofocus wins,
      // then autofocusCancel, then the confirm button. autofocusCancel exists so
      // a destructive confirmation can start on the safe answer — Enter should
      // never be the answer to a question nobody read.
      const initial =
        box.querySelector('[data-autofocus]') ||
        (opts.autofocusCancel ? box.querySelector('.modal-btn-cancel') : null) ||
        box.querySelector('.modal-btn-confirm');
      if (initial) initial.focus();

      return close;
    },
    openPanel(panelId) {
      panels.setActivePanel(panelId);
    },
    toggleSidebar() {
      emit('sidebar:toggle');
    }
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- Google Official Material Web (@material/web) Helpers ---
  const m3 = {
    isAvailable() {
      return typeof customElements !== 'undefined' && Boolean(customElements.get('md-filled-button'));
    },
    version: '1.5.0',
    tags: [
      'md-filled-button',
      'md-outlined-button',
      'md-elevated-button',
      'md-tonal-button',
      'md-text-button',
      'md-icon-button',
      'md-icon',
      'md-tabs',
      'md-primary-tab',
      'md-secondary-tab',
      'md-assist-chip',
      'md-filter-chip',
      'md-chip-set',
      'md-dialog',
      'md-divider',
      'md-circular-progress',
      'md-linear-progress',
      'md-switch',
      'md-checkbox',
      'md-ripple',
      'md-elevation',
      'md-filled-text-field',
      'md-outlined-text-field',
      'md-list',
      'md-list-item',
      'md-menu',
      'md-menu-item',
    ],
    create(tag, attributes = {}, innerContent = '') {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attributes)) {
        if (k === 'className' || k === 'class') {
          el.className = v;
        } else if (k.startsWith('on') && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (typeof v === 'boolean') {
          if (v) el.setAttribute(k, '');
        } else {
          el.setAttribute(k, String(v));
        }
      }
      if (typeof innerContent === 'string') {
        el.innerHTML = innerContent;
      } else if (innerContent instanceof HTMLElement) {
        el.appendChild(innerContent);
      }
      return el;
    }
  };

  // --- SDK Object ---
  const sdk = {
    version: '1.2.0',
    theme,
    i18n,
    auth: authApi,
    slots,
    panels,
    tools,
    commands,
    api,
    ui,
    m3,
    // Published so a plugin can escape before it renders, instead of each one
    // hand-rolling a copy. A plugin that builds HTML for a slot, a panel or a
    // toast almost always has untrusted input (a filename, a tool error, a label)
    // somewhere in it, and this is the escaper the app's own renderers use.
    escapeHtml,
    on,
    off,
    emit,
    async registerPlugin(plugin) {
      if (!plugin || !plugin.id || typeof plugin.setup !== 'function') {
        throw new Error('Invalid plugin: id and setup(sdk) required');
      }
      try {
        await plugin.setup(sdk);
        emit('plugin:loaded', plugin.id);
      } catch (err) {
        console.error('[Plugin Setup Error]', plugin.id, err);
        ui.showToast({ message: 'Plugin ' + plugin.name + ' failed to load', type: 'error' });
      }
    }
  };

  window.MeowSDK = sdk;
  window.MeowWebUI = sdk;
})();
`
