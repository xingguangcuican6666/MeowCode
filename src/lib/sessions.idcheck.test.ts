import { describe, it, expect } from 'vitest'
import { isValidSessionId, loadSession, deleteSession, renameSession } from './sessions'

// Session ids arrive from outside — `--resume <id>` and the WebUI's
// /api/session/{load,rename,delete} bodies — and are interpolated into a filename.
describe('session id validation', () => {
  it('accepts generated ids', () => {
    expect(isValidSessionId('m9x8k2-a1b2c3')).toBe(true)
    expect(isValidSessionId('abc123')).toBe(true)
  })

  it('rejects anything that could escape the sessions directory', () => {
    for (const bad of [
      '../../../etc/passwd', '..', '.', './x', 'a/b', 'a\\b', '',
      '/abs/path', 'x\u0000y', '.hidden', 'a'.repeat(200),
    ]) expect(isValidSessionId(bad), JSON.stringify(bad)).toBe(false)
  })

  it('the public operations refuse a traversing id instead of touching a file', () => {
    expect(loadSession('../../../etc/passwd')).toBeNull()
    expect(deleteSession('../../../etc/passwd')).toBe(false)
    expect(renameSession('../../../etc/passwd', 'x')).toBe(false)
  })
})
