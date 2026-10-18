/**
 * Vite plugin: `export default defineConfig({ plugins: [kiln()] })`.
 *
 * - Names transform, so systems and traits are named after their exports.
 * - Hot reload. A module that only defines systems swaps those systems in place (the world is
 *   kept). Any other change reaches the entry module, and the browser runtime then follows
 *   kiln.config.ts `hotReload`: 'snapshot' rebuilds the app and restores the last snapshot,
 *   'keep' and false reload the page.
 * - `/__kiln/shot` serves the page `kiln shot` screenshots: the game's index.html (its styles and
 *   markup) with its module scripts swapped for the shot runner.
 * - `POST /__kiln/recording?name=x` writes a session recording (F8 in the game) to recordings/x.json.
 * - Dedupes three and koota, so a game that installs kiln from outside its own node_modules (a
 *   file: or linked checkout) still shares one copy with it. Two copies of three break WebGPU
 *   lights ("Light node not found"); two copies of koota split traits between worlds.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { addNames } from './names.ts'

/** This package's src folder; its files are named but never hot-swapped. */
const KILN_SRC = resolve(new URL('..', import.meta.url).pathname)

const FACTORY_RE = /^[ \t]*(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*(?::[^=\n]+)?=\s*(?:[\w$]+\.)?(system|trait|resource|event|prefab|plugin|relation)\s*(?:<[^\n]*?>)?\s*\(/gm

/** Kiln factory kinds a module defines at its top level. */
export function factoryKinds(code: string): string[] {
  return [...code.matchAll(FACTORY_RE)].map((m) => m[1]!)
}

export interface KilnViteOptions {
  /** Game entry, relative to the Vite root. Default 'src/main.ts'. */
  entry?: string
}

const HOT_SYSTEMS = `
if (import.meta.hot) {
  import.meta.hot.accept((mod) => { if (mod) globalThis.__kiln_hot_systems?.(mod) })
}
`
const HOT_ENTRY = `
if (import.meta.hot) {
  import.meta.hot.accept((mod) => { if (mod) globalThis.__kiln_hot_main?.(mod) })
}
`

const MODULE_SCRIPT_RE = /<script\b[^>]*\btype\s*=\s*["']?module["']?[^>]*>[\s\S]*?<\/script\s*>/gi

/**
 * The shot page: the game's own index.html when it has one, so its CSS and HUD markup are in the
 * shot, with its module scripts (the boot entry) replaced by the shot runner.
 */
export function shotPage(entry: string, indexHtml?: string): string {
  const runner = `<script type="module">
import { shot } from 'kiln-ecs/browser'
import main from '/${entry}'
shot(main, document.querySelector('canvas'))
</script>`
  if (indexHtml) {
    const page = indexHtml.replace(MODULE_SCRIPT_RE, '')
    return /<\/body\s*>/i.test(page) ? page.replace(/<\/body\s*>/i, `${runner}</body>`) : page + runner
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>kiln shot</title>
<style>html,body{margin:0;background:#000}canvas{display:block}</style></head>
<body><canvas id="kiln"></canvas>
${runner}</body></html>`
}

export function kiln(options: KilnViteOptions = {}): Plugin {
  let root = process.cwd()
  let entryAbs = ''
  const entry = options.entry ?? 'src/main.ts'
  let server: ViteDevServer | undefined
  return {
    name: 'kiln',
    enforce: 'pre',
    config() {
      return { resolve: { dedupe: ['three', 'koota'] } }
    },
    configResolved(c) {
      root = c.root
      entryAbs = resolve(root, entry)
    },
    configureServer(s) {
      server = s
      s.middlewares.use((req, res, next) => {
        if (req.method !== 'POST' || !req.url?.startsWith('/__kiln/recording')) return next()
        const name = new URL(req.url, 'http://x').searchParams.get('name') ?? 'session'
        const safe = name.replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '').slice(0, 80) || 'session'
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8')
            JSON.parse(body)
            mkdirSync(resolve(root, 'recordings'), { recursive: true })
            const path = `recordings/${safe}.json`
            writeFileSync(resolve(root, path), body)
            s.config.logger.info(`[kiln] saved ${path}`)
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ path }))
          } catch (err) {
            res.statusCode = 400
            res.end(String(err))
          }
        })
      })
      s.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__kiln/shot')) return next()
        let index: string | undefined
        try {
          index = readFileSync(resolve(root, 'index.html'), 'utf8')
        } catch {}
        const html = await s.transformIndexHtml(req.url, shotPage(entry, index))
        res.setHeader('content-type', 'text/html')
        res.end(html)
      })
    },
    transform(code, id) {
      const file = id.split('?')[0]!
      if (!/\.[cm]?[jt]sx?$/.test(file)) return null
      const inKiln = file.startsWith(KILN_SRC)
      if (file.includes('/node_modules/') && !inKiln) return null
      const named = addNames(code)
      let out = named ?? code
      if (server && !inKiln) {
        const kinds = factoryKinds(code)
        if (file === entryAbs) out += HOT_ENTRY
        else if (kinds.length > 0 && kinds.every((k) => k === 'system')) out += HOT_SYSTEMS
      }
      return out === code ? null : { code: out, map: null }
    },
    handleHotUpdate(ctx) {
      const file = ctx.file
      if (!/\.[cm]?[jt]sx?$/.test(file) || file === entryAbs) return
      let code = ''
      try {
        code = readFileSync(file, 'utf8')
      } catch {
        return
      }
      const kinds = factoryKinds(code)
      if (kinds.length > 0 && kinds.every((k) => k === 'system')) return // self-accepts
      // Anything else: invalidate the chain up to the entry and let the entry decide.
      const graph = ctx.server.moduleGraph
      const entryMod = graph.getModuleById(entryAbs)
      if (!entryMod) return
      const seen = new Set<unknown>()
      const stack = [...ctx.modules]
      while (stack.length) {
        const m = stack.pop()!
        if (seen.has(m)) continue
        seen.add(m)
        graph.invalidateModule(m, new Set(), ctx.timestamp, true)
        for (const imp of m.importers) stack.push(imp)
      }
      return [entryMod]
    },
  }
}

export default kiln
