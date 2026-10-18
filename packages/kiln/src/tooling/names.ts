/**
 * The names transform, shared by kiln-ecs/vite and kiln-ecs/preload. Every
 * `const X = system|trait|resource|event|prefab|plugin|relation|state(...)`, at any depth, becomes
 * `const X = globalThis.__kiln_named("X", system(...))` (guarded), so Kiln can name things after their
 * export in errors, snapshots and `kiln describe`. It is a runtime transform only; types are
 * untouched, and code it can't parse is left as it was.
 */
const FACTORIES = ['system', 'trait', 'resource', 'event', 'prefab', 'plugin', 'relation', 'state']
const DECL = new RegExp(
  String.raw`(^|[\n;{}])([ \t]*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*)((?:[\w$]+\.)?(?:${FACTORIES.join('|')})\s*(?:<[^\n]*?>)?\s*\()`,
  'g',
)

const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '\n'])

/** Index just past the `)` closing the paren at `open`, or -1 if the code can't be followed. */
export function findCallEnd(code: string, open: number): number {
  let depth = 0
  const tmpl: number[] = [] // brace depth at which each open template literal's ${ started
  let i = open
  let lastSig = '('
  while (i < code.length) {
    const c = code[i]!
    const n = code[i + 1]
    if (c === '/' && n === '/') {
      const e = code.indexOf('\n', i)
      i = e < 0 ? code.length : e
      continue
    }
    if (c === '/' && n === '*') {
      const e = code.indexOf('*/', i + 2)
      if (e < 0) return -1
      i = e + 2
      continue
    }
    if (c === '"' || c === "'") {
      i++
      while (i < code.length && code[i] !== c) {
        if (code[i] === '\\') i++
        else if (code[i] === '\n') return -1
        i++
      }
      i++
      lastSig = 'a'
      continue
    }
    if (c === '`' || (c === '}' && tmpl.length && tmpl[tmpl.length - 1] === depth)) {
      if (c === '}') tmpl.pop()
      i++
      while (i < code.length && code[i] !== '`') {
        if (code[i] === '\\') i++
        else if (code[i] === '$' && code[i + 1] === '{') {
          tmpl.push(depth)
          i += 2
          break
        }
        i++
      }
      if (code[i] === '`') i++
      lastSig = 'a'
      continue
    }
    if (c === '/' && REGEX_PREV.has(lastSig)) {
      i++
      let inClass = false
      while (i < code.length) {
        const r = code[i]!
        if (r === '\\') i++
        else if (r === '[') inClass = true
        else if (r === ']') inClass = false
        else if (r === '/' && !inClass) break
        else if (r === '\n') return -1
        i++
      }
      i++
      while (/[a-z]/i.test(code[i] ?? '')) i++
      lastSig = 'a'
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0) return c === ')' ? i + 1 : -1
    }
    if (!/\s/.test(c)) lastSig = /[\w$]/.test(c) ? 'a' : c
    else if (c === '\n' && lastSig !== 'a' && lastSig !== ')' && lastSig !== ']') lastSig = '\n'
    i++
  }
  return -1
}

/** Names of top-level factory consts, for tooling. */
export function findNamedExports(code: string): string[] {
  const out: string[] = []
  for (const m of code.matchAll(DECL)) if (!/^[ \t]/.test(m[2]!)) out.push(m[3]!)
  return out
}

export function addNames(code: string): string | null {
  let out = ''
  let last = 0
  let hit = false
  DECL.lastIndex = 0
  for (let m = DECL.exec(code); m; m = DECL.exec(code)) {
    const callStart = m.index + m[1]!.length + m[2]!.length
    const open = m.index + m[0].length - 1
    const end = findCallEnd(code, open)
    if (end < 0) continue
    out += code.slice(last, callStart) + `(globalThis.__kiln_named ?? ((_n, v) => v))(${JSON.stringify(m[3])}, ` + code.slice(callStart, end) + ')'
    last = end
    DECL.lastIndex = end
    hit = true
  }
  if (!hit) return null
  return out + code.slice(last)
}
