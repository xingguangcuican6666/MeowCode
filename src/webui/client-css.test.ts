import { describe, it, expect } from 'vitest'
import { CLIENT_CSS } from './client/css'
import { generateWebUIHtml } from './client/html'

/**
 * The WebUI shell's shrink chain, asserted as text.
 *
 * There is no browser here (no chromium on this box, and the disk is full), so
 * these are not layout tests — they are a guard on the specific property whose
 * absence produces the reported bug: the chat composer being pushed BELOW the
 * sidebar's bottom edge. A flex item defaults to `min-height: auto`, which means
 * "at least as tall as my content", so in the chain
 *
 *   #app (100vh column) > .main-workspace (row) > .content-area (column)
 *     > .chat-view (column) > [.chat-transcript (flex:1, scrolls), composer]
 *
 * every box that must be allowed to give way needs `min-height: 0`. Miss one and
 * the transcript refuses to shrink: the composer is what gets pushed off the
 * bottom instead, and the sidebar — which does shrink — ends up visibly higher.
 * That is exactly 「输入框直接嵌下去了，比侧边栏底还低」.
 */
const sheet = CLIENT_CSS

/** The declaration block for a selector, first occurrence. */
function rule(selector: string): string {
  const i = sheet.indexOf(`\n${selector} {`)
  expect(i, `no rule for ${selector}`).toBeGreaterThan(-1)
  const end = sheet.indexOf('\n}', i)
  return sheet.slice(i, end)
}

describe('WebUI shell layout', () => {
  it('gives the scrollable chat column permission to shrink', () => {
    // The box that must absorb the overflow by scrolling instead of growing.
    expect(rule('.chat-transcript')).toMatch(/min-height:\s*0/)
    expect(rule('.chat-transcript')).toMatch(/overflow-y:\s*auto/)
  })

  it('gives every box between the 100vh shell and the transcript the same permission', () => {
    // One missing link and the whole chain is rigid again.
    for (const sel of ['.chat-view', '.content-area']) {
      expect(rule(sel), `${sel} cannot shrink`).toMatch(/min-height:\s*0/)
    }
    // …and it has to be a row container at the top, or none of it applies.
    expect(rule('.main-workspace')).toMatch(/display:\s*flex/)
    expect(rule('#app')).toMatch(/height:\s*100vh/)
  })

  it('does not cap the panel view that replaces the chat', () => {
    // Same job as the transcript: it scrolls. Same missing property would push
    // the statusbar off the bottom when a plugin panel is long.
    expect(rule('.custom-panel-view')).toMatch(/min-height:\s*0/)
  })

  it('keeps the composer as a sibling that ends the column, not an overlay', () => {
    // An absolutely/fixed-position composer is what "sunk below the sidebar"
    // looks like when it happens; the dock is normal flow here, and its own
    // bottom padding is the deliberate breathing room above the statusbar.
    const dock = rule('.input-dock-container')
    expect(dock).not.toMatch(/position:\s*(absolute|fixed)/)
    expect(rule('.chat-view')).toMatch(/flex-direction:\s*column/)
  })

  it('puts the composer after the transcript in the DOM, so it can only be pushed down by it', () => {
    // Guards the diagnosis: if these ever swap, the transcript would sit under
    // the composer and the layout would break for a different reason. Read from
    // the generated page, not the CSS — the order is a markup fact.
    const page = generateWebUIHtml()
    const t = page.indexOf('class="chat-transcript"')
    const d = page.indexOf('class="input-dock-container"')
    expect(t).toBeGreaterThan(-1)
    expect(d).toBeGreaterThan(t)
  })
})