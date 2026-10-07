import { describe, it, expect } from 'vitest'
import { rankMatches, hitQuality, searchTokens, NAME, DESC, type SearchField } from './search'
import { registry } from '../commands'
import { bothLangs } from './i18n'

// The row shape the /config search uses: label+description in both languages.
interface Row { key: string; terms: string[] }
const rowFields = (r: Row): SearchField[] => r.terms.map((text) => ({ text }))

// 「语言」 in every form it appears in, plus a near-miss to prove ranking.
const LANG: Row = {
  key: 'language',
  terms: ['语言', '界面语言（auto = 跟随 shell 区域设置）', 'Language', 'UI language (auto = match your shell locale)'],
}
const LANG_SERVICE: Row = { key: 'langSvc', terms: ['语言服务', '实验性功能', 'Language server', 'Experimental'] }
const FORMAT: Row = { key: 'timeFormat', terms: ['时间格式', '时间戳的时钟格式', 'Time format', 'Clock format for timestamps'] }
const CONFIG: Row = { key: 'config', terms: ['配置', '查看或设置配置', 'Config', 'View or change configuration'] }

const match = (rows: Row[], q: string): string[] => rankMatches(rows, q, rowFields).map((r) => r.key)

describe('searchTokens', () => {
  it('keeps a CJK run as one token and splits ASCII words', () => {
    // Splitting 「语言」 into two tokens would make it match any field containing
    // both characters anywhere — the whole point is that it stays intact.
    expect(searchTokens('界面语言 auto')).toEqual(['界面语言', 'auto'])
    expect(searchTokens('Auto-compact window')).toEqual(['auto', 'compact', 'window'])
    expect(searchTokens('   ')).toEqual([])
    expect(searchTokens('!!! ???')).toEqual([])
  })
})

describe('hitQuality', () => {
  it('ranks exact over prefix over word-boundary over bare substring', () => {
    const at = (tok: string, field: string): number | null => hitQuality(tok, field)?.[0] ?? null
    expect(at('time', 'time')).toBe(0)
    expect(at('time', 'time format')).toBe(1)
    expect(at('time', 'show the time')).toBe(2)
    expect(at('time', 'sometimes')).toBe(3)
    expect(at('tme', 'time')).toBeNull() // no ASCII subsequence tier: too much noise
  })

  it('scores a CJK match by how tightly its characters sit together', () => {
    // 「语言」 sitting at the head of the label beats one buried mid-description.
    expect(hitQuality('语言', '语言')?.[0]).toBe(0)
    expect(hitQuality('语言', '语言设置')?.[0]).toBe(0)
    expect(hitQuality('语言', '界面语言（auto）')?.[0]).toBe(2)
    // Same two characters, five columns apart — a much weaker answer, and the
    // reason 「语言」 outranks 「…语速调整的语言…」 below it.
    expect(hitQuality('语言', '语速调整的语言')?.[0]).toBe(3)
    // A subsequence that doesn't occur is not a match at all.
    expect(hitQuality('言设', '语言设置')?.[0]).toBe(2) // the user's typo, still found
    expect(hitQuality('语设', '界面语言与输出格式设置')?.[0]).toBe(3) // scattered, still found
  })

  it('gives a word-boundary ASCII hit a better tier than a mid-word one', () => {
    // "se" starts a word in "terminal-setup" and only occurs mid-word in
    // "responses" — the same substring, and the old substring-only filter had no
    // way to rank them differently.
    expect(hitQuality('se', 'terminal-setup')?.[0]).toBe(2)
    expect(hitQuality('se', 'responses')?.[0]).toBe(3)
    expect(hitQuality('se', 'sessions')?.[0]).toBe(1) // a name prefix, best of the lot
  })

  it('returns null for a token that cannot occur in the field', () => {
    expect(hitQuality('lang', '语言')).toBeNull()
    expect(hitQuality('', 'anything')).toBeNull()
  })
})

describe('rankMatches — searching across languages', () => {
  const rows = [LANG, LANG_SERVICE, FORMAT, CONFIG]

  it('finds a Chinese row by its English text', () => {
    // The bug this whole module exists for: on a Chinese UI the row is labelled
    // 「语言」 and `includes('lang')` was false.
    expect(match(rows, 'lang')).toContain('language')
    expect(match(rows, 'language')).toContain('language')
    expect(match(rows, 'ui lang')).toContain('language')
  })

  it('finds an English row by its Chinese text', () => {
    expect(match(rows, '语言')).toContain('language')
    expect(match(rows, '界面')).toContain('language')
    expect(match(rows, '配置')).toContain('config')
  })

  it('matches descriptions, not just labels', () => {
    // 「时钟格式」 appears only in the description.
    expect(match(rows, '时钟')).toContain('timeFormat')
    expect(match(rows, 'timestamps')).toContain('timeFormat')
  })

  it('prefers the tighter CJK match', () => {
    // Both start with 「语言」, so the tie-break is span then field length.
    expect(match(rows, '语言').slice(0, 2)).toEqual(['language', 'langSvc'])
  })
})

describe('rankMatches — query handling', () => {
  const rows = [LANG, LANG_SERVICE, FORMAT, CONFIG]

  it('requires every token to match, not just one of them', () => {
    expect(match(rows, 'language')).toEqual(['language', 'langSvc'])
    expect(match(rows, 'auto lang')).toEqual(['language']) // `auto` is only in its desc
    expect(match(rows, 'auto theme')).toEqual([])          // no row has both
  })

  it('ignores token order', () => {
    expect(match(rows, 'lang ui')).toEqual(match(rows, 'ui lang'))
  })

  it('returns the input untouched, in order, when there is nothing to search for', () => {
    expect(rankMatches(rows, '', rowFields)).toEqual(rows)
    expect(rankMatches(rows, '   ', rowFields)).toEqual(rows)
    expect(rankMatches(rows, '!?', rowFields)).toEqual(rows)
  })

  it('is stable: equally good matches keep their declared order', () => {
    // Two rows the query treats identically — neither may leapfrog the other.
    const a: Row = { key: 'a', terms: ['shared', 'shared', 'shared'] }
    const b: Row = { key: 'b', terms: ['shared', 'shared', 'shared'] }
    const c: Row = { key: 'c', terms: ['shared', 'shared', 'shared'] }
    expect(match([a, b, c], 'shared')).toEqual(['a', 'b', 'c'])
    expect(match([c, b, a], 'shared')).toEqual(['c', 'b', 'a'])
  })

  it('weights a name hit above a description-only hit', () => {
    // This is the whole reason `weight` exists: without it, adding descriptions to
    // the searchable surface would let a row whose *description* mentions a word
    // outrank one that is actually *named* that word.
    const named: Row = { key: 'named', terms: ['language'] }
    const described: Row = { key: 'described', terms: ['something else', 'the language setting'] }
    const byWeight = rankMatches([described, named], 'language', (r) =>
      r.terms.map((text) => ({ text, weight: text === r.terms[0] ? NAME : DESC })),
    )
    expect(byWeight.map((r) => r.key)).toEqual(['named', 'described'])
  })

  it('does not throw on degenerate input', () => {
    expect(() => rankMatches([], 'lang', rowFields)).not.toThrow()
    expect(() => rankMatches(rows, 'x'.repeat(5000), rowFields)).not.toThrow()
    expect(rankMatches(rows, 'x'.repeat(5000), rowFields)).toEqual([])
    // A row with nothing to match against is dropped, not crashed on.
    expect(rankMatches([{ key: 'empty', terms: [] }], 'lang', rowFields)).toEqual([])
  })

  it('matches an uninterpolated template, and the placeholder name itself', () => {
    // /effort's description carries `{levels}` when read raw from the catalog.
    // That is deliberate (see bothLangs), so it has to be searchable, not fatal.
    const eff: Row = { key: 'effort', terms: ['查看或设置推理投入 —— 例如 /effort high（{levels}）'] }
    expect(match([eff], 'levels')).toEqual(['effort'])
    expect(match([eff], '推理')).toEqual(['effort'])
  })
})

describe('the real registries stay searchable', () => {
  it('every built-in command has a catalog key whose both languages are non-empty', () => {
    // Guards the wiring rather than the matcher: a new command that forgets its
    // `descKey` would silently be unsearchable in the other language.
    const missing = registry.filter((c) => !c.descKey).map((c) => c.name)
    expect(missing).toEqual([])
    for (const c of registry) {
      if (!c.descKey) continue // already asserted empty above
      const both = bothLangs(c.descKey)
      expect(both.zh, c.name).not.toBe('')
      expect(both.en, c.name).not.toBe('')
    }
  })

  it('the slash menu still leads with the name prefix', () => {
    // Descriptions became searchable; the ranking people rely on must survive it.
    const fields = (c: typeof registry[number]): SearchField[] => {
      const f: SearchField[] = [{ text: c.name, weight: NAME }, { text: c.description, weight: DESC }]
      for (const a of c.aliases ?? []) f.push({ text: a, weight: NAME })
      if (c.descKey) {
        const both = bothLangs(c.descKey)
        f.push({ text: both.zh, weight: DESC }, { text: both.en, weight: DESC })
      }
      return f
    }
    const names = (q: string): string[] => rankMatches(registry, q, fields).map((c) => c.name)

    expect(names('mod')[0]).toBe('model')
    expect(names('model')[0]).toBe('model')
    expect(names('co')[0]).toBe('config')
    expect(names('conf')[0]).toBe('config')
    expect(names('?')[0]).toBe('help') // the alias still works
    expect(names('help')[0]).toBe('help')
  })

  it('preserves the previous ranking for name/alias matches, not just the top row', () => {
    // The old filter ranked every name-prefix match above every name-contains
    // match, and let declaration order break ties. Descriptions entering the
    // search surface must not quietly reshuffle a menu people navigate by muscle
    // memory, so the new ranking is checked against the old one exhaustively
    // over every 1–3 letter query: for each, the commands the OLD filter would
    // have shown must appear in the new results in the same relative order.
    const fields = (c: typeof registry[number]): SearchField[] => {
      const f: SearchField[] = [{ text: c.name, weight: NAME }, { text: c.description, weight: DESC }]
      for (const a of c.aliases ?? []) f.push({ text: a, weight: NAME })
      if (c.descKey) {
        const both = bothLangs(c.descKey)
        f.push({ text: both.zh, weight: DESC }, { text: both.en, weight: DESC })
      }
      return f
    }
    const legacyOrder = (query: string): string[] => {
      const q = query.toLowerCase()
      const starts: string[] = []
      const contains: string[] = []
      for (const c of registry) {
        const names = [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase())
        if (names.some((n) => n.startsWith(q))) starts.push(c.name)
        else if (names.some((n) => n.includes(q))) contains.push(c.name)
      }
      return [...starts, ...contains]
    }

    const letters = 'abcdefghijklmnopqrstuvwxyz'.split('')
    const reordered: string[] = []
    for (const a of letters) {
      for (const b of letters) {
        for (const q of [a + b, a + b + a, a + b + b]) {
          const legacy = legacyOrder(q)
          if (!legacy.length) continue
          const now = rankMatches(registry, q, fields).map((c) => c.name)
          const keptInLegacyOrder = now.filter((n) => legacy.includes(n))
          if (keptInLegacyOrder.join(',') !== legacy.join(',')) reordered.push(q)
        }
      }
    }
    // Exactly one query legitimately improves: `/se` used to put /clear (whose
    // name merely CONTAINS "se") above /terminal-setup (where "se" starts a
    // word). Word-boundary ranking puts it the right way round.
    expect([...new Set(reordered)]).toEqual(['se'])
  })

  it('a Chinese word finds its command, and the English word does too', () => {
    const fields = (c: typeof registry[number]): SearchField[] => {
      const f: SearchField[] = [{ text: c.name, weight: NAME }]
      if (c.descKey) {
        const both = bothLangs(c.descKey)
        f.push({ text: both.zh, weight: DESC }, { text: both.en, weight: DESC })
      }
      return f
    }
    const names = (q: string): string[] => rankMatches(registry, q, fields).map((c) => c.name)

    expect(names('模型')[0]).toBe('model')
    expect(names('model')[0]).toBe('model')
    expect(names('版本')).toContain('version')
    expect(names('version')).toContain('version')
    // A word that exists in neither language finds nothing rather than everything.
    expect(names('zzz')).toEqual([])
  })
})
