import { describe, it, expect } from 'vitest'
import { expandBraces, globToRegExp, hasGlobChars } from './glob'

describe('expandBraces', () => {
  it('expands a simple group', () => {
    expect(expandBraces('*.{ts,tsx}')).toEqual(['*.ts', '*.tsx'])
  })
  it('expands nested and adjacent groups', () => {
    expect(expandBraces('a{b,c{d,e}}f').sort()).toEqual(['abf', 'acdf', 'acef'])
    expect(expandBraces('{a,b}{1,2}').sort()).toEqual(['a1', 'a2', 'b1', 'b2'])
  })
  it('leaves comma-less braces and plain globs alone', () => {
    expect(expandBraces('{x}')).toEqual(['{x}'])
    expect(expandBraces('src/**/*.ts')).toEqual(['src/**/*.ts'])
  })
  it('caps the number of expansions', () => {
    expect(expandBraces('{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}', 10).length).toBeLessThanOrEqual(10)
  })
})

describe('globToRegExp', () => {
  it('** matches across directories, * does not', () => {
    const r = globToRegExp('**/*.ts')
    expect(r.test('a.ts')).toBe(true)
    expect(r.test('x/y/a.ts')).toBe(true)
    expect(globToRegExp('*.ts').test('x/a.ts')).toBe(false)
  })
  it('`**/` in the middle means zero or more directories, not a substring wildcard', () => {
    const r = globToRegExp('src/**/foo')
    expect(r.test('src/foo')).toBe(true)
    expect(r.test('src/a/b/foo')).toBe(true)
    expect(r.test('src/xfoo')).toBe(false)
  })
  it('trailing /** matches everything below', () => {
    const r = globToRegExp('src/**')
    expect(r.test('src/a/b.ts')).toBe(true)
    expect(r.test('lib/a.ts')).toBe(false)
  })
  it('supports braces, ? and character classes', () => {
    expect(globToRegExp('**/*.{ts,tsx}').test('a/b.tsx')).toBe(true)
    expect(globToRegExp('**/*.{ts,tsx}').test('a/b.js')).toBe(false)
    expect(globToRegExp('?.ts').test('a.ts')).toBe(true)
    expect(globToRegExp('?.ts').test('ab.ts')).toBe(false)
    expect(globToRegExp('[ab].ts').test('a.ts')).toBe(true)
    expect(globToRegExp('[!ab].ts').test('a.ts')).toBe(false)
  })
  it('escapes regex metacharacters in literal text', () => {
    expect(globToRegExp('a.b(c)+.ts').test('a.b(c)+.ts')).toBe(true)
    expect(globToRegExp('a.b.ts').test('axb.ts')).toBe(false)
  })
})

describe('hasGlobChars', () => {
  it('detects metacharacters', () => {
    expect(hasGlobChars('src/*.ts')).toBe(true)
    expect(hasGlobChars('src/a.ts')).toBe(false)
  })
})
