import type { WebUIPlugin } from '../types'

const frontendCode = `
(function() {
  const sdk = window.MeowSDK;
  if (!sdk) return;

  // 1. Register custom tool renderer for 'bash'
  sdk.tools.register({
    toolName: 'bash',
    render(container, call, result) {
      const cmd = call.input?.command || call.input?.cmd || '';
      const output = result?.display || result?.content || '';
      const isError = Boolean(result?.isError);

      container.className = 'tool-card tool-card-terminal';
      container.innerHTML = \`
        <div class="terminal-header">
          <div class="terminal-dots">
            <span class="dot red"></span>
            <span class="dot yellow"></span>
            <span class="dot green"></span>
          </div>
          <span class="terminal-title">bash</span>
          <span class="terminal-badge \${isError ? 'badge-error' : 'badge-success'}">\${isError ? 'FAILED' : 'EXIT 0'}</span>
        </div>
        <div class="terminal-command">
          <span class="terminal-prompt">$</span>
          <code>\${escapeHtml(cmd)}</code>
        </div>
        \${output ? '<pre class="terminal-output ' + (isError ? 'output-error' : '') + '">' + escapeHtml(output) + '</pre>' : ''}
      \`;
    }
  });

  // 2. Register custom tool renderer for 'edit_file' and 'write_file'
  function renderFileEdit(container, call, result) {
    const file = call.input?.file_path || call.input?.path || call.input?.target || '';
    const diff = result?.diff || [];
    const isError = Boolean(result?.isError);
    const content = result?.display || result?.content || '';

    container.className = 'tool-card tool-card-diff';
    let diffHtml = '';

    if (diff && diff.length > 0) {
      diffHtml = '<div class="diff-viewer">' + diff.map(d => {
        const sign = d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' ';
        const cls = d.type === 'add' ? 'diff-line-add' : d.type === 'del' ? 'diff-line-del' : 'diff-line-ctx';
        return '<div class="diff-line ' + cls + '"><span class="diff-sign">' + sign + '</span><span class="diff-text">' + escapeHtml(d.line) + '</span></div>';
      }).join('') + '</div>';
    } else if (content) {
      diffHtml = '<pre class="tool-plain-content">' + escapeHtml(content) + '</pre>';
    }

    container.innerHTML = \`
      <div class="diff-header">
        <span class="material-symbols-outlined diff-icon icon-sm" style="color:var(--md-sys-color-primary);">edit_document</span>
        <span class="diff-filename">\${escapeHtml(file || call.name)}</span>
        <span class="tool-tag \${isError ? 'tag-error' : 'tag-success'}">\${escapeHtml(call.name)}</span>
      </div>
      \${diffHtml}
    \`;
  }

  sdk.tools.register({ toolName: 'edit_file', render: renderFileEdit });
  sdk.tools.register({ toolName: 'write_file', render: renderFileEdit });

  // 3. Register custom tool renderer for 'todo_write' (Task Checklist)
  function renderTodoList(container, call, result) {
    const rawTodos = call.input?.todos || [];
    const todos = Array.isArray(rawTodos) ? rawTodos : [];
    const doneCount = todos.filter(t => t.status === 'completed').length;
    const totalCount = todos.length;
    const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    const t = (k, def) => (sdk.i18n ? sdk.i18n.t(k) : def);

    container.className = 'tool-card tool-card-todo';
    container.innerHTML = \`
      <div class="todo-card-header">
        <div class="todo-header-left">
          <span class="material-symbols-outlined todo-icon">checklist</span>
          <span>\${t('todo.title', 'Task Checklist')}</span>
        </div>
        <div class="todo-progress-chip">\${doneCount} / \${totalCount} \${t('todo.done', 'Done')} (\${percent}%)</div>
      </div>
      <div class="todo-progress-bar-track">
        <div class="todo-progress-bar-fill" style="width: \${percent}%;"></div>
      </div>
      <div class="todo-item-list">
        \${todos.map(item => {
          // status comes from the model's todo_write payload and lands in a class
          // attribute, so it is narrowed to the three drawable states here rather
          // than interpolated as written.
          const raw = item.status || 'pending';
          const status = raw === 'completed' || raw === 'in_progress' ? raw : 'pending';
          const isDone = status === 'completed';
          const isProg = status === 'in_progress';
          const icon = isDone ? 'check_circle' : isProg ? 'sync' : 'radio_button_unchecked';
          const statusLabel = isDone ? t('todo.completed', 'Completed') : isProg ? t('todo.inProgress', 'In Progress') : t('todo.pending', 'Pending');
          const tagClass = isDone ? 'todo-tag-completed' : isProg ? 'todo-tag-progress' : 'todo-tag-pending';
          const displayText = isProg && item.activeForm ? item.activeForm : (item.content || '');

          return \`
            <div class="todo-item \${status}">
              <span class="material-symbols-outlined todo-item-icon">\${escapeHtml(icon)}</span>
              <span class="todo-item-text">\${escapeHtml(displayText)}</span>
              <span class="todo-status-tag \${tagClass}">\${escapeHtml(statusLabel)}</span>
            </div>
          \`;
        }).join('')}
      </div>
    \`;
  }
  sdk.tools.register({ toolName: 'todo_write', render: renderTodoList });

  // 4. Register custom tool renderer for 'read_file'
  function renderReadFile(container, call, result) {
    const filePath = call.input?.path || 'file';
    const content = result?.content || result?.display || '';
    const isError = Boolean(result?.isError);
    const lineCount = content ? content.split('\\n').length : 0;

    container.className = 'tool-card tool-card-read';
    container.innerHTML = \`
      <div class="read-file-header">
        <div class="read-file-info">
          <span class="material-symbols-outlined icon-sm" style="color:var(--md-sys-color-primary);">description</span>
          <span>\${escapeHtml(filePath)}</span>
        </div>
        <span class="tool-tag \${isError ? 'tag-error' : 'tag-success'}">\${isError ? 'Error' : lineCount + ' lines'}</span>
      </div>
      <pre class="read-file-content \${isError ? 'output-error' : ''}">\${escapeHtml(content || '(reading file...)')}</pre>
    \`;
  }
  sdk.tools.register({ toolName: 'read_file', render: renderReadFile });

  // 5. Register custom tool renderer for 'web_search'
  function renderWebSearch(container, call, result) {
    const query = call.input?.query || '';
    const content = result?.content || result?.display || '';
    const isError = Boolean(result?.isError);

    container.className = 'tool-card tool-card-search';
    container.innerHTML = \`
      <div class="search-header">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="material-symbols-outlined icon-sm" style="color:var(--md-sys-color-primary);">travel_explore</span>
          <span class="search-query-text">"\${escapeHtml(query)}"</span>
        </div>
        <span class="tool-tag \${isError ? 'tag-error' : 'tag-success'}">\${isError ? 'Failed' : 'Web Search'}</span>
      </div>
      <div class="search-results-list">
        <div class="search-result-snippet">\${escapeHtml(content || '(searching...)')}</div>
      </div>
    \`;
  }
  sdk.tools.register({ toolName: 'web_search', render: renderWebSearch });

  // 6. Register custom tool renderer for 'ask_user'
  function renderAskUser(container, call, result) {
    const questions = Array.isArray(call.input?.questions) ? call.input.questions : [];
    container.className = 'tool-card tool-card-ask';
    container.innerHTML = \`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span class="material-symbols-outlined icon-sm" style="color:var(--md-sys-color-primary);">help_center</span>
        <span style="font-weight:600;font-size:13px;">\${sdk.i18n ? sdk.i18n.t('tools.ask.title', 'User Decision Required') : 'User Decision Required'}</span>
      </div>
      \${questions.map(q => \`
        <div class="ask-question-title">\${escapeHtml(q.question || '')}</div>
        <div class="ask-options-grid">
          \${(q.options || []).map(opt => \`
            <div class="ask-option-item">
              <span class="material-symbols-outlined icon-xs" style="color:var(--md-sys-color-primary);margin-top:2px;">radio_button_unchecked</span>
              <div>
                <div style="font-weight:600;">\${escapeHtml(opt.label || '')}</div>
                \${opt.description ? \`<div style="font-size:12px;color:var(--md-sys-color-on-surface-variant);">\${escapeHtml(opt.description)}</div>\` : ''}
              </div>
            </div>
          \`).join('')}
        </div>
      \`).join('')}
      \${result?.content ? \`<div style="margin-top:10px;font-size:12px;color:var(--md-sys-color-primary);"><strong>Answer:</strong> \${escapeHtml(result.content)}</div>\` : ''}
    \`;
  }
  sdk.tools.register({ toolName: 'ask_user', render: renderAskUser });

  // 3. Register Tools Inspector panel
  sdk.panels.register({
    id: 'tools',
    title: 'Tools',
    icon: 'construction',
    priority: 85,
    render(container) {
      container.innerHTML = \`
        <div class="panel-tools-view">
          <div class="panel-toolbar">
            <span class="panel-title-text">Agent Toolset Inspector</span>
            <button id="tools-refresh-btn" class="btn btn-sm btn-ghost" title="Refresh">
              <span class="material-symbols-outlined icon-sm">refresh</span>
            </button>
          </div>
          <div id="tools-list-container" class="tools-list-container">Loading tools...</div>
          <div id="tool-test-modal" class="tool-modal" style="display:none;">
            <div class="modal-backdrop"></div>
            <div class="modal-box">
              <h3 id="modal-tool-name">Test Tool</h3>
              <p id="modal-tool-desc" class="muted-text"></p>
              <textarea id="modal-tool-input" class="tool-json-input" placeholder='{"arg": "value"}'></textarea>
              <div class="modal-actions">
                <button id="modal-tool-run" class="btn btn-primary">Run Tool</button>
                <button id="modal-tool-cancel" class="btn btn-ghost">Cancel</button>
              </div>
              <pre id="modal-tool-result" class="modal-result" style="display:none;"></pre>
            </div>
          </div>
        </div>
      \`;

      const listContainer = container.querySelector('#tools-list-container');
      const refreshBtn = container.querySelector('#tools-refresh-btn');
      const modal = container.querySelector('#tool-test-modal');
      const modalName = container.querySelector('#modal-tool-name');
      const modalDesc = container.querySelector('#modal-tool-desc');
      const modalInput = container.querySelector('#modal-tool-input');
      const modalRun = container.querySelector('#modal-tool-run');
      const modalCancel = container.querySelector('#modal-tool-cancel');
      const modalResult = container.querySelector('#modal-tool-result');

      let currentTool = null;

      async function loadTools() {
        listContainer.innerHTML = '<div class="muted-loading">Loading tool schemas...</div>';
        try {
          const res = await sdk.api.listTools();
          const tools = res.tools || [];
          if (!tools.length) {
            listContainer.innerHTML = '<div class="empty-state">No tools available</div>';
            return;
          }

          listContainer.innerHTML = '';
          tools.forEach(tool => {
            const card = document.createElement('div');
            card.className = 'tool-inspect-card';
            
            const params = tool.input_schema?.properties ? Object.keys(tool.input_schema.properties) : [];
            const req = tool.input_schema?.required || [];

            card.innerHTML = \`
              <div class="tool-inspect-header">
                <div class="tool-inspect-title-wrap">
                  <span class="tool-badge-pill">\${escapeHtml(tool.name)}</span>
                  <span class="tool-desc-short">\${escapeHtml(tool.description || '')}</span>
                </div>
                <button class="btn btn-xs btn-outline test-btn">\${escapeHtml(sdk.i18n ? sdk.i18n.t('plugins.tools.test') : 'Test')}</button>
              </div>
              <div class="tool-params-wrap">
                \${params.map(p => {
                  const isReq = req.includes(p);
                  return '<span class="param-chip ' + (isReq ? 'param-req' : '') + '">' + escapeHtml(p) + (isReq ? '*' : '') + '</span>';
                }).join('')}
              </div>
            \`;

            card.querySelector('.test-btn').addEventListener('click', () => {
              currentTool = tool;
              modalName.textContent = (sdk.i18n ? sdk.i18n.t('plugins.tools.testTitle') : 'Test Tool: ') + tool.name;
              modalDesc.textContent = tool.description || '';
              
              const sample = {};
              if (tool.input_schema?.properties) {
                for (const [k, v] of Object.entries(tool.input_schema.properties)) {
                  sample[k] = v.type === 'string' ? '' : v.type === 'number' ? 0 : v.type === 'boolean' ? true : null;
                }
              }
              modalInput.value = JSON.stringify(sample, null, 2);
              modalResult.style.display = 'none';
              modal.style.display = 'flex';
            });

            listContainer.appendChild(card);
          });
        } catch (e) {
          listContainer.innerHTML = '<div class="text-error">' + escapeHtml('Error: ' + e.message) + '</div>';
        }
      }

      modalCancel.addEventListener('click', () => {
        modal.style.display = 'none';
      });

      modalRun.addEventListener('click', async () => {
        if (!currentTool) return;
        let parsed = {};
        try {
          parsed = JSON.parse(modalInput.value || '{}');
        } catch (err) {
          sdk.ui.showToast({ message: 'Invalid JSON input', type: 'error' });
          return;
        }

        modalRun.disabled = true;
        modalRun.textContent = 'Running...';
        modalResult.style.display = 'block';
        modalResult.textContent = 'Executing tool...';

        try {
          const res = await sdk.api.callTool(currentTool.name, parsed);
          modalResult.textContent = JSON.stringify(res, null, 2);
        } catch (err) {
          modalResult.textContent = 'Error: ' + (err.message || String(err));
        } finally {
          modalRun.disabled = false;
          modalRun.textContent = 'Run Tool';
        }
      });

      refreshBtn.addEventListener('click', () => loadTools());
      loadTools();
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
`

export const toolsInspectorPlugin: WebUIPlugin = {
  id: 'tools-inspector',
  name: 'Tools Inspector & Visualizer',
  version: '1.0.0',
  description: 'Inspect tool schemas, execute tool diagnostics, and customize rendering for bash & diffs',
  frontendScript: frontendCode,
}
