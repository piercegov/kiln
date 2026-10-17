import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Args } from './args.ts'

/** Calls that break deterministic headless runs inside game code. */
const RULES: { re: RegExp; rule: string; fix: string }[] = [
  { re: /\bMath\.random\s*\(/g, rule: 'no-math-random', fix: 'Use res.mut(Rng).float() (seeded) instead of Math.random().' },
  { re: /\bDate\.now\s*\(/g, rule: 'no-date-now', fix: 'Use ctx.time.elapsed (simulated seconds) instead of Date.now().' },
  { re: /\bperformance\.now\s*\(/g, rule: 'no-performance-now', fix: 'Use ctx.time.elapsed (simulated seconds) instead of performance.now().' },
  { re: /\bnew Date\s*\(\s*\)/g, rule: 'no-new-date', fix: 'Wall-clock time is not deterministic; use ctx.time.' },
]

export interface Finding {
  file: string
  line: number
  col: number
  rule: string
  message: string
}

function walk(dir: string, out: string[]): void {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const n of names) {
    if (n === 'node_modules' || n.startsWith('.')) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|mjs)$/.test(n)) out.push(p)
  }
}

/** Scans game sources. A line with `kiln-allow` is skipped. Vendored plugins are checked too. */
export function checkDeterminism(root: string, dirs = ['src']): Finding[] {
  const files: string[] = []
  for (const d of dirs) walk(join(root, d), files)
  const findings: Finding[] = []
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((text, i) => {
      if (text.includes('kiln-allow')) return
      const trimmed = text.trimStart()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
      for (const r of RULES) {
        r.re.lastIndex = 0
        for (const m of text.matchAll(r.re)) {
          findings.push({ file: relative(root, file), line: i + 1, col: (m.index ?? 0) + 1, rule: r.rule, message: r.fix })
        }
      }
    })
  }
  return findings
}

/** kiln check: determinism lint. Exit 1 when anything is found. */
export default async function check(args: Args, root: string): Promise<number> {
  const findings = checkDeterminism(root)
  if (args.json) console.log(JSON.stringify({ findings }))
  else if (findings.length === 0) console.log('ok no determinism problems')
  else for (const f of findings) console.log(`${f.file}:${f.line}:${f.col} ${f.rule} ${f.message}`)
  return findings.length ? 1 : 0
}
