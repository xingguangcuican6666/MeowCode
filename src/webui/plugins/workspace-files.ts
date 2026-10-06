import fs from 'node:fs'
import path from 'node:path'
import type { WebUIPlugin } from '../types'

export interface FileItem {
  name: string
  path: string
  isDirectory: boolean
  size?: number
}

function scanDir(dir: string, baseDir: string, depth = 0, maxDepth = 3): FileItem[] {
  if (depth > maxDepth) return []
  const items: FileItem[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const ent of entries) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'dist') {
        continue
      }
      const fullPath = path.join(dir, ent.name)
      const relPath = path.relative(baseDir, fullPath)
      const isDir = ent.isDirectory()
      let size: number | undefined
      if (!isDir) {
        try {
          size = fs.statSync(fullPath).size
        } catch {
          // ignore stat errors
        }
      }
      items.push({
        name: ent.name,
        path: relPath,
        isDirectory: isDir,
        size,
      })
      if (isDir && depth < maxDepth) {
        items.push(...scanDir(fullPath, baseDir, depth + 1, maxDepth))
      }
    }
  } catch {
    // ignore read errors
  }
  return items
}

const frontendCode = `
(function() {
  const sdk = window.MeowSDK;
  if (!sdk) return;

  sdk.panels.register({
    id: 'files',
    title: 'Files',
    icon: 'folder',
    priority: 90,
    render(container, ctx) {
      const t = (k, def) => (sdk.i18n ? sdk.i18n.t(k) : def);
      container.innerHTML = \`
        <div class="panel-files-view">
          <div class="panel-toolbar">
            <input type="text" id="file-search" placeholder="\${t('plugins.files.filterPlaceholder', 'Filter files...')}" class="panel-input" />
            <button id="file-refresh-btn" class="btn btn-sm btn-ghost" title="\${t('plugins.files.refresh', 'Refresh files')}">
              <span class="material-symbols-outlined icon-sm">refresh</span>
            </button>
          </div>
          <div id="file-tree" class="file-tree-container">\${t('plugins.files.loading', 'Loading files...')}</div>
          <div id="file-preview-area" class="file-preview-card" style="display:none;">
            <div class="file-preview-header">
              <span id="file-preview-title" class="file-preview-name"></span>
              <div class="file-preview-actions">
                <button id="file-insert-btn" class="btn btn-xs btn-primary">\${t('plugins.files.insert', 'Insert @path')}</button>
                <button id="file-close-btn" class="btn btn-xs btn-ghost">
                  <span class="material-symbols-outlined icon-xs">close</span>
                </button>
              </div>
            </div>
            <pre id="file-preview-body" class="file-preview-content"></pre>
          </div>
        </div>
      \`;

      const searchInput = container.querySelector('#file-search');
      const refreshBtn = container.querySelector('#file-refresh-btn');
      const treeContainer = container.querySelector('#file-tree');
      const previewArea = container.querySelector('#file-preview-area');
      const previewTitle = container.querySelector('#file-preview-title');
      const previewBody = container.querySelector('#file-preview-body');
      const insertBtn = container.querySelector('#file-insert-btn');
      const closeBtn = container.querySelector('#file-close-btn');

      let currentFile = null;
      let cachedFiles = [];

      async function loadFiles() {
        treeContainer.innerHTML = '<div class="muted-loading">' + t('plugins.files.loading', 'Loading workspace files...') + '</div>';
        try {
          const res = await sdk.api.callBackendPlugin('workspace-files', 'tree');
          cachedFiles = res.items || [];
          renderTree(cachedFiles);
        } catch (e) {
          treeContainer.innerHTML = '<div class="text-error">Failed to load files: ' + e.message + '</div>';
        }
      }

      function renderTree(files) {
        const query = (searchInput.value || '').trim().toLowerCase();
        const filtered = files.filter(f => !query || f.path.toLowerCase().includes(query));

        if (filtered.length === 0) {
          treeContainer.innerHTML = '<div class="empty-state">No matching files</div>';
          return;
        }

        treeContainer.innerHTML = '';
        const list = document.createElement('div');
        list.className = 'file-list';

        filtered.forEach(file => {
          const row = document.createElement('div');
          row.className = 'file-row ' + (file.isDirectory ? 'is-dir' : 'is-file');
          
          const iconName = file.isDirectory ? 'folder' : (file.path.endsWith('.ts') || file.path.endsWith('.tsx') ? 'code' : file.path.endsWith('.json') ? 'data_object' : file.path.endsWith('.md') ? 'article' : 'description');
          const sizeStr = file.size !== undefined ? formatBytes(file.size) : '';
          
          row.innerHTML = \`
            <span class="material-symbols-outlined file-icon icon-sm" style="color:var(--md-sys-color-primary);">\${iconName}</span>
            <span class="file-path">\${file.path}</span>
            \${sizeStr ? '<span class="file-size">' + sizeStr + '</span>' : ''}
          \`;

          if (!file.isDirectory) {
            row.addEventListener('click', () => previewFile(file.path));
          }
          list.appendChild(row);
        });

        treeContainer.appendChild(list);
      }

      async function previewFile(filePath) {
        currentFile = filePath;
        previewTitle.textContent = filePath;
        previewBody.textContent = 'Loading...';
        previewArea.style.display = 'block';

        try {
          const res = await sdk.api.callBackendPlugin('workspace-files', 'read', { path: filePath });
          previewBody.textContent = res.content || '(empty file)';
        } catch (err) {
          previewBody.textContent = 'Error reading file: ' + err.message;
        }
      }

      function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      }

      searchInput.addEventListener('input', () => renderTree(cachedFiles));
      refreshBtn.addEventListener('click', () => loadFiles());
      closeBtn.addEventListener('click', () => {
        previewArea.style.display = 'none';
        currentFile = null;
      });
      insertBtn.addEventListener('click', () => {
        if (!currentFile) return;
        const promptInput = document.querySelector('#prompt-input');
        if (promptInput) {
          const space = promptInput.value.length && !promptInput.value.endsWith(' ') ? ' ' : '';
          promptInput.value = promptInput.value + space + '@' + currentFile + ' ';
          promptInput.focus();
          sdk.ui.showToast({ message: 'Added @' + currentFile + ' to prompt', type: 'info' });
        }
      });

      loadFiles();
    }
  });
})();
`

export const workspaceFilesPlugin: WebUIPlugin = {
  id: 'workspace-files',
  name: 'Workspace Files Explorer',
  version: '1.0.0',
  description: 'Explore workspace files, inspect file contents, and insert @paths into chat prompt',
  frontendScript: frontendCode,
  routes: {
    tree: (_req, _res, _body, ctx) => {
      const items = scanDir(ctx.cwd, ctx.cwd, 0, 3)
      return { cwd: ctx.cwd, items }
    },
    read: (_req, _res, body, ctx) => {
      const relPath = String(body?.path || '')
      if (!relPath) throw new Error('Path required')
      const target = path.resolve(ctx.cwd, relPath)
      if (!target.startsWith(path.resolve(ctx.cwd))) {
        throw new Error('Access denied: path escapes workspace')
      }
      const stat = fs.statSync(target)
      if (stat.isDirectory()) throw new Error('Target is a directory')
      if (stat.size > 2 * 1024 * 1024) throw new Error('File exceeds preview size limit (2MB)')
      const content = fs.readFileSync(target, 'utf8')
      return { path: relPath, size: stat.size, content }
    },
  },
}
