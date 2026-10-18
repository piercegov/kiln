/**
 * Browser runtime: `boot(main)` builds the app from the game's entry function, starts it on a
 * canvas, shows Kiln errors in an overlay, and handles hot reload.
 */
import type { App } from './core/app.ts'
import { isSystem, type System } from './core/system.ts'
import { PHASES } from './core/schedule.ts'
import type { Snapshot } from './core/snapshot.ts'
import { Recorder, type Recording } from './core/recording.ts'
import { Renderer } from './plugins/render/index.ts'

export type MainFn = () => App | Promise<App>

declare global {
  // eslint-disable-next-line no-var
  var __kiln_app: App | undefined
  /** Saves the session recording to recordings/ (dev server) and resolves to its path. F8 does the same. */
  // eslint-disable-next-line no-var
  var __kiln_save_recording: ((name?: string) => Promise<string | null>) | undefined
}

let toastEl: HTMLDivElement | null = null
function toast(text: string): void {
  console.info(`[kiln] ${text}`)
  if (typeof document === 'undefined') return
  toastEl?.remove()
  const el = (toastEl = document.createElement('div'))
  el.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:99998;background:rgba(10,12,16,.85);color:#e8eef8;font:13px/1.4 ui-monospace,monospace;padding:6px 10px;border-radius:6px;pointer-events:none'
  el.textContent = text
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 4000)
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
}

/**
 * Sends a recording to the dev server, which writes recordings/<name>.json in the game folder.
 * Without a dev server (a production build), the browser downloads the file instead.
 */
async function storeRecording(rec: Recording, name: string): Promise<string> {
  const body = JSON.stringify(rec)
  try {
    const res = await fetch(`/__kiln/recording?name=${encodeURIComponent(name)}`, { method: 'POST', body })
    if (res.ok) return ((await res.json()) as { path: string }).path
  } catch {
    // No dev server: fall through to a download.
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
  a.download = `${name}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  return `${name}.json (downloaded)`
}

let recorder: Recorder | null = null

/** Dev builds record every session from boot, so F8 or a crash can save a replayable recording. */
function startRecording(app: App): void {
  recorder = null
  if (!app.dev || app.config.record === false || app.isBooted) return
  recorder = new Recorder(app)
  const save = async (name?: string): Promise<string | null> => {
    if (!recorder || globalThis.__kiln_app !== app) {
      toast('Nothing to save: hot reload rebuilt the app, so its session no longer replays from boot. Reload the page to record again.')
      return null
    }
    const rec = recorder.take()
    const path = await storeRecording(rec, name ?? `session-${stamp()}`)
    toast(`Saved ${rec.frames} frames to ${path}. Replay it with \`kiln replay ${path}\`.`)
    return path
  }
  globalThis.__kiln_save_recording = save
  // The first error pauses the loop; save the session that led to it.
  app.hooks.error.push(() => void save(`crash-${stamp()}`))
}

let overlayEl: HTMLDivElement | null = null

/** Shows an error over the canvas. Agents read it with `kiln shot` or the console. */
export function showError(err: unknown): void {
  console.error(err)
  if (typeof document === 'undefined') return
  if (!overlayEl) {
    overlayEl = document.createElement('div')
    overlayEl.id = 'kiln-error'
    overlayEl.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:rgba(20,0,0,.88);color:#ffb4b4;font:14px/1.5 ui-monospace,monospace;padding:24px;white-space:pre-wrap;overflow:auto'
    overlayEl.onclick = () => clearError()
    document.body.appendChild(overlayEl)
  }
  const e = err as { code?: string; message?: string; stack?: string }
  overlayEl.textContent = `${e?.code ? `KilnError ${e.code}\n` : ''}${e?.message ?? String(err)}\n\n${e?.stack ?? ''}\n\n(click to dismiss)`
}

export function clearError(): void {
  overlayEl?.remove()
  overlayEl = null
}

function ensureCanvas(canvas?: HTMLCanvasElement | null): HTMLCanvasElement {
  if (canvas) return canvas
  const found = document.querySelector('canvas')
  if (found) return found
  const c = document.createElement('canvas')
  c.style.cssText = 'display:block;width:100vw;height:100vh'
  document.body.style.margin = '0'
  document.body.appendChild(c)
  return c
}

function systemsByName(app: App): Map<string, System> {
  const out = new Map<string, System>()
  for (const p of PHASES) for (const cs of app.systemsIn(p)) out.set(cs.name, cs.system)
  return out
}

/** Starts the game in the browser and wires up hot reload. Returns the running app. */
export async function boot(main: MainFn, canvasArg?: HTMLCanvasElement | null): Promise<App | undefined> {
  const canvas = ensureCanvas(canvasArg)
  window.addEventListener('error', (e) => showError(e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => showError(e.reason))
  let app: App
  try {
    app = await main()
    globalThis.__kiln_app = app
    app.hooks.error.push(showError)
    startRecording(app)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F8' && !e.repeat) {
        e.preventDefault()
        void globalThis.__kiln_save_recording?.()
      }
    })
    await app.start(canvas)
  } catch (err) {
    showError(err)
    return undefined
  }

  // A module that only defines systems changed: swap them in place, keep the world.
  ;(globalThis as any).__kiln_hot_systems = (mod: Record<string, unknown>) => {
    const current = globalThis.__kiln_app
    if (!current) return
    if (current.config.hotReload === false) return location.reload()
    const byName = systemsByName(current)
    try {
      for (const [name, value] of Object.entries(mod)) {
        if (!isSystem(value)) continue
        const old = byName.get(value.name) ?? byName.get(name)
        if (old && old !== value) {
          current.replaceSystem(old, value)
          recorder?.addNote(`hot-swapped system ${value.name}; replays run the new code from frame 1`)
        }
      }
      clearError()
      current.paused = false
      console.info('[kiln] hot-swapped systems; world kept')
    } catch (err) {
      showError(err)
    }
  }

  // The entry (or a trait/prefab/resource module) changed.
  ;(globalThis as any).__kiln_hot_main = async (mod: { default?: MainFn }) => {
    const current = globalThis.__kiln_app
    if (!current || current.config.hotReload !== 'snapshot' || typeof mod.default !== 'function') {
      return location.reload()
    }
    let snap: Snapshot
    try {
      snap = current.snapshot({ refs: true, resources: true })
    } catch (err) {
      showError(err)
      return
    }
    try {
      const next = await mod.default()
      next.hooks.error.push(showError)
      current.dispose()
      globalThis.__kiln_app = next
      recorder = null
      await next.start(canvas, { startup: false })
      const { missingTraits } = next.restore(snap)
      if (missingTraits.length) console.warn(`[kiln] snapshot traits no longer exist: ${missingTraits.join(', ')}`)
      clearError()
      console.info('[kiln] rebuilt app and restored snapshot')
    } catch (err) {
      showError(err)
    }
  }
  return app
}

/**
 * The page `kiln shot` loads: build headlessly-deterministic, step N frames, render one frame,
 * then signal Playwright. Params come from the query string: steps, seed, webgl.
 */
export async function shot(main: MainFn, canvas: HTMLCanvasElement): Promise<void> {
  const q = new URLSearchParams(location.search)
  const steps = Number(q.get('steps') ?? 60)
  const w = Number(q.get('width') ?? 800)
  const h = Number(q.get('height') ?? 600)
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  const g = window as any
  try {
    if (q.has('seed')) g.__KILN_OVERRIDES__ = { seed: Number(q.get('seed')) }
    const app = await main()
    g.__kiln_app = app
    await app.start(canvas, { loop: false })
    // Assets requested in Startup load before the steps, as in scenarios, so the frame is deterministic.
    await app.idle()
    // Simulate without drawing, then draw once: the renderer uploads some per-frame data (instance
    // colours) only once per browser frame, so many renders in one frame would lose updates.
    app.headless = true
    app.step(steps)
    app.headless = false
    // Assets requested during the steps (sprite sheets, models) land before the one draw.
    await app.idle()
    app.render()
    // Wait for the GPU to finish the frame before the screenshot.
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    const state = app.resource(Renderer)
    g.__kilnShot = { ok: true, tick: app.time.tick, backend: state.backend }
  } catch (err) {
    showError(err)
    g.__kilnShot = { ok: false, error: (err as Error)?.message ?? String(err), code: (err as any)?.code }
  }
}
