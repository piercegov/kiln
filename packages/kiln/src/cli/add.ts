import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Args } from './args.ts'
import { KilnError } from '../core/errors.ts'

export interface CommunityPlugin {
  name: string
  description: string
  files: string[]
  requires?: string[]
  dir: string
}

/** Where community plugins live: kiln's own community/ folder, plus KILN_PLUGIN_PATH entries. */
export function registryDirs(): string[] {
  const own = resolve(new URL('.', import.meta.url).pathname, '../../community')
  const extra = (process.env.KILN_PLUGIN_PATH ?? '').split(':').filter(Boolean)
  return [own, ...extra].filter((d) => existsSync(d))
}

export function listPlugins(): CommunityPlugin[] {
  const out: CommunityPlugin[] = []
  for (const dir of registryDirs()) {
    for (const name of readdirSync(dir).sort()) {
      const manifest = join(dir, name, 'kiln-plugin.json')
      if (!existsSync(manifest)) continue
      const m = JSON.parse(readFileSync(manifest, 'utf8'))
      out.push({ name: m.name ?? name, description: m.description ?? '', files: m.files ?? ['index.ts'], requires: m.requires ?? [], dir: join(dir, name) })
    }
  }
  return out
}

/**
 * kiln add <name> [--force] | --list
 * Copies a community plugin's source into src/plugins/<name>/ so it can be read and edited, instead
 * of installing a black box. Prints the line to add to src/main.ts.
 */
export default async function add(args: Args, root: string): Promise<number> {
  const plugins = listPlugins()
  if (args.list || args._.length === 0) {
    if (args.json) console.log(JSON.stringify(plugins.map(({ name, description }) => ({ name, description }))))
    else for (const p of plugins) console.log(`${p.name.padEnd(16)} ${p.description}`)
    return args._.length === 0 && !args.list ? 1 : 0
  }
  const results: { name: string; dest: string; use: string | null }[] = []
  for (const name of args._) {
    const p = plugins.find((x) => x.name === name)
    if (!p) {
      throw new KilnError('unknown-plugin', `No community plugin "${name}". Available: ${plugins.map((x) => x.name).join(', ')}.`)
    }
    const dest = join(root, 'src/plugins', p.name)
    if (existsSync(dest) && !args.force) {
      throw new KilnError('plugin-exists', `src/plugins/${p.name} already exists. It is yours to edit; pass --force to overwrite it.`)
    }
    mkdirSync(dest, { recursive: true })
    for (const f of p.files) cpSync(join(p.dir, f), join(dest, f), { recursive: true })
    const src = readFileSync(join(p.dir, 'index.ts'), 'utf8')
    const pluginExport = src.match(/export const (\w+Plugin)\s*=/)?.[1] ?? null
    results.push({ name: p.name, dest: relative(root, dest), use: pluginExport })
  }
  if (args.json) console.log(JSON.stringify({ added: results }))
  else {
    for (const r of results) {
      console.log(`ok copied ${r.name} to ${r.dest}/`)
      if (r.use) console.log(`next in src/main.ts: import { ${r.use} } from './plugins/${r.name}/index.ts' and add .use(${r.use})`)
    }
  }
  return 0
}
