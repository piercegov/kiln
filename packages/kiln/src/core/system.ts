import type { Entity, Trait, World } from 'koota'
import type { NamedQueries, QueryList, QueryViews, Row } from './access.ts'
import type { Commands } from './commands.ts'
import type { Events } from './event.ts'
import { nameOf, setName } from './names.ts'
import type { Resource } from './resource.ts'

export const $system = Symbol.for('kiln.system')
export const $entry = Symbol.for('kiln.entry')
export const $chain = Symbol.for('kiln.chain')
export const $gate = Symbol.for('kiln.gate')

/** Clock values a system sees. All in seconds except `frame` and `tick`. */
export interface TimeState {
  /** Fixed step length (1 / fixedHz). */
  step: number
  /** This phase's delta: `step` inside Fixed, the clamped frame delta elsewhere. */
  dt: number
  /** Simulated seconds: tick * step. Deterministic. */
  elapsed: number
  /** Frames run so far. */
  frame: number
  /** Fixed steps run so far. */
  tick: number
  /** Interpolation factor between the last two fixed steps, for rendering. */
  alpha: number
}

/** Resource access. `get` reads (read-only proxy in dev), `mut` writes. */
export interface Res {
  get<T>(r: Resource<T>): Readonly<T>
  mut<T>(r: Resource<T>): T
  has(r: Resource<any>): boolean
}

/** Everything a system can touch. */
export interface SystemContext {
  readonly time: Readonly<TimeState>
  readonly res: Res
  readonly commands: Commands
  readonly events: Events
  /** The Koota world, for ad-hoc reads. A read-only proxy in dev builds. */
  readonly world: World
}

/** Context for the per-entity form, adding the current entity. */
export interface EntityContext extends SystemContext {
  readonly entity: Entity
}

export interface SystemOptions {
  /** Overrides the export name. */
  name?: string
  /** Extra traits this system writes outside its queries (plugins only). */
  writes?: Trait[]
  /** Extra traits this system reads outside its queries (plugins only). */
  reads?: Trait[]
  /** Skips dev write guards and hands over the raw world. For plugin internals that own their data. */
  unchecked?: boolean
}

export type SystemForm = 'none' | 'each' | 'named'

/** A query plus a function. Schedule it with `app.add(Phase, system)`. */
export interface System {
  readonly [$system]: true
  readonly id: number
  readonly form: SystemForm
  readonly query: QueryList | NamedQueries | null
  readonly fn: (...args: any[]) => void
  readonly options: SystemOptions
  readonly name: string
  /** Sets the name used in errors and `kiln describe`. */
  named(name: string): this
  /** Runs this system after the given systems in the same phase. */
  after(...systems: System[]): SystemEntry
  /** Runs this system before the given systems in the same phase. */
  before(...systems: System[]): SystemEntry
}

/** A system plus ordering constraints, returned by `.after()` / `.before()`. */
export interface SystemEntry {
  readonly [$entry]: true
  readonly system: System
  readonly afters: readonly System[]
  readonly befores: readonly System[]
  after(...systems: System[]): SystemEntry
  before(...systems: System[]): SystemEntry
}

/** Systems that run in the given order: `chain(PlayerMove, Movement, CollectCoins)`. */
export interface Chain {
  readonly [$chain]: true
  readonly items: readonly Schedulable[]
}

/** What a run condition sees: resources (reads are recorded for `kiln describe`) and the clock. */
export interface ConditionContext {
  readonly res: Res
  readonly time: Readonly<TimeState>
}

/**
 * A run condition: `({ res }) => res.get(Score).value > 10`. Checked before each run of each system
 * it gates; false skips that run. `label` is how `kiln describe` shows it.
 */
export type Condition = ((ctx: ConditionContext) => boolean) & { label?: string }

/** Systems that only run while a condition holds, returned by `runIf(cond, ...)`. */
export interface Gate {
  readonly [$gate]: true
  readonly condition: Condition
  readonly items: readonly Schedulable[]
}

export type Schedulable = System | SystemEntry | Chain | Gate

let nextId = 1

function makeEntry(system: System, afters: System[], befores: System[]): SystemEntry {
  return {
    [$entry]: true,
    system,
    afters,
    befores,
    after: (...s) => makeEntry(system, [...afters, ...s], befores),
    before: (...s) => makeEntry(system, afters, [...befores, ...s]),
  }
}

/** A system with no query: runs once per phase run with only the context. */
export function system(fn: (ctx: SystemContext) => void, options?: SystemOptions): System
/** A per-entity system: runs fn once per entity matching the query. */
export function system<const P extends QueryList>(
  query: P,
  fn: (row: Row<P>, ctx: EntityContext) => void,
  options?: SystemOptions,
): System
/** A system over named queries: runs once per phase run with each query's results. */
export function system<const Q extends NamedQueries>(
  queries: Q,
  fn: (queries: QueryViews<Q>, ctx: SystemContext) => void,
  options?: SystemOptions,
): System
export function system(a: any, b?: any, c?: any): System {
  let form: SystemForm
  let query: QueryList | NamedQueries | null
  let fn: (...args: any[]) => void
  let options: SystemOptions
  if (typeof a === 'function' && !('schema' in a)) {
    form = 'none'
    query = null
    fn = a
    options = b ?? {}
  } else if (Array.isArray(a)) {
    form = 'each'
    query = a
    fn = b
    options = c ?? {}
  } else if (typeof a === 'object' && a !== null) {
    form = 'named'
    query = a
    fn = b
    options = c ?? {}
  } else {
    throw new TypeError(
      'system() takes (fn), ([...query], fn) or ({ name: [...query] }, fn). Got ' + typeof a + '.',
    )
  }
  if (typeof fn !== 'function') {
    throw new TypeError('system() needs a function as its last argument (after the query).')
  }
  const s: System = {
    [$system]: true,
    id: nextId++,
    form,
    query,
    fn,
    options,
    get name() {
      return nameOf(s, options.name ?? (fn.name || `System#${s.id}`))
    },
    named(name: string) {
      setName(s, name, true)
      return s
    },
    after: (...t) => makeEntry(s, t, []),
    before: (...t) => makeEntry(s, [], t),
  }
  if (options.name) setName(s, options.name, true)
  return s
}

/** Runs the given systems in order, within one phase. */
export function chain(...items: Schedulable[]): Chain {
  return { [$chain]: true, items }
}

/**
 * Runs the given systems only while `cond` is true: `runIf(inState(Screen, 'playing'), chain(A, B), C)`.
 * Order works as without it: a gated chain still runs in order, `.after()` still applies. Gates nest
 * (all conditions must hold). Skipped systems don't read events, so they see them when they run again
 * only if the events are still alive (two runs of the emitting phase).
 */
export function runIf(cond: Condition, ...items: Schedulable[]): Gate {
  if (typeof cond !== 'function') {
    throw new TypeError('runIf() takes a condition function first: runIf(inState(Screen, \'playing\'), MySystem).')
  }
  return { [$gate]: true, condition: cond, items }
}

/** A condition that is true when `cond` is false. */
export function not(cond: Condition): Condition {
  return withLabel((ctx) => !cond(ctx), `not(${conditionLabel(cond)})`)
}

/** Gives a condition the label `kiln describe` prints for it. */
export function withLabel(cond: Condition, label: string): Condition {
  ;(cond as { label?: string }).label = label
  return cond
}

/** How `kiln describe` names a condition: its label, else its function name. */
export function conditionLabel(cond: Condition): string {
  return cond.label ?? (cond.name || 'condition')
}

export function isSystem(x: unknown): x is System {
  return typeof x === 'object' && x !== null && (x as any)[$system] === true
}
export function isEntry(x: unknown): x is SystemEntry {
  return typeof x === 'object' && x !== null && (x as any)[$entry] === true
}
export function isGate(x: unknown): x is Gate {
  return typeof x === 'object' && x !== null && (x as any)[$gate] === true
}
export function isChain(x: unknown): x is Chain {
  return typeof x === 'object' && x !== null && (x as any)[$chain] === true
}
