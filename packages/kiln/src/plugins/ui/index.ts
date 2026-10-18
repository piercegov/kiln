import type { App } from '../../core/app.ts'
import { KilnError } from '../../core/errors.ts'
import { event } from '../../core/event.ts'
import { plugin } from '../../core/plugin.ts'
import { resource } from '../../core/resource.ts'
import { InputPhase, Render } from '../../core/schedule.ts'
import { system } from '../../core/system.ts'
import { Input } from '../input/index.ts'

/** Where on screen an element sits. Elements with the same anchor stack in `order`. */
export type Anchor = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right'

const ANCHORS: readonly Anchor[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right']

export interface UiOptions {
  /** Default 'top-left'. */
  anchor?: Anchor
  /** Font size in CSS pixels. Default 20 (buttons 22). */
  size?: number
  /** CSS colour of the text (or a bar's fill). Default '#fff' (bars '#4ade80'). */
  color?: string
  /** Stacking order inside the anchor, low first. Default: creation order. */
  order?: number
  /** false hides the element but keeps it. Default true. */
  visible?: boolean
}

export interface BarOptions extends UiOptions {
  /** Text drawn next to the bar. */
  label?: string
  /** Bar width in CSS pixels. Default 200. */
  width?: number
}

export interface ButtonOptions extends UiOptions {
  /** An input action that also clicks this button while it is visible ('jump', 'pause'...). */
  action?: string
}

/** One HUD element as data. This is what snapshots and tests see. */
export interface UiNode {
  id: string
  kind: 'text' | 'bar' | 'button'
  /** Text, bar label or button label. */
  text: string
  /** Bar fill 0..1. */
  value: number
  anchor: Anchor
  size: number
  color: string
  order: number
  visible: boolean
  width: number
  action: string
}

/** A button was clicked (pointer, its `action`, or `Ui.click(id)` in tests). */
export const UiClick = event<{ id: string }>()

/**
 * The HUD as retained data: `res.mut(Ui).text('score', 'Coins 3')`, `.bar('hp', 0.5)`,
 * `.button('start', 'Start', { anchor: 'center', action: 'jump' })`. Elements stay until removed
 * (`remove(id)`, or `clear('menu.')` for every id with that prefix). Calls with unchanged values
 * cost nothing, so systems may set them every step. Headless the same data exists (tests read
 * `app.res(Ui).get('score')?.text`); in the browser it is drawn as DOM over the canvas.
 */
export class UiState {
  nodes: Record<string, UiNode> = {}
  /** Bumped on every change; the DOM sync skips frames where it didn't move. */
  version = 0
  /** Clicks waiting to become UiClick events. */
  clicks: string[] = []
  private nextOrder = 0

  /** Sets a text element. */
  text(id: string, text: string | number, options: UiOptions = {}): void {
    this.put(id, 'text', { ...options, text: String(text) })
  }

  /** Sets a progress bar: `value` 0..1 (clamped). */
  bar(id: string, value: number, options: BarOptions = {}): void {
    const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
    this.put(id, 'bar', { ...options, value: v, text: options.label ?? '' })
  }

  /** Sets a button. Clicking it emits UiClick { id }. */
  button(id: string, label: string, options: ButtonOptions = {}): void {
    this.put(id, 'button', { ...options, text: label })
  }

  /** The element with this id, or undefined. */
  get(id: string): Readonly<UiNode> | undefined {
    return this.nodes[id]
  }

  has(id: string): boolean {
    return id in this.nodes
  }

  /** Shows or hides an element without removing it. */
  show(id: string, visible = true): void {
    const n = this.nodes[id]
    if (!n || n.visible === visible) return
    n.visible = visible
    this.version++
  }

  /** Removes an element. Removing a missing id is a no-op. */
  remove(id: string): void {
    if (!(id in this.nodes)) return
    delete this.nodes[id]
    this.version++
  }

  /** Removes every element whose id starts with `prefix` (all of them with no prefix). */
  clear(prefix = ''): void {
    let changed = false
    for (const id of Object.keys(this.nodes)) {
      if (!id.startsWith(prefix)) continue
      delete this.nodes[id]
      changed = true
    }
    if (changed) this.version++
  }

  /** Clicks a button as a player would; UiClick is emitted in the next Input phase. */
  click(id: string): void {
    const n = this.nodes[id]
    if (!n || n.kind !== 'button') {
      const buttons = Object.values(this.nodes).filter((x) => x.kind === 'button').map((x) => `'${x.id}'`)
      throw new KilnError('no-button', `Ui.click('${id}'): there is no button '${id}'. Buttons now: ${buttons.join(', ') || 'none'}.`)
    }
    this.clicks.push(id)
  }

  private put(id: string, kind: UiNode['kind'], o: Partial<UiNode> & UiOptions): void {
    if (typeof id !== 'string' || id === '') throw new KilnError('ui-id', 'Ui elements need a non-empty string id: ui.text(\'score\', ...).')
    if (o.anchor !== undefined && !ANCHORS.includes(o.anchor)) {
      throw new KilnError('ui-anchor', `Unknown anchor '${o.anchor}'. Use one of: ${ANCHORS.join(', ')}.`)
    }
    const prev = this.nodes[id]
    const next: UiNode = {
      id,
      kind,
      text: o.text ?? '',
      value: o.value ?? 0,
      anchor: o.anchor ?? prev?.anchor ?? 'top-left',
      size: o.size ?? prev?.size ?? (kind === 'button' ? 22 : 20),
      color: o.color ?? prev?.color ?? (kind === 'bar' ? '#4ade80' : '#fff'),
      order: o.order ?? prev?.order ?? this.nextOrder++,
      visible: o.visible ?? prev?.visible ?? true,
      width: (o as BarOptions).width ?? prev?.width ?? 200,
      action: (o as ButtonOptions).action ?? prev?.action ?? '',
    }
    if (prev && sameNode(prev, next)) return
    this.nodes[id] = next
    this.version++
  }

  toJSON() {
    return { nodes: this.nodes }
  }

  restore(json: { nodes: Record<string, UiNode> }): void {
    this.nodes = structuredClone(json.nodes ?? {})
    this.version++
  }
}

function sameNode(a: UiNode, b: UiNode): boolean {
  for (const k in a) if ((a as any)[k] !== (b as any)[k]) return false
  return true
}

export const Ui = resource(() => new UiState()).named('Ui')

/** Turns pointer clicks, button actions and Ui.click() into UiClick events. */
export const UiEvents = system(
  ({ res, events }) => {
    const ui = res.get(Ui)
    const input = res.has(Input) ? res.get(Input) : null
    let clicked: string[] | null = null
    if (ui.clicks.length > 0) {
      clicked = [...ui.clicks]
      res.mut(Ui).clicks.length = 0
    }
    if (input) {
      for (const id in ui.nodes) {
        const n = ui.nodes[id]!
        if (n.kind === 'button' && n.visible && n.action && input.pressed(n.action)) (clicked ??= []).push(id)
      }
    }
    if (clicked) for (const id of clicked) events.emit(UiClick, { id })
  },
  { name: 'UiEvents' },
)

const ANCHOR_CSS: Record<Anchor, string> = {
  'top-left': 'top:12px;left:16px;align-items:flex-start',
  top: 'top:12px;left:50%;transform:translateX(-50%);align-items:center',
  'top-right': 'top:12px;right:16px;align-items:flex-end',
  left: 'top:50%;left:16px;transform:translateY(-50%);align-items:flex-start',
  center: 'top:50%;left:50%;transform:translate(-50%,-50%);align-items:center',
  right: 'top:50%;right:16px;transform:translateY(-50%);align-items:flex-end',
  'bottom-left': 'bottom:12px;left:16px;align-items:flex-start',
  bottom: 'bottom:12px;left:50%;transform:translateX(-50%);align-items:center',
  'bottom-right': 'bottom:12px;right:16px;align-items:flex-end',
}

/** Draws UiState as DOM over the canvas. Browser only. */
class UiDom {
  readonly root: HTMLDivElement
  private slots = new Map<Anchor, HTMLDivElement>()
  private els = new Map<string, { el: HTMLElement; kind: UiNode['kind']; fill?: HTMLDivElement; label?: HTMLSpanElement }>()
  private seen = -1

  constructor(
    private canvas: HTMLCanvasElement | undefined,
    onClick: (id: string) => void,
  ) {
    const root = document.createElement('div')
    root.id = 'kiln-ui'
    root.style.cssText = 'position:fixed;pointer-events:none;z-index:50;font-family:system-ui,sans-serif;font-weight:600;color:#fff;overflow:hidden'
    for (const a of ANCHORS) {
      const slot = document.createElement('div')
      slot.dataset.anchor = a
      slot.style.cssText = `position:absolute;display:flex;flex-direction:column;gap:6px;${ANCHOR_CSS[a]}`
      root.appendChild(slot)
      this.slots.set(a, slot)
    }
    root.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest('[data-ui-button]')?.getAttribute('data-ui-button')
      if (id) onClick(id)
    })
    document.body.appendChild(root)
    this.root = root
  }

  /** Keeps the overlay on top of the canvas. */
  place(): void {
    const r = this.canvas?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    const s = this.root.style
    const css = `${r.left}px|${r.top}px|${r.width}px|${r.height}px`
    if (this.root.dataset.rect === css) return
    this.root.dataset.rect = css
    s.left = `${r.left}px`
    s.top = `${r.top}px`
    s.width = `${r.width}px`
    s.height = `${r.height}px`
  }

  sync(ui: UiState): void {
    this.place()
    if (ui.version === this.seen) return
    this.seen = ui.version
    for (const [id, rec] of this.els) {
      const n = ui.nodes[id]
      if (!n || n.kind !== rec.kind) {
        rec.el.remove()
        this.els.delete(id)
      }
    }
    const sorted = Object.values(ui.nodes).sort((a, b) => a.order - b.order)
    for (const n of sorted) {
      let rec = this.els.get(n.id)
      if (!rec) rec = this.create(n)
      const el = rec.el
      el.style.display = n.visible ? '' : 'none'
      el.style.fontSize = `${n.size}px`
      if (n.kind === 'bar') {
        rec.fill!.style.width = `${n.value * 100}%`
        rec.fill!.style.background = n.color
        ;(rec.fill!.parentElement as HTMLElement).style.width = `${n.width}px`
        rec.label!.textContent = n.text
      } else {
        el.style.color = n.color
        if (el.textContent !== n.text) el.textContent = n.text
      }
      // Re-appending in order keeps each anchor's stack sorted; it is a no-op when already in place.
      this.slots.get(n.anchor)!.appendChild(el)
    }
  }

  private create(n: UiNode) {
    let rec: { el: HTMLElement; kind: UiNode['kind']; fill?: HTMLDivElement; label?: HTMLSpanElement }
    if (n.kind === 'bar') {
      const el = document.createElement('div')
      el.style.cssText = 'display:flex;align-items:center;gap:8px;text-shadow:0 1px 3px #000'
      const track = document.createElement('div')
      track.style.cssText = 'height:0.7em;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.35);border-radius:4px;overflow:hidden'
      const fill = document.createElement('div')
      fill.style.cssText = 'height:100%'
      track.appendChild(fill)
      const label = document.createElement('span')
      el.append(track, label)
      rec = { el, kind: n.kind, fill, label }
    } else if (n.kind === 'button') {
      const el = document.createElement('button')
      el.dataset.uiButton = n.id
      el.style.cssText =
        'pointer-events:auto;cursor:pointer;font:inherit;padding:.35em 1.1em;border-radius:8px;border:1px solid rgba(255,255,255,.4);background:rgba(20,24,32,.75);color:#fff;text-shadow:none'
      rec = { el, kind: n.kind }
    } else {
      const el = document.createElement('div')
      el.style.cssText = 'white-space:pre-line;text-shadow:0 1px 3px #000'
      rec = { el, kind: n.kind }
    }
    rec.el.dataset.uiId = n.id
    this.els.set(n.id, rec)
    return rec
  }

  dispose(): void {
    this.root.remove()
  }
}

/**
 * HUD and menus: text, bars and buttons anchored over the canvas, from the `Ui` resource. Buttons
 * emit `UiClick`. Headless it keeps the same data (no DOM), so scenarios can assert on it.
 */
export const UiPlugin = plugin((app: App) => {
  app.init(Ui, UiClick)
  // After CorePlugins' PollInput by add() order, so button actions see this frame's input.
  app.add(InputPhase, UiEvents)
  let dom: UiDom | null = null
  const RenderUi = system(
    ({ res }) => {
      dom?.sync(res.get(Ui) as UiState)
    },
    { name: 'RenderUi', unchecked: true },
  )
  app.add(Render, RenderUi)
  app.hooks.start.push((canvas) => {
    if (typeof document === 'undefined') return
    dom = new UiDom(canvas, (id) => app.resource(Ui).clicks.push(id))
  })
  app.hooks.dispose.push(() => {
    dom?.dispose()
    dom = null
  })
}, 'UiPlugin')

