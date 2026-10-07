import type { WebUIPlugin } from '../types'

const frontendCode = `
(function() {
  const sdk = window.MeowSDK;
  if (!sdk) return;

  // The model and provider names render through innerHTML and come from config,
  // which /api/config lets a browser write — so treat them as untrusted and
  // escape at the sink rather than trusting the current call sites.
  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // 1. Slot: Header Center - Model chip & reasoning indicator
  sdk.slots.register('header:center', {
    id: 'metrics-model-chip',
    priority: 100,
    render(container, ctx) {
      const chip = document.createElement('div');
      chip.className = 'header-model-chip';

      const model = ctx.config?.model || 'claude-opus-4-8';
      const provider = ctx.config?.provider || 'default';

      chip.innerHTML = \`
        <span class="model-name">\${escapeHtml(model)}</span>
        <span class="provider-badge">\${escapeHtml(provider)}</span>
        <span id="agent-pulse" class="agent-pulse-dot" style="display:none;" title="Generating..."></span>
      \`;
      container.appendChild(chip);

      // Returned so renderSlot can call it on re-render: without it every
      // re-render added one more listener on a chip that no longer exists.
      return sdk.on('status:change', (st) => {
        const dot = chip.querySelector('#agent-pulse');
        if (dot) {
          dot.style.display = st.isRunning ? 'inline-block' : 'none';
        }
      });
    }
  });

  // 2. Slot: Statusbar Right - Real-time tokens and usage
  sdk.slots.register('statusbar:right', {
    id: 'metrics-token-counter',
    priority: 100,
    render(container, ctx) {
      const wrap = document.createElement('div');
      wrap.className = 'statusbar-metrics-wrap';

      function update(usage) {
        const u = usage || { inputTokens: 0, outputTokens: 0, toolCalls: 0, turns: 0 };
        const total = (u.inputTokens || 0) + (u.outputTokens || 0);
        wrap.innerHTML = \`
          <span class="metric-item" title="Input Tokens"><span class="material-symbols-outlined icon-xs" style="vertical-align:middle;margin-right:2px;">call_received</span>\${(u.inputTokens || 0).toLocaleString()}</span>
          <span class="metric-item" title="Output Tokens"><span class="material-symbols-outlined icon-xs" style="vertical-align:middle;margin-right:2px;">call_made</span>\${(u.outputTokens || 0).toLocaleString()}</span>
          <span class="metric-item metric-highlight" title="Total Tokens"><span class="material-symbols-outlined icon-xs" style="vertical-align:middle;margin-right:2px;">data_usage</span>\${total.toLocaleString()}</span>
          <span class="metric-item" title="Tool Invocations"><span class="material-symbols-outlined icon-xs" style="vertical-align:middle;margin-right:2px;">construction</span>\${u.toolCalls || 0}</span>
        \`;
      }

      update(ctx.session?.usage);
      container.appendChild(wrap);

      return sdk.on('usage:update', (u) => update(u));
    }
  });
})();
`

export const metricsMonitorPlugin: WebUIPlugin = {
  id: 'metrics-monitor',
  name: 'Metrics & Usage Monitor',
  version: '1.0.0',
  description: 'Displays live token metrics in the statusbar and model info in the header',
  frontendScript: frontendCode,
}
