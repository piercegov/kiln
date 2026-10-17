/** Tiny argv parser: `--flag`, `--key value`, `--key=value`, positionals. */
export interface Args {
  _: string[]
  [key: string]: string | boolean | string[]
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--') {
      out._.push(...argv.slice(i + 1))
      break
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1)
      else {
        const key = a.slice(2)
        const next = argv[i + 1]
        if (key.startsWith('no-')) out[key.slice(3)] = false
        else if (next !== undefined && !next.startsWith('--')) {
          out[key] = next
          i++
        } else out[key] = true
      }
    } else out._.push(a)
  }
  return out
}

export function num(v: unknown, fallback: number): number {
  if (v === undefined || v === true || v === false) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`Expected a number, got "${v}".`)
  return n
}

export function list(v: unknown): string[] {
  if (typeof v !== 'string') return []
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}
