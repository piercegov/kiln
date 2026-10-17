import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Args } from './args.ts'
import { buildApp, loadGame } from './load.ts'
import type { AppDescription } from '../core/describe.ts'

export const START = '<!-- kiln:generated:start (kiln docs rewrites everything below; edit above) -->'
export const END = '<!-- kiln:generated:end -->'

export interface DocEntry {
  name: string
  kind: string
  doc: string
  file: string
}

const DOC_RE = /\/\*\*([\s\S]*?)\*\/\s*export\s+(?:const|function|class|async function)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?(?:=\s*(?:[\w$]+\.)?([\w$]+))?/g
const EXPORT_RE = /^export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:[\w$]+\.)?(system|trait|resource|event|prefab|plugin|relation)\b/gm

function cleanDoc(raw: string): string {
  return raw
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter((l) => !l.startsWith('@'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(n) && !/\.(test|eval)\.ts$/.test(n)) out.push(p)
  }
}

/** Exported factory consts with their JSDoc (empty when missing) and file. */
export function collectDocs(root: string): DocEntry[] {
  const files: string[] = []
  walk(join(root, 'src'), files)
  const out = new Map<string, DocEntry>()
  for (const file of files) {
    const code = readFileSync(file, 'utf8')
    const rel = relative(root, file)
    for (const m of code.matchAll(EXPORT_RE)) out.set(m[1]!, { name: m[1]!, kind: m[2]!, doc: '', file: rel })
    for (const m of code.matchAll(DOC_RE)) {
      const prev = out.get(m[2]!)
      out.set(m[2]!, { name: m[2]!, kind: prev?.kind ?? m[3] ?? 'export', doc: cleanDoc(m[1]!), file: rel })
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function scenarioNames(root: string): { file: string; names: string[] }[] {
  const dir = join(root, 'scenarios')
  if (!existsSync(dir)) return []
  const files: string[] = []
  const walkAll = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walkAll(p)
      else if (/\.test\.ts$/.test(n)) files.push(p)
    }
  }
  walkAll(dir)
  return files.sort().map((f) => ({
    file: relative(root, f),
    names: [...readFileSync(f, 'utf8').matchAll(/scenario(?:\.only|\.skip)?\(\s*(['"`])(.*?)\1/g)].map((m) => m[2]!),
  }))
}

const esc = (s: string) => s.replace(/\|/g, '\\|')
const list = (xs: string[]) => (xs.length ? xs.join(', ') : '–')

/** The generated "This game" section. */
export function renderGameSection(d: AppDescription, docs: DocEntry[], root: string): string {
  const byName = new Map(docs.map((e) => [e.name, e]))
  const L: string[] = []
  L.push(START, '', '## This game', '')
  L.push(`Config: \`mode: '${d.config.mode}'\`, \`fixedHz: ${d.config.fixedHz}\`, \`seed: ${d.config.seed}\`, \`hotReload: ${JSON.stringify(d.config.hotReload)}\`.`)
  L.push(`Plugins: ${d.plugins.join(', ')}.`, '')
  L.push('### Schedule', '', 'Run order inside each phase (from `kiln describe`). Resource access is what one headless step touched.', '')
  for (const p of d.phases) {
    L.push(`**${p.name}**`, '')
    L.push('| # | System | Writes | Reads | Resources | After | File |', '|---|---|---|---|---|---|---|')
    p.systems.forEach((s, i) => {
      const res = [...s.resources.writes.map((r) => `${r} (w)`), ...s.resources.reads]
      const file = byName.get(s.name)?.file ?? '(kiln)'
      L.push(`| ${i + 1} | ${s.name} | ${list(s.writes)} | ${list(s.reads)} | ${list(res)} | ${list(s.after)} | ${file} |`)
    })
    L.push('')
  }
  const own = (kind: string) => docs.filter((e) => e.kind === kind)
  const section = (title: string, items: DocEntry[], extra?: (e: DocEntry) => string) => {
    if (!items.length) return
    L.push(`### ${title}`, '')
    for (const e of items) L.push(`- **${e.name}** (\`${e.file}\`)${extra ? extra(e) : ''}${e.doc ? `: ${esc(e.doc)}` : ''}`)
    L.push('')
  }
  const traitInfo = new Map(d.traits.map((t) => [t.name, t]))
  section('Traits', own('trait'), (e) => {
    const t = traitInfo.get(e.name)
    if (!t) return ''
    if (t.storage === 'tag') return ' tag'
    if (t.fields) return ` \`{ ${Object.entries(t.fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} }\``
    return ` ${t.storage}`
  })
  section('Relations', own('relation'))
  section('Prefabs', own('prefab'))
  section('Resources', own('resource'))
  section('Events', own('event'))
  section('Systems', own('system'))
  section('Plugins', own('plugin'))
  const helpers = docs.filter((e) => !['trait', 'relation', 'prefab', 'resource', 'event', 'system', 'plugin'].includes(e.kind) && e.doc)
  section('Other exports', helpers)
  const sc = scenarioNames(root)
  if (sc.length) {
    L.push('### Scenarios', '')
    for (const f of sc) L.push(`- \`${f.file}\`: ${f.names.map((n) => `“${n}”`).join(', ')}`)
    L.push('')
  }
  L.push(END, '')
  return L.join('\n')
}

/** The framework guide that opens a new AGENTS.md. */
export function guideText(): string {
  return readFileSync(resolve(new URL('.', import.meta.url).pathname, '../../docs/agents-guide.md'), 'utf8')
}

/** Builds the full AGENTS.md text, keeping anything above the generated marker. */
export function renderAgents(existing: string | null, generated: string): string {
  const head = existing && existing.includes(START) ? existing.slice(0, existing.indexOf(START)) : guideText().trimEnd() + '\n\n'
  return head + generated
}

/** kiln docs [--check] [--guide]: writes AGENTS.md (guide + generated game section). */
export default async function docs(args: Args, root: string): Promise<number> {
  const game = await loadGame(root)
  const app = await buildApp(game)
  let d: AppDescription
  try {
    app.build()
    app.step(1)
    d = app.describe()
  } finally {
    app.dispose()
  }
  const path = join(root, 'AGENTS.md')
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null
  const generated = renderGameSection(d, collectDocs(root), root)
  const next = renderAgents(args.guide ? null : existing, generated)
  if (args.check) {
    const fresh = existing === next
    if (args.json) console.log(JSON.stringify({ fresh }))
    else console.log(fresh ? 'ok AGENTS.md is up to date' : 'stale AGENTS.md differs from the code. Run `kiln docs`.')
    return fresh ? 0 : 1
  }
  writeFileSync(path, next)
  const missing = collectDocs(root).filter((e) => !e.doc && ['trait', 'system', 'plugin', 'resource', 'event', 'prefab'].includes(e.kind))
  if (args.json) console.log(JSON.stringify({ written: path, undocumented: missing.map((m) => m.name) }))
  else {
    console.log(`ok wrote ${relative(process.cwd(), path) || path}`)
    for (const m of missing) console.log(`note ${m.file}: ${m.name} has no JSDoc; add /** ... */ above the export.`)
  }
  return 0
}
