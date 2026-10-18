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
// Binding names built once, so polling a gamepad doesn't build strings every frame.
const PAD_BUTTON_KEYS = PAD_BUTTONS.map((n) => `Pad:${n}`)
const PAD_AXIS_POS = PAD_AXES.map((n) => `Pad:${n}+`)
const PAD_AXIS_NEG = PAD_AXES.map((n) => `Pad:${n}-`)
const DEADZONE = 0.15

/** Raw device state, written by DOM listeners and gamepad polling. */
export class RawInput {
  keys = new Set<string>()
  /** Keys that went down since the last poll, so a press and release within one frame still counts. */
  tapped = new Set<string>()
  /** Analog values for gamepad bindings ('Pad:A' → 1, 'Pad:LX+' → 0.7). */
  pad = new Map<string, number>()
  stick = { x: 0, y: 0, active: false }
  pointer = { x: 0, y: 0, ndcX: 0, ndcY: 0, dx: 0, dy: 0, wheel: 0, inside: false }
  /** Gamepads seen via gamepadconnected. Polling skips navigator.getGamepads() while this is 0. */
  pads = 0
  clear(): void {
    this.keys.clear()
    this.tapped.clear()
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
  private recording: Recording | null = null

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
      if ('press' in ev) this.at(ev.frame, () => this.virtual.set(ev.press, ev.value ?? 1))
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
          if (ev.pointer.ndcX !== undefined) p.ndcX = ev.pointer.ndcX
          if (ev.pointer.ndcY !== undefined) p.ndcY = ev.pointer.ndcY
          if (ev.pointer.wheel) p.wheel += ev.pointer.wheel
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

  record(): { stop(): ScriptEvent[]; peek(): ScriptEvent[] } {
    const rec: Recording = {
      start: this.app.time.frame,
      events: [],
      values: new Map(),
      axis: null,
      pointer: { x: 0, y: 0, ndcX: 0, ndcY: 0, mouse: false },
    }
    this.recording = rec
    return {
      stop: () => {
        if (this.recording === rec) this.recording = null
        return rec.events
      },
      peek: () => rec.events.map((e) => structuredClone(e)),
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

  /** Called after Input is updated: records what changed since the last frame. */
  observe(state: InputState): void {
    const rec = this.recording
    if (!rec) return
    const frame = this.app.time.frame - rec.start
    const ev = rec.events
    // Action values, not raw keys: the replay doesn't depend on bindings or devices.
    for (const [a, v] of state.values) {
      if (rec.values.get(a) === v) continue
      ev.push(v === 1 ? { frame, press: a } : { frame, press: a, value: v })
    }
    for (const a of rec.values.keys()) if (!state.values.has(a)) ev.push({ frame, release: a })
    rec.values = new Map(state.values)
    // The axis follows the actions unless a stick or a script overrides it; record only overrides.
    const over = this.virtualAxis !== null || this.raw.stick.active
    const axis = over ? { x: state.axis.x, y: state.axis.y } : null
    const last = rec.axis
    if (axis ? !last || last.x !== axis.x || last.y !== axis.y : last) ev.push({ frame, axis })
    rec.axis = axis
    const p = state.pointer
    const lp = rec.pointer
    const mouse = this.raw.keys.has('Mouse0') || this.raw.tapped.has('Mouse0') || this.virtualKeys.has('Mouse0')
    if (p.x !== lp.x || p.y !== lp.y || p.ndcX !== lp.ndcX || p.ndcY !== lp.ndcY || p.wheel !== 0 || mouse !== lp.mouse) {
      const pointer: Extract<ScriptEvent, { pointer: unknown }>['pointer'] = { x: p.x, y: p.y, ndcX: p.ndcX, ndcY: p.ndcY }
      if (mouse !== lp.mouse) pointer.down = mouse
      if (p.wheel !== 0) pointer.wheel = p.wheel
      ev.push({ frame, pointer })
      rec.pointer = { x: p.x, y: p.y, ndcX: p.ndcX, ndcY: p.ndcY, mouse }
    }
  }
}

interface Recording {
  start: number
  events: ScriptEvent[]
  values: Map<string, number>
  axis: { x: number; y: number } | null
  pointer: { x: number; y: number; ndcX: number; ndcY: number; mouse: boolean }
}

/** Map/Set.clear() allocates a fresh table even when empty, so skip it when there is nothing to clear. */
function clear(c: { size: number; clear(): void }): void {
  if (c.size > 0) c.clear()
}

function bindingValue(b: Binding, raw: RawInput, ctl: Controller): number {
  if (raw.keys.has(b) || raw.tapped.has(b) || ctl.virtualKeys.has(b)) return 1
  return raw.pad.get(b) ?? 0
}

function pollGamepads(raw: RawInput): void {
  clear(raw.pad)
  raw.stick.active = false
  if (raw.pads === 0) return
  const nav = (globalThis as any).navigator
  if (!nav?.getGamepads) return
  const pads = nav.getGamepads() as (Gamepad | null)[]
  for (let p = 0; p < pads.length; p++) {
    const pad = pads[p]
    if (!pad) continue
    const buttons = pad.buttons
    const nb = Math.min(buttons.length, PAD_BUTTON_KEYS.length)
    for (let i = 0; i < nb; i++) {
      const value = buttons[i]!.value
      if (value <= 0) continue
      const key = PAD_BUTTON_KEYS[i]!
      raw.pad.set(key, Math.max(raw.pad.get(key) ?? 0, value))
    }
    const axes = pad.axes
    const na = Math.min(axes.length, PAD_AXES.length)
    for (let i = 0; i < na; i++) {
      const v = axes[i]!
      if (Math.abs(v) < DEADZONE) continue
      const key = v > 0 ? PAD_AXIS_POS[i]! : PAD_AXIS_NEG[i]!
      raw.pad.set(key, Math.max(raw.pad.get(key) ?? 0, Math.abs(v)))
    }
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
    if (!e.repeat) raw.tapped.add(e.code)
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
    raw.tapped.add(`Mouse${e.button}`)
  }
  const onUp = (e: PointerEvent) => raw.keys.delete(`Mouse${e.button}`)
  const onWheel = (e: WheelEvent) => {
    raw.pointer.wheel += e.deltaY
  }
  const onContext = (e: Event) => e.preventDefault()
  const onPadOn = () => raw.pads++
  const onPadOff = () => {
    raw.pads = Math.max(0, raw.pads - 1)
  }
  // A pad that was connected before this page loaded still fires gamepadconnected on first use.
  raw.pads = ((globalThis as any).navigator?.getGamepads?.() ?? []).filter(Boolean).length
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  target.addEventListener('pointermove', onMove as EventListener)
  target.addEventListener('pointerdown', onDown as EventListener)
  window.addEventListener('pointerup', onUp)
  target.addEventListener('wheel', onWheel as EventListener, { passive: true })
  canvas?.addEventListener('contextmenu', onContext)
  window.addEventListener('gamepadconnected', onPadOn)
  window.addEventListener('gamepaddisconnected', onPadOff)
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
    window.removeEventListener('gamepadconnected', onPadOn)
    window.removeEventListener('gamepaddisconnected', onPadOff)
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

    // Two sets swapped each poll, so the held set is never reallocated.
    let spareDown = new Set<string>()
    const Poll = system(
      ({ res }) => {
        const state = res.mut(Input)
        // unchecked: the raw map, not a dev read-only proxy (the plugin owns it and only reads it).
        const map = res.get(ActionMap)
        if (!app.headless) pollGamepads(raw)
        const prevDown = state.downSet
        const nextDown = spareDown
        clear(nextDown)
        clear(state.framePressed)
        clear(state.frameReleased)
        clear(state.values)
        for (const action in map) {
          let v = ctl.virtual.get(action) ?? 0
          const bindings = map[action]!
          for (let i = 0; i < bindings.length; i++) v = Math.max(v, bindingValue(bindings[i]!, raw, ctl))
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
        spareDown = prevDown

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
        clear(raw.tapped)
      },
      { name: 'PollInput', unchecked: true },
    )
    app.add(InputPhase, Poll)

    app.hooks.frameStart.push(() => ctl.tick())
    // pressed()/released() in Fixed are true for the first fixed step after the edge only.
    app.hooks.fixedEnd.push(() => {
      const s = app.resource(Input)
      clear(s.fixedPressed)
      clear(s.fixedReleased)
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
