/**
 * Cross-language matching for the UI's search boxes.
 *
 * A MeowCode surface is rendered in ONE language at a time, but a search box is
 * typed by a person who may be thinking in the other one: on a Chinese UI,
 * `lang` finds nothing because the row is labelled 「语言」, and on an English UI,
 * 「语言」 finds nothing either. So every searchable row hands this module all of
 * its textual forms — the zh label, the en label, both descriptions — and matches
 * the query against every one of them, in both directions.
 *
 * Two decisions shape the ranking, and both were settled by running the real
 * `/config` and slash-command data through the matcher rather than by taste:
 *
 * 1. **CJK is matched as a subsequence, ASCII is not.** 「语言」 is two
 *    independent characters, so 「言设」 must find it, and the match's *span*
 *    (how far apart the matched characters land) is the honest measure of how
 *    good it is. English words get exact/prefix/word-boundary/substring tiers and
 *    stop: adding a subsequence tier there (`tme` → `time`) measurably buried
 *    real matches under noise, which is not a trade worth making.
 *
 * 2. **A field's weight is added to its tier**, so a name hit always outranks a
 *    description-only hit. That is what keeps `/mod` → `/model` at the top of the
 *    slash menu now that descriptions are searchable at all.
 *
 * A hit is a `[tier, span]` pair compared lexicographically, where `span` is how
 * wide the CJK match is (always 0 for ASCII, which has no such measure). It is a
 * tie-breaker only: it separates 「语言」 from 「语言服务」 when both match at tier 0
 * and nothing else does, because both take the same two characters.
 *
 * There is deliberately NO field-length term. Ranking a shorter field higher looks
 * principled and is wrong here: it made `co` rank `/usage` first (via its short
 * alias `cost`) above `/config`, and `/copy` above `/config` — reordering a menu
 * people already have muscle memory for, on a tie the old code broke by
 * declaration order. Tier alone reproduces the old ranking exactly, because every
 * old "starts with" match is tier 1 and every old "contains" match is tier 2 or 3
 * on the same name field.
 */

export interface SearchField {
  /** The text to match against. Compared case-insensitively. */
  readonly text: string
  /** Added to the tier, so a name hit outranks a description-only hit. */
  readonly weight?: number
}

/** Weight for the row's own name/label. */
export const NAME = 0
/** Weight for supporting text (a description, a hint). */
export const DESC = 3

// CJK ideographs (U+4E00–U+9FFF) plus kana (U+3040–U+30FF) and hangul syllables
// (U+AC00–U+D7AF): scripts written without spaces, where a "word" is not a
// whitespace-delimited unit and substring matching alone would demand the user
// reproduce the original wording exactly. Written as escapes rather than literal
// characters so the ranges stay legible — and unambiguous — in any editor.
const CJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/

function hasCJK(s: string): boolean {
  return CJK.test(s)
}

/**
 * Split text into match tokens: ASCII alphanumerics form words, and a run of CJK
 * characters forms one token (it is searched as a subsequence, so it must not be
 * split further — 「语言」 must stay one token to match 「界面…设置」).
 */
export function searchTokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) ?? []
}

/** The subsequence span of `token` inside `field`, or null when it doesn't occur. */
function cjkSpan(token: string, field: string): number | null {
  let from = 0
  let first = -1
  let last = -1
  for (const ch of token) {
    const at = field.indexOf(ch, from)
    if (at < 0) return null
    if (first < 0) first = at
    last = at
    from = at + 1
  }
  return last - first + 1
}

/**
 * How well `token` matches `field`, as a pair compared lexicographically
 * (smaller is better). `null` means no match at all.
 *
 * The tiers, in order of preference:
 *
 * | token  | best case                                             |
 * |--------|-------------------------------------------------------|
 * | CJK    | the field starts with it (tier 0), else tight (2), else scattered (3) |
 * | ASCII  | the field *is* it (tier 0), else starts with it (1), else on a word boundary (2), else anywhere (3) |
 *
 * A CJK match scores its *span* — how far apart the matched characters land —
 * because that is the honest measure of a subsequence hit: 「语言」 at the head of
 * a label is a better answer than the same two characters scattered across a
 * sentence. There is no ASCII subsequence tier; see the module comment.
 */
export function hitQuality(token: string, field: string): readonly [number, number] | null {
  const hay = field.toLowerCase()
  if (!token || !hay) return null

  if (hasCJK(token)) {
    const span = cjkSpan(token, hay)
    if (span === null) return null
    return [hay.startsWith(token) ? 0 : span <= token.length * 2 ? 2 : 3, span]
  }

  if (hay === token) return [0, 0]
  if (hay.startsWith(token)) return [1, 0]
  // Word boundary: a token inside a longer word is a weaker signal than one that
  // starts or *is* a word ("lang" in "language" beats "lang" inside "floating").
  if (searchTokens(hay).some((w) => w === token || w.startsWith(token))) return [2, 0]
  if (hay.includes(token)) return [3, 0]
  return null
}

/** Lexicographic comparison of two hit pairs. */
function better(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

/**
 * Rank `items` against `query`, dropping the ones that don't match.
 *
 * Every query token must match *something* about an item — a partial match is
 * not a match, so `auto comp` only keeps rows that have both words. An empty
 * query (or one with no matchable characters in it) returns the input untouched,
 * in order, which is what every list wants before the user has typed anything.
 *
 * The sort is stable: equal scores keep the caller's original order, so a list
 * that was deliberately ordered (settings by group, commands by declaration)
 * stays that way among equally-good matches.
 */
export function rankMatches<T>(
  items: readonly T[],
  query: string,
  fieldsOf: (item: T) => readonly SearchField[],
): T[] {
  const tokens = searchTokens(query)
  if (!tokens.length) return [...items]

  const scored: { item: T; score: number[] }[] = []
  for (const item of items) {
    const fields = fieldsOf(item)
    const total = [0, 0]
    let ok = true
    for (const token of tokens) {
      let best: number[] | null = null
      for (const { text, weight } of fields) {
        const hit = hitQuality(token, text)
        if (!hit) continue
        const candidate = [hit[0] + (weight ?? 0), hit[1]]
        if (!best || better(candidate, best)) best = candidate
      }
      // One unmatched token disqualifies the whole row: "auto comp" must not
      // surface every row that merely mentions compacting.
      if (!best) { ok = false; break }
      total[0] += best[0]; total[1] += best[1]
    }
    if (ok) scored.push({ item, score: total })
  }

  return scored
    .sort((a, b) => (better(a.score, b.score) ? -1 : better(b.score, a.score) ? 1 : 0))
    .map((s) => s.item)
}
