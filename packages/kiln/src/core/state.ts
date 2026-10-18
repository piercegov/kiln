import type { App } from './app.ts'
import { KilnError } from './errors.ts'
import { trait } from './koota.ts'
import { nameOf } from './names.ts'
import { resource, type Resource } from './resource.ts'
import { Fixed } from './schedule.ts'
import { withLabel, type Condition } from './system.ts'

/**
 * Despawns the entity when its state is left: `commands.spawn(..., despawnOnExit(Screen, 'playing'))`.
 * `state` is the state's name, `value` the state value it belongs to.
 */
export const DespawnOnExit = trait({ state: '', value: '' })

let nextStateId = 1

/** A state's live value. Read it with `res.get(Screen)`, change it with `res.mut(Screen).set('playing')`. */
export class StateValue<S extends string = string> {
  /** The active value. */
  current: S
  /** The value before the last transition, or null. */
  previous: S | null = null
  /** A transition requested with set(), applied at the start of the next frame. */
  next: S | null = null
  /** Frame and fixed tick on which `current` was entered, for onEnter/onExit. */
  enteredFrame: number
  enteredTick: number

  constructor(
    readonly values: readonly S[],
    initial: S,
    private readonly inFixed: () => boolean,
    frame: number,
    tick: number,
  ) {
    this.current = initial
    this.enteredFrame = frame
    this.enteredTick = tick
  }

  /** Requests a transition. It applies at the start of the next frame; the last set() wins. */
  set(next: S): void {
    if (!this.values.includes(next)) {
      throw new KilnError('unknown-state', `'${next}' is not a value of this state. Use one of: ${this.values.map((v) => `'${v}'`).join(', ')}.`)
    }
    this.next = next === this.current ? null : next
  }

  /** True while the state is `value`. */
  is(value: S): boolean {
    return this.current === value
  }

  /** True during the first frame (or, in Fixed, the first fixed step) after a transition. */
  justChanged(): boolean {
    return this.inFixed() ? this.enteredTick === this.tickNow() : this.enteredFrame === this.frameNow()
  }

  /** @internal set by the state resource so justChanged can read the clock. */
  tickNow: () => number = () => 0
  /** @internal */
  frameNow: () => number = () => 0

  toJSON() {
    return { current: this.current, previous: this.previous, next: this.next, enteredFrame: this.enteredFrame, enteredTick: this.enteredTick }
  }

  restore(json: { current: S; previous: S | null; next: S | null; enteredFrame: number; enteredTick: number }): void {
    Object.assign(this, json)
  }
}

/** A finite state machine resource: game screens, pause, round phases. */
export interface State<S extends string = string> extends Resource<StateValue<S>> {
  readonly values: readonly S[]
  readonly initial: S
}

/**
 * Defines a state: `export const Screen = state(['menu', 'playing', 'paused', 'gameover'], 'menu')`.
 * Register it with `app.init(Screen)`. Gate systems with `runIf(inState(Screen, 'playing'), ...)`,
 * run one-off setup with `runIf(onEnter(Screen, 'playing'), SpawnLevel)` in Update or Fixed, and
 * change it with `res.mut(Screen).set('gameover')`. Transitions apply at the start of the next
 * frame; entities spawned with `despawnOnExit(Screen, v)` are despawned when `v` is left.
 */
export function state<const S extends string>(values: readonly S[], initial: S = values[0]!): State<S> {
  if (values.length === 0) throw new KilnError('empty-state', 'state() needs at least one value: state([\'menu\', \'playing\']).')
  if (!values.includes(initial)) {
    throw new KilnError('unknown-state', `state() initial value '${initial}' is not one of ${values.map((v) => `'${v}'`).join(', ')}.`)
  }
  const id = nextStateId++
  // `let`, not `const`: the names transform would otherwise name this resource "r".
  let r: State<S>
  r = resource((app: App) => {
    const t = app.time
    const v = new StateValue<S>(values, initial, () => app.currentPhase === Fixed, t.frame + 1, t.tick)
    v.tickNow = () => t.tick
    v.frameNow = () => t.frame
    app.hooks.frameStart.push(() => applyTransition(app, r, v))
    return v
  }) as State<S>
  Object.defineProperty(r, 'values', { value: values })
  Object.defineProperty(r, 'initial', { value: initial })
  Object.defineProperty(r, 'name', { get: () => nameOf(r, `State#${id}`) })
  return r
}

function applyTransition<S extends string>(app: App, s: State<S>, v: StateValue<S>): void {
  const next = v.next
  if (next === null) return
  v.next = null
  if (next === v.current) return
  const left = v.current
  v.previous = left
  v.current = next
  v.enteredFrame = app.time.frame
  v.enteredTick = app.time.tick
  const name = s.name
  for (const e of app.world.query(DespawnOnExit)) {
    const d = e.get(DespawnOnExit)!
    if (d.state === name && d.value === left) e.destroy()
  }
}

/** The DespawnOnExit trait for a state value: `commands.spawn(Enemy, ..., despawnOnExit(Screen, 'playing'))`. */
export function despawnOnExit<S extends string>(s: State<S>, value: S) {
  return DespawnOnExit({ state: s.name, value })
}

/** Run condition: true while the state is `value`. */
export function inState<S extends string>(s: State<S>, value: S): Condition {
  return withLabel(({ res }) => res.get(s).current === value, `inState(${s.name},${value})`)
}

/**
 * Run condition: true on the first frame after `value` is entered (in Fixed: the first fixed step).
 * The initial value counts as entered on frame 1. For Update, Fixed and Late; Startup runs before it.
 */
export function onEnter<S extends string>(s: State<S>, value: S): Condition {
  return withLabel(({ res }) => {
    const v = res.get(s)
    return v.current === value && v.justChanged()
  }, `onEnter(${s.name},${value})`)
}

/** Run condition: true on the first frame (in Fixed: step) after `value` was left. */
export function onExit<S extends string>(s: State<S>, value: S): Condition {
  return withLabel(({ res }) => {
    const v = res.get(s)
    return v.previous === value && v.justChanged() && v.current !== value
  }, `onExit(${s.name},${value})`)
}

/** Run condition: true on the first frame (in Fixed: step) after any transition of this state. */
export function stateChanged<S extends string>(s: State<S>): Condition {
  return withLabel(({ res }) => {
    const v = res.get(s)
    return v.previous !== null && v.justChanged()
  }, `stateChanged(${s.name})`)
}
