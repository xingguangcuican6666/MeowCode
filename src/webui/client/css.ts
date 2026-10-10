/* ============================================================================
   MeowCode WebUI — Material 3 Expressive (M3E) Design System
   Google Material 3 Expressive Design Specification
   Features:
     - Full Light / Dark Dynamic Tonal Palette with Surface Containers (0-5)
     - Expressive Shapes, Curvatures & Asymmetrical Chat Bubbles
     - Spring Motion & State Layers (Hover, Focus, Pressed)
     - M3 Navigation Rail, Sliding Theme Switch, Action Cards, Floating Dock, FAB
   ============================================================================ */

export const CLIENT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');

/* --- Root M3 Tokens: Dark Mode (Default) --- */
:root, [data-theme="dark"] {
  --md-sys-color-primary: #8AB4F8;
  --md-sys-color-on-primary: #041E49;
  --md-sys-color-primary-container: #1C3E75;
  --md-sys-color-on-primary-container: #D3E3FD;

  --md-sys-color-secondary: #C2C7CF;
  --md-sys-color-on-secondary: #2C3137;
  --md-sys-color-secondary-container: #333842;
  --md-sys-color-on-secondary-container: #DEE3EB;

  --md-sys-color-tertiary: #D4BBFF;
  --md-sys-color-on-tertiary: #381E72;
  --md-sys-color-tertiary-container: #4F378B;
  --md-sys-color-on-tertiary-container: #EADDFF;

  --md-sys-color-error: #F2B8B5;
  --md-sys-color-on-error: #601410;
  --md-sys-color-error-container: #8C1D18;
  --md-sys-color-on-error-container: #F9DEDC;

  --md-sys-color-surface: #0E1015;
  --md-sys-color-on-surface: #F0F3F9;
  --md-sys-color-surface-variant: #44474E;
  --md-sys-color-on-surface-variant: #9EABC0;

  --md-sys-color-surface-container-lowest: #080A0D;
  --md-sys-color-surface-container-low: #13161C;
  --md-sys-color-surface-container: #181C23;
  --md-sys-color-surface-container-high: #20252F;
  --md-sys-color-surface-container-highest: #282E3B;

  --md-sys-color-outline: rgba(255, 255, 255, 0.14);
  --md-sys-color-outline-variant: rgba(255, 255, 255, 0.08);

  --md-sys-color-inverse-surface: #E2E2E9;
  --md-sys-color-inverse-on-surface: #1B1B1F;
  --md-sys-color-inverse-primary: #1A73E8;

  --md-sys-color-code-bg: #0A0C10;
  --md-sys-color-diff-add-bg: rgba(74, 222, 128, 0.14);
  --md-sys-color-diff-add-text: #4ADE80;
  --md-sys-color-diff-del-bg: rgba(248, 113, 113, 0.14);
  --md-sys-color-diff-del-text: #F87171;

  --md-sys-elevation-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  --md-sys-glow-primary: 0 0 20px rgba(138, 180, 248, 0.25);
}

/* --- M3 Tokens: Light Mode --- */
[data-theme="light"] {
  --md-sys-color-primary: #1A73E8;
  --md-sys-color-on-primary: #FFFFFF;
  --md-sys-color-primary-container: #D3E3FD;
  --md-sys-color-on-primary-container: #041E49;

  --md-sys-color-secondary: #575E66;
  --md-sys-color-on-secondary: #FFFFFF;
  --md-sys-color-secondary-container: #DEE3EB;
  --md-sys-color-on-secondary-container: #141C23;

  --md-sys-color-tertiary: #6750A4;
  --md-sys-color-on-tertiary: #FFFFFF;
  --md-sys-color-tertiary-container: #EADDFF;
  --md-sys-color-on-tertiary-container: #21005D;

  --md-sys-color-error: #BA1A1A;
  --md-sys-color-on-error: #FFFFFF;
  --md-sys-color-error-container: #FFDAD6;
  --md-sys-color-on-error-container: #410002;

  --md-sys-color-surface: #F7F9FC;
  --md-sys-color-on-surface: #14181F;
  --md-sys-color-surface-variant: #E0E2EC;
  --md-sys-color-on-surface-variant: #4A5568;

  --md-sys-color-surface-container-lowest: #FFFFFF;
  --md-sys-color-surface-container-low: #F0F3F8;
  --md-sys-color-surface-container: #E7EDF5;
  --md-sys-color-surface-container-high: #DFE5EF;
  --md-sys-color-surface-container-highest: #D6DEEA;

  --md-sys-color-outline: rgba(0, 0, 0, 0.12);
  --md-sys-color-outline-variant: rgba(0, 0, 0, 0.06);

  --md-sys-color-inverse-surface: #2E3135;
  --md-sys-color-inverse-on-surface: #F0F1F5;
  --md-sys-color-inverse-primary: #8AB4F8;

  --md-sys-color-code-bg: #EDF2F7;
  --md-sys-color-diff-add-bg: rgba(22, 163, 74, 0.12);
  --md-sys-color-diff-add-text: #15803D;
  --md-sys-color-diff-del-bg: rgba(220, 38, 38, 0.12);
  --md-sys-color-diff-del-text: #B91C1C;

  --md-sys-elevation-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
  --md-sys-glow-primary: 0 0 18px rgba(26, 115, 232, 0.18);
}

/* --- Common Design System Variables --- */
:root {
  --font-family-display: "Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-family-code: "JetBrains Mono", ui-monospace, Monaco, "Cascadia Code", Consolas, monospace;

  /* M3 Shapes */
  --md-shape-xs: 4px;
  --md-shape-sm: 8px;
  --md-shape-md: 12px;
  --md-shape-lg: 16px;
  --md-shape-xl: 20px;
  --md-shape-xxl: 28px;
  --md-shape-full: 9999px;

  /* Official @material/web shape & typography mapping */
  --md-sys-shape-corner-none: 0;
  --md-sys-shape-corner-extra-small: 4px;
  --md-sys-shape-corner-small: 8px;
  --md-sys-shape-corner-medium: 12px;
  --md-sys-shape-corner-large: 16px;
  --md-sys-shape-corner-extra-large: 28px;
  --md-sys-shape-corner-full: 9999px;
  --md-ref-typeface-brand: 'Outfit', sans-serif;
  --md-ref-typeface-plain: 'Outfit', sans-serif;

  /* M3 Expressive Motion */
  --md-motion-easing-emphasized: cubic-bezier(0.2, 0.0, 0.0, 1.0);
  --md-motion-easing-decelerate: cubic-bezier(0.05, 0.7, 0.1, 1.0);
  --md-motion-easing-accelerate: cubic-bezier(0.3, 0.0, 0.8, 0.15);
  --md-motion-duration-short: 180ms;
  --md-motion-duration-medium: 300ms;
  --md-motion-duration-long: 500ms;

  --header-height: 60px;
  --statusbar-height: 32px;
  --sidebar-width: 260px;

  /* Settings pane geometry (schema-driven rows, see client/app.ts). */
  --settings-sidebar-width: 220px;
  --settings-row-min-height: 52px;
  --settings-row-padding-y: 10px;
  --settings-row-padding-x: 16px;
  --settings-ctrl-max-width: 250px;

  /* Command palette: a two-pane master-detail, list left / preview right. */
  --cmd-palette-width: 820px;
  --cmd-palette-list-width: 480px;
  --cmd-palette-preview-width: 340px;
  --cmd-palette-row-height: 48px;
}

/* Reset */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: var(--md-sys-color-surface);
  color: var(--md-sys-color-on-surface);
  font-family: var(--font-family-display);
  font-size: 14px;
  line-height: 1.5;
  letter-spacing: 0.01em;
  -webkit-font-smoothing: antialiased;
  transition: background-color var(--md-motion-duration-medium) var(--md-motion-easing-emphasized),
              color var(--md-motion-duration-medium) var(--md-motion-easing-emphasized);
}

/* Google Material Symbols Specification */
.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 20px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  vertical-align: middle;
  flex-shrink: 0;
  user-select: none;
}

.material-symbols-outlined.icon-filled,
.active .material-symbols-outlined,
[aria-selected="true"] .material-symbols-outlined {
  font-variation-settings: 'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24;
}

.icon-xs { font-size: 14px !important; }
.icon-sm { font-size: 18px !important; }
.icon-md { font-size: 20px !important; }
.icon-lg { font-size: 24px !important; }
.icon-xl { font-size: 28px !important; }

#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background-color: var(--md-sys-color-surface);
  position: relative;
}

/* ============================================================================
   M3 Expressive Top App Bar
   ============================================================================ */
.app-header {
  height: var(--header-height);
  background: var(--md-sys-color-surface-container);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  z-index: 50;
  user-select: none;
}

.header-left-cluster {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon-btn {
  background: transparent;
  border: none;
  color: var(--md-sys-color-on-surface-variant);
  width: 36px;
  height: 36px;
  border-radius: var(--md-shape-full);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--md-motion-duration-short) var(--md-motion-easing-emphasized);
}
.header-icon-btn:hover {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
}

.brand-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 4px 10px 4px 4px;
  border-radius: var(--md-shape-full);
  transition: background var(--md-motion-duration-short);
}
.brand-badge:hover {
  background: var(--md-sys-color-surface-container-high);
}
.brand-icon-mark {
  width: 30px;
  height: 30px;
  background: linear-gradient(135deg, var(--md-sys-color-primary) 0%, #A78BFA 100%);
  color: var(--md-sys-color-on-primary);
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(138, 180, 248, 0.3);
  transition: transform var(--md-motion-duration-short);
}
.brand-icon-mark .material-symbols-outlined {
  font-size: 18px;
  color: #FFFFFF;
}
.brand-badge:hover .brand-icon-mark {
  transform: scale(1.08) rotate(3deg);
}
.brand-title {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, var(--md-sys-color-primary) 0%, #A78BFA 60%, #F472B6 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.brand-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--md-shape-full);
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.header-center-cluster {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-right-cluster {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-actions-slot {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.header-actions-slot button,
.header-actions-slot .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border-radius: var(--md-shape-full);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  cursor: pointer;
  transition: all var(--md-motion-duration-short) var(--md-motion-easing-standard);
  box-shadow: none;
  outline: none;
}

.header-actions-slot button:hover,
.header-actions-slot .btn:hover {
  background: var(--md-sys-color-surface-container-highest);
  border-color: var(--md-sys-color-outline);
  color: var(--md-sys-color-primary);
  transform: translateY(-1px);
}

.header-actions-slot button:active,
.header-actions-slot .btn:active {
  transform: scale(0.97);
}

/* Modern M3 Sliding Theme Switch */
.m3-theme-toggle {
  position: relative;
  width: 62px;
  height: 32px;
  background: var(--md-sys-color-surface-container-highest);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-full);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px;
  cursor: pointer;
  user-select: none;
  transition: all var(--md-motion-duration-short) var(--md-motion-easing-emphasized);
}
.m3-theme-toggle:hover {
  border-color: var(--md-sys-color-primary);
}
.m3-theme-toggle .theme-icon {
  font-size: 16px;
  z-index: 2;
  color: var(--md-sys-color-on-surface-variant);
  transition: color 180ms ease, opacity 180ms ease;
}
.m3-theme-toggle .theme-switch-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 24px;
  height: 24px;
  background: var(--md-sys-color-primary);
  border-radius: 50%;
  transition: transform var(--md-motion-duration-medium) var(--md-motion-easing-emphasized);
  z-index: 1;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
[data-theme="light"] .m3-theme-toggle .theme-switch-thumb {
  transform: translateX(0);
}
:root .m3-theme-toggle .theme-switch-thumb,
[data-theme="dark"] .m3-theme-toggle .theme-switch-thumb {
  transform: translateX(30px);
}
[data-theme="light"] .m3-theme-toggle .light-icon {
  color: var(--md-sys-color-on-primary);
}
[data-theme="dark"] .m3-theme-toggle .dark-icon {
  color: var(--md-sys-color-on-primary);
}

/* Header Action Buttons */
.m3-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 36px;
  padding: 0 16px;
  border-radius: var(--md-shape-full);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  transition: all var(--md-motion-duration-short) var(--md-motion-easing-emphasized);
  border: 1px solid transparent;
}
.m3-action-btn .material-symbols-outlined {
  font-size: 18px;
}
.m3-action-btn:active {
  transform: scale(0.97);
}

.m3-btn-tonal {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  border-color: var(--md-sys-color-outline-variant);
}
.m3-btn-tonal:hover {
  background: var(--md-sys-color-surface-container-highest);
  border-color: var(--md-sys-color-primary);
  color: var(--md-sys-color-primary);
  transform: translateY(-1px);
}

.m3-btn-filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}
.m3-btn-filled:hover {
  filter: brightness(1.08);
  box-shadow: 0 4px 12px rgba(138, 180, 248, 0.35);
  transform: translateY(-1px);
}

/* Model Chip in header */
.header-model-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--md-sys-color-surface-container-high);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-full);
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
}
.header-model-chip .model-name {
  color: var(--md-sys-color-on-surface);
  font-weight: 600;
}
.header-model-chip .provider-badge {
  color: var(--md-sys-color-on-primary-container);
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.05em;
  background: var(--md-sys-color-primary-container);
  padding: 1px 6px;
  border-radius: var(--md-shape-sm);
}
.agent-pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10B981;
  animation: m3-pulse 1.4s infinite var(--md-motion-easing-emphasized);
}
@keyframes m3-pulse {
  0% { transform: scale(0.9); opacity: 0.5; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
  70% { transform: scale(1.2); opacity: 1; box-shadow: 0 0 0 5px rgba(16, 185, 129, 0); }
  100% { transform: scale(0.9); opacity: 0.5; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}

/* Progress bar */
.app-progress-bar {
  position: absolute;
  top: var(--header-height);
  left: 0;
  right: 0;
  z-index: 60;
  height: 3px;
  --md-linear-progress-track-shape: 0;
}
.app-progress-bar.hidden {
  display: none;
}

/* ============================================================================
   Main Layout & Sidebar (M3 Navigation Rail)
   ============================================================================ */
.main-workspace {
  display: flex;
  flex: 1;
  overflow: hidden;
  position: relative;
}

.sidebar {
  width: var(--sidebar-width);
  background: var(--md-sys-color-surface-container-low);
  border-right: 1px solid var(--md-sys-color-outline-variant);
  display: flex;
  flex-direction: column;
  transition: width var(--md-motion-duration-medium) var(--md-motion-easing-emphasized);
  z-index: 20;
}
.sidebar.collapsed {
  width: 0;
  overflow: hidden;
  border-right: none;
}
.sidebar-backdrop {
  display: none;
}

.sidebar-header {
  padding: 12px 14px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* M3 Navigation Rail Tabs */
.sidebar-nav-tabs {
  display: flex;
  gap: 4px;
  background: var(--md-sys-color-surface-container-high);
  padding: 4px;
  border-radius: var(--md-shape-full);
}
.sidebar-tab-btn {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  padding: 7px 10px;
  border-radius: var(--md-shape-full);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  position: relative;
  transition: all var(--md-motion-duration-short) var(--md-motion-easing-emphasized);
}
.sidebar-tab-btn .tab-icon {
  font-size: 17px;
  transition: transform var(--md-motion-duration-short);
}
.sidebar-tab-btn:hover {
  background: var(--md-sys-color-surface-container-highest);
  color: var(--md-sys-color-on-surface);
}
.sidebar-tab-btn:hover .tab-icon {
  transform: scale(1.1);
}
.sidebar-tab-btn.active {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
.sidebar-tab-btn.active .tab-icon {
  font-variation-settings: 'FILL' 1, 'wght' 600, 'GRAD' 0, 'opsz' 24;
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 14px 10px;
}

.sidebar-section-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--md-sys-color-on-surface-variant);
  margin-bottom: 10px;
  font-weight: 700;
  padding-left: 6px;
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* M3 Session Card item */
.session-item {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  border-radius: var(--md-shape-md);
  border: 1px solid transparent;
  cursor: pointer;
  background: var(--md-sys-color-surface-container);
  transition: all var(--md-motion-duration-short) var(--md-motion-easing-emphasized);
  position: relative;
}
.session-item:hover {
  background: var(--md-sys-color-surface-container-high);
  transform: translateY(-1px);
  border-color: var(--md-sys-color-outline-variant);
}
.session-item.active {
  background: var(--md-sys-color-secondary-container);
  border-color: var(--md-sys-color-primary);
}
.session-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-height: 24px;
}
.session-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.session-icon {
  color: var(--md-sys-color-primary);
  flex-shrink: 0;
}
.session-title {
  font-size: 12.5px;
  color: var(--md-sys-color-on-surface);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.session-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--md-motion-duration-short) ease;
  flex-shrink: 0;
}
.session-item:hover .session-actions,
.session-item:focus-within .session-actions,
.session-item.active .session-actions,
.session-item.editing .session-actions {
  opacity: 1;
  pointer-events: auto;
}
.session-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--md-shape-full);
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  padding: 0;
  transition: background var(--md-motion-duration-short), color var(--md-motion-duration-short);
}
.session-action-btn:hover {
  background: var(--md-sys-color-surface-variant);
  color: var(--md-sys-color-on-surface);
}
.session-action-btn.btn-delete:hover {
  background: rgba(239, 68, 68, 0.15);
  color: var(--md-sys-color-error);
}
.session-rename-input {
  width: 100%;
  font-size: 12px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
  background: var(--md-sys-color-surface);
  border: 1px solid var(--md-sys-color-primary);
  border-radius: var(--md-shape-xs);
  padding: 2px 6px;
  outline: none;
  font-family: inherit;
  box-shadow: 0 0 0 2px var(--md-sys-glow-primary);
}
.session-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
}

.sidebar-footer {
  padding: 10px 14px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.workspace-info-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--md-sys-color-on-surface-variant);
  font-family: var(--font-family-code);
}
.ws-dot {
  color: #10B981;
  font-size: 8px;
}
.ws-branch {
  color: var(--md-sys-color-primary);
  font-weight: 600;
}

/* ============================================================================
   Content Area & Chat
   ============================================================================ */
.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--md-sys-color-surface);
  position: relative;
  /* A flex item defaults to min-height:auto — "at least as tall as my content".
     Every box between #app's 100vh column and the transcript needs the explicit
     permission to give way; miss one link and the column refuses to shrink, so
     the composer is what gets pushed off the bottom while the sidebar (which
     does shrink) ends up visibly higher. See the chain in client-css.test.ts. */
  min-height: 0;
}

.chat-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  height: 100%;
  min-height: 0;
}

.chat-transcript {
  flex: 1;
  overflow-y: auto;
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  /* The box that absorbs the overflow BY SCROLLING rather than by growing. */
  min-height: 0;
}

/* ============================================================================
   M3 Expressive Welcome Studio Hub
   ============================================================================ */
.welcome-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin: auto;
  width: 100%;
  max-width: 820px;
  padding: 32px 16px;
  animation: m3-float-in 400ms var(--md-motion-easing-decelerate);
}
@keyframes m3-float-in {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

.welcome-header {
  text-align: center;
  margin-bottom: 32px;
}
.welcome-hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--md-sys-color-surface-container-high);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-full);
  padding: 6px 18px;
  margin-bottom: 16px;
}
.hero-badge-icon {
  font-size: 16px;
  color: var(--md-sys-color-primary);
}
.hero-badge-tag {
  font-size: 12px;
  font-weight: 600;
  color: var(--md-sys-color-primary);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.welcome-title {
  font-size: clamp(22px, 5vw, 34px);
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--md-sys-color-on-surface);
  margin-bottom: 12px;
  line-height: 1.25;
}
.welcome-subtitle {
  font-size: 15px;
  color: var(--md-sys-color-on-surface-variant);
  line-height: 1.6;
  max-width: 620px;
  margin: 0 auto;
}

/* M3 2x2 Action Cards Grid */
.welcome-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  width: 100%;
}
@media (max-width: 680px) {
  .welcome-grid {
    grid-template-columns: 1fr;
  }
}

.welcome-card {
  background: var(--md-sys-color-surface-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-xxl);
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  cursor: pointer;
  transition: all var(--md-motion-duration-short) var(--md-motion-easing-emphasized);
  position: relative;
  overflow: hidden;
}
.welcome-card:hover {
  transform: translateY(-3px);
  border-color: var(--md-sys-color-primary);
  box-shadow: var(--md-sys-elevation-shadow);
  background: var(--md-sys-color-surface-container-high);
}
.welcome-card:hover .card-arrow {
  transform: translateX(4px);
  color: var(--md-sys-color-primary);
}

.card-icon-wrap {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.card-icon-wrap .material-symbols-outlined {
  font-size: 24px;
}
.icon-primary {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}
.icon-tertiary {
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}
.icon-success {
  background: rgba(16, 185, 129, 0.16);
  color: #10B981;
}
.icon-secondary {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--md-sys-color-on-surface);
}
.card-arrow {
  font-size: 16px;
  color: var(--md-sys-color-on-surface-variant);
  transition: transform var(--md-motion-duration-short);
}
.card-desc {
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
  line-height: 1.5;
  margin-top: 2px;
}
.card-action-btn {
  align-self: flex-start;
  margin-top: 6px;
  background: transparent;
  border: none;
  color: var(--md-sys-color-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: opacity 150ms ease, transform 150ms ease;
}
.card-action-btn:hover {
  opacity: 0.8;
  transform: translateX(2px);
}

/* ============================================================================
   Message Rows & M3 Expressive Bubbles
   ============================================================================ */
.message-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  animation: m3-msg-pop 250ms var(--md-motion-easing-emphasized);
}
@keyframes m3-msg-pop {
  from { opacity: 0; transform: translateY(10px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.message-row.user {
  align-items: flex-end;
}
.message-row.assistant {
  align-items: flex-start;
}

/* User Bubble: M3 Expressive Asymmetrical Bubble */
.message-row.user .message-bubble {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  border-radius: 20px 20px 4px 20px;
  padding: 12px 18px;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.6;
  max-width: 82%;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

/* Assistant Bubble: M3 Expressive Elevated Card */
.message-row.assistant .message-bubble {
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 4px 20px 20px 20px;
  padding: 16px 22px;
  font-size: 14px;
  line-height: 1.6;
  width: 100%;
  box-shadow: var(--md-sys-elevation-shadow);
}

.message-header-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
  margin-bottom: 6px;
  user-select: none;
}
.author-pill {
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 6px;
  border-radius: var(--md-shape-xs);
}
.user .author-pill {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}
.assistant .author-pill {
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}

/* Markdown typography inside assistant bubble */
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 {
  color: var(--md-sys-color-on-surface);
  margin-top: 14px;
  margin-bottom: 8px;
  font-weight: 700;
}
.markdown-body h1 { font-size: 18px; }
.markdown-body h2 { font-size: 16px; }
.markdown-body h3 { font-size: 14.5px; }
.markdown-body p { margin-bottom: 10px; }
.markdown-body ul, .markdown-body ol { margin-left: 20px; margin-bottom: 10px; }
.markdown-body li { margin-bottom: 4px; }
.markdown-body pre {
  background: var(--md-sys-color-code-bg);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-lg);
  padding: 14px 16px;
  overflow-x: auto;
  margin: 12px 0;
  font-family: var(--font-family-code);
  font-size: 13px;
  line-height: 1.5;
}
.markdown-body code {
  font-family: var(--font-family-code);
  font-size: 12.5px;
  padding: 2px 6px;
  border-radius: var(--md-shape-xs);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-primary);
}
.markdown-body pre code {
  background: transparent;
  padding: 0;
  color: inherit;
}

/* Thinking Card in chat */
.thinking-card {
  background: var(--md-sys-color-surface-container-high);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-lg);
  padding: 12px 16px;
  margin-bottom: 12px;
}
.thinking-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  user-select: none;
}
.thinking-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--md-sys-color-primary);
  animation: m3-pulse 1.2s infinite;
}
.thinking-body {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
  font-size: 12.5px;
  color: var(--md-sys-color-on-surface-variant);
  line-height: 1.55;
  white-space: pre-wrap;
}

/* Tool execution card */
.tool-card {
  background: var(--md-sys-color-code-bg);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-lg);
  margin: 10px 0;
  overflow: hidden;
}
.tool-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--md-sys-color-surface-container-high);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  font-size: 12px;
}
.tool-name-badge {
  font-family: var(--font-family-code);
  font-weight: 700;
  color: var(--md-sys-color-primary);
}
.tool-card-content {
  padding: 12px 14px;
  font-family: var(--font-family-code);
  font-size: 12.5px;
  overflow-x: auto;
  white-space: pre;
}

/* Diff visualizer */
.diff-container {
  display: flex;
  flex-direction: column;
}
.diff-line {
  padding: 2px 10px;
  font-family: var(--font-family-code);
  font-size: 12.5px;
  line-height: 1.5;
}
.diff-line.diff-add {
  background: var(--md-sys-color-diff-add-bg);
  color: var(--md-sys-color-diff-add-text);
}
.diff-line.diff-del {
  background: var(--md-sys-color-diff-del-bg);
  color: var(--md-sys-color-diff-del-text);
}

/* ============================================================================
   M3 Floating Input Dock
   ============================================================================ */
.input-dock-container {
  padding: 0 20px 16px 20px;
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  position: relative;
  z-index: 30;
}

.input-dock-card {
  background: var(--md-sys-color-surface-container);
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-shape-xl);
  padding: 10px 16px 10px 16px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: all var(--md-motion-duration-short);
}
.input-dock-card:focus-within {
  border-color: var(--md-sys-color-primary);
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.4), var(--md-sys-glow-primary);
}

.chat-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: var(--md-sys-color-on-surface);
  font-family: var(--font-family-display);
  font-size: 14px;
  resize: none;
  min-height: 32px;
  max-height: 180px;
  line-height: 1.5;
  padding: 4px 0;
}
.chat-input::placeholder {
  color: var(--md-sys-color-on-surface-variant);
}

.input-bottom-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 4px;
}

.input-left-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}
.input-tool-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--md-sys-color-surface-container-high);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-full);
  padding: 4px 10px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  transition: all var(--md-motion-duration-short);
}
.input-tool-chip:hover {
  background: var(--md-sys-color-surface-container-highest);
  color: var(--md-sys-color-on-surface);
  border-color: var(--md-sys-color-primary);
}
.tool-chip-icon {
  color: var(--md-sys-color-primary);
  font-weight: 700;
}

.input-right-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.m3-send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 16px;
  border-radius: var(--md-shape-full);
  border: none;
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  transition: all var(--md-motion-duration-short) var(--md-motion-easing-emphasized);
}
.m3-send-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.08);
  box-shadow: 0 4px 14px rgba(138, 180, 248, 0.4);
}
.m3-send-btn:active {
  transform: scale(0.97);
}
.send-icon {
  font-size: 15px;
  font-weight: 700;
}

.m3-btn-danger {
  background: var(--md-sys-color-error);
  color: var(--md-sys-color-on-error);
}

/* Quick pills toolbar */
.quick-pills-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.quick-pill-btn {
  background: var(--md-sys-color-surface-container-high);
  border: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
  border-radius: var(--md-shape-full);
  padding: 4px 12px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--md-motion-duration-short);
}
.quick-pill-btn:hover {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  border-color: var(--md-sys-color-primary);
  transform: translateY(-1px);
}

/* Extension Slots Styling */
.meow-slot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.chat-toolbar-slot:empty {
  display: none !important;
}
.slot-item {
  display: inline-flex;
  align-items: center;
}

/* ============================================================================
   M3 Status Bar & Panels
   ============================================================================ */
.app-statusbar {
  height: var(--statusbar-height);
  background: var(--md-sys-color-surface-container-lowest);
  border-top: 1px solid var(--md-sys-color-outline-variant);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
  user-select: none;
  z-index: 40;
}
.statusbar-left, .statusbar-center, .statusbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.status-indicator {
  font-size: 11.5px;
  color: var(--md-sys-color-primary);
  font-weight: 600;
}

/* Custom Panels */
.custom-panel-view {
  flex: 1;
  padding: 24px 28px;
  overflow-y: auto;
  /* Same job as .chat-transcript (below): this is the box that absorbs the
     overflow by scrolling. Without it a long plugin panel pushes the statusbar
     off the bottom instead of scrolling inside the shell. */
  min-height: 0;
}
.panel-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.panel-input {
  flex: 1;
  background: var(--md-sys-color-surface-container-high);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-full);
  padding: 8px 16px;
  color: var(--md-sys-color-on-surface);
  font-size: 13px;
  outline: none;
}
.panel-input:focus {
  border-color: var(--md-sys-color-primary);
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: var(--md-shape-md);
  cursor: pointer;
  background: var(--md-sys-color-surface-container);
  transition: all var(--md-motion-duration-short);
}
.file-row:hover {
  background: var(--md-sys-color-surface-container-high);
  transform: translateX(2px);
}
.file-row.is-dir {
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
}
.file-size {
  margin-left: auto;
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
}

.file-preview-card {
  margin-top: 16px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-lg);
  background: var(--md-sys-color-code-bg);
  overflow: hidden;
}
.file-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--md-sys-color-surface-container-high);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}
.file-preview-content {
  padding: 14px 16px;
  font-family: var(--font-family-code);
  font-size: 13px;
  max-height: 400px;
  overflow-y: auto;
  white-space: pre;
}

/* Tool Inspector Cards */
.tools-list-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 14px;
}
.tool-inspect-card {
  background: var(--md-sys-color-surface-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-lg);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: all var(--md-motion-duration-short);
}
.tool-inspect-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--md-sys-elevation-shadow);
  border-color: var(--md-sys-color-primary);
}
.tool-badge-pill {
  font-family: var(--font-family-code);
  font-size: 13px;
  font-weight: 700;
  color: var(--md-sys-color-primary);
}
.tool-desc-short {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
}

/* M3 Modal Dialog */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: m3-fade-in 160ms var(--md-motion-easing-decelerate);
}
.modal-container {
  background: var(--md-sys-color-surface-container-high);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-xxl);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4);
  width: 90%;
  max-width: 520px;
  overflow: hidden;
  animation: m3-scale-in 200ms var(--md-motion-easing-emphasized);
}
@keyframes m3-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes m3-scale-in { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }

.modal-header {
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}
.modal-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--md-sys-color-on-surface);
}
.modal-close-btn {
  background: transparent;
  border: none;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 18px;
  cursor: pointer;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-close-btn:hover {
  background: rgba(128, 128, 128, 0.15);
}
.modal-body {
  padding: 20px;
  max-height: 70vh;
  overflow-y: auto;
}
.modal-footer {
  padding: 14px 20px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
/* The hint states the current keyboard contract and the count says how much of
   the registry survived the filter; both push left, away from the buttons. */
.modal-footer .modal-footer-hint {
  margin-right: auto;
}

/* A confirm dialog for a destructive action tints its affirmative button, so the
   two answers never look equally weighted. */
.modal-container.is-destructive .modal-btn-confirm {
  background: var(--md-sys-color-error);
  color: var(--md-sys-color-on-error);
  border-color: var(--md-sys-color-error);
}
.modal-container.is-destructive .modal-btn-confirm:hover {
  filter: brightness(1.08);
}

/* M3 Snackbars (Toasts) */
.toast-host {
  position: fixed;
  bottom: 44px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 2000;
  pointer-events: none;
}
.toast-item {
  background: var(--md-sys-color-inverse-surface);
  color: var(--md-sys-color-inverse-on-surface);
  border-radius: var(--md-shape-sm);
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  animation: m3-toast-in 220ms var(--md-motion-easing-decelerate);
}
@keyframes m3-toast-in {
  from { transform: translateY(16px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.toast-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.toast-info .toast-dot { background: var(--md-sys-color-primary); }
.toast-success .toast-dot { background: #10B981; }
.toast-warning .toast-dot { background: #F59E0B; }
.toast-error .toast-dot { background: #EF4444; }

/* --- M3 Modal & Component Enhancements --- */
.modal-header-title-cluster {
  display: flex;
  align-items: center;
  gap: 10px;
}
.modal-icon {
  font-size: 18px;
}
.modal-search-bar {
  padding: 10px 18px;
  background: var(--md-sys-color-surface-container);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  display: flex;
  align-items: center;
  gap: 10px;
}
.modal-search-bar .search-icon {
  color: var(--md-sys-color-primary);
  font-weight: 700;
  font-size: 16px;
}
.modal-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--md-sys-color-on-surface);
  font-family: var(--font-family-display);
  font-size: 14px;
}
.modal-footer-hint {
  margin-right: auto;
  align-self: center;
}

/* File Picker */
.file-picker-body {
  max-height: 380px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.file-picker-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: var(--md-shape-sm);
  cursor: pointer;
  transition: background-color var(--md-motion-duration-short);
}
.file-picker-row:hover {
  background: var(--md-sys-color-surface-container-highest);
}
.file-picker-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.file-picker-icon {
  font-size: 16px;
  flex-shrink: 0;
}
.file-picker-path {
  font-family: var(--font-family-code);
  font-size: 12.5px;
  color: var(--md-sys-color-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-picker-size {
  font-family: var(--font-family-code);
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
  flex-shrink: 0;
}

/* --- Command Palette (master-detail) -------------------------------------
   The list pane owns selection, the preview pane owns explanation. Only one of
   them carries the focus at a time: .is-in-preview on the container moves the
   focus ring from the list rows to the preview's action button. */
.cmd-palette-container {
  width: var(--cmd-palette-width);
  max-width: min(var(--cmd-palette-width), calc(100vw - 32px));
}
.cmd-palette-body {
  display: flex;
  align-items: stretch;
  min-height: 0;
  height: min(440px, calc(100vh - 220px));
  /* Full-bleed: the pane divider should reach the card's edges, so the two panes
     scroll against the frame rather than inside an inset. */
  margin: 0 -20px;
  overflow: hidden;
}
.cmd-palette-list-pane {
  flex: 0 0 var(--cmd-palette-list-width);
  min-width: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px 8px;
  border-right: 1px solid var(--md-sys-color-outline-variant);
}
.cmd-palette-preview-pane {
  flex: 0 0 var(--cmd-palette-preview-width);
  min-width: 0;
  overflow-y: auto;
  padding: 16px;
  background: var(--md-sys-color-surface-container-low);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
/* With the preview focused, the list's selection tint recedes — two panes both
   claiming the focus would make it ambiguous which one Enter acts on. */
.cmd-palette-container.is-in-preview .cmd-palette-row.is-focused {
  background: transparent;
  border-left-color: var(--md-sys-color-outline);
}
.cmd-palette-container.is-in-preview .cmd-palette-preview-pane {
  box-shadow: inset 2px 0 0 var(--md-sys-color-primary);
}
/* Below the two-column threshold the preview is worthless side-by-side, so it
   stacks under the list instead of squeezing both into unreadable slivers. */
@media (max-width: 720px) {
  .cmd-palette-body {
    flex-direction: column;
    height: min(520px, calc(100vh - 200px));
  }
  .cmd-palette-list-pane {
    flex: 1 1 auto;
    border-right: none;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
  }
  .cmd-palette-preview-pane {
    flex: 0 0 auto;
    max-height: 40%;
  }
}
.cmd-palette-group {
  padding: 12px 10px 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--md-sys-color-on-surface-variant);
}
.cmd-palette-group:first-child {
  padding-top: 4px;
}
/* Group headers stay put while the list scrolls: a 57-row palette is taller than
   the pane, and a bare header that scrolls away takes the only cue for which
   bucket the rows under it belong to. */
.cmd-palette-group {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--md-sys-color-surface-container);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}
.cmd-palette-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: var(--cmd-palette-row-height);
  padding: 8px 10px;
  border-radius: var(--md-shape-sm);
  cursor: pointer;
  border-left: 3px solid transparent;
  transition:
    background-color var(--md-motion-duration-short) var(--md-motion-easing-decelerate),
    border-color var(--md-motion-duration-short) var(--md-motion-easing-decelerate);
}
.cmd-palette-row:hover {
  background: var(--md-sys-color-surface-container-high);
}
.cmd-palette-row.is-focused {
  background: var(--md-sys-color-secondary-container);
  border-left-color: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-secondary-container);
}
.cmd-palette-row.is-focused .cmd-palette-title,
.cmd-palette-row.is-focused .cmd-palette-desc {
  color: var(--md-sys-color-on-secondary-container);
}
.cmd-palette-icon {
  font-size: 20px;
  flex-shrink: 0;
  color: var(--md-sys-color-primary);
}
.cmd-palette-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.cmd-palette-title {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--md-sys-color-on-surface);
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cmd-palette-desc {
  font-size: 11.5px;
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* "CLI" — the command works in the terminal only. It stays legible rather than
   being dimmed out of reach, because the palette still offers it: copy the line. */
.cmd-chip-terminal {
  font-family: var(--font-family-code);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 1px 6px;
  border-radius: var(--md-shape-xs);
  background: var(--badge-web-bg);
  color: var(--badge-web-text);
  flex-shrink: 0;
}
.cmd-preview-empty {
  margin: auto;
  text-align: center;
  line-height: 1.6;
}
.cmd-preview-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.cmd-preview-icon {
  font-size: 22px;
  color: var(--md-sys-color-primary);
  flex-shrink: 0;
}
.cmd-preview-title {
  font-family: var(--font-family-code);
  font-size: 13px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
  word-break: break-all;
}
.cmd-preview-desc {
  margin-top: 4px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--md-sys-color-on-surface-variant);
}
.cmd-preview-aliases {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}
.cmd-preview-aliases code {
  font-family: var(--font-family-code);
  font-size: 11px;
  color: var(--md-sys-color-on-surface);
  background: var(--md-sys-color-surface-container-highest);
  padding: 1px 5px;
  border-radius: var(--md-shape-xs);
}
.cmd-preview-label {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--md-sys-color-on-surface-variant);
}
.cmd-preview-status {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cmd-preview-pill {
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--md-shape-full);
}
.cmd-preview-pill.is-web {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}
.cmd-preview-pill.is-terminal {
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}
.cmd-preview-hint {
  line-height: 1.55;
}
.cmd-preview-run {
  margin-top: auto;
  width: 100%;
}

/* --- Generic dialog widgets ---------------------------------------------
   Four shapes, one set of tokens: an enum of radio cards, a searchable list, a
   confirmation, and free text. */
.dialog-enum {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 360px;
  overflow-y: auto;
}
.dialog-enum-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  border-radius: var(--md-shape-sm);
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--md-motion-duration-short) var(--md-motion-easing-decelerate);
}
.dialog-enum-row:hover {
  background: var(--md-sys-color-surface-container-high);
}
.dialog-enum-row.is-active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  border-color: var(--md-sys-color-primary);
}
/* The number that row responds to. Hidden once a row is the current value, so
   the hint and the digits do not compete for the same attention. */
.dialog-enum-key {
  flex: 0 0 18px;
  height: 18px;
  display: grid;
  place-items: center;
  font-family: var(--font-family-code);
  font-size: 10.5px;
  border-radius: var(--md-shape-xs);
  background: var(--md-sys-color-surface-container-highest);
  color: var(--md-sys-color-on-surface-variant);
}
.dialog-enum-row.is-active .dialog-enum-key {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}
.dialog-enum-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dialog-enum-label {
  font-size: 13px;
  font-weight: 600;
}
.dialog-enum-desc {
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
}
.dialog-enum-row.is-active .dialog-enum-desc {
  color: inherit;
  opacity: 0.82;
}
.dialog-choice {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dialog-choice-search {
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--md-shape-sm);
  border: 1px solid var(--md-sys-color-outline);
  background: var(--md-sys-color-surface-container-lowest);
  color: var(--md-sys-color-on-surface);
  font: inherit;
  font-size: 13px;
}
.dialog-choice-search:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 1px;
}
.dialog-choice-list {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dialog-choice-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--md-shape-sm);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  border: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dialog-choice-row:hover {
  background: var(--md-sys-color-surface-container-high);
}
.dialog-choice-desc {
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
}
.dialog-confirm {
  font-size: 13px;
  line-height: 1.6;
  color: var(--md-sys-color-on-surface-variant);
}
.dialog-text {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dialog-text-input {
  width: 100%;
  padding: 9px 12px;
  border-radius: var(--md-shape-sm);
  border: 1px solid var(--md-sys-color-outline);
  background: var(--md-sys-color-surface-container-lowest);
  color: var(--md-sys-color-on-surface);
  font: inherit;
  font-size: 13px;
  resize: vertical;
}
.dialog-text-input:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 1px;
}

/* Model Selector */
.model-selector-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.model-option-card {
  padding: 12px 16px;
  border-radius: var(--md-shape-lg);
  border: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface-container);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: all var(--md-motion-duration-short);
}
.model-option-card:hover {
  background: var(--md-sys-color-surface-container-highest);
  border-color: var(--md-sys-color-primary);
}
.model-option-card.active {
  background: var(--md-sys-color-primary-container);
  border-color: var(--md-sys-color-primary);
}
.model-card-title {
  font-weight: 700;
  font-size: 13.5px;
  color: var(--md-sys-color-on-surface);
  display: flex;
  align-items: center;
  gap: 8px;
}
.model-option-card.active .model-card-title {
  color: var(--md-sys-color-on-primary-container);
}
.model-card-desc {
  font-size: 11.5px;
  color: var(--md-sys-color-on-surface-variant);
  margin-top: 2px;
}
.model-option-card.active .model-card-desc {
  color: var(--md-sys-color-on-primary-container);
  opacity: 0.85;
}
.model-card-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 9999px;
  background: rgba(128, 128, 128, 0.15);
}

/* Workspace Info Dialog */
.workspace-info-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.workspace-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  font-size: 13px;
}
.ws-label {
  color: var(--md-sys-color-on-surface-variant);
  font-weight: 500;
}
.ws-val {
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
}
.badge-git {
  font-family: var(--font-family-code);
  font-size: 11.5px;
  background: rgba(16, 185, 129, 0.15);
  color: #10B981;
  padding: 2px 8px;
  border-radius: var(--md-shape-xs);
}

/* Message Hover Action Bar */
.message-bubble {
  position: relative;
}
.message-action-bar {
  position: absolute;
  top: -14px;
  right: 14px;
  display: none;
  background: var(--md-sys-color-surface-container-highest);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-full);
  padding: 2px 6px;
  gap: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  z-index: 10;
  animation: m3-fade-in 140ms;
}
.message-row:hover .message-action-bar {
  display: flex;
}
.msg-action-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 8px;
  border-radius: var(--md-shape-full);
  color: var(--md-sys-color-on-surface-variant);
  transition: all 120ms;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.msg-action-btn .material-symbols-outlined {
  font-size: 15px;
}
.msg-action-btn:hover {
  background: rgba(128, 128, 128, 0.15);
  color: var(--md-sys-color-primary);
}
.msg-action-btn.active {
  color: var(--md-sys-color-primary);
}
.msg-action-btn.active .material-symbols-outlined {
  font-variation-settings: 'FILL' 1, 'wght' 600, 'GRAD' 0, 'opsz' 24;
}

/* Sample Session Badge in Sidebar */
.sample-session-pill {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 9999px;
  background: rgba(138, 180, 248, 0.15);
  color: var(--md-sys-color-primary);
  font-weight: 600;
  margin-left: 6px;
}

/* Compatibility overrides for @material/web custom elements */
md-filled-button, md-outlined-button, md-tonal-button, md-elevated-button, md-text-button {
  font-family: var(--font-family-display);
  --md-filled-button-container-shape: var(--md-shape-full);
  --md-outlined-button-container-shape: var(--md-shape-full);
  --md-tonal-button-container-shape: var(--md-shape-full);
}
md-icon {
  font-family: 'Material Symbols Outlined';
  font-size: 18px;
}
md-assist-chip, md-filter-chip {
  font-family: var(--font-family-display);
  --md-assist-chip-container-shape: var(--md-shape-full);
}

/* ============================================================================
   Missing Component Styles — Message, Terminal, Diff, Code, Buttons, Metrics
   ============================================================================ */

/* Message Meta Row (user/assistant name + timestamp) */
.message-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
  user-select: none;
  padding: 0 4px;
}
.assistant-avatar-icon {
  font-size: 16px;
  color: var(--md-sys-color-tertiary);
  font-variation-settings: 'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24;
}

/* Assistant Live Text Streaming */
.assistant-live-text {
  line-height: 1.65;
  font-size: 14px;
}
.assistant-live-text h1,
.assistant-live-text h2,
.assistant-live-text h3,
.assistant-live-text h4 {
  color: var(--md-sys-color-on-surface);
  margin-top: 14px;
  margin-bottom: 8px;
  font-weight: 700;
}
.assistant-live-text h3 { font-size: 15px; }
.assistant-live-text strong { color: var(--md-sys-color-on-surface); }
.assistant-live-text ul { margin-left: 20px; margin-bottom: 10px; list-style: disc; }
.assistant-live-text li { margin-bottom: 4px; }

/* Markdown tables (GFM). formatMarkdown emits .md-table; without these it was a
   wall of raw " | a | b | " text the newline pass turned into loose <br/> rows. */
.md-table {
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 13px;
  width: auto;
  max-width: 100%;
  display: block;
  overflow-x: auto;
}
.md-table th,
.md-table td {
  border: 1px solid var(--md-sys-color-outline-variant);
  padding: 6px 12px;
  text-align: left;
  vertical-align: top;
}
.md-table th {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  font-weight: 600;
}
.md-table tr:nth-child(even) td {
  background: var(--md-sys-color-surface-container);
}
.md-table code {
  white-space: nowrap;
}

/* Thinking Card Toggle Icon */
.thinking-header {
  justify-content: space-between;
}
.thinking-toggle-icon {
  font-size: 18px;
  color: var(--md-sys-color-on-surface-variant);
  transition: transform var(--md-motion-duration-short);
}

/* ============================================================================
   Code Blocks — Rendered Markdown
   ============================================================================ */
.code-block-wrap {
  border-radius: var(--md-shape-lg);
  border: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-code-bg);
  overflow: hidden;
  margin: 12px 0;
}
.code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--md-sys-color-surface-container-high);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  font-size: 12px;
}
.code-lang {
  font-family: var(--font-family-code);
  font-weight: 700;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--md-sys-color-primary);
}
.copy-code-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-full);
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  transition: all var(--md-motion-duration-short);
}
.copy-code-btn:hover {
  background: var(--md-sys-color-surface-container-highest);
  color: var(--md-sys-color-primary);
  border-color: var(--md-sys-color-primary);
}
.code-body {
  padding: 14px 16px;
  font-family: var(--font-family-code);
  font-size: 13px;
  line-height: 1.55;
  overflow-x: auto;
  white-space: pre;
  margin: 0;
  background: transparent;
  border: none;
}
.code-body code {
  font-family: inherit;
  background: transparent;
  padding: 0;
  color: inherit;
}
.inline-code {
  font-family: var(--font-family-code);
  font-size: 12.5px;
  padding: 2px 7px;
  border-radius: var(--md-shape-xs);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-primary);
}

/* ============================================================================
   Terminal / Tool Execution Cards
   ============================================================================ */
.terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--md-sys-color-surface-container-high);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  font-size: 13px;
  font-weight: 600;
}
.terminal-dots {
  display: flex;
  align-items: center;
  gap: 5px;
}
.terminal-dots .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.terminal-dots .dot.red { background: #EF4444; }
.terminal-dots .dot.yellow { background: #F59E0B; }
.terminal-dots .dot.green { background: #10B981; }

.terminal-title {
  font-family: var(--font-family-code);
  font-size: 12px;
  font-weight: 700;
  color: var(--md-sys-color-on-surface);
}
.terminal-badge {
  font-family: var(--font-family-code);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: var(--md-shape-full);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.terminal-badge.badge-success {
  background: rgba(16, 185, 129, 0.18);
  color: #10B981;
}
.terminal-badge.badge-error {
  background: rgba(239, 68, 68, 0.18);
  color: #EF4444;
}
.terminal-command {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  font-family: var(--font-family-code);
  font-size: 13px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}
.terminal-prompt {
  color: #10B981;
  font-weight: 700;
}
.terminal-output {
  padding: 12px 14px;
  font-family: var(--font-family-code);
  font-size: 12.5px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--md-sys-color-on-surface);
  margin: 0;
  background: transparent;
  border: none;
}
.terminal-output.output-error {
  color: var(--md-sys-color-error);
}

/* Tool Tags (Running / Success / Error) */
.tool-tag {
  font-family: var(--font-family-code);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: var(--md-shape-full);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.tag-running {
  background: rgba(138, 180, 248, 0.18);
  color: var(--md-sys-color-primary);
  animation: m3-pulse 1.4s infinite;
}
.tag-success {
  background: rgba(16, 185, 129, 0.18);
  color: #10B981;
}
.tag-error {
  background: rgba(239, 68, 68, 0.18);
  color: #EF4444;
}

.tool-result-output {
  border-top: 1px solid var(--md-sys-color-outline-variant);
}

/* Tool Card Terminal */
.tool-card-terminal {
  background: var(--md-sys-color-code-bg);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-lg);
  margin: 10px 0;
  overflow: hidden;
}

/* ============================================================================
   Diff Viewer
   ============================================================================ */
.tool-card-diff {
  background: var(--md-sys-color-code-bg);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-lg);
  margin: 10px 0;
  overflow: hidden;
}
.diff-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--md-sys-color-surface-container-high);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  font-size: 13px;
}
.diff-filename {
  font-family: var(--font-family-code);
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
}
.diff-viewer {
  display: flex;
  flex-direction: column;
  font-family: var(--font-family-code);
  font-size: 12.5px;
  line-height: 1.5;
}
.diff-line {
  display: flex;
  padding: 1px 12px;
}
.diff-line-add {
  background: var(--md-sys-color-diff-add-bg);
  color: var(--md-sys-color-diff-add-text);
}
.diff-line-del {
  background: var(--md-sys-color-diff-del-bg);
  color: var(--md-sys-color-diff-del-text);
}
.diff-line-ctx {
  color: var(--md-sys-color-on-surface-variant);
}
.diff-sign {
  width: 16px;
  font-weight: 700;
  flex-shrink: 0;
  user-select: none;
}
.diff-text {
  white-space: pre;
}
.tool-plain-content {
  padding: 12px 14px;
  font-family: var(--font-family-code);
  font-size: 12.5px;
  white-space: pre-wrap;
  margin: 0;
  background: transparent;
  border: none;
}

/* ============================================================================
   M3 Expressive Specialized Tool Cards (Todo, Read, Search, Ask)
   ============================================================================ */

/* ============================================================================
   M3 Collapsible Session Tasks Dock (Above Dialogue / Input Box)
   ============================================================================ */
.todo-floating-dock {
  margin-bottom: 8px;
  background: var(--md-sys-color-surface-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-lg);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.22);
  overflow: hidden;
  transition: all var(--md-motion-duration-short) cubic-bezier(0.2, 0, 0, 1);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.todo-floating-dock:hover {
  border-color: var(--md-sys-color-primary);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.28), var(--md-sys-glow-primary);
}
.todo-floating-dock.is-expanded {
  border-radius: var(--md-shape-xl);
  border-color: var(--md-sys-color-primary);
}

.todo-dock-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  cursor: pointer;
  user-select: none;
  background: var(--md-sys-color-surface-container-high);
  transition: background-color var(--md-motion-duration-short);
  gap: 12px;
}
.todo-dock-header:hover {
  background: var(--md-sys-color-surface-container-highest);
}

.todo-dock-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.todo-dock-icon {
  font-size: 19px;
  color: var(--md-sys-color-primary);
  flex-shrink: 0;
}
.todo-dock-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
  white-space: nowrap;
}
.todo-dock-active-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  background: rgba(96, 165, 250, 0.12);
  border: 1px solid rgba(96, 165, 250, 0.25);
  border-radius: var(--md-shape-full);
  font-size: 12px;
  color: var(--md-sys-color-primary);
  min-width: 0;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.todo-dock-active-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--md-sys-color-primary);
  box-shadow: 0 0 6px var(--md-sys-color-primary);
  animation: pulse-dot 1.5s infinite ease-in-out;
  flex-shrink: 0;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 0.4; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.2); }
}
.todo-dock-active-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.todo-dock-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.todo-dock-count-badge {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
}
.todo-dock-mini-track {
  width: 56px;
  height: 4px;
  border-radius: var(--md-shape-full);
  background: var(--md-sys-color-surface-container-highest);
  overflow: hidden;
}
.todo-dock-mini-bar {
  height: 100%;
  background: var(--md-sys-color-primary);
  border-radius: var(--md-shape-full);
  transition: width 300ms cubic-bezier(0.2, 0, 0, 1);
}
.todo-dock-chevron-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--md-sys-color-on-surface-variant);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border-radius: var(--md-shape-full);
  transition: all var(--md-motion-duration-short);
}
.todo-dock-chevron-btn:hover {
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-primary);
}
#todo-dock-chevron {
  font-size: 20px;
  transition: transform var(--md-motion-duration-short) ease;
}

.todo-dock-body {
  border-top: 1px solid var(--md-sys-color-outline-variant);
  max-height: 250px;
  overflow-y: auto;
  padding: 8px 10px;
  background: var(--md-sys-color-surface-container-low);
}
.todo-dock-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

@keyframes icon-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.icon-spin {
  animation: icon-spin 1.8s linear infinite;
}

/* 1. Todo List Card */
.tool-card-todo {
  background: var(--md-sys-color-surface-container-low);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-lg);
  margin: 10px 0;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.todo-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--md-sys-color-surface-container-high);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  font-size: 13px;
}
.todo-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
}
.todo-header-left .todo-icon {
  color: var(--md-sys-color-primary);
  font-size: 18px;
}
.todo-progress-chip {
  font-size: 11.5px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: var(--md-shape-full);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-primary);
  border: 1px solid var(--md-sys-color-outline-variant);
}
.todo-progress-bar-track {
  width: 100%;
  height: 3px;
  background: var(--md-sys-color-surface-container-high);
  overflow: hidden;
}
.todo-progress-bar-fill {
  height: 100%;
  background: var(--md-sys-color-primary);
  transition: width 350ms ease;
}
.todo-item-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
}
.todo-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--md-shape-md);
  font-size: 13px;
  line-height: 1.4;
  transition: background-color 150ms ease;
}
.todo-item:hover {
  background: var(--md-sys-color-surface-container-high);
}
.todo-item-icon {
  font-size: 18px;
  flex-shrink: 0;
}
.todo-item-text {
  flex: 1;
  min-width: 0;
}
.todo-item.completed {
  color: var(--md-sys-color-on-surface-variant);
}
.todo-item.completed .todo-item-icon {
  color: #10B981;
}
.todo-item.completed .todo-item-text {
  text-decoration: line-through;
  opacity: 0.8;
}
.todo-item.in_progress {
  color: var(--md-sys-color-on-surface);
  font-weight: 600;
  background: rgba(96, 165, 250, 0.08);
}
.todo-item.in_progress .todo-item-icon {
  color: var(--md-sys-color-primary);
  animation: todo-spin 2s linear infinite;
}
@keyframes todo-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.todo-item.pending {
  color: var(--md-sys-color-on-surface-variant);
}
.todo-item.pending .todo-item-icon {
  color: var(--md-sys-color-outline);
}
.todo-status-tag {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: var(--md-shape-full);
  font-weight: 500;
  flex-shrink: 0;
}
.todo-tag-completed {
  background: rgba(16, 185, 129, 0.12);
  color: #10B981;
}
.todo-tag-progress {
  background: rgba(59, 130, 246, 0.15);
  color: var(--md-sys-color-primary);
}
.todo-tag-pending {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
}

/* 2. Read File Card */
.tool-card-read {
  background: var(--md-sys-color-code-bg);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-lg);
  margin: 10px 0;
  overflow: hidden;
}
.read-file-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--md-sys-color-surface-container-high);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  font-size: 13px;
}
.read-file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-family-code);
  font-weight: 600;
}
.read-file-content {
  padding: 10px 14px;
  font-family: var(--font-family-code);
  font-size: 12.5px;
  line-height: 1.5;
  max-height: 320px;
  overflow-y: auto;
  margin: 0;
  white-space: pre-wrap;
}

/* 3. Web Search Card */
.tool-card-search {
  background: var(--md-sys-color-surface-container-low);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-lg);
  margin: 10px 0;
  overflow: hidden;
}
.search-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--md-sys-color-surface-container-high);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  font-size: 13px;
}
.search-query-text {
  font-weight: 600;
  color: var(--md-sys-color-primary);
}
.search-results-list {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.search-result-item {
  padding: 8px 10px;
  border-radius: var(--md-shape-md);
  background: var(--md-sys-color-surface-container);
  font-size: 12.5px;
}
.search-result-title {
  font-weight: 600;
  color: var(--md-sys-color-primary);
  margin-bottom: 3px;
}
.search-result-snippet {
  color: var(--md-sys-color-on-surface-variant);
  line-height: 1.4;
}

/* 4. Ask User Card */
.tool-card-ask {
  background: var(--md-sys-color-surface-container);
  border: 1px solid var(--md-sys-color-primary);
  border-radius: var(--md-shape-lg);
  margin: 10px 0;
  padding: 14px;
}
.ask-question-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
  margin-bottom: 10px;
}
.ask-options-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ask-option-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--md-shape-md);
  background: var(--md-sys-color-surface-container-high);
  border: 1px solid var(--md-sys-color-outline-variant);
  font-size: 13px;
  cursor: pointer;
  transition: all 150ms ease;
}
.ask-option-item:hover {
  border-color: var(--md-sys-color-primary);
  background: rgba(96, 165, 250, 0.08);
}

/* ============================================================================
   Generic Button System (used by plugins)
   ============================================================================ */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-full);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  font-family: var(--font-family-display);
  font-weight: 600;
  cursor: pointer;
  transition: all var(--md-motion-duration-short) var(--md-motion-easing-emphasized);
  padding: 8px 16px;
  font-size: 13px;
}
.btn:hover {
  background: var(--md-sys-color-surface-container-highest);
  border-color: var(--md-sys-color-primary);
  color: var(--md-sys-color-primary);
  transform: translateY(-1px);
}
.btn:active {
  transform: scale(0.97);
}
.btn-sm {
  padding: 5px 10px;
  font-size: 12px;
}
.btn-xs {
  padding: 3px 8px;
  font-size: 11px;
}
.btn-primary {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  border-color: transparent;
}
.btn-primary:hover {
  filter: brightness(1.1);
  box-shadow: 0 4px 12px rgba(138, 180, 248, 0.35);
}
.btn-ghost {
  background: transparent;
  border-color: transparent;
  color: var(--md-sys-color-on-surface-variant);
}
.btn-ghost:hover {
  background: rgba(128, 128, 128, 0.12);
  color: var(--md-sys-color-on-surface);
}
.btn-outline {
  background: transparent;
  border-color: var(--md-sys-color-outline);
  color: var(--md-sys-color-primary);
}
.btn-outline:hover {
  background: var(--md-sys-color-primary-container);
  border-color: var(--md-sys-color-primary);
}
.btn-sparkle {
  animation: btn-sparkle-shine 2s infinite alternate;
}
@keyframes btn-sparkle-shine {
  0% { opacity: 0.85; }
  50% { opacity: 1; }
  100% { opacity: 0.85; transform: rotate(3deg); }
}

/* ============================================================================
   Metrics Display (statusbar)
   ============================================================================ */
.statusbar-metrics-wrap {
  display: flex;
  align-items: center;
  gap: 14px;
  font-family: var(--font-family-code);
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
}
.metric-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-weight: 500;
}
.metric-highlight {
  color: var(--md-sys-color-primary);
  font-weight: 700;
}

/* ============================================================================
   Loading & Empty States
   ============================================================================ */
.muted-loading {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
  font-style: italic;
  display: flex;
  align-items: center;
  gap: 8px;
}
.muted-loading::before {
  content: '';
  width: 14px;
  height: 14px;
  border: 2px solid var(--md-sys-color-outline-variant);
  border-top-color: var(--md-sys-color-primary);
  border-radius: 50%;
  animation: m3-spin 0.8s linear infinite;
}
@keyframes m3-spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
  text-align: center;
  padding: 24px 16px;
}

.text-dim { color: var(--md-sys-color-on-surface-variant); }
.text-xs { font-size: 11px; }
.text-error { color: var(--md-sys-color-error); }

/* ============================================================================
   Tool Inspector — Nested Modal
   ============================================================================ */
.tool-modal {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tool-modal .modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
}
.tool-modal .modal-box {
  position: relative;
  z-index: 2;
  background: var(--md-sys-color-surface-container-high);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-xxl);
  padding: 24px;
  width: 90%;
  max-width: 520px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4);
  animation: m3-scale-in 200ms var(--md-motion-easing-emphasized);
}
.tool-modal h3 {
  font-size: 18px;
  font-weight: 700;
  color: var(--md-sys-color-on-surface);
  margin-bottom: 6px;
}
.tool-modal .muted-text {
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
  margin-bottom: 14px;
}
.tool-json-input {
  width: 100%;
  min-height: 100px;
  background: var(--md-sys-color-code-bg);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-md);
  padding: 12px 14px;
  font-family: var(--font-family-code);
  font-size: 13px;
  color: var(--md-sys-color-on-surface);
  outline: none;
  resize: vertical;
  margin-bottom: 12px;
}
.tool-json-input:focus {
  border-color: var(--md-sys-color-primary);
}
.modal-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.modal-result {
  background: var(--md-sys-color-code-bg);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-md);
  padding: 12px 14px;
  font-family: var(--font-family-code);
  font-size: 12.5px;
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  margin: 0;
}

/* Tool Inspector Panel */
.panel-title-text {
  font-size: 16px;
  font-weight: 700;
  color: var(--md-sys-color-on-surface);
  flex: 1;
}
.tool-inspect-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.tool-inspect-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.tool-params-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.param-chip {
  font-family: var(--font-family-code);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--md-shape-full);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
  border: 1px solid var(--md-sys-color-outline-variant);
}
.param-chip.param-req {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  border-color: var(--md-sys-color-primary);
  font-weight: 600;
}

/* File path display in file panel */
.file-path {
  font-family: var(--font-family-code);
  font-size: 12.5px;
  color: var(--md-sys-color-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.file-icon {
  flex-shrink: 0;
}
.file-preview-name {
  font-family: var(--font-family-code);
  font-size: 13px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
}
.file-preview-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-full);
}
::-webkit-scrollbar-thumb:hover {
  background: var(--md-sys-color-outline);
}

/* Workspace Info Chip cursor */
.workspace-info-chip {
  cursor: pointer;
  transition: color var(--md-motion-duration-short);
}
/* Chat Customization Tokens */
:root {
  --chat-font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --chat-max-width: 860px;
  --focus-ring-color: var(--md-sys-color-primary);
  --focus-ring-width: 2px;
  --focus-ring-offset: 2px;
}

/* Keyboard focus must be visible everywhere, but only for keyboard users —
   :focus would ring the mouse cursor on every click. */
:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

body.reduced-motion *,
body.reduced-motion *::before,
body.reduced-motion *::after {
  animation-duration: 0.001ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.001ms !important;
}
/* Same effect for people who ask the OS, regardless of the reduceMotion setting. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}

/* Sidebar Settings Button */
.sidebar-settings-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: var(--md-shape-full);
  border: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--md-motion-duration-short);
}
.sidebar-settings-btn:hover {
  background: var(--md-sys-color-surface-container-highest);
  border-color: var(--md-sys-color-primary);
  color: var(--md-sys-color-primary);
  transform: translateY(-1px);
}
.sidebar-settings-btn .settings-icon {
  font-size: 16px;
}

/* ============================================================================
   Floating Settings Modal (Claude Code Style)
   ============================================================================ */
/* Settings reuses .modal-backdrop with a modifier rather than restating the
   backdrop: it is the deepest dialog in the stack (a settings pane can open a
   picker on top of itself), and it dims harder so the two layers read apart. */
.modal-backdrop-settings {
  z-index: 2000;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(8px);
}

.settings-dialog-card {
  width: min(940px, 94vw);
  height: min(680px, 88vh);
  background: var(--md-sys-color-surface-container-low);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 18px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
  display: flex;
  position: relative;
  overflow: hidden;
  animation: m3-scale-in 200ms var(--md-motion-easing-emphasized);
}

.settings-close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 30;
  width: 32px;
  height: 32px;
  border-radius: var(--md-shape-full);
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--md-motion-duration-short);
}
.settings-close-btn:hover {
  background: var(--md-sys-color-surface-container-highest);
  color: var(--md-sys-color-on-surface);
  transform: scale(1.05);
}

/* Settings Left Sidebar */
.settings-sidebar {
  width: var(--settings-sidebar-width);
  flex-shrink: 0;
  border-right: 1px solid var(--md-sys-color-outline-variant);
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
  gap: 12px;
  background: var(--md-sys-color-surface-container-lowest);
  overflow: hidden;
}

.settings-search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--md-shape-full);
  border: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface-container-high);
}
.settings-search-box .search-icon {
  font-size: 16px;
  color: var(--md-sys-color-on-surface-variant);
}
.settings-search-field {
  border: none;
  background: transparent;
  outline: none;
  font-size: 12.5px;
  color: var(--md-sys-color-on-surface);
  width: 100%;
}

.settings-nav-scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 4px;
}
.settings-nav-group-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--md-sys-color-on-surface-variant);
  padding: 10px 8px 4px 8px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 10px;
  border-radius: var(--md-shape-sm);
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: all var(--md-motion-duration-short);
}
.settings-nav-item:hover {
  background: var(--md-sys-color-surface-container-high);
}
.settings-nav-item.active {
  background: var(--md-sys-color-surface-container-highest);
  font-weight: 600;
  color: var(--md-sys-color-primary);
}
.settings-nav-item .nav-item-icon {
  font-size: 18px;
  color: var(--md-sys-color-on-surface-variant);
}
.settings-nav-item.active .nav-item-icon {
  color: var(--md-sys-color-primary);
}
.settings-nav-item .nav-item-ext-icon {
  margin-left: auto;
  font-size: 14px;
  opacity: 0.6;
}

/* Settings Right Content Area */
.settings-main-content {
  flex: 1;
  overflow-y: auto;
  padding: 28px 36px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.settings-section-block {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
/* Segmented Buttons Group */
.m3-segmented-group {
  display: inline-flex;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-full);
  padding: 2px;
  background: var(--md-sys-color-surface-container-high);
  gap: 2px;
}
.m3-segmented-btn {
  border: none;
  background: transparent;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: var(--md-shape-full);
  cursor: pointer;
  color: var(--md-sys-color-on-surface-variant);
  transition: all var(--md-motion-duration-short);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.m3-segmented-btn:hover {
  color: var(--md-sys-color-on-surface);
}
.m3-segmented-btn.active {
  background: var(--md-sys-color-surface);
  color: var(--md-sys-color-primary);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

/* The schema renderer draws its own switch so it can carry data-setting/role;
   the settings pane never uses a legacy .m3-switch. */
.settings-ctrl-switch {
  flex: 0 0 auto;
  width: 44px;
  height: 24px;
  padding: 0;
  border-radius: var(--md-shape-full);
  border: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface-container-highest);
  position: relative;
  cursor: pointer;
  transition: background-color var(--md-motion-duration-short) var(--md-motion-easing-emphasized),
              border-color var(--md-motion-duration-short) var(--md-motion-easing-emphasized);
}
.settings-ctrl-switch .switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--md-sys-color-on-surface-variant);
  transition: transform var(--md-motion-duration-short) var(--md-motion-easing-emphasized),
              background-color var(--md-motion-duration-short) var(--md-motion-easing-emphasized);
}
.settings-ctrl-switch.active {
  background: var(--md-sys-color-primary);
  border-color: var(--md-sys-color-primary);
}
.settings-ctrl-switch.active .switch-thumb {
  transform: translateX(20px);
  background: var(--md-sys-color-on-primary);
}

/* Settings controls: every one caps out so long descriptions keep the left side. */
.settings-ctrl-select,
.settings-ctrl-input {
  height: 32px;
  max-width: var(--settings-ctrl-max-width);
  padding: 4px 10px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-sm);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  font-family: var(--font-family-display);
  font-size: 13px;
  outline: none;
}
.settings-ctrl-select {
  padding-right: 28px;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' height='20' viewBox='0 -960 960 960' width='20' fill='%23888'%3E%3Cpath d='M480-345 240-585l56-56 184 184 184-184 56 56-240 240Z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 6px center;
  background-size: 16px;
  appearance: none;
}
.settings-ctrl-text {
  font-family: var(--font-family-code);
  font-size: 12px;
}
.settings-ctrl-input[type="number"] {
  width: 108px;
}
.settings-ctrl-input:focus,
.settings-ctrl-select:focus {
  border-color: var(--md-sys-color-primary);
}
/* A value the schema would reject gets an error ring rather than a silent clamp. */
.settings-ctrl-input.is-invalid {
  border-color: var(--md-sys-color-error);
  box-shadow: 0 0 0 1px var(--md-sys-color-error);
}
.settings-ctrl-input:disabled,
.settings-ctrl-select:disabled,
.settings-ctrl-stepper[data-disabled] {
  opacity: 0.55;
}
.settings-ctrl-stepper {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.settings-ctrl-stepper .stepper-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-sm);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  transition: background-color var(--md-motion-duration-short);
}
.settings-ctrl-stepper .stepper-btn:hover:not(:disabled) {
  background: var(--md-sys-color-surface-container-highest);
  color: var(--md-sys-color-on-surface);
}
.settings-ctrl-stepper .stepper-btn:disabled { cursor: default; }
.settings-ctrl-unit {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
}
.settings-ctrl-number {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.settings-preset-row {
  display: flex;
  gap: 4px;
}
.settings-preset-chip {
  padding: 2px 8px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-shape-full);
  background: var(--md-sys-color-surface-container-low);
  color: var(--md-sys-color-on-surface-variant);
  font-family: var(--font-family-code);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--md-motion-duration-short);
}
.settings-preset-chip:hover:not(:disabled) { color: var(--md-sys-color-on-surface); }
.settings-preset-chip.active {
  background: var(--md-sys-color-secondary-container);
  border-color: transparent;
  color: var(--md-sys-color-on-secondary-container);
  font-weight: 600;
}

/* Row states: a TUI-only row is visible but inert, a changed row carries a dot
   and grows a reset affordance on hover. */
.settings-row {
  min-height: var(--settings-row-min-height);
  padding: var(--settings-row-padding-y) var(--settings-row-padding-x);
  border-radius: var(--md-shape-md);
  transition: background-color var(--md-motion-duration-short);
}
.settings-row:hover { background: var(--md-sys-color-surface-container-low); }
.settings-row.is-tui-only { opacity: 0.55; }
.settings-row-info { max-width: none; flex: 1 1 auto; }
.settings-row-desc {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
  line-height: 1.4;
}
.settings-row-ctrl { flex: 0 0 auto; }
.settings-row-label {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
/* Badge and highlight colors are tokens so the palette chip and the settings
   badges stay in step with the scheme rather than each naming a surface. */
:root, [data-theme="dark"] {
  --badge-tui-bg: var(--md-sys-color-surface-container-highest);
  --badge-tui-text: var(--md-sys-color-on-surface-variant);
  --badge-web-bg: var(--md-sys-color-tertiary-container);
  --badge-web-text: var(--md-sys-color-on-tertiary-container);
  --badge-restart-bg: var(--md-sys-color-error-container);
  --badge-restart-text: var(--md-sys-color-on-error-container);
  --badge-dirty-dot: var(--md-sys-color-primary);
  --search-match-bg: var(--md-sys-color-primary-container);
  --search-match-text: var(--md-sys-color-on-primary-container);
}

.settings-badge {
  padding: 0 6px;
  border-radius: var(--md-shape-full);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.settings-badge-tui {
  background: var(--badge-tui-bg);
  color: var(--badge-tui-text);
}
.settings-badge-web {
  background: var(--badge-web-bg);
  color: var(--badge-web-text);
}
.settings-badge-restart {
  background: var(--badge-restart-bg);
  color: var(--badge-restart-text);
}
.settings-badge-dirty {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--badge-dirty-dot);
}
.settings-group-tag {
  padding: 0 6px;
  border-radius: var(--md-shape-full);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font-size: 10px;
  font-weight: 500;
  text-transform: none;
}
.settings-reset-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--md-shape-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--md-motion-duration-short), background-color var(--md-motion-duration-short);
}
.settings-row:hover .settings-reset-btn,
.settings-reset-btn:focus-visible { opacity: 1; }
.settings-reset-btn:hover { background: var(--md-sys-color-surface-container-highest); }

.settings-search-highlight {
  background: var(--search-match-bg);
  color: var(--search-match-text);
  border-radius: 2px;
  padding: 0 1px;
}
.settings-search-count {
  align-self: flex-start;
  padding: 6px 10px;
  border-radius: var(--md-shape-full);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
}
/* Sticky group headers so a long pane keeps its section labels in view. */
.settings-section-header {
  position: sticky;
  top: -28px;
  z-index: 1;
  margin: 0 -36px;
  padding: 10px 36px 8px 36px;
  background: var(--md-sys-color-surface-container-low);
}

/* ============================================================================
   Turn Feedback: Retry Notice & Sub-agent Strip
   These mirror the TUI's status region, which sits *above* the prompt rather
   than in the transcript — a retry or a delegated sub-agent is turn state, not
   a message, so it must not scroll away inside the assistant card.
   ============================================================================ */

/* The TUI only carries a visible-height row per item, so clamp the strip to one
   scrolling line; the chips stay in DOM order (spawned first -> leftmost). */
.subagent-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}
.subagent-strip::-webkit-scrollbar { display: none; }
.subagent-strip.hidden { display: none; }

.subagent-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  max-width: 220px;
  padding: 3px 10px 3px 8px;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-shape-full);
  background: var(--md-sys-color-surface-container-low);
  color: var(--md-sys-color-on-surface-variant);
  font-size: 11.5px;
  cursor: default;
  transition: background-color var(--md-motion-duration-short) var(--md-motion-easing-emphasized),
              border-color var(--md-motion-duration-short) var(--md-motion-easing-emphasized);
}
.subagent-chip .icon-xs { font-size: 14px; }
.subagent-chip-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.subagent-chip-steps {
  flex: 0 0 auto;
  padding: 0 6px;
  border-radius: var(--md-shape-full);
  background: var(--md-sys-color-surface-container-highest);
  color: var(--md-sys-color-on-surface-variant);
  font-family: var(--font-family-code);
  font-size: 10px;
  line-height: 15px;
}
.subagent-chip.active {
  border-color: var(--md-sys-color-primary);
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}
.subagent-chip.active .subagent-chip-steps {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}
.subagent-chip[data-subagent-kind="workflow"].active {
  border-color: var(--md-sys-color-tertiary);
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}

/* Retry notice: aria-live so a screen reader hears the attempt counter too. */
.retry-notice {
  display: flex;
  align-items: center;
  min-height: 20px;
  color: var(--md-sys-color-tertiary);
  font-size: 12px;
  animation: m3-fade-in var(--md-motion-duration-medium) var(--md-motion-easing-decelerate);
}
.retry-notice.hidden { display: none; }

/* ============================================================================
   Interaction Dialogs (permission allow/deny, ask_user)
   ============================================================================ */

.interaction-tool {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--md-sys-color-on-surface);
  font-size: 13.5px;
}
.interaction-tool .material-symbols-outlined { color: var(--md-sys-color-primary); }
.interaction-tool code {
  font-family: var(--font-family-code);
  font-size: 12.5px;
  padding: 1px 6px;
  border-radius: var(--md-shape-xs);
  background: var(--md-sys-color-surface-container-high);
}
.interaction-summary {
  margin-bottom: 8px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
  line-height: 1.5;
}
.interaction-input {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-shape-sm);
  background: var(--md-sys-color-code-bg);
  color: var(--md-sys-color-on-surface-variant);
  font-family: var(--font-family-code);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.ask-user-questions {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.ask-user-question + .ask-user-question {
  padding-top: 18px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
}
.ask-user-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.ask-user-chip {
  padding: 1px 8px;
  border-radius: var(--md-shape-full);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font-size: 11px;
  letter-spacing: 0.2px;
}
.ask-user-question-text {
  color: var(--md-sys-color-on-surface);
  font-size: 13.5px;
  font-weight: 500;
}
.ask-user-options {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ask-user-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--md-shape-sm);
  cursor: pointer;
  transition: background-color var(--md-motion-duration-short) var(--md-motion-easing-standard);
}
.ask-user-option:hover { background: var(--md-sys-color-surface-container-high); }
.ask-user-radio {
  flex: 0 0 auto;
  accent-color: var(--md-sys-color-primary);
  width: 15px;
  height: 15px;
  margin: 0;
}
.ask-user-option-text {
  color: var(--md-sys-color-on-surface);
  font-size: 13px;
  line-height: 1.45;
}
.ask-user-option-desc {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 11.5px;
  line-height: 1.4;
}
/* Free-text escape hatch: narrower than an option so it reads as an aside. */
.ask-user-other {
  flex: 1 1 160px;
  min-width: 0;
  margin-left: 4px;
  padding: 4px 8px;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-shape-xs);
  background: var(--md-sys-color-surface);
  color: var(--md-sys-color-on-surface);
  font-family: var(--font-family-display);
  font-size: 12.5px;
  outline: none;
}
.ask-user-other:focus {
  border-color: var(--md-sys-color-primary);
}

/* ============================================================================
   Responsive Adaptations & Breakpoints
   ============================================================================ */

/* Mobile / Tablet Drawer & Compact Layout (< 768px) */
@media (max-width: 768px) {
  /* 1. Header Bar: Compact & Clean */
  .app-header {
    padding: 0 10px;
    gap: 8px;
  }
  .brand-tag {
    display: none;
  }
  .header-actions-slot {
    display: none;
  }
  #demo-showcase-btn .btn-text,
  #new-session-btn .btn-text {
    display: none;
  }
  #demo-showcase-btn,
  #new-session-btn {
    padding: 0;
    width: 36px;
    height: 36px;
    min-width: 36px;
    border-radius: var(--md-shape-full);
    justify-content: center;
  }
  .header-model-chip {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    padding: 4px 8px;
  }

  /* 2. Off-Canvas Modal Drawer Sidebar */
  .sidebar {
    position: fixed;
    top: var(--header-height);
    bottom: var(--statusbar-height);
    left: 0;
    width: min(300px, 85vw);
    max-width: 85vw;
    background: var(--md-sys-color-surface-container);
    border-right: 1px solid var(--md-sys-color-outline-variant);
    z-index: 1000;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
    transform: translateX(0);
    transition: transform var(--md-motion-duration-medium) var(--md-motion-easing-emphasized);
  }

  .sidebar.collapsed {
    width: min(300px, 85vw);
    transform: translateX(-100%);
    box-shadow: none;
    pointer-events: none;
  }

  /* Sidebar Backdrop */
  .sidebar-backdrop {
    display: block;
    position: fixed;
    top: var(--header-height);
    bottom: var(--statusbar-height);
    left: 0;
    right: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px);
    z-index: 999;
    opacity: 1;
    pointer-events: auto;
    transition: opacity var(--md-motion-duration-short);
  }

  .sidebar.collapsed ~ .sidebar-backdrop,
  .sidebar-backdrop.hidden {
    opacity: 0;
    pointer-events: none;
  }

  /* 3. Content Area: 100% Full Width */
  .content-area {
    width: 100%;
    max-width: 100%;
    flex: 1;
    min-width: 0;
  }

  /* 4. Welcome Studio & Cards */
  .welcome-container {
    padding: 20px 14px 28px 14px;
    max-width: 100%;
  }
  .welcome-header {
    margin-bottom: 20px;
  }
  .welcome-hero-badge {
    padding: 4px 12px;
    margin-bottom: 12px;
    font-size: 11px;
  }
  .welcome-title {
    font-size: clamp(20px, 5.5vw, 28px);
    margin-bottom: 8px;
    line-height: 1.25;
  }
  .welcome-subtitle {
    font-size: 13px;
    line-height: 1.5;
  }
  .welcome-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .welcome-card {
    padding: 14px 16px;
    border-radius: var(--md-shape-xl);
    gap: 10px;
  }
  .card-icon-wrap {
    width: 38px;
    height: 38px;
    border-radius: 10px;
  }
  .card-title {
    font-size: 14px;
  }
  .card-desc {
    font-size: 12px;
    line-height: 1.4;
  }

  /* 5. Prompt Quick Pills: Icon-Only Mode on Narrow Widths */
  .quick-pills-bar {
    gap: 4px;
  }
  .quick-pill-btn {
    padding: 0 8px;
    height: 32px;
    min-width: 32px;
    justify-content: center;
  }
  .quick-pill-btn .pill-label {
    display: none;
  }
  .quick-pill-btn .pill-icon {
    font-size: 18px;
    margin: 0;
  }

  /* 6. Input Dock Floating Bar */
  .input-dock-container {
    padding: 8px 12px;
    max-width: 100%;
  }
  .input-dock-card {
    padding: 8px 12px;
    border-radius: var(--md-shape-xl);
  }
  .chat-input {
    font-size: 13.5px;
    padding: 4px 2px;
  }
  .input-tool-chip span:not(.tool-chip-icon) {
    display: none;
  }
  .input-tool-chip {
    padding: 0 8px;
    height: 32px;
    min-width: 32px;
    justify-content: center;
    border-radius: var(--md-shape-full);
  }
  .m3-send-btn .send-text {
    display: none;
  }
  .m3-send-btn {
    padding: 0;
    width: 36px;
    height: 36px;
    min-width: 36px;
    border-radius: var(--md-shape-full);
    justify-content: center;
  }

  /* 7. Status Bar Compact */
  .app-statusbar {
    padding: 0 10px;
    font-size: 11px;
  }
  .statusbar-metrics-wrap .metric-item:not(.metric-highlight) {
    display: none;
  }

  /* 8. Settings Dialog Mobile Adaptation */
  .settings-dialog-card {
    width: 96vw;
    height: 92vh;
    border-radius: 14px;
    flex-direction: column;
  }
  .settings-sidebar {
    width: 100%;
    height: auto;
    max-height: 140px;
    border-right: none;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    padding: 10px 12px;
  }
  .settings-nav-scroll {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 4px;
  }
  .settings-nav-group-title {
    display: none;
  }
  .settings-nav-item {
    width: auto;
    padding: 4px 10px;
    font-size: 12px;
    border-radius: var(--md-shape-full);
  }
  .settings-main-content {
    padding: 18px 16px;
    gap: 20px;
  }
  .settings-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .settings-row-info {
    max-width: 100%;
  }
}

/* Extra Small Phones (< 480px) */
@media (max-width: 480px) {
  .brand-title {
    display: none;
  }
  .header-left-cluster {
    gap: 4px;
  }
  .header-model-chip {
    max-width: 110px;
    font-size: 10.5px;
  }
  .provider-badge {
    display: none;
  }
  .m3-theme-toggle {
    width: 52px;
    height: 28px;
  }
  .welcome-title {
    font-size: 20px;
  }
}

/* --- Accessibility: live region -------------------------------------------
   One polite announcer for the whole app. Streamed output is far too chatty
   to announce token by token, so callers speak only at milestones (a turn
   starting, a command returning, an error). */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* --- Auth gate -----------------------------------------------------------
   Shown when /api/* answers 401 and there is no credential to spend. Full
   screen on purpose: until the token is entered, nothing behind it works. */
.auth-gate {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(8px);
  animation: m3-fade-in 180ms var(--md-motion-easing-decelerate);
}
.auth-gate-card {
  width: min(420px, calc(100vw - 32px));
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  text-align: center;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-shape-xxl);
  box-shadow: var(--md-sys-color-shadow);
}
.auth-gate-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  color: var(--md-sys-color-primary);
  background: var(--md-sys-color-primary-container);
}
.auth-gate-title {
  margin: 2px 0 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
}
.auth-gate-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--md-sys-color-on-surface-variant);
}
.auth-gate-form {
  display: flex;
  gap: 8px;
  width: 100%;
  margin-top: 6px;
}
.auth-gate-input {
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
  font-family: var(--font-family-code);
  font-size: 12px;
  color: var(--md-sys-color-on-surface);
  background: var(--md-sys-color-surface);
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-shape-md);
}
.auth-gate-input:focus-visible {
  border-color: var(--md-sys-color-primary);
}
.auth-gate-error {
  margin: 0;
  min-height: 16px;
  font-size: 12px;
  color: var(--md-sys-color-error);
}
.auth-gate-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--md-sys-color-on-surface-variant);
}

/* --- Auth bypass banner --------------------------------------------------
   Only rendered when the server was started with --no-auth. */
.auth-bypass-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--md-sys-color-on-error-container);
  background: var(--md-sys-color-error-container);
  border-bottom: 1px solid var(--md-sys-color-error);
}

.auth-banner-icon {
  font-size: 16px;
}
.auth-banner-text {
  line-height: 1.4;
}
`;


