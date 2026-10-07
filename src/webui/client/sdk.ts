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
    zh: {
      'common.search': '搜索',
      'common.cancel': '取消',
      'common.save': '保存',
      'common.close': '关闭',
      'common.done': '完成',
      'common.refresh': '刷新',
      'common.apply': '应用',
      'common.ready': '就绪',
      'common.connected': '● 已连接',
      'common.disconnected': '● 连接已断开',
      'common.generating': '思考与生成中...',
      'common.send': '发送',
      'common.sendTitle': '发送消息 (Enter)',
      'common.stop': '停止',
      'common.stopTitle': '停止生成 (Esc)',
      'common.file': '文件',
      'common.command': '命令',
      'common.untitledConversation': '未命名会话',
      'header.toggleSidebar': '切换侧边栏',
      'header.brandTag': 'M3E 智能体工作室',
      'header.themeToggle': '切换浅色/深色主题',
      'header.demo': '示例演示',
      'header.demoShowcaseTitle': '加载交互式演示示例',
      'header.newSession': '新建会话',
      'header.newSessionTitle': '开始全新的对话',
      'sidebar.tab.chat': '对话',
      'sidebar.tab.files': '文件',
      'sidebar.tab.tools': '工具',
      'sidebar.savedConversations': '对话和任务',
      'sidebar.settings': '设置',
      'sidebar.msgs': '条消息',
      'sidebar.sample': '示例',
      'sidebar.workspaceTitle': '工作区与 Git 分支',
      'welcome.badge': 'Material 3 Expressive 智能体工作室',
      'welcome.title': '今天想构建什么？',
      'welcome.subtitle': '具备自愈工具循环、终端执行与代码实时重构能力的自主结对编程智能体。',
      'welcome.card.demo.title': '运行交互式演示',
      'welcome.card.demo.desc': '模拟智能体推理过程、通过 Bash 运行测试及代码审查。',
      'welcome.card.demo.btn': '体验示例',
      'welcome.card.files.title': '浏览项目工作区',
      'welcome.card.files.desc': '查看项目目录树结构、查看文件内容并插入 @路径 到对话。',
      'welcome.card.files.btn': '浏览文件',
      'welcome.card.test.title': '运行项目测试套件',
      'welcome.card.test.desc': '执行全项目测试诊断，验证系统套件完整性。',
      'welcome.card.test.btn': '运行测试',
      'welcome.card.tools.title': '智能体工具检查器',
      'welcome.card.tools.desc': '审查已注册工具定义、参数规范及交互诊断。',
      'welcome.card.tools.btn': '检查工具',
      'chat.dock.file': '文件',
      'chat.dock.fileTitle': '引用项目文件 (@)',
      'chat.dock.command': '命令',
      'chat.dock.commandTitle': '执行斜杠命令 (/)',
      'chat.input.placeholder': '向 MeowCode 提问、请求重构或引用 @文件... (Shift+Enter 换行，Enter 发送)',
      'input.placeholder': '向 MeowCode 提问、请求重构或引用 @文件... (Shift+Enter 换行，Enter 发送)',
      'statusbar.connected': '● 已连接',
      'statusbar.disconnected': '● 连接断开',
      'statusbar.ready': '就绪',
      'statusbar.running': '智能体运行中...',
      'statusbar.thinking': '思考与推理中...',
      'statusbar.executingTool': '正在执行工具: {name}',
      'todo.title': '任务清单',
      'todo.completed': '已完成',
      'todo.inProgress': '进行中',
      'todo.pending': '待处理',
      'todo.done': '已完成',
      'todo.expand': '展开任务清单',
      'todo.collapse': '收起任务清单',
      'session.rename': '重命名会话',
      'session.delete': '删除会话',
      'session.confirmDelete': '确定要删除此会话吗？删除后将无法恢复。',
      'session.renamed': '会话已重命名',
      'session.deleted': '会话已删除',
      'session.titlePlaceholder': '输入新会话标题...',
      'tools.read.title': '读取文件',
      'tools.search.title': '网页搜索',
      'tools.ask.title': '需要用户确认',
      'modal.files.title': '选择项目工作区文件',
      'modal.files.searchPlaceholder': '输入路径或文件名快速搜索...',
      'modal.files.hint': '点击任意文件插入 @路径 到对话中',
      'modal.cmd.title': '命令面板',
      'modal.cmd.searchPlaceholder': '输入斜杠命令或搜索...',
      'modal.cmd.hint': '按 Enter 或点击即可执行',
      'modal.model.title': '选择 AI 模型与提供商',
      'modal.model.hint': '选择模型以更新智能体工作室配置',
      'modal.ws.title': '工作区环境概览',
      'modal.ws.repo': '仓库',
      'modal.ws.branch': '分支',
      'modal.ws.runtime': '运行时',
      'modal.ws.provider': '提供商',
      'modal.ws.model': '当前模型',
      'modal.ws.tools': '工具',
      'modal.ws.openFiles': '浏览文件',
      'modal.ws.openTools': '检查工具',
      'plugins.files.filterPlaceholder': '筛选文件...',
      'plugins.files.refresh': '刷新文件列表',
      'plugins.files.loading': '正在加载工作区文件...',
      'plugins.files.insert': '插入 @路径',
      'plugins.tools.test': '测试',
      'plugins.tools.testTitle': '测试工具: ',
      'plugins.tools.runTool': '运行工具',
      'settings.title': '设置',
      'settings.searchPlaceholder': '搜索...',
      'settings.section.settings': '设置',
      'settings.nav.general': '常规',
      'settings.nav.account': '账户',
      'settings.nav.privacy': '隐私',
      'settings.nav.billing': '账单',
      'settings.nav.capabilities': '功能',
      'settings.nav.memory': '记忆',
      'settings.nav.reflection': '反思',
      'settings.nav.focus': '时间与专注',
      'settings.nav.meowcode': 'Claude Code',
      'settings.section.machine': '此电脑',
      'settings.nav.system': '系统',
      'settings.nav.extensions': '扩展',
      'settings.nav.developer': '开发者',
      'settings.section.custom': '自定义',
      'settings.nav.skills': 'Skills',
      'settings.nav.connectors': '连接器',
      'settings.nav.plugins': '插件',
      'settings.section.platform': '平台',
      'settings.nav.apiKeys': 'API 密钥',
      'settings.appearance.title': '外观',
      'settings.appearance.theme': '主题',
      'settings.appearance.theme.system': '系统',
      'settings.appearance.theme.light': '浅色',
      'settings.appearance.theme.dark': '深色',
      'settings.appearance.font': '对话字体',
      'settings.appearance.chatWidth': '对话记录宽度',
      'settings.appearance.chatWidth.narrow': '窄版',
      'settings.appearance.chatWidth.medium': '中等',
      'settings.appearance.chatWidth.wide': '宽幅',
      'settings.appearance.chatWidth.desc': '对话记录栏和输入栏的最大宽度。',
      'settings.appearance.motion': '动效',
      'settings.appearance.motion.system': '系统',
      'settings.appearance.motion.reduced': '减弱',
      'settings.appearance.motion.desc': '减少流式回复和其他界面元素中的动画效果。',
      'settings.voice.title': '语音与语言',
      'settings.voice.language': '语言',
      'settings.voice.language.zh': '中文 ( 普通话 )',
      'settings.voice.language.en': 'English ( US )',
      'settings.voice.style': '风格',
      'settings.voice.style.soft': '柔和',
      'settings.voice.style.professional': '严谨',
      'settings.voice.speed': '速度',
      'settings.voice.speed.normal': '正常',
      'settings.voice.speed.fast': '稍快',
      'settings.notification.title': '通知',
      'settings.notification.turnDone': '回复完成',
      'settings.notification.turnDone.desc': '在 Claude 完成回复时接收通知，适用于长时间运行的任务。',
      'template.runTests': '运行测试',
      'template.runTests.prompt': '运行当前项目的测试套件并检查是否有错误。',
      'template.explainCode': '解释代码',
      'template.explainCode.prompt': '解释当前项目的核心架构与主要工作流。',
      'template.refactor': '重构代码',
      'template.refactor.prompt': '分析近期的代码变动并提出优雅的代码重构建议。',
      'template.fixBug': '修复缺陷',
      'template.fixBug.prompt': '协助诊断并修复最近的错误或失败测试。',
      'template.document': '编写文档',
      'template.document.prompt': '为最近添加的特性编写详尽的文档与注释。',
      'template.optimize': '性能优化',
      'template.optimize.prompt': '识别潜在的性能瓶颈并提供优化建议。'
    },
    en: {
      'common.search': 'Search',
      'common.cancel': 'Cancel',
      'common.save': 'Save',
      'common.close': 'Close',
      'common.done': 'Done',
      'common.refresh': 'Refresh',
      'common.apply': 'Apply',
      'common.ready': 'Ready',
      'common.connected': '● Connected',
      'common.disconnected': '● Disconnected',
      'common.generating': 'Generating...',
      'common.send': 'Send',
      'common.sendTitle': 'Send message (Enter)',
      'common.stop': 'Stop',
      'common.stopTitle': 'Stop generation (Esc)',
      'common.file': 'File',
      'common.command': 'Command',
      'common.untitledConversation': 'Untitled Conversation',
      'header.toggleSidebar': 'Toggle Sidebar',
      'header.brandTag': 'M3E Studio',
      'header.themeToggle': 'Toggle Light / Dark Mode',
      'header.demo': 'Demo Showcase',
      'header.demoShowcaseTitle': 'Load Interactive Demo Showcase',
      'header.newSession': 'New Session',
      'header.newSessionTitle': 'Start a fresh conversation',
      'sidebar.tab.chat': 'Chat',
      'sidebar.tab.files': 'Files',
      'sidebar.tab.tools': 'Tools',
      'sidebar.savedConversations': 'Saved Conversations',
      'sidebar.settings': 'Settings',
      'sidebar.msgs': 'msgs',
      'sidebar.sample': 'Sample',
      'sidebar.workspaceTitle': 'Workspace & Git Branch',
      'welcome.badge': 'Material 3 Expressive Studio',
      'welcome.title': 'What would you like to build?',
      'welcome.subtitle': 'Autonomous agentic pair programmer equipped with self-healing tool loops, terminal execution, and live code refactoring.',
      'welcome.card.demo.title': 'Run Interactive Demo',
      'welcome.card.demo.desc': 'Simulate agent reasoning, test execution via bash, and visual diff review.',
      'welcome.card.demo.btn': 'Experience Demo',
      'welcome.card.files.title': 'Browse Workspace Files',
      'welcome.card.files.desc': 'Inspect project tree, view file contents, and insert @paths into chat prompt.',
      'welcome.card.files.btn': 'Explore Files',
      'welcome.card.test.title': 'Run Test Suite',
      'welcome.card.test.desc': 'Execute test diagnostics across the repository to verify harness integrity.',
      'welcome.card.test.btn': 'Run Tests',
      'welcome.card.tools.title': 'Tools Inspector',
      'welcome.card.tools.desc': 'Examine registered tools, schema definitions, and interactive diagnostics.',
      'welcome.card.tools.btn': 'Inspect Tools',
      'chat.dock.file': 'File',
      'chat.dock.fileTitle': 'Reference workspace file (@)',
      'chat.dock.command': 'Command',
      'chat.dock.commandTitle': 'Slash commands (/)',
      'chat.input.placeholder': 'Ask MeowCode anything, request refactorings, or reference @files... (Shift+Enter for newline, Enter to send)',
      'input.placeholder': 'Ask MeowCode anything, request refactorings, or reference @files... (Shift+Enter for newline, Enter to send)',
      'statusbar.connected': '● Connected',
      'statusbar.disconnected': '● Disconnected',
      'statusbar.ready': 'Ready',
      'statusbar.running': 'Agent running...',
      'statusbar.thinking': 'Thinking & reasoning...',
      'statusbar.executingTool': 'Executing tool: {name}',
      'todo.title': 'Task Checklist',
      'todo.completed': 'Completed',
      'todo.inProgress': 'In Progress',
      'todo.pending': 'Pending',
      'todo.done': 'Done',
      'todo.expand': 'Expand tasks',
      'todo.collapse': 'Collapse tasks',
      'session.rename': 'Rename session',
      'session.delete': 'Delete session',
      'session.confirmDelete': 'Are you sure you want to delete this session? This cannot be undone.',
      'session.renamed': 'Session renamed',
      'session.deleted': 'Session deleted',
      'session.titlePlaceholder': 'Enter new session title...',
      'tools.read.title': 'Read File',
      'tools.search.title': 'Web Search',
      'tools.ask.title': 'User Decision Required',
      'modal.files.title': 'Select Workspace File',
      'modal.files.searchPlaceholder': 'Search workspace files by path or name...',
      'modal.files.hint': 'Click any file to insert @path into prompt',
      'modal.cmd.title': 'Command Palette',
      'modal.cmd.searchPlaceholder': 'Type a slash command or search...',
      'modal.cmd.hint': 'Press Enter or click to execute',
      'modal.model.title': 'Select AI Model & Provider',
      'modal.model.hint': 'Select model to update studio configuration',
      'modal.ws.title': 'Workspace Environment',
      'modal.ws.repo': 'Repository',
      'modal.ws.branch': 'Branch',
      'modal.ws.runtime': 'Runtime',
      'modal.ws.provider': 'Provider',
      'modal.ws.model': 'Active Model',
      'modal.ws.tools': 'Tools',
      'modal.ws.openFiles': 'Browse Files',
      'modal.ws.openTools': 'Inspect Tools',
      'plugins.files.filterPlaceholder': 'Filter files...',
      'plugins.files.refresh': 'Refresh files',
      'plugins.files.loading': 'Loading workspace files...',
      'plugins.files.insert': 'Insert @path',
      'plugins.tools.test': 'Test',
      'plugins.tools.testTitle': 'Test Tool: ',
      'plugins.tools.runTool': 'Run Tool',
      'settings.title': 'Settings',
      'settings.searchPlaceholder': 'Search...',
      'settings.section.settings': 'SETTINGS',
      'settings.nav.general': 'General',
      'settings.nav.account': 'Account',
      'settings.nav.privacy': 'Privacy',
      'settings.nav.billing': 'Billing',
      'settings.nav.capabilities': 'Capabilities',
      'settings.nav.memory': 'Memory',
      'settings.nav.reflection': 'Reflection',
      'settings.nav.focus': 'Time & Focus',
      'settings.nav.meowcode': 'Claude Code',
      'settings.section.machine': 'THIS MACHINE',
      'settings.nav.system': 'System',
      'settings.nav.extensions': 'Extensions',
      'settings.nav.developer': 'Developer',
      'settings.section.custom': 'CUSTOMIZATION',
      'settings.nav.skills': 'Skills',
      'settings.nav.connectors': 'Connectors',
      'settings.nav.plugins': 'Plugins',
      'settings.section.platform': 'PLATFORM',
      'settings.nav.apiKeys': 'API Keys',
      'settings.appearance.title': 'Appearance',
      'settings.appearance.theme': 'Theme',
      'settings.appearance.theme.system': 'System',
      'settings.appearance.theme.light': 'Light',
      'settings.appearance.theme.dark': 'Dark',
      'settings.appearance.font': 'Chat Font',
      'settings.appearance.chatWidth': 'Chat Width',
      'settings.appearance.chatWidth.narrow': 'Narrow',
      'settings.appearance.chatWidth.medium': 'Medium',
      'settings.appearance.chatWidth.wide': 'Wide',
      'settings.appearance.chatWidth.desc': 'Maximum width for conversation transcript and input dock.',
      'settings.appearance.motion': 'Motion',
      'settings.appearance.motion.system': 'System',
      'settings.appearance.motion.reduced': 'Reduced',
      'settings.appearance.motion.desc': 'Reduce motion and animations in streaming responses and UI.',
      'settings.voice.title': 'Voice & Language',
      'settings.voice.language': 'Language',
      'settings.voice.language.zh': 'Chinese (Mandarin)',
      'settings.voice.language.en': 'English (US)',
      'settings.voice.style': 'Style',
      'settings.voice.style.soft': 'Soft',
      'settings.voice.style.professional': 'Professional',
      'settings.voice.speed': 'Speed',
      'settings.voice.speed.normal': 'Normal',
      'settings.voice.speed.fast': 'Fast',
      'settings.notification.title': 'Notifications',
      'settings.notification.turnDone': 'Turn Complete',
      'settings.notification.turnDone.desc': 'Receive notifications when Claude completes a response, useful for long-running tasks.',
      'template.runTests': 'Run Tests',
      'template.runTests.prompt': 'Run the project tests and check if everything passes.',
      'template.explainCode': 'Explain Code',
      'template.explainCode.prompt': 'Explain the architecture and main workflows of this project.',
      'template.refactor': 'Refactor',
      'template.refactor.prompt': 'Analyze recent changes and propose clean code refactorings.',
      'template.fixBug': 'Fix Bug',
      'template.fixBug.prompt': 'Help diagnose and fix the latest error or failing test.',
      'template.document': 'Document',
      'template.document.prompt': 'Write comprehensive documentation for recently added features.',
      'template.optimize': 'Optimize',
      'template.optimize.prompt': 'Identify performance bottlenecks and recommend optimizations.'
    }
  };

  const detectedLang = (function() {
    const saved = localStorage.getItem('meowcode_lang');
    if (saved === 'zh' || saved === 'en') return saved;
    const nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
    return nav.startsWith('zh') ? 'zh' : 'en';
  })();

  let currentLang = detectedLang;

  function t(key, params) {
    const table = i18nDict[currentLang] || i18nDict.zh || {};
    let str = table[key] || (i18nDict.en && i18nDict.en[key]) || key;
    if (params) {
      Object.keys(params).forEach(k => {
        str = str.replace(new RegExp('\\\\{' + k + '\\\\}', 'g'), String(params[k]));
      });
    }
    return str;
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
  }

  const i18n = {
    getLang() { return currentLang; },
    setLang(lang) {
      if (lang !== 'zh' && lang !== 'en') return;
      currentLang = lang;
      localStorage.setItem('meowcode_lang', lang);
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

  const commands = {
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
    async callBackendPlugin(pluginId, action, payload = {}) {
      return await apiFetch('/api/plugins/' + encodeURIComponent(pluginId) + '/' + encodeURIComponent(action), {
        method: 'POST',
        body: JSON.stringify(payload),
      });
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
      box.className = 'modal-container';
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

      const close = () => {
        backdrop.style.opacity = '0';
        setTimeout(() => backdrop.remove(), 160);
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
    slots,
    panels,
    tools,
    commands,
    api,
    ui,
    m3,
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
