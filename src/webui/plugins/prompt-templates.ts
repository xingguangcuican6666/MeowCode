import type { WebUIPlugin } from '../types'

const frontendCode = `
(function() {
  const sdk = window.MeowSDK;
  if (!sdk) return;

  function getTemplates() {
    const t = sdk.i18n ? sdk.i18n.t : (k) => k;
    return [
      { icon: 'fact_check', label: t('template.runTests'), prompt: t('template.runTests.prompt') },
      { icon: 'psychology', label: t('template.explainCode'), prompt: t('template.explainCode.prompt') },
      { icon: 'auto_awesome', label: t('template.refactor'), prompt: t('template.refactor.prompt') },
      { icon: 'bug_report', label: t('template.fixBug'), prompt: t('template.fixBug.prompt') },
      { icon: 'description', label: t('template.document'), prompt: t('template.document.prompt') },
      { icon: 'speed', label: t('template.optimize'), prompt: t('template.optimize.prompt') },
    ];
  }

  // Slot: Quick Prompt Pills in chat:toolbar
  // Shown only on fresh/empty sessions, hidden as soon as dialogue starts
  sdk.slots.register('chat:toolbar', {
    id: 'prompt-quick-pills',
    priority: 100,
    render(container, context) {
      let isVisible = true;

      function checkHasMessages() {
        if (context && context.session && Array.isArray(context.session.messages)) {
          return context.session.messages.filter(m => m.content !== '__banner__').length > 0;
        }
        if (sdk.session && typeof sdk.session.getMessages === 'function') {
          const msgs = sdk.session.getMessages() || [];
          return msgs.filter(m => m.content !== '__banner__').length > 0;
        }
        const msgEls = document.querySelectorAll('#chat-transcript .chat-message');
        return msgEls.length > 0;
      }

      function updateVisibility() {
        const wrap = container.querySelector('.quick-pills-bar');
        if (wrap) {
          wrap.style.display = isVisible ? 'flex' : 'none';
        }
        container.style.display = isVisible ? '' : 'none';
        const parent = container.parentElement;
        if (parent && parent.classList.contains('chat-toolbar-slot')) {
          const hasOtherVisible = Array.from(parent.children).some(child => child !== container && child.style.display !== 'none');
          parent.style.display = (isVisible || hasOtherVisible) ? '' : 'none';
        }
      }

      function draw() {
        container.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'quick-pills-bar';

        getTemplates().forEach(tmpl => {
          const pill = document.createElement('button');
          pill.className = 'quick-pill-btn';
          pill.setAttribute('aria-label', tmpl.label);
          pill.title = tmpl.label + ' — ' + tmpl.prompt;
          pill.innerHTML = '<span class="material-symbols-outlined pill-icon">' + tmpl.icon + '</span><span class="pill-label">' + tmpl.label + '</span>';
          pill.onclick = (e) => {
            e.preventDefault();
            isVisible = false;
            updateVisibility();
            const input = document.querySelector('#prompt-input');
            const sendBtn = document.querySelector('#send-btn');
            if (input) {
              input.value = tmpl.prompt;
              input.focus();
              input.dispatchEvent(new Event('input'));
              if (sendBtn && sendBtn.style.display !== 'none') {
                sendBtn.click();
              }
            }
          };
          wrap.appendChild(pill);
        });

        container.appendChild(wrap);
        updateVisibility();
      }

      isVisible = !checkHasMessages();
      draw();

      const unsubs = [
        sdk.on('i18n:change', draw),
        sdk.on('chat:messages', (data) => {
          const count = (data && typeof data.count === 'number') ? data.count : (checkHasMessages() ? 1 : 0);
          isVisible = (count === 0);
          updateVisibility();
        }),
        sdk.on('turn:start', () => {
          isVisible = false;
          updateVisibility();
        }),
        sdk.on('session:reset', () => {
          isVisible = true;
          updateVisibility();
        }),
      ];

      return () => {
        unsubs.forEach(fn => { try { fn(); } catch(e){} });
      };
    }
  });

  // Register commands
  getTemplates().forEach(t => {
    sdk.commands.register({
      id: 'template:' + t.label.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      title: t.label + ' — ' + t.prompt,
      category: 'Templates',
      execute() {
        const input = document.querySelector('#prompt-input');
        if (input) {
          input.value = t.prompt;
          input.focus();
        }
      }
    });
  });
})();
`

export const promptTemplatesPlugin: WebUIPlugin = {
  id: 'prompt-templates',
  name: 'Prompt Templates & Quick Actions',
  version: '1.0.0',
  description: 'Mounts quick prompt action pills in chat:toolbar and registers template commands',
  frontendScript: frontendCode,
}
