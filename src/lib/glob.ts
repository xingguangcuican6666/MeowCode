// Glob helpers shared by the `glob` tool, the grep fallback and the permission
// rules' path patterns. Dependency-free (no minimatch): just the subset agents
// actually use — `*`, `**`, `?`, `[abc]`/`[!abc]`, and `{a,b}` alternatives.

const REGEX_SPECIALS = /[.+^${}()|[\]\\]/g

/**
 * Expand `{a,b}` alternatives (nestable) into separate globs:
 * `*.{ts,tsx}` → [`*.ts`, `*.tsx`]. A brace group with no top-level comma
 * (`{x}`) is left literal, like a shell does. Capped so `{a,b}{c,d}{e,f}…`
 * cannot blow up.
 */
export function expandBraces(glob: string, cap = 64): string[] {
  const out: string[] = []
  const walk = (s: string): void => {
    if (out.length >= cap) return
    let depth = 0
    let start = -1
    let commas: number[] = []
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (c === '\\') { i++; continue }
      if (c === '{') {
        if (depth === 0) { start = i; commas = [] }
        depth++
      } else if (c === ',' && depth === 1) {
        commas.push(i)
      } else if (c === '}' && depth > 0) {
        depth--
        if (depth === 0 && commas.length > 0) {
          const prefix = s.slice(0, start)
          const suffix = s.slice(i + 1)
          const bounds = [start, ...commas, i]
          for (let k = 0; k < bounds.length - 1; k++) walk(prefix + s.slice(bounds[k] + 1, bounds[k + 1]) + suffix)
          return
        }
      }
    }
    out.push(s)
  }
  walk(glob)
  return out.length ? out : [glob]
}

// One brace-free glob → regex source (no anchors).
function compileOne(glob: string): string {
  let re = ''
  let i = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const atSegStart = i === 0 || glob[i - 1] === '/'
        if (atSegStart && glob[i + 2] === '/') { re += '(?:.*/)?'; i += 3; continue } // `**/` = zero or more directories
        re += '.*'
        i += 2
        continue
      }
      re += '[^/]*'
      i++
    } else if (c === '?') {
      re += '[^/]'
      i++
    } else if (c === '[') {
      const close = glob.indexOf(']', i + 2)
      if (close < 0) { re += '\\['; i++; continue }
      let body = glob.slice(i + 1, close)
      const neg = body[0] === '!' || body[0] === '^'
      if (neg) body = body.slice(1)
      re += `[${neg ? '^' : ''}${body.replace(/\\/g, '\\\\')}]`
      i = close + 1
    } else if (c === '\\' && i + 1 < glob.length) {
      re += glob[i + 1].replace(REGEX_SPECIALS, '\\$&')
      i += 2
    } else {
      re += c.replace(REGEX_SPECIALS, '\\$&')
      i++
    }
  }
  return re
}

/** Compile a glob to an anchored RegExp over a `/`-separated path. `*` and `?` never cross `/`; `**` does. */
export function globToRegExp(glob: string, flags = 's'): RegExp {
  const alts = expandBraces(glob).map(compileOne)
  return new RegExp(`^(?:${alts.join('|')})$`, flags)
}

/** Does the string contain any glob metacharacter? */
export function hasGlobChars(s: string): boolean {
  return /[*?[\]{}]/.test(s)
}
