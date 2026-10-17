import { $internal, type Entity, type Trait } from 'koota'
import type { App } from '../../core/app.ts'
import { traitName } from '../../core/names.ts'
import { plugin, type Plugin } from '../../core/plugin.ts'
import { PHASES } from '../../core/schedule.ts'
import { Renderer } from '../render/index.ts'

export interface DebugOptions {
  /** Start with the panel open. Default true. Toggle with the ` key. */
  open?: boolean
  /** Turn the panel on outside dev builds too. Default false. */
  force?: boolean
}

const ENTITY_ID_MASK = (1 << 20) - 1

/**
 * Tweakpane inspector for dev builds: FPS, frame and tick, per-system timings, an entity
 * inspector with editable fields, resource values, pause/step and snapshot-to-console.
 * Toggle with the ` key; `?debug=0` hides it. Does nothing headless or in production.
 */
export function debugPlugin(options: DebugOptions = {}): Plugin {
  return plugin((app) => {
    app.hooks.start.push(async () => {
      if (typeof document === 'undefined') return
      if (!app.dev && !options.force) return
      const q = new URLSearchParams(location.search)
      if (q.get('debug') === '0' || location.pathname.startsWith('/__kiln/shot')) return
      app.profile = true
      const { Pane } = await import('tweakpane')
      const host = document.createElement('div')
      host.id = 'kiln-debug'
      host.style.cssText = 'position:fixed;top:8px;right:8px;width:300px;max-height:calc(100vh - 16px);overflow-y:auto;z-index:9999'
      document.body.appendChild(host)
      const ui = new DebugUI(app, new Pane({ title: 'Kiln', expanded: options.open ?? true, container: host }), host)
      app.hooks.dispose.push(() => ui.dispose())
    })
  }, 'DebugPlugin')
}

/** The debug panel. Dev builds only. */
export const DebugPlugin = debugPlugin()

class DebugUI {
  private stats = { fps: 0, ms: 0, frame: 0, tick: 0, entities: 0, backend: '-' }
  private systems: Record<string, number> = {}
  private resources = { json: '' }
  private inspect = { id: 1 }
  private timer: ReturnType<typeof setInterval>
  private graphTimer: ReturnType<typeof setInterval>
  private graph: FpsGraph
  private gFrame = 0
  private gTime = performance.now()
  private entityFolder: any
  private onKey: (e: KeyboardEvent) => void
  private lastFrame = 0
  private lastTime = performance.now()

  constructor(
    private app: App,
    private pane: any,
    private host: HTMLElement,
  ) {
    const f = pane.addFolder({ title: 'Stats' })
    this.graph = new FpsGraph()
    const content = (f.element as HTMLElement).querySelector('.tp-fldv_c') ?? f.element
    content.prepend(this.graph.el)
    f.addBinding(this.stats, 'fps', { readonly: true, format: (v: number) => v.toFixed(0) })
    f.addBinding(this.stats, 'ms', { readonly: true, label: 'frame ms', format: (v: number) => v.toFixed(2) })
    for (const k of ['frame', 'tick', 'entities'] as const) f.addBinding(this.stats, k, { readonly: true, format: (v: number) => v.toFixed(0) })
    f.addBinding(this.stats, 'backend', { readonly: true })

    const ctl = pane.addFolder({ title: 'Control' })
    const pauseBtn = ctl.addButton({ title: 'Pause' })
    pauseBtn.on('click', () => {
      app.paused = !app.paused
      pauseBtn.title = app.paused ? 'Resume' : 'Pause'
    })
    ctl.addButton({ title: 'Step 1 frame' }).on('click', () => {
      app.paused = true
      pauseBtn.title = 'Resume'
      app.step(1)
      app.render()
    })
    ctl.addButton({ title: 'Snapshot → console' }).on('click', () => {
      const snap = app.snapshot({ resources: true, precision: 4 })
      console.log('[kiln] snapshot', snap)
      void navigator.clipboard?.writeText(JSON.stringify(snap, null, 2)).catch(() => {})
    })

    // Frame pacing, remembered per browser.
    try {
      const saved = JSON.parse(localStorage.getItem('kiln.frameRate') ?? 'null')
      if (saved && typeof saved.vsync === 'boolean') Object.assign(app.frameRate, { vsync: saved.vsync, maxFps: Number(saved.maxFps) || 0 })
    } catch {}
    const save = () => {
      try {
        localStorage.setItem('kiln.frameRate', JSON.stringify(app.frameRate))
      } catch {}
    }
    ctl.addBinding(app.frameRate, 'vsync').on('change', save)
    ctl
      .addBinding(app.frameRate, 'maxFps', {
        label: 'fps cap',
        options: { off: 0, '30': 30, '60': 60, '120': 120, '144': 144, '240': 240, '500': 500 },
      })
      .on('change', save)

    const sys = pane.addFolder({ title: 'Systems (ms)', expanded: false })
    for (const p of PHASES) {
      for (const cs of app.systemsIn(p)) {
        const key = `${p.name}/${cs.name}`
        this.systems[key] = 0
        sys.addBinding(this.systems, key, { readonly: true, format: (v: number) => v.toFixed(3) })
      }
    }

    const ent = pane.addFolder({ title: 'Entity', expanded: false })
    ent.addBinding(this.inspect, 'id', { step: 1, min: 0 }).on('change', () => this.buildEntity())
    this.entityFolder = ent.addFolder({ title: 'traits' })
    this.buildEntity()

    const res = pane.addFolder({ title: 'Resources', expanded: false })
    res.addBinding(this.resources, 'json', { readonly: true, multiline: true, rows: 10 })

    this.onKey = (e: KeyboardEvent) => {
      if (e.code === 'Backquote') host.style.display = host.style.display === 'none' ? '' : 'none'
    }
    window.addEventListener('keydown', this.onKey)
    this.timer = setInterval(() => this.refresh(), 250)
    this.graphTimer = setInterval(() => {
      const now = performance.now()
      const frames = app.time.frame - this.gFrame
      if (now > this.gTime) this.graph.push((frames * 1000) / (now - this.gTime))
      this.gFrame = app.time.frame
      this.gTime = now
    }, 100)
  }

  private entityById(id: number): Entity | undefined {
    for (const e of this.app.world.query()) if (((e as number) & ENTITY_ID_MASK) === id) return e
    return undefined
  }

  private shownEntity: Entity | undefined

  private buildEntity(): void {
    for (const c of [...this.entityFolder.children]) this.entityFolder.remove(c)
    const e = this.entityById(this.inspect.id)
    this.shownEntity = e
    if (e === undefined) {
      this.entityFolder.title = 'no such entity'
      return
    }
    this.entityFolder.title = `entity ${this.inspect.id}`
    const traits = this.app.world[$internal].entityTraits.get(e) as Set<Trait> | undefined
    for (const t of traits ?? []) {
      const name = traitName(t)
      const type = (t[$internal] as any).type
      if (type !== 'soa') {
        this.entityFolder.addBlade({ view: 'text', label: name, parse: (v: string) => v, value: type === 'tag' ? 'tag' : 'object' })
        continue
      }
      const rec = { ...(e.get(t) as Record<string, unknown>) }
      const folder = this.entityFolder.addFolder({ title: name })
      for (const [k, v] of Object.entries(rec)) {
        if (typeof v !== 'number' && typeof v !== 'boolean' && typeof v !== 'string') continue
        folder.addBinding(rec, k).on('change', (ev: { value: unknown }) => {
          if (this.app.world.has(e)) e.set(t, { [k]: ev.value } as never)
        })
      }
      ;(folder as any).__sync = () => {
        if (!this.app.world.has(e)) return
        Object.assign(rec, e.get(t))
        folder.refresh()
      }
    }
  }

  private refresh(): void {
    const app = this.app
    const now = performance.now()
    const frames = app.time.frame - this.lastFrame
    this.stats.fps = (frames * 1000) / Math.max(1, now - this.lastTime)
    this.stats.ms = frames > 0 ? Math.min(50, (now - this.lastTime) / frames) : 50
    this.lastFrame = app.time.frame
    this.lastTime = now
    this.stats.frame = app.time.frame
    this.stats.tick = app.time.tick
    this.stats.entities = app.world.query().length
    this.stats.backend = app.hasResource(Renderer) ? (app.resource(Renderer).backend ?? '-') : '-'
    for (const p of PHASES) for (const cs of app.systemsIn(p)) this.systems[`${p.name}/${cs.name}`] = cs.timing.avg
    try {
      this.resources.json = JSON.stringify(app.snapshot({ traits: [], resources: true, precision: 3 }).resources, null, 1)
    } catch {}
    // Entities come and go (startup, despawns): rebuild when the shown one changed.
    const e = this.entityById(this.inspect.id)
    if (e !== this.shownEntity) this.buildEntity()
    else for (const c of this.entityFolder.children) (c as any).__sync?.()
    this.pane.refresh()
  }

  dispose(): void {
    clearInterval(this.timer)
    clearInterval(this.graphTimer)
    window.removeEventListener('keydown', this.onKey)
    this.pane.dispose()
    this.host.remove()
  }
}

/**
 * FPS over the last 12 seconds. The y range follows the window: top is the max +10%, bottom the
 * min −10%, both labelled, so small swings are visible at 30 fps and at 1000+ fps alike.
 */
class FpsGraph {
  readonly el: HTMLDivElement
  private canvas: HTMLCanvasElement
  private samples: number[] = []
  private readonly size = 120

  constructor() {
    this.el = document.createElement('div')
    this.el.style.cssText = 'padding:4px 4px 2px'
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'display:block;width:100%;height:72px;border-radius:2px;background:rgba(0,0,0,.25)'
    this.el.appendChild(this.canvas)
  }

  push(fps: number): void {
    this.samples.push(fps)
    if (this.samples.length > this.size) this.samples.shift()
    this.draw()
  }

  private draw(): void {
    const c = this.canvas
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(c.clientWidth * dpr))
    const h = Math.max(1, Math.round(c.clientHeight * dpr))
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
    }
    const g = c.getContext('2d')
    if (!g || this.samples.length === 0) return
    let lo = Math.min(...this.samples)
    let hi = Math.max(...this.samples)
    lo *= 0.9
    hi *= 1.1
    if (hi - lo < 1) {
      lo -= 0.5
      hi += 0.5
    }
    g.clearRect(0, 0, w, h)
    const labelW = 34 * dpr
    const plotW = w - labelW
    const y = (v: number) => h - ((v - lo) / (hi - lo)) * h
    // Line, newest on the right.
    g.strokeStyle = '#7ee787'
    g.lineWidth = 1.5 * dpr
    g.beginPath()
    const n = this.samples.length
    this.samples.forEach((v, i) => {
      const x = labelW + plotW * ((this.size - n + i) / (this.size - 1))
      if (i === 0) g.moveTo(x, y(v))
      else g.lineTo(x, y(v))
    })
    g.stroke()
    // Bound labels and guide lines.
    g.fillStyle = 'rgba(200,205,215,.85)'
    g.font = `${10 * dpr}px ui-monospace, monospace`
    g.textBaseline = 'top'
    g.fillText(hi.toFixed(0), 2 * dpr, 2 * dpr)
    g.textBaseline = 'bottom'
    g.fillText(lo.toFixed(0), 2 * dpr, h - 2 * dpr)
    g.strokeStyle = 'rgba(255,255,255,.08)'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(labelW, 0.5)
    g.lineTo(w, 0.5)
    g.moveTo(labelW, h - 0.5)
    g.lineTo(w, h - 0.5)
    g.stroke()
  }
}
