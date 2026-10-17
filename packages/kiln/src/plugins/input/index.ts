import type { App } from '../../core/app.ts'
import { KilnError } from '../../core/errors.ts'
import type { InputController, ScriptEvent } from '../../core/input-types.ts'
import { plugin, type Plugin } from '../../core/plugin.ts'
import { resource } from '../../core/resource.ts'
import { Fixed, InputPhase } from '../../core/schedule.ts'
import { system } from '../../core/system.ts'

/**
 * A binding names a physical input: a KeyboardEvent.code ('KeyW', 'Space', 'ArrowLeft'),
 * 'Mouse0'..'Mouse2', a gamepad button ('Pad:A', 'Pad:Start', 'Pad:Up', 'Pad:RT'), or a stick
 * direction ('Pad:LX+', 'Pad:LY-', 'Pad:RX+').
 */
export type Binding = string

/** Action name → bindings. Systems read actions, not keys. */
export type ActionBindings = Record<string, Binding[]>

/** The default action map. Override with `app.insert(ActionMap, {...})` or `inputPlugin({ actions })`. */
export const DEFAULT_ACTIONS: ActionBindings = {
  left: ['KeyA', 'ArrowLeft', 'Pad:Left', 'Pad:LX-'],
  right: ['KeyD', 'ArrowRight', 'Pad:Right', 'Pad:LX+'],
  up: ['KeyW', 'ArrowUp', 'Pad:Up', 'Pad:LY-'],
  down: ['KeyS', 'ArrowDown', 'Pad:Down', 'Pad:LY+'],
  jump: ['Space', 'Pad:A'],
  fire: ['Mouse0', 'Pad:RT'],
  alt: ['Mouse2', 'Pad:LT'],
  interact: ['KeyE', 'Pad:X'],
  sprint: ['ShiftLeft', 'Pad:B'],
  pause: ['Escape', 'Pad:Start'],
}

/** The action map as a resource, editable at runtime. */
export const ActionMap = resource((): ActionBindings => structuredClone(DEFAULT_ACTIONS)).named('ActionMap')

const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS', 'Up', 'Down', 'Left', 'Right']
const PAD_AXES = ['LX', 'LY', 'RX', 'RY']
const DEADZONE = 0.15

/** Raw device state, written by DOM listeners and gamepad polling. */
export class RawInput {
  keys = new Set<string>()
  /** Analog values for gamepad bindings ('Pad:A' → 1, 'Pad:LX+' → 0.7). */
  pad = new Map<string, number>()
  stick = { x: 0, y: 0, active: false }
  pointer = { x: 0, y: 0, ndcX: 0, ndcY: 0, dx: 0, dy: 0, wheel: 0, inside: false }
  clear(): void {
    this.keys.clear()
    this.pad.clear()
  }
}

/**
 * The Input resource. Read it with `res.get(Input)`:
 * `axis` (x: right−left, y: up−down, length ≤ 1), `down('jump')`, `pressed('jump')`,
 * `released('jump')`, `value('fire')`, and `pointer`.
 *
 * `pressed`/`released` are true for exactly one fixed step when read in Fixed, and for exactly
 * one frame when read elsewhere, however many fixed steps a frame runs.
 */
export class InputState {
  /** Move axis from left/right/up/down (or the left stick). Unit length at most. */
  readonly axis = { x: 0, y: 0 }
  /** Pointer in canvas pixels and normalized device coords (y up), plus deltas this frame. */
  readonly pointer = { x: 0, y: 0, ndcX: 0, ndcY: 0, dx: 0, dy: 0, wheel: 0, down: false }
  values = new Map<string, number>()
  downSet = new Set<string>()
  framePressed = new Set<string>()
  frameReleased = new Set<string>()
  fixedPressed = new Set<string>()
  fixedReleased = new Set<string>()
  inFixed: () => boolean = () => false

  /** True while the action is held. */
  down(action: string): boolean {
    return this.downSet.has(action)
  }
  /** True on the step (in Fixed) or frame (elsewhere) the action went down. */
  pressed(action: string): boolean {
    return (this.inFixed() ? this.fixedPressed : this.framePressed).has(action)
  }
  /** True on the step (in Fixed) or frame (elsewhere) the action went up. */
  released(action: string): boolean {
    return (this.inFixed() ? this.fixedReleased : this.frameReleased).has(action)
  }
  /** Analog value 0..1 (triggers, stick directions); 0 or 1 for keys. */
  value(action: string): number {
    return this.values.get(action) ?? 0
  }
  toJSON() {
    return { axis: { ...this.axis }, down: [...this.downSet].sort() }
  }
}

export const Input = resource((app) => {
  const s = new InputState()
  s.inFixed = () => app.currentPhase === Fixed
  return s
}).named('Input')

interface Pending {
  at: number
  apply: () => void
}

/** Scripted input plus the live-device controller behind `app.input`. */
class Controller implements InputController {
  readonly virtual = new Map<string, number>()
  readonly virtualKeys = new Set<string>()
  virtualAxis: { x: number; y: number } | null = null
  private queue: Pending[] = []
  private recording: { start: number; events: ScriptEvent[]; last: Set<string> } | null = null

  constructor(
    private app: App,
    readonly raw: RawInput,
  ) {}

  private at(frame: number, apply: () => void) {
    // Frame 1 is the next frame; time.frame is incremented at the start of each frame.
    this.queue.push({ at: this.app.time.frame + Math.max(1, frame), apply })
  }

  script(events: readonly ScriptEvent[]): this {
    for (const ev of events) {
      if (typeof ev.frame !== 'number') {
        throw new KilnError('bad-script', `Every input script event needs a frame number. Got ${JSON.stringify(ev)}.`)
      }
      if ('press' in ev) this.at(ev.frame, () => this.virtual.set(ev.press, 1))
      else if ('release' in ev) this.at(ev.frame, () => this.virtual.delete(ev.release))
      else if ('tap' in ev) {
        this.at(ev.frame, () => this.virtual.set(ev.tap, 1))
        this.at(ev.frame + 1, () => this.virtual.delete(ev.tap))
      } else if ('hold' in ev) {
        this.at(ev.frame, () => this.virtual.set(ev.hold, 1))
        this.at(ev.frame + Math.max(1, ev.frames), () => this.virtual.delete(ev.hold))
      } else if ('key' in ev) {
        this.at(ev.frame, () => (ev.up ? this.virtualKeys.delete(ev.key) : this.virtualKeys.add(ev.key)))
      } else if ('axis' in ev) this.at(ev.frame, () => (this.virtualAxis = ev.axis ? { ...ev.axis } : null))
      else if ('pointer' in ev) {
        this.at(ev.frame, () => {
          const p = this.raw.pointer
          p.dx += ev.pointer.x - p.x
          p.dy += ev.pointer.y - p.y
          p.x = ev.pointer.x
          p.y = ev.pointer.y
          if (ev.pointer.down !== undefined) {
            if (ev.pointer.down) this.virtualKeys.add('Mouse0')
            else this.virtualKeys.delete('Mouse0')
          }
        })
      } else {
        throw new KilnError(
          'bad-script',
          `Unknown input script event ${JSON.stringify(ev)}. Use press, release, tap, hold, key, axis or pointer.`,
        )
      }
    }
    return this
  }

  press(action: string): this {
    return this.script([{ frame: 1, press: action }])
  }
  release(action: string): this {
    return this.script([{ frame: 1, release: action }])
  }
  tap(action: string): this {
    return this.script([{ frame: 1, tap: action }])
  }
  setAxis(x: number, y: number): this {
    return this.script([{ frame: 1, axis: { x, y } }])
  }
  clearAxis(): this {
    return this.script([{ frame: 1, axis: null }])
  }
  reset(): this {
    this.queue.length = 0
    this.virtual.clear()
    this.virtualKeys.clear()
    this.virtualAxis = null
    return this
  }

  record(): { stop(): ScriptEvent[] } {
    const rec = { start: this.app.time.frame, events: [] as ScriptEvent[], last: new Set<string>() }
    this.recording = rec
    return {
      stop: () => {
        if (this.recording === rec) this.recording = null
        return rec.events
      },
    }
  }

  /** Runs at frame start: applies script events due this frame. */
  tick(): void {
    const now = this.app.time.frame
    if (this.queue.length === 0) return
    const due = this.queue.filter((p) => p.at <= now)
    if (due.length === 0) return
    this.queue = this.queue.filter((p) => p.at > now)
    for (const p of due) p.apply()
  }

  /** Called after Input is updated, to record action edges. */
  observe(state: InputState): void {
    const rec = this.recording
    if (!rec) return
    const frame = this.app.time.frame - rec.start
    for (const a of state.downSet) if (!rec.last.has(a)) rec.events.push({ frame, press: a })
    for (const a of rec.last) if (!state.downSet.has(a)) rec.events.push({ frame, release: a })
    rec.last = new Set(state.downSet)
  }
}

function bindingValue(b: Binding, raw: RawInput, ctl: Controller): number {
  if (raw.keys.has(b) || ctl.virtualKeys.has(b)) return 1
  return raw.pad.get(b) ?? 0
}

function pollGamepads(raw: RawInput): void {
  raw.pad.clear()
  raw.stick.active = false
  const nav = (globalThis as any).navigator
  if (!nav?.getGamepads) return
  for (const pad of nav.getGamepads() as (Gamepad | null)[]) {
    if (!pad) continue
    pad.buttons.forEach((btn, i) => {
      const name = PAD_BUTTONS[i]
      if (name && btn.value > 0) raw.pad.set(`Pad:${name}`, Math.max(raw.pad.get(`Pad:${name}`) ?? 0, btn.value))
    })
    pad.axes.forEach((v, i) => {
      const name = PAD_AXES[i]
      if (!name || Math.abs(v) < DEADZONE) return
      const key = `Pad:${name}${v > 0 ? '+' : '-'}`
      raw.pad.set(key, Math.max(raw.pad.get(key) ?? 0, Math.abs(v)))
    })
    const lx = pad.axes[0] ?? 0
    const ly = pad.axes[1] ?? 0
    if (Math.hypot(lx, ly) > DEADZONE) {
      raw.stick.x = lx
      raw.stick.y = -ly
      raw.stick.active = true
    }
  }
}

function attachDom(app: App, raw: RawInput, canvas: HTMLCanvasElement | undefined): () => void {
  if (typeof window === 'undefined') return () => {}
  const prevent = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
  const onKeyDown = (e: KeyboardEvent) => {
    raw.keys.add(e.code)
    if (prevent.has(e.code) && e.target === document.body) e.preventDefault()
  }
  const onKeyUp = (e: KeyboardEvent) => raw.keys.delete(e.code)
  const onBlur = () => raw.clear()
  const target: HTMLElement | Window = canvas ?? window
  const pos = (e: PointerEvent | MouseEvent) => {
    const rect = canvas?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const p = raw.pointer
    p.dx += x - p.x
    p.dy += y - p.y
    p.x = x
    p.y = y
    p.ndcX = (x / rect.width) * 2 - 1
    p.ndcY = -((y / rect.height) * 2 - 1)
  }
  const onMove = (e: PointerEvent) => pos(e)
  const onDown = (e: PointerEvent) => {
    pos(e)
    raw.keys.add(`Mouse${e.button}`)
  }
  const onUp = (e: PointerEvent) => raw.keys.delete(`Mouse${e.button}`)
  const onWheel = (e: WheelEvent) => {
    raw.pointer.wheel += e.deltaY
  }
  const onContext = (e: Event) => e.preventDefault()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  target.addEventListener('pointermove', onMove as EventListener)
  target.addEventListener('pointerdown', onDown as EventListener)
  window.addEventListener('pointerup', onUp)
  target.addEventListener('wheel', onWheel as EventListener, { passive: true })
  canvas?.addEventListener('contextmenu', onContext)
  void app
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    target.removeEventListener('pointermove', onMove as EventListener)
    target.removeEventListener('pointerdown', onDown as EventListener)
    window.removeEventListener('pointerup', onUp)
    target.removeEventListener('wheel', onWheel as EventListener)
    canvas?.removeEventListener('contextmenu', onContext)
  }
}

export interface InputOptions {
  /** Replaces the default action map. */
  actions?: ActionBindings
}

/** Builds an input plugin with a custom action map. */
export function inputPlugin(options: InputOptions = {}): Plugin {
  return plugin((app) => {
    const raw = new RawInput()
    const ctl = new Controller(app, raw)
    app.ext.input = ctl
    app.ext.rawInput = raw
    if (options.actions) app.insert(ActionMap, structuredClone(options.actions))
    app.init(ActionMap, Input)

    const Poll = system(
      ({ res }) => {
        const state = res.mut(Input)
        const map = res.get(ActionMap)
        if (!app.headless) pollGamepads(raw)
        const prevDown = state.downSet
        const nextDown = new Set<string>()
        state.framePressed.clear()
        state.frameReleased.clear()
        state.values.clear()
        for (const action of Object.keys(map)) {
          let v = ctl.virtual.get(action) ?? 0
          for (const b of map[action]!) v = Math.max(v, bindingValue(b, raw, ctl))
          if (v > 0) state.values.set(action, v)
          if (v >= 0.5) nextDown.add(action)
        }
        for (const [action, v] of ctl.virtual) {
          if (map[action]) continue
          // Scripted actions that aren't in the map still work, so tests can use any name.
          state.values.set(action, v)
          if (v >= 0.5) nextDown.add(action)
        }
        for (const a of nextDown) {
          if (!prevDown.has(a)) {
            state.framePressed.add(a)
            state.fixedPressed.add(a)
          }
        }
        for (const a of prevDown) {
          if (!nextDown.has(a)) {
            state.frameReleased.add(a)
            state.fixedReleased.add(a)
          }
        }
        state.downSet = nextDown

        let x: number
        let y: number
        if (ctl.virtualAxis) {
          x = ctl.virtualAxis.x
          y = ctl.virtualAxis.y
        } else if (raw.stick.active) {
          x = raw.stick.x
          y = raw.stick.y
        } else {
          x = (state.values.get('right') ?? 0) - (state.values.get('left') ?? 0)
          y = (state.values.get('up') ?? 0) - (state.values.get('down') ?? 0)
        }
        const len = Math.hypot(x, y)
        if (len > 1) {
          x /= len
          y /= len
        }
        state.axis.x = x
        state.axis.y = y

        const p = state.pointer
        const rp = raw.pointer
        p.x = rp.x
        p.y = rp.y
        p.ndcX = rp.ndcX
        p.ndcY = rp.ndcY
        p.dx = rp.dx
        p.dy = rp.dy
        p.wheel = rp.wheel
        p.down = nextDown.has('fire') || raw.keys.has('Mouse0') || ctl.virtualKeys.has('Mouse0')
        rp.dx = 0
        rp.dy = 0
        rp.wheel = 0
        ctl.observe(state)
      },
      { name: 'PollInput' },
    )
    app.add(InputPhase, Poll)

    app.hooks.frameStart.push(() => ctl.tick())
    // pressed()/released() in Fixed are true for the first fixed step after the edge only.
    app.hooks.fixedEnd.push(() => {
      const s = app.resource(Input)
      s.fixedPressed.clear()
      s.fixedReleased.clear()
    })
    let detach = () => {}
    app.hooks.start.push((canvas) => {
      detach = attachDom(app, raw, canvas)
    })
    app.hooks.dispose.push(() => detach())
  }, 'InputPlugin')
}

/** Keyboard, mouse and gamepad through an action map, plus scripted input for tests. */
export const InputPlugin = inputPlugin()
