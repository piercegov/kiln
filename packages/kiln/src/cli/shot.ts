import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Args } from './args.ts'
import { num } from './args.ts'
import { KilnError } from '../core/errors.ts'
import { asRecording, type Recording } from '../core/recording.ts'
import type { ScriptEvent } from '../core/input-types.ts'

/** Finds a Chromium for Playwright: its own registry first, then any cached build. */
export function findChromium(chromium: { executablePath(): string }): string | undefined {
  try {
    const p = chromium.executablePath()
    if (p && existsSync(p)) return p
  } catch {}
  const env = process.env.KILN_CHROMIUM ?? process.env.CHROME_PATH
  if (env && existsSync(env)) return env
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), '.cache/ms-playwright'), '/opt/pw-browsers'].filter(Boolean) as string[]
  for (const root of roots) {
    if (!existsSync(root)) continue
    const dirs = readdirSync(root).filter((d) => d.startsWith('chromium')).sort().reverse()
    for (const d of dirs) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-linux/headless_shell', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
        const p = join(root, d, rel)
        if (existsSync(p)) return p
      }
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) if (existsSync(p)) return p
  return undefined
}

/** What the shot page reads from window.__KILN_SHOT__ before it builds the app. */
export interface ShotPlan {
  /** URL of a module whose default export runs on the app after Startup: `(app) => void | Promise<void>`. */
  setup?: string
  /** Input script queued after setup, before the steps (frame 1 = the first step). */
  input?: ScriptEvent[]
  /** A recording to replay from boot, up to `until` (default: its end), before the steps. */
  recording?: Recording
  until?: number
}

function readJson(root: string, flag: string, value: string): unknown {
  const inline = value.trimStart()
  if (inline.startsWith('[') || inline.startsWith('{')) return JSON.parse(value)
  const path = resolve(root, value)
  if (!existsSync(path)) throw new KilnError('shot-file', `kiln shot --${flag}: no file at ${path}. Pass a path relative to the game folder${flag === 'input' ? ', or inline JSON' : ''}.`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Builds the shot plan from --setup, --input, --recording and --until. */
export function shotPlan(args: Args, root: string): ShotPlan {
  const plan: ShotPlan = {}
  if (typeof args.setup === 'string') {
    const path = resolve(root, args.setup)
    if (!existsSync(path)) {
      throw new KilnError('shot-file', `kiln shot --setup: no file at ${path}. Pass a module whose default export is (app) => void, e.g. --setup shots/boss.ts.`)
    }
    plan.setup = `/@fs/${path.replace(/\\/g, '/').replace(/^\/+/, '')}`
  }
  if (typeof args.input === 'string') {
    const input = readJson(root, 'input', args.input)
    if (!Array.isArray(input)) {
      throw new KilnError('bad-script', 'kiln shot --input takes an input script: a JSON array like [{"frame":1,"tap":"jump"}] (inline or a file).')
    }
    plan.input = input as ScriptEvent[]
  }
  if (typeof args.recording === 'string') {
    if (args.seed !== undefined) throw new KilnError('shot-seed', 'kiln shot --recording replays with the seed the recording ran with; drop --seed.')
    plan.recording = asRecording(readJson(root, 'recording', args.recording), args.recording)
    if (args.until !== undefined) plan.until = num(args.until, plan.recording.frames)
  }
  return plan
}

/**
 * kiln shot [--steps 60] [--seed S] [--setup file.ts] [--input script.json|'[...]']
 *           [--recording rec.json [--until N]] [--width 800] [--height 600] [--webgl] [out.png]
 * Serves the game with Vite, opens /__kiln/shot in headless Chromium (Playwright), boots the game,
 * replays the recording (if any), runs the setup module, queues the input script, runs N steps,
 * renders one frame and saves the canvas. Prints one JSON line (or text) with the result and any
 * console errors.
 */
export default async function shot(args: Args, root: string): Promise<number> {
  const out = resolve(root, args._[0] ?? 'shot.png')
  const plan = shotPlan(args, root)
  // After a recording, the shot shows where it ended unless --steps asks for more.
  const steps = num(args.steps, plan.recording ? 0 : 60)
  const width = num(args.width, 800)
  const height = num(args.height, 600)
  const { createServer } = await import('vite')
  const { kiln } = await import('../tooling/vite.ts')
  const hasConfig = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'].some((f) => existsSync(join(root, f)))
  const server = await createServer({
    root,
    configFile: hasConfig ? undefined : false,
    plugins: hasConfig ? [] : [kiln()],
    logLevel: 'error',
    server: { port: 0, host: '127.0.0.1', hmr: false },
    clearScreen: false,
  })
  await server.listen()
  const addr = server.httpServer?.address()
  const port = typeof addr === 'object' && addr ? addr.port : 5173
  const { chromium } = await import('playwright-core')
  const executablePath = findChromium(chromium)
  if (!executablePath) {
    await server.close()
    throw new KilnError(
      'no-chromium',
      'kiln shot needs Chromium. Run `bunx playwright install chromium`, or set KILN_CHROMIUM to a Chrome/Chromium binary.',
    )
  }
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  })
  const errors: string[] = []
  const warnings: string[] = []
  try {
    const page = await browser.newPage({ viewport: { width, height } })
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
      else if (m.type() === 'warning') warnings.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    await page.addInitScript((p) => ((window as any).__KILN_SHOT__ = p), plan)
    const q = new URLSearchParams({ steps: String(steps), width: String(width), height: String(height) })
    if (args.seed !== undefined) q.set('seed', String(num(args.seed, 0)))
    if (args.webgl) q.set('webgl', '1')
    await page.goto(`http://127.0.0.1:${port}/__kiln/shot?${q}`)
    await page.waitForFunction(() => (window as any).__kilnShot, null, { timeout: num(args.timeout, 60000) })
    const result = (await page.evaluate(() => (window as any).__kilnShot)) as { ok: boolean; tick?: number; backend?: string; error?: string; code?: string }
    // A page clip over the canvas, so HUD elements drawn over it are in the shot too.
    const box = result.ok ? await page.locator('canvas').first().boundingBox() : null
    if (box) await page.screenshot({ path: out, clip: box })
    else await page.screenshot({ path: out })
    const report = { ...result, out, steps, errors, warnings }
    if (args.json) console.log(JSON.stringify(report))
    else {
      console.log(result.ok ? `ok ${out} tick=${result.tick} backend=${result.backend}` : `error ${result.code ?? 'shot'}: ${result.error}`)
      for (const e of errors) console.log(`console-error ${e}`)
      for (const w of warnings) console.log(`console-warning ${w}`)
    }
    return result.ok ? 0 : 1
  } finally {
    await browser.close()
    await server.close()
  }
}
