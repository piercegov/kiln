import {
  createWorld,
  type ConfigurableTrait,
  type Entity,
  type QueryParameter,
  type Trait,
  type TraitRecord,
  type World,
} from 'koota'
import { isMut, isTrack, type QueryList, type QueryParam } from './access.ts'
import { CommandQueue, Commands } from './commands.ts'
import { defaultDev } from './dev.ts'
import { KilnError } from './errors.ts'
import { Events, EventBus, isEvent, type EventType } from './event.ts'
import type { InputController } from './input-types.ts'
import { describeApp, type AppDescription } from './describe.ts'
import { guard, installEntityGuards, readonlyWorld, type GuardTarget } from './guard.ts'
import { nameOf } from './names.ts'
import { isPlugin, type Plugin, type PluginLike } from './plugin.ts'
import { resolveSpawn, type Prefab } from './prefab.ts'
import { isResource, type Resource } from './resource.ts'
import { diffSnapshots, restoreSnapshot, takeSnapshot, type Snapshot, type SnapshotDiff, type SnapshotOptions } from './snapshot.ts'
import { accessOf, NamedQueryView, RowPlan, type Access } from './runtime.ts'
import {
  buildPhase,
  Fixed,
  InputPhase,
  isPhase,
  Late,
  PHASES,
  PhaseBuilder,
  Render,
  Startup,
  Update,
  type BuiltPhase,
  type Phase,
} from './schedule.ts'
import type { Res, Schedulable, System, SystemContext, TimeState } from './system.ts'

export type HotReloadMode = 'keep' | 'snapshot' | false

/** Contents of kiln.config.ts. Every field is optional. */
export interface KilnConfig {
  /** Fixed simulation rate. Default 60. */
  fixedHz?: number
  /** Seed for the Rng resource. Default 0. */
  seed?: number
  /** '3d' (default) or '2d': orthographic camera, z as draw order, Z-only rotation, Rapier 2D. */
  mode?: '2d' | '3d'
  /** 'keep' swaps changed systems in place, 'snapshot' rebuilds and restores, false disables. */
  hotReload?: HotReloadMode
  /** Dev guards and read-only proxies. Default: on unless NODE_ENV=production. */
  dev?: boolean
  /** Frame delta clamp in seconds, so a tab-away doesn't spiral. Default 0.25. */
  maxFrameDt?: number
  /** Pace browser frames with the display (requestAnimationFrame). Default true. */
  vsync?: boolean
  /** Cap on browser frames per second; 0 means no cap. Default 0. */
  maxFps?: number
  /** Most fixed steps per frame. Default 5. */
  maxFixedSteps?: number
  /** Module whose default export builds the app, for the CLI and scenarios. Default 'src/main.ts'. */
  entry?: string
}

export type ResolvedConfig = Required<KilnConfig>

/** Typed helper for kiln.config.ts. */
export function defineConfig(config: KilnConfig): KilnConfig {
  return config
}

function resolveConfig(c: KilnConfig): ResolvedConfig {
  return {
    fixedHz: c.fixedHz ?? 60,
    seed: c.seed ?? 0,
    mode: c.mode ?? '3d',
    hotReload: c.hotReload ?? 'keep',
    dev: c.dev ?? defaultDev(),
    maxFrameDt: c.maxFrameDt ?? 0.25,
    maxFixedSteps: c.maxFixedSteps ?? 5,
    vsync: c.vsync ?? true,
    maxFps: c.maxFps ?? 0,
    entry: c.entry ?? 'src/main.ts',
  }
}

/** Per-system timing, read by the debug plugin. */
export interface SystemTiming {
  last: number
  avg: number
}

/** One system compiled against this app's world. */
export class CompiledSystem implements GuardTarget {
  readonly writes: Set<Trait>
  readonly reads: Set<Trait>
  readonly resReads = new Set<Resource<any>>()
  readonly resWrites = new Set<Resource<any>>()
  readonly timing: SystemTiming = { last: 0, avg: 0 }
  readonly ctx: SystemContext & { entity: Entity }
  readonly run: () => void
  readonly unchecked: boolean

  constructor(
    readonly app: App,
    readonly system: System,
    readonly phase: Phase,
  ) {
    const access = staticAccess(system)
    this.writes = access.writes
    this.reads = access.reads
    this.unchecked = system.options.unchecked === true
    const world = app.world
    const self = this
    this.ctx = {
      time: app.time,
      res: new ResAccess(app, this),
      commands: app.commands,
      events: new Events(app.bus),
      world: app.dev && !this.unchecked ? readonlyWorld(world, () => guard.current) : world,
      entity: 0 as Entity,
    }
    const nameFn = () => self.name
    const ctx = this.ctx
    const fn = system.fn
    if (system.form === 'none') {
      this.run = () => fn(ctx)
    } else if (system.form === 'each') {
      const plan = new RowPlan(world, system.query as QueryList, nameFn)
      const each = (row: unknown, e: Entity) => {
        ctx.entity = e
        fn(row, ctx)
      }
      this.run = () => plan.each(plan.entities(), each)
    } else {
      const named = system.query as Record<string, QueryList>
      const views: Record<string, NamedQueryView> = {}
      for (const key of Object.keys(named)) views[key] = new NamedQueryView(new RowPlan(world, named[key]!, nameFn))
      const list = Object.values(views)
      this.run = () => {
        for (let i = 0; i < list.length; i++) list[i]!.refresh()
        fn(views, ctx)
      }
    }
  }

  get name(): string {
    return this.system.name
  }
  get phaseName(): string {
    return this.phase.name
  }
}

/** Reads and writes declared by a system's queries and options. */
export function staticAccess(system: System): Access {
  const access: Access = { reads: new Set(), writes: new Set() }
  if (system.form === 'each') accessOf(system.query as QueryList, access)
  else if (system.form === 'named') {
    for (const list of Object.values(system.query as Record<string, QueryList>)) accessOf(list, access)
  }
  for (const t of system.options.writes ?? []) access.writes.add(t)
  for (const t of system.options.reads ?? []) access.reads.add(t)
  for (const w of access.writes) access.reads.delete(w)
  return access
}

const NATIVE_RECEIVERS = [Map, Set, WeakMap, WeakSet, Date, ArrayBuffer, DataView]

function needsTargetReceiver(v: object): boolean {
  if (ArrayBuffer.isView(v)) return true
  for (const C of NATIVE_RECEIVERS) if (v instanceof C) return true
  return false
}

/** Resource access for one system. Records what it touches for `kiln describe`. */
class ResAccess implements Res {
  private proxies = new WeakMap<object, object>()
  constructor(
    private app: App,
    private owner: CompiledSystem | null,
  ) {}

  get<T>(r: Resource<T>): Readonly<T> {
    this.owner?.resReads.add(r)
    const v = this.app.resource(r)
    if (!this.app.dev || r.opaque || this.owner?.unchecked || typeof v !== 'object' || v === null) return v
    return this.readonly(v as object, r.name, r.name) as T
  }

  mut<T>(r: Resource<T>): T {
    this.owner?.resWrites.add(r)
    return this.app.resource(r)
  }

  has(r: Resource<any>): boolean {
    return this.app.hasResource(r)
  }

  private readonly(v: object, path: string, rname: string): object {
    let p = this.proxies.get(v)
    if (p) return p
    const owner = this.owner
    const self = this
    const native = needsTargetReceiver(v)
    p = new Proxy(v, {
      get(target, key, receiver) {
        const out = Reflect.get(target, key, native ? target : receiver)
        if (typeof out === 'function') return native ? out.bind(target) : out
        if (typeof out === 'object' && out !== null && typeof key === 'string') {
          return self.readonly(out, `${path}.${key}`, rname)
        }
        return out
      },
      set(_, key) {
        const who = owner?.name ?? 'This code'
        throw new KilnError(
          'readonly-resource',
          `${who} wrote ${path}.${String(key)} through res.get(${rname}), which is read-only. Use res.mut(${rname}).`,
        )
      },
      deleteProperty(_, key) {
        const who = owner?.name ?? 'This code'
        throw new KilnError(
          'readonly-resource',
          `${who} deleted ${path}.${String(key)} through res.get(${rname}). Use res.mut(${rname}).`,
        )
      },
    })
    this.proxies.set(v, p)
    return p
  }
}

type Hook<A extends unknown[] = []> = (...args: A) => void | Promise<void>

/**
 * The game: a Koota world, resources, events, and a schedule of systems in phases.
 * Build it with `createApp(config).use(...).add(Phase, ...)`, then `start(canvas)` in the
 * browser or `step(n)` headless.
 */
export class App {
  readonly config: ResolvedConfig
  readonly world: World
  readonly dev: boolean
  readonly time: TimeState
  readonly bus = new EventBus()
  readonly queue = new CommandQueue()
  /** App-level command queue; systems share it. */
  readonly commands: Commands
  /** Slots plugins attach controllers to (input, renderer, physics world...). */
  readonly ext: Record<string, any> = {}
  /** Lifecycle hooks for plugins. */
  readonly hooks = {
    /** Before Startup when the app starts in a browser. Receives the canvas. */
    start: [] as Hook<[HTMLCanvasElement | undefined]>[],
    /** Before each fixed step (render uses it to snapshot the previous transform). */
    fixedStart: [] as Hook[],
    /** After each fixed step and its commands. */
    fixedEnd: [] as Hook[],
    /** At the start of each frame, with its delta. */
    frameStart: [] as Hook<[number]>[],
    /** After the schedule is (re)built. */
    built: [] as Hook[],
    /** When the app is disposed. */
    dispose: [] as Hook[],
    /** When a browser frame throws. The loop pauses; the browser runtime shows an overlay. */
    error: [] as Hook<[unknown]>[],
  }
  /** True until start() runs in a browser. Render-only work skips itself when headless. */
  headless = true
  /** Record per-system timings (the debug plugin turns this on). */
  profile = false
  /** While true the browser loop only renders; the simulation is frozen. */
  paused = false
  canvas: HTMLCanvasElement | undefined

  private builders = new Map<Phase, PhaseBuilder>()
  private compiledCache = new Map<string, CompiledSystem>()
  private compiled = new Map<Phase, CompiledSystem[]>()
  private builtPhases = new Map<Phase, BuiltPhase>()
  private dirty = true
  private resources = new Map<Resource<any>, unknown>()
  private resourceOrder: Resource<any>[] = []
  private plugins: Plugin[] = []
  private pluginSet = new Set<unknown>()
  private pending = new Set<Promise<void>>()
  private pluginError: unknown = null
  private booted = false
  private disposed = false
  private acc = 0
  private loopToken = 0
  /**
   * Browser loop pacing. `vsync: true` (default) paces frames with requestAnimationFrame;
   * `false` runs frames back to back (the compositor still presents at the display rate, so this
   * measures throughput). `maxFps` caps frames per second in either mode; 0 means no cap.
   * Change these at runtime; the debug panel has controls for both.
   */
  readonly frameRate = { vsync: true, maxFps: 0 }

  private runLoop(): void {
    const token = ++this.loopToken
    let last = performance.now()
    let nextAllowed = 0
    const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null
    const schedule = () => {
      if (this.frameRate.vsync || !channel) requestAnimationFrame(() => tick())
      else channel.port2.postMessage(0)
    }
    if (channel) channel.port1.onmessage = () => tick()
    const tick = () => {
      if (this.disposed || token !== this.loopToken) return
      const now = performance.now()
      const cap = this.frameRate.maxFps
      if (cap > 0 && now < nextAllowed) {
        // Uncapped mode would spin on postMessage; wait out the remainder instead.
        if (!this.frameRate.vsync) setTimeout(tick, Math.max(0, nextAllowed - now - 1))
        else schedule()
        return
      }
      if (cap > 0) nextAllowed = Math.max(nextAllowed + 1000 / cap, now - 1000 / cap)
      schedule()
      this.bus.startRecording()
      const dt = (now - last) / 1000
      last = now
      try {
        if (this.paused) {
          if (!this.headless) this.render()
        } else this.frame(dt, false)
      } catch (err) {
        // Stop on the first error instead of flooding the console every frame.
        this.paused = true
        for (const h of this.hooks.error) void h(err)
        if (this.hooks.error.length === 0) console.error(err)
      }
    }
    schedule()
  }
  private appRes: ResAccess
  currentPhase: Phase | null = null

  constructor(config: KilnConfig = {}) {
    this.config = resolveConfig(config)
    this.dev = this.config.dev
    this.frameRate.vsync = this.config.vsync
    this.frameRate.maxFps = this.config.maxFps
    try {
      this.world = createWorld()
    } catch (err) {
      throw new KilnError(
        'too-many-apps',
        'Too many Kiln apps are alive at once (Koota allows 16 worlds). Call app.dispose() when an app is done; scenario() does this for you.',
        { cause: err },
      )
    }
    if (this.dev) installEntityGuards()
    const step = 1 / this.config.fixedHz
    this.time = { step, dt: step, elapsed: 0, frame: 0, tick: 0, alpha: 0 }
    this.commands = new Commands(this.queue)
    this.appRes = new ResAccess(this, null)
    for (const p of PHASES) this.builders.set(p, new PhaseBuilder(p))
  }

  // ---------------------------------------------------------------- building

  /** Adds plugins. Each plugin is used once, however many times it is passed. */
  use(...plugins: PluginLike[]): this {
    for (const p of plugins) {
      if (Array.isArray(p)) {
        this.use(...p)
        continue
      }
      if (this.pluginSet.has(p)) continue
      this.pluginSet.add(p)
      const pl: Plugin | null = isPlugin(p) ? p : null
      const build = pl ? pl.build : (p as (app: App) => void | Promise<void>)
      if (pl) this.plugins.push(pl)
      else if (typeof p !== 'function') {
        throw new KilnError('not-a-plugin', `app.use() got ${typeof p}. Pass plugins made with plugin(), or functions (app) => void.`)
      }
      const out = build(this)
      if (out && typeof (out as Promise<void>).then === 'function') {
        const pr = (out as Promise<void>).then(
          () => void this.pending.delete(pr),
          (err) => {
            this.pending.delete(pr)
            this.pluginError ??= err
          },
        )
        this.pending.add(pr)
      }
    }
    return this
  }

  /** Registers resources (created with their defaults) and event types. */
  init(...items: (Resource<any> | EventType<any>)[]): this {
    for (const item of items) {
      if (isResource(item)) this.resource(item)
      else if (isEvent(item)) this.bus.register(item)
      else throw new KilnError('not-initable', `app.init() takes resources and events. Got ${typeof item}.`)
    }
    return this
  }

  /** Sets a resource's value, replacing any existing one. */
  insert<T>(r: Resource<T>, value: T): this {
    if (!this.resources.has(r)) this.resourceOrder.push(r)
    this.resources.set(r, value)
    return this
  }

  /** Adds systems to a phase. Order inside the phase comes from chain() and .after()/.before(). */
  add(phase: Phase, ...items: Schedulable[]): this {
    if (!isPhase(phase)) {
      throw new KilnError(
        'not-a-phase',
        `app.add() needs a phase first: app.add(Fixed, ${nameOf(phase, 'MySystem')}). Phases: ${PHASES.map((p) => p.name).join(', ')}.`,
      )
    }
    const b = this.builders.get(phase)!
    for (const item of items) b.add(item)
    this.dirty = true
    return this
  }

  /** Resolves when async plugins (e.g. physics WASM) have finished. */
  async ready(): Promise<this> {
    while (this.pending.size > 0) await Promise.all([...this.pending])
    if (this.pluginError) throw this.pluginError
    return this
  }

  private background = new Set<Promise<unknown>>()

  /**
   * Registers background work (asset loads) that never blocks a phase. `app.idle()` waits for it;
   * scenarios call it after Startup so headless runs stay deterministic.
   */
  track<T>(work: Promise<T>): Promise<T> {
    const p = work.finally(() => this.background.delete(p))
    this.background.add(p)
    p.catch(() => {})
    return work
  }

  /** Resolves when all tracked background work (e.g. asset loads) has settled. */
  async idle(): Promise<this> {
    while (this.background.size > 0) await Promise.allSettled([...this.background])
    return this
  }

  /** Plugins used, in order. */
  get pluginList(): readonly Plugin[] {
    return this.plugins
  }

  // ---------------------------------------------------------------- resources

  /** The live value of a resource (created on first access). Mutable: for tests and plugins. */
  resource<T>(r: Resource<T>): T {
    if (this.resources.has(r)) return this.resources.get(r) as T
    const v = r.create(this)
    this.resources.set(r, v)
    this.resourceOrder.push(r)
    return v
  }

  /** Shorthand for app.resource(r). */
  res<T>(r: Resource<T>): T {
    return this.resource(r)
  }

  hasResource(r: Resource<any>): boolean {
    return this.resources.has(r)
  }

  /** Resources created so far, in creation order. */
  resourceList(): readonly Resource<any>[] {
    return this.resourceOrder
  }

  // ---------------------------------------------------------------- schedule

  /** Builds and validates the schedule if anything changed. Throws errors that name the fix. */
  build(): this {
    if (!this.dirty) return this
    const phaseOf = (s: System): Phase | undefined => {
      for (const [p, b] of this.builders) if (b.systems.includes(s)) return p
      return undefined
    }
    const writes = new Map<System, Set<Trait>>()
    const writesOf = (s: System) => {
      let w = writes.get(s)
      if (!w) writes.set(s, (w = staticAccess(s).writes))
      return w
    }
    const next = new Map<Phase, BuiltPhase>()
    for (const [p, b] of this.builders) next.set(p, buildPhase(b, writesOf, phaseOf))
    this.builtPhases = next
    this.compiled.clear()
    for (const [p, built] of next) {
      this.compiled.set(
        p,
        built.order.map((s) => {
          const key = `${p.order}:${s.id}`
          let cs = this.compiledCache.get(key)
          if (!cs) this.compiledCache.set(key, (cs = new CompiledSystem(this, s, p)))
          return cs
        }),
      )
    }
    this.dirty = false
    for (const h of this.hooks.built) void h()
    return this
  }

  /** The built schedule: each phase's systems in run order. */
  schedule(): ReadonlyMap<Phase, BuiltPhase> {
    this.build()
    return this.builtPhases
  }

  /** Compiled systems in run order for a phase. */
  systemsIn(phase: Phase): readonly CompiledSystem[] {
    this.build()
    return this.compiled.get(phase) ?? []
  }

  /**
   * Swaps one system for another in place, keeping the world. Used by hot reload ('keep').
   * The schedule is re-validated first; on error the old system stays.
   */
  replaceSystem(oldSystem: System, newSystem: System): boolean {
    let found = false
    const backup = new Map<Phase, PhaseBuilder>()
    for (const [p, b] of this.builders) {
      if (!b.systems.includes(oldSystem)) continue
      found = true
      backup.set(p, b)
      const nb = new PhaseBuilder(p)
      const swap = (s: System) => (s === oldSystem ? newSystem : s)
      for (const s of b.systems) (nb as any).systems.push(swap(s))
      for (const e of b.edges) (nb as any).edges.push({ ...e, from: swap(e.from), to: swap(e.to) })
      this.builders.set(p, nb)
    }
    if (!found) return false
    this.dirty = true
    try {
      this.build()
    } catch (err) {
      for (const [p, b] of backup) this.builders.set(p, b)
      this.dirty = true
      this.build()
      throw err
    }
    return true
  }

  // ---------------------------------------------------------------- running

  private assertReady(what: string): void {
    if (this.disposed) throw new KilnError('disposed', `app.${what}() was called after app.dispose(). Create a new app.`)
    if (this.pluginError) throw this.pluginError
    if (this.pending.size > 0) {
      const names = this.plugins.map((p) => p.name).join(', ')
      throw new KilnError(
        'not-ready',
        `app.${what}() ran while an async plugin is still loading (${names}). await app.ready() first; scenario() waits for you.`,
      )
    }
  }

  /** Builds the schedule and runs Startup once. step() and start() call this for you. */
  boot(): this {
    if (this.booted) return this
    this.assertReady('boot')
    this.build()
    this.booted = true
    this.runPhase(Startup)
    return this
  }

  /** True once Startup has run. */
  get isBooted(): boolean {
    return this.booted
  }

  /**
   * Advances exactly n frames of one fixed step each, with no renderer. Deterministic for a given
   * seed and input script. Events emitted during the call are readable with app.events(E).
   */
  step(n = 1): this {
    this.assertReady('step')
    this.bus.startRecording()
    this.boot()
    for (let i = 0; i < n; i++) this.frame(this.time.step, true)
    return this
  }

  /** Runs one variable-dt frame: input, 0..N fixed steps, update, late, render. */
  tick(dt: number): this {
    this.assertReady('tick')
    this.boot()
    this.frame(dt, false)
    return this
  }

  private frame(rawDt: number, exactStep: boolean): void {
    this.build()
    const t = this.time
    const dt = Math.min(Math.max(rawDt, 0), this.config.maxFrameDt)
    t.frame++
    for (const h of this.hooks.frameStart) void h(dt)
    t.dt = dt
    this.runPhase(InputPhase)

    const step = t.step
    let ran = 0
    const runFixed = () => {
      if (ran === 0) this.bus.beginBlock(Fixed.block)
      for (const h of this.hooks.fixedStart) void h()
      t.dt = step
      this.runPhase(Fixed)
      t.tick++
      t.elapsed = t.tick * step
      ran++
      for (const h of this.hooks.fixedEnd) void h()
    }
    if (exactStep) {
      runFixed()
      this.acc = 0
      t.alpha = 1
    } else {
      this.acc += dt
      while (this.acc >= step && ran < this.config.maxFixedSteps) {
        runFixed()
        this.acc -= step
      }
      if (this.acc >= step) this.acc %= step
      t.alpha = this.acc / step
    }
    t.dt = dt
    this.runPhase(Update)
    this.runPhase(Late)
    if (!this.headless) this.runPhase(Render)
  }

  private runPhase(p: Phase): void {
    if (p !== Fixed && p !== Startup) this.bus.beginBlock(p.block)
    this.currentPhase = p
    this.bus.currentBlock = p.block
    const list = this.compiled.get(p)!
    for (let i = 0; i < list.length; i++) this.runSystem(list[i]!)
    this.flush()
    this.currentPhase = null
    this.bus.currentBlock = Update.block
  }

  private runSystem(cs: CompiledSystem): void {
    guard.current = cs
    const t0 = this.profile ? performance.now() : 0
    try {
      cs.run()
    } catch (err) {
      throw wrapSystemError(err, cs)
    } finally {
      guard.current = null
    }
    if (this.profile) {
      const ms = performance.now() - t0
      cs.timing.last = ms
      cs.timing.avg = cs.timing.avg * 0.95 + ms * 0.05
    }
  }

  /** Applies queued commands now. Runs automatically at every phase boundary. */
  flush(): void {
    const prev = guard.current
    guard.current = null
    try {
      this.queue.apply(this.world)
    } finally {
      guard.current = prev
    }
  }

  /**
   * Starts the browser loop: runs plugin start hooks (renderer, input devices), Startup, then a
   * requestAnimationFrame loop. Pass `{ loop: false }` to drive frames yourself (kiln shot does),
   * `{ startup: false }` to skip Startup (when restoring a snapshot).
   */
  async start(canvas?: HTMLCanvasElement, options: { loop?: boolean; startup?: boolean } = {}): Promise<this> {
    try {
      await this.ready()
      this.headless = false
      this.canvas = canvas
      for (const h of this.hooks.start) await h(canvas)
      if (options.startup === false) {
        // Restoring a snapshot instead (hot reload): build, but don't spawn the level again.
        this.build()
        this.booted = true
      }
      this.boot()
      if (options.loop !== false && typeof requestAnimationFrame === 'function') this.runLoop()
      return this
    } catch (err) {
      console.error(err)
      throw err
    }
  }

  /** Renders one frame now without advancing the simulation. Needs a started app. */
  render(): this {
    if (this.headless) throw new KilnError('headless-render', 'app.render() needs a started app. Call await app.start(canvas) first.')
    this.build()
    this.runPhase(Render)
    return this
  }

  /** Stops the loop and frees the world. The app can't be used afterwards. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.loopToken++
    for (const h of this.hooks.dispose) void h()
    this.bus.clear()
    this.queue.clear()
    this.world.destroy()
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  // ---------------------------------------------------------------- direct access (tests, tools)

  private assertOutsideSystem(what: string): void {
    const s = guard.current
    if (s && !s.unchecked) {
      throw new KilnError('app-in-system', `${s.name} called app.${what}() inside a system. Use the context instead (commands, res).`)
    }
  }

  /** Spawns immediately (tests and tools). Systems use commands.spawn. */
  spawn<P>(prefab: Prefab<P>, ...params: P extends void ? [] : [P]): Entity
  spawn(...traits: ConfigurableTrait[]): Entity
  spawn(...args: unknown[]): Entity {
    this.assertOutsideSystem('spawn')
    return this.world.spawn(...resolveSpawn(args))
  }

  /** Despawns immediately (tests and tools). */
  despawn(entity: Entity): void {
    this.assertOutsideSystem('despawn')
    if (this.world.has(entity)) entity.destroy()
  }

  /** A trait's current value on an entity, or undefined. */
  get<T extends Trait>(entity: Entity, trait: T): TraitRecord<T> | undefined {
    return entity.get(trait) as TraitRecord<T> | undefined
  }

  /** Sets fields of a trait on an entity (tests and tools). */
  set<T extends Trait>(entity: Entity, trait: T, value: Partial<TraitRecord<T>>): void {
    this.assertOutsideSystem('set')
    entity.set(trait, value as never)
  }

  has(entity: Entity, trait: Trait): boolean {
    return this.world.has(entity) && entity.has(trait)
  }

  /** Entities matching a query. Mut() and change filters are accepted and ignored. */
  query(...params: QueryParam[]): readonly Entity[] {
    const plain = params.filter((p) => !isTrack(p)).map((p) => (isMut(p) ? p.trait : p)) as QueryParameter[]
    return this.world.query(...plain)
  }

  /** Emits an event from outside a system (tests, DOM callbacks). */
  emit<T>(e: EventType<T>, ...data: T extends void ? [] : [T]): void {
    this.bus.emit(e, data[0])
  }

  /** Every event of this type emitted during the last app.step() call (or browser frame). */
  events<T>(e: EventType<T>): readonly T[] {
    return this.bus.recorded(e)
  }

  /**
   * The world as JSON: `app.snapshot({ traits: [Transform, Health] })`. With no traits, every
   * JSON-friendly trait on every entity. Add `resources: [Score]` or `resources: true`.
   */
  snapshot(options?: SnapshotOptions): Snapshot {
    return takeSnapshot(this, options)
  }

  /** Field-level changes between two snapshots. Numbers within epsilon count as equal. */
  diff(a: Snapshot, b: Snapshot, epsilon = 0): SnapshotDiff {
    return diffSnapshots(a, b, epsilon)
  }

  /** Replaces all entities (and listed resources) with a snapshot's. Traits match by name. */
  restore(snapshot: Snapshot): { missingTraits: string[] } {
    this.assertOutsideSystem('restore')
    return restoreSnapshot(this, snapshot)
  }

  /** The built app as data: phases, systems with reads/writes/order, traits, resources, events. */
  describe(): AppDescription {
    return describeApp(this)
  }

  /** Scripted and live input: `app.input.script([{ frame: 10, press: 'jump' }])`. Needs the input plugin. */
  get input(): InputController {
    const c = this.ext.input as InputController | undefined
    if (!c) {
      throw new KilnError('no-input-plugin', 'app.input needs the input plugin. Add .use(CorePlugins) (or InputPlugin from kiln/input).')
    }
    return c
  }

  /** Resource access with the same read-only rules systems get. */
  get resAccess(): Res {
    return this.appRes
  }
}

function wrapSystemError(err: unknown, cs: CompiledSystem): unknown {
  if (err instanceof KilnError) return err
  const msg = err instanceof Error ? err.message : String(err)
  const wrapped = new KilnError('system-threw', `${cs.name} threw in ${cs.phase.name}: ${msg}`, { cause: err })
  if (err instanceof Error && err.stack) wrapped.stack = `KilnError: ${wrapped.message}\n${err.stack.split('\n').slice(1).join('\n')}`
  return wrapped
}

/** Creates an app. 3D by default; pass `{ mode: '2d' }` for 2D. */
export function createApp(config: KilnConfig = {}): App {
  // The CLI and scenario runner can override config (e.g. --seed) without editing the game.
  const overrides = (globalThis as any).__KILN_OVERRIDES__ as KilnConfig | undefined
  return new App(overrides ? { ...config, ...overrides } : config)
}
