/**
 * The animation state graph shared by SpriteAnimationPlugin and SkeletalAnimationPlugin: states
 * that play clips, transitions on parameters, triggers and exit times, crossfades, and frame/time
 * events. Plain data and plain numbers; no Three.js here, so it runs and tests headless.
 */
import type { Entity } from 'koota'
import { KilnError } from '../../core/errors.ts'
import { event } from '../../core/event.ts'

/** How a clip repeats: `loop` from the start, `once` and hold the last pose, `pingpong` back and forth. */
export type LoopMode = 'loop' | 'once' | 'pingpong'

/** A frame or time event on a state: `{ frame: 3, name: 'hit' }` (sprites) or `{ at: 0.4, name: 'footstep' }` (seconds of clip time). */
export interface AnimationEventSpec {
  name: string
  /** Seconds into the clip (clip time: before `speed`). */
  at?: number
  /** Frame of a sprite clip, counted from 0 within the clip. */
  frame?: number
}

/** One state of the graph: the clip it plays and how. */
export interface AnimationStateSpec {
  /** The clip's name (sprite sheet clip, or glTF animation). Default: the state's name. */
  clip?: string
  /** Overrides the clip's loop mode. Default: the sprite clip's mode, or 'loop' for glTF clips. */
  loop?: LoopMode
  /** Playback rate. Default 1. */
  speed?: number
  /** Events fired as the playhead crosses them, every loop. */
  events?: readonly AnimationEventSpec[]
}

/** A comparison for one parameter in `when`: a value means equals; or `{ gt, gte, lt, lte, eq, ne }`. */
export type ParamTest = number | boolean | { gt?: number; gte?: number; lt?: number; lte?: number; eq?: number | boolean; ne?: number | boolean }

/** An edge of the graph. All of `when`, `trigger` and `exitTime` that are given must hold. */
export interface TransitionSpec<S extends string = string, P extends string = string, T extends string = string> {
  /** A state, a list of states, or '*' for any state other than `to`. */
  from: S | readonly S[] | '*'
  to: S
  /** Parameter tests: `{ speed: { gt: 0.1 }, grounded: true }`. */
  when?: { readonly [K in P]?: ParamTest }
  /** Fires when this trigger was set (and consumes it). */
  trigger?: T
  /** Only once the current clip's normalized time reached this (1 = one full play, the end of a 'once' clip). */
  exitTime?: number
  /** Crossfade seconds (skeletal; sprites switch at once). Default: the graph's `fade`. */
  fade?: number
}

/** An animation graph as data. See `animationGraph`. */
export interface AnimationGraphSpec<S extends string = string, P extends Record<string, number | boolean> = Record<string, number | boolean>, T extends string = string> {
  /** The state entered on spawn. */
  initial: NoInfer<S>
  /** Parameters and their defaults: numbers or booleans, set from systems with `anim.set(name, value)`. */
  params?: P
  /** Trigger names, set with `anim.trigger(name)`; they last one animation step unless a transition uses them. */
  triggers?: readonly T[]
  /** Default crossfade seconds for transitions and play(). Default 0. */
  fade?: number
  states: { readonly [K in S]: AnimationStateSpec }
  /** Checked in order every step; the first that holds fires. */
  transitions?: readonly TransitionSpec<NoInfer<S>, NoInfer<keyof P & string>, NoInfer<T>>[]
}

/** A validated graph, shared by every entity that uses it. */
export interface AnimationGraph {
  readonly kind: 'kiln.animationGraph'
  readonly initial: string
  readonly params: Readonly<Record<string, number | boolean>>
  readonly triggers: readonly string[]
  readonly fade: number
  readonly states: Readonly<Record<string, AnimationStateSpec>>
  readonly transitions: readonly TransitionSpec[]
}

const list = (xs: Iterable<string>) => [...xs].map((x) => `'${x}'`).join(', ')

/**
 * Defines an animation state graph as data, checked when it is made:
 * ```ts
 * export const HeroAnim = animationGraph({
 *   initial: 'idle',
 *   params: { speed: 0 },
 *   triggers: ['attack'],
 *   states: { idle: {}, run: { events: [{ frame: 1, name: 'footstep' }] }, attack: { loop: 'once' } },
 *   transitions: [
 *     { from: 'idle', to: 'run', when: { speed: { gt: 0.1 } } },
 *     { from: 'run', to: 'idle', when: { speed: { lte: 0.1 } } },
 *     { from: '*', to: 'attack', trigger: 'attack' },
 *     { from: 'attack', to: 'idle', exitTime: 1 },
 *   ],
 * })
 * ```
 */
export function animationGraph<const S extends string, const P extends Record<string, number | boolean> = {}, const T extends string = never>(
  spec: AnimationGraphSpec<S, P, T>,
): AnimationGraph {
  const states = spec.states as Record<string, AnimationStateSpec>
  const names = Object.keys(states)
  if (names.length === 0) throw new KilnError('graph-empty', 'animationGraph() needs at least one state: states: { idle: {} }.')
  const params = (spec.params ?? {}) as Record<string, number | boolean>
  const triggers = (spec.triggers ?? []) as readonly string[]
  const has = (s: string) => Object.hasOwn(states, s)
  if (!has(spec.initial)) {
    throw new KilnError('graph-unknown-state', `animationGraph() initial state '${spec.initial}' is not one of its states: ${list(names)}.`)
  }
  for (const [name, p] of Object.entries(params)) {
    if (typeof p !== 'number' && typeof p !== 'boolean') {
      throw new KilnError('graph-param', `animationGraph() param '${name}' must default to a number or a boolean, not ${typeof p}.`)
    }
  }
  for (const [name, s] of Object.entries(states)) {
    for (const ev of s.events ?? []) {
      if (typeof ev.name !== 'string' || (ev.at === undefined) === (ev.frame === undefined)) {
        throw new KilnError('graph-event', `State '${name}' has an event without a name or with neither/both of at and frame. Write { at: seconds, name } or { frame: n, name }.`)
      }
    }
  }
  const transitions = (spec.transitions ?? []) as readonly TransitionSpec[]
  transitions.forEach((t, i) => {
    const where = `animationGraph() transition ${i} (${Array.isArray(t.from) ? t.from.join('|') : t.from} -> ${t.to})`
    const froms = t.from === '*' ? [] : Array.isArray(t.from) ? t.from : [t.from as string]
    for (const s of [...froms, t.to]) {
      if (!has(s)) throw new KilnError('graph-unknown-state', `${where} names state '${s}', which isn't one of: ${list(names)}. Add it to states or fix the name.`)
    }
    for (const p of Object.keys(t.when ?? {})) {
      if (!Object.hasOwn(params, p)) throw new KilnError('graph-unknown-param', `${where} tests param '${p}'. Declare it in params: { ${p}: 0 }${names.length ? ` (params: ${list(Object.keys(params)) || 'none'})` : ''}.`)
    }
    if (t.trigger !== undefined && !triggers.includes(t.trigger)) {
      throw new KilnError('graph-unknown-trigger', `${where} uses trigger '${t.trigger}'. Declare it in triggers: ['${t.trigger}'].`)
    }
  })
  return { kind: 'kiln.animationGraph', initial: spec.initial, params, triggers, fade: spec.fade ?? 0, states, transitions }
}

export function isAnimationGraph(x: unknown): x is AnimationGraph {
  return typeof x === 'object' && x !== null && (x as AnimationGraph).kind === 'kiln.animationGraph'
}

/** A graph with one state per clip and no transitions, for animators that only use play(). */
export function clipGraph(clips: readonly string[], initial = clips[0]!): AnimationGraph {
  const states: Record<string, AnimationStateSpec> = {}
  for (const c of clips) states[c] = {}
  return animationGraph({ initial, states } as AnimationGraphSpec)
}

/** A frame/time event from a graph state: `{ entity, name, state }`. Emitted in Fixed; each reader sees it once. */
export const AnimationEvent = event<{ entity: Entity; name: string; state: string }>().named('AnimationEvent')

/** An animator entered a new state (by transition or play()). */
export const AnimationStateChanged = event<{ entity: Entity; from: string; to: string }>().named('AnimationStateChanged')

/** A 'once' clip reached its end. */
export const AnimationFinished = event<{ entity: Entity; state: string }>().named('AnimationFinished')

/** What the graph needs to know about a clip. Sprite clips also give `frames` and `fps`. */
export interface ClipInfo {
  /** Seconds for one forward play. */
  duration: number
  /** The clip's own loop mode, used when the state doesn't set one. */
  loop?: LoopMode
  frames?: number
  fps?: number
}

/** Receives what one animation step produced. */
export interface AnimationSink {
  event(name: string, state: string): void
  changed(from: string, to: string): void
  finished(state: string): void
}

const EPS = 1e-6

/** An in-progress crossfade from the previous state. */
export interface Fade {
  from: string
  /** The previous state's playhead (seconds of clip time, unrolled). */
  fromTime: number
  duration: number
  elapsed: number
}

/**
 * One entity's playback of a graph. Systems use it through `SpriteAnimator` / `Animator` rows (with
 * `Mut(...)` to write): `set(param, value)`, `trigger(name)`, `play(state)`, and read `state`,
 * `time`, `normalizedTime`, `finished`, `is(state)`, `get(param)`.
 */
export class AnimationController {
  graph: AnimationGraph | null
  /** The current state's name ('' until the clips are known). */
  state = ''
  /** Seconds of clip time since the state was entered (keeps growing across loops). */
  time = 0
  /** Playback rate for the whole animator, multiplied with each state's speed. */
  speed = 1
  /** Holds the playhead (events and transitions wait too). */
  paused = false
  /** Parameter values; write them with set(). */
  readonly params: Record<string, number | boolean> = {}
  /** Triggers set since the last animation step. */
  readonly triggers = new Set<string>()
  /** The crossfade in progress, or null. */
  fade: Fade | null = null
  /** play() requests, applied at the start of the next animation step. */
  protected request: { state: string; fade: number | undefined; restart: boolean } | null = null
  /** The state to enter first, overriding the graph's initial state. */
  protected startState: string | null
  private fresh = true
  private finishedSent = false
  private clips = new Map<string, ClipInfo>()

  constructor(graph: AnimationGraph | null, play?: string) {
    this.graph = graph
    this.startState = play ?? null
    if (graph) Object.assign(this.params, graph.params)
  }

  /** Sets a parameter declared in the graph's params. */
  set(name: string, value: number | boolean): this {
    if (this.graph && !Object.hasOwn(this.graph.params, name)) {
      throw new KilnError('anim-unknown-param', `No animation param '${name}'. Declare it in the graph's params (${list(Object.keys(this.graph.params)) || 'none yet'}).`)
    }
    this.params[name] = value
    return this
  }

  /** A parameter's value. */
  get(name: string): number | boolean | undefined {
    return this.params[name]
  }

  /** Sets a trigger declared in the graph's triggers. It lasts one animation step unless a transition takes it. */
  trigger(name: string): this {
    if (this.graph && !this.graph.triggers.includes(name)) {
      throw new KilnError('anim-unknown-trigger', `No animation trigger '${name}'. Declare it in the graph's triggers (${list(this.graph.triggers) || 'none yet'}).`)
    }
    this.triggers.add(name)
    return this
  }

  /**
   * Enters a state at the next animation step, skipping transitions. Already in it: nothing,
   * unless `restart`. `fade` overrides the graph's crossfade seconds.
   */
  play(state: string, options: { fade?: number; restart?: boolean } = {}): this {
    if (this.graph && !Object.hasOwn(this.graph.states, state)) {
      throw new KilnError('anim-unknown-state', `Can't play '${state}': no such state. States: ${list(Object.keys(this.graph.states))}.`)
    }
    this.request = { state, fade: options.fade, restart: options.restart ?? false }
    return this
  }

  /** True when the current state is `state`. */
  is(state: string): boolean {
    return this.state === state
  }

  /** The current state's spec. */
  get stateSpec(): AnimationStateSpec | undefined {
    return this.graph?.states[this.state]
  }

  /** The current state's clip name. */
  get clip(): string {
    return clipOf(this.graph, this.state)
  }

  /** The current state's loop mode. */
  get loop(): LoopMode {
    return loopOf(this.graph, this.state, this.clips.get(this.clip))
  }

  /** Plays of the current clip so far: 0..1 through the first, 1 at the end of a 'once' clip, 2.5 halfway through a third loop. */
  get normalizedTime(): number {
    const info = this.clips.get(this.clip)
    if (!info) return 0
    const c = cycleOf(info, this.loop)
    return c > 0 ? this.time / c : 1
  }

  /** A 'once' clip has reached its end. */
  get finished(): boolean {
    const info = this.clips.get(this.clip)
    return !!info && this.loop === 'once' && this.time >= info.duration - EPS
  }

  /** The crossfade weight of the current state: 0 just after a faded transition, 1 when settled. */
  get weight(): number {
    const f = this.fade
    return f ? Math.min(1, f.elapsed / f.duration) : 1
  }

  /** True once the plugin has told the controller about its clips. */
  get bound(): boolean {
    return this.state !== ''
  }

  /** Called by the plugin when the clips are known. Checks every state's clip exists, then enters the first state. */
  bind(clips: ReadonlyMap<string, ClipInfo>, what: string): void {
    this.clips = new Map(clips)
    if (!this.graph) this.graph = clipGraph([...clips.keys()])
    for (const [name] of Object.entries(this.graph.states)) {
      const c = clipOf(this.graph, name)
      if (!clips.has(c)) {
        throw new KilnError('anim-unknown-clip', `Animation state '${name}' plays clip '${c}', which ${what} doesn't have. Clips: ${list(clips.keys()) || 'none'}. Set the state's clip or fix the name.`)
      }
    }
    if (Object.keys(this.params).length === 0) Object.assign(this.params, this.graph.params)
    const first = this.request?.state ?? this.startState ?? this.graph.initial
    if (!Object.hasOwn(this.graph.states, first)) {
      throw new KilnError('anim-unknown-state', `Can't play '${first}': no such state. States: ${list(Object.keys(this.graph.states))}.`)
    }
    this.request = null
    this.state = first
    this.time = 0
    this.fresh = true
    this.finishedSent = false
  }

  /** Info for a clip by name. */
  clipInfo(name: string): ClipInfo | undefined {
    return this.clips.get(name)
  }

  /** One animation step of `dt` seconds: play() requests, then transitions, then the playhead and its events. */
  step(dt: number, out: AnimationSink): void {
    if (!this.graph || !this.bound) return
    const r = this.request
    if (r) {
      this.request = null
      if (r.state !== this.state || r.restart) this.enter(r.state, r.fade ?? this.graph.fade, out)
    } else if (!this.paused) {
      const t = this.pick()
      if (t) {
        if (t.trigger !== undefined) this.triggers.delete(t.trigger)
        this.enter(t.to, t.fade ?? this.graph.fade, out)
      }
    }
    this.triggers.clear()
    if (this.paused) return

    const spec = this.graph.states[this.state]!
    const info = this.clips.get(this.clip)!
    const loop = this.loop
    const rate = (spec.speed ?? 1) * this.speed
    const prev = this.time
    let cur = prev + dt * rate
    if (loop === 'once') cur = Math.min(cur, info.duration)
    this.time = cur
    const lo = this.fresh ? -Infinity : prev + EPS
    this.fresh = false
    for (const ev of spec.events ?? []) {
      const positions = eventPositions(info, loop, ev, this.state)
      const c = cycleOf(info, loop)
      for (const a of positions) {
        if (loop === 'once' || c <= 0) {
          if (lo < a && a <= cur + EPS) out.event(ev.name, this.state)
          continue
        }
        // Every repetition of the cycle the step crossed.
        const kMin = Math.max(0, Math.ceil((lo - a) / c - 1e-9))
        const kMax = Math.floor((cur + EPS - a) / c)
        for (let k = Number.isFinite(kMin) ? kMin : 0; k <= kMax; k++) out.event(ev.name, this.state)
      }
    }
    if (loop === 'once' && !this.finishedSent && cur >= info.duration - EPS) {
      this.finishedSent = true
      out.finished(this.state)
    }
    const f = this.fade
    if (f) {
      const fromSpec = this.graph.states[f.from]
      f.fromTime += dt * (fromSpec?.speed ?? 1) * this.speed
      f.elapsed += dt
      if (f.elapsed >= f.duration - EPS) this.fade = null
    }
  }

  private enter(to: string, fade: number, out: AnimationSink): void {
    const from = this.state
    this.fade = fade > 0 ? { from, fromTime: this.time, duration: fade, elapsed: 0 } : null
    this.state = to
    this.time = 0
    this.fresh = true
    this.finishedSent = false
    out.changed(from, to)
  }

  private pick(): TransitionSpec | undefined {
    const g = this.graph!
    for (const t of g.transitions) {
      if (t.from === '*') {
        if (t.to === this.state) continue
      } else if (Array.isArray(t.from) ? !t.from.includes(this.state) : t.from !== this.state) continue
      if (t.trigger !== undefined && !this.triggers.has(t.trigger)) continue
      if (t.exitTime !== undefined && this.normalizedTime < t.exitTime - EPS) continue
      if (t.when && !passes(t.when, this.params)) continue
      return t
    }
    return undefined
  }

  toJSON(): Record<string, unknown> {
    return {
      state: this.state,
      time: Math.round(this.time * 1e4) / 1e4,
      params: { ...this.params },
      ...(this.fade ? { fade: { from: this.fade.from, weight: Math.round(this.weight * 1e3) / 1e3 } } : {}),
    }
  }
}

function passes(when: Record<string, ParamTest | undefined>, params: Record<string, number | boolean>): boolean {
  for (const k in when) {
    const test = when[k]
    const v = params[k]
    if (test === undefined) continue
    if (typeof test !== 'object') {
      if (v !== test) return false
      continue
    }
    const n = Number(v)
    if (test.gt !== undefined && !(n > test.gt)) return false
    if (test.gte !== undefined && !(n >= test.gte)) return false
    if (test.lt !== undefined && !(n < test.lt)) return false
    if (test.lte !== undefined && !(n <= test.lte)) return false
    if (test.eq !== undefined && v !== test.eq) return false
    if (test.ne !== undefined && v === test.ne) return false
  }
  return true
}

export function clipOf(graph: AnimationGraph | null, state: string): string {
  return graph?.states[state]?.clip ?? state
}

function loopOf(graph: AnimationGraph | null, state: string, info: ClipInfo | undefined): LoopMode {
  return graph?.states[state]?.loop ?? info?.loop ?? 'loop'
}

/** Seconds of one full cycle: one play for loop/once, there and back for pingpong. */
export function cycleOf(info: ClipInfo, loop: LoopMode): number {
  if (loop !== 'pingpong') return info.duration
  if (info.frames !== undefined && info.fps) return info.frames > 1 ? (2 * info.frames - 2) / info.fps : 1 / info.fps
  return info.duration * 2
}

/** Where an event sits inside one cycle (pingpong passes most points twice). */
function eventPositions(info: ClipInfo, loop: LoopMode, ev: AnimationEventSpec, state: string): number[] {
  if (ev.frame !== undefined) {
    if (info.frames === undefined || !info.fps) {
      throw new KilnError('anim-frame-event', `State '${state}' has a frame event ('${ev.name}'), but its clip has no frames. Use { at: seconds, name: '${ev.name}' } for glTF clips.`)
    }
    const n = info.frames
    const f = Math.min(Math.max(0, Math.floor(ev.frame)), n - 1)
    if (loop !== 'pingpong' || f === 0 || f === n - 1) return [f / info.fps]
    return [f / info.fps, (2 * n - 2 - f) / info.fps]
  }
  const a = Math.min(Math.max(0, ev.at!), info.duration)
  if (loop !== 'pingpong' || a <= 0 || a >= info.duration) return [a]
  return [a, 2 * info.duration - a]
}

/** Seconds into the clip to show for an unrolled playhead (continuous clips: glTF). */
export function localTime(info: ClipInfo, loop: LoopMode, time: number): number {
  const d = info.duration
  if (d <= 0) return 0
  if (loop === 'once') return Math.min(time, d)
  // Snap a playhead a rounding error short of a wrap to the wrap, as events and frames do.
  const wrap = (x: number, m: number) => {
    const r = x % m
    return m - r < EPS ? 0 : r
  }
  if (loop === 'loop') return wrap(time, d)
  const p = wrap(time, 2 * d)
  return p <= d ? p : 2 * d - p
}

/** The frame index within a sprite clip for an unrolled playhead. */
export function frameIndex(info: ClipInfo, loop: LoopMode, time: number): number {
  const n = info.frames ?? 1
  const s = Math.floor(time * (info.fps ?? 1) + EPS)
  if (n <= 1) return 0
  if (loop === 'once') return Math.min(s, n - 1)
  if (loop === 'loop') return s % n
  const k = s % (2 * n - 2)
  return k < n ? k : 2 * n - 2 - k
}

/** Turns one animator's step results into AnimationEvent / AnimationStateChanged / AnimationFinished. Reused across entities. */
export class EventSink implements AnimationSink {
  private entity = 0 as Entity
  private events: { emit(e: unknown, data: unknown): void } | null = null

  /** Points the sink at an entity and a system's events before `controller.step()`. */
  for(entity: Entity, events: { emit(e: any, data: any): void }): this {
    this.entity = entity
    this.events = events
    return this
  }
  event(name: string, state: string): void {
    this.events!.emit(AnimationEvent, { entity: this.entity, name, state })
  }
  changed(from: string, to: string): void {
    this.events!.emit(AnimationStateChanged, { entity: this.entity, from, to })
  }
  finished(state: string): void {
    this.events!.emit(AnimationFinished, { entity: this.entity, state })
  }
}
