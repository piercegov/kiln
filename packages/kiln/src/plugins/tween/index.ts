import type { Entity, Trait } from 'koota'
import type { App } from '../../core/app.ts'
import { PendingEntity, type EntityRef } from '../../core/commands.ts'
import { KilnError } from '../../core/errors.ts'
import { event } from '../../core/event.ts'
import { traitName } from '../../core/names.ts'
import { plugin } from '../../core/plugin.ts'
import { resource } from '../../core/resource.ts'
import { Fixed } from '../../core/schedule.ts'
import { system } from '../../core/system.ts'
import { stepsFor } from '../timer/index.ts'

const c1 = 1.70158
const c2 = c1 * 1.525
const c3 = c1 + 1
const c4 = (2 * Math.PI) / 3
const c5 = (2 * Math.PI) / 4.5

function outBounce(x: number): number {
  const n1 = 7.5625
  const d1 = 2.75
  if (x < 1 / d1) return n1 * x * x
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375
  return n1 * (x -= 2.625 / d1) * x + 0.984375
}

/** Easing functions from easings.net, mapping 0..1 to 0..1 (back and elastic overshoot). */
export const ease = {
  linear: (x: number) => x,
  inQuad: (x: number) => x * x,
  outQuad: (x: number) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
  inCubic: (x: number) => x * x * x,
  outCubic: (x: number) => 1 - (1 - x) ** 3,
  inOutCubic: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  inQuart: (x: number) => x ** 4,
  outQuart: (x: number) => 1 - (1 - x) ** 4,
  inOutQuart: (x: number) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
  inSine: (x: number) => 1 - Math.cos((x * Math.PI) / 2),
  outSine: (x: number) => Math.sin((x * Math.PI) / 2),
  inOutSine: (x: number) => -(Math.cos(Math.PI * x) - 1) / 2,
  inExpo: (x: number) => (x === 0 ? 0 : 2 ** (10 * x - 10)),
  outExpo: (x: number) => (x === 1 ? 1 : 1 - 2 ** (-10 * x)),
  inOutExpo: (x: number) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
  inBack: (x: number) => c3 * x ** 3 - c1 * x * x,
  outBack: (x: number) => 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2,
  inOutBack: (x: number) =>
    x < 0.5 ? ((2 * x) ** 2 * ((c2 + 1) * 2 * x - c2)) / 2 : ((2 * x - 2) ** 2 * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2,
  inElastic: (x: number) => (x === 0 ? 0 : x === 1 ? 1 : -(2 ** (10 * x - 10)) * Math.sin((x * 10 - 10.75) * c4)),
  outElastic: (x: number) => (x === 0 ? 0 : x === 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1),
  inOutElastic: (x: number) =>
    x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? -(2 ** (20 * x - 10) * Math.sin((20 * x - 11.125) * c5)) / 2 : (2 ** (-20 * x + 10) * Math.sin((20 * x - 11.125) * c5)) / 2 + 1,
  inBounce: (x: number) => 1 - outBounce(1 - x),
  outBounce,
  inOutBounce: (x: number) => (x < 0.5 ? (1 - outBounce(1 - 2 * x)) / 2 : (1 + outBounce(2 * x - 1)) / 2),
}

export type EaseName = keyof typeof ease
export type Easing = EaseName | ((t: number) => number)

export interface TweenOptions {
  /** Seconds per run. Default 0.3. */
  duration?: number
  /** An `ease` name or a function of 0..1. Default 'outQuad'. */
  ease?: Easing
  /** Seconds before it starts. Start values are read when it starts. Default 0. */
  delay?: number
  /** Extra runs after the first; -1 repeats forever. Default 0. */
  repeat?: number
  /** Alternate direction on each repeat (there and back). Default false. */
  yoyo?: boolean
  /** Start values instead of the current ones, written when the tween starts. */
  from?: Record<string, number>
  /** A label carried by TweenDone so readers can tell tweens apart. Default ''. */
  tag?: string
  /** Despawn the entity when the tween (and anything chained with .then) finishes. Default false. */
  despawn?: boolean
}

/** A tween finished (after all repeats). `entity` is undefined for plain-object tweens. */
export const TweenDone = event<{ id: number; tag: string; entity: Entity | undefined }>()

interface Spec {
  target: EntityRef | object
  trait: Trait | null
  values: Record<string, number>
  opts: TweenOptions
}

interface Active extends Spec {
  id: number
  steps: number
  delay: number
  ticks: number
  run: number
  started: boolean
  start: Record<string, number>
  easeFn: (t: number) => number
  next: Spec[]
  /** Removed without TweenDone: its entity went away or a newer tween took all its fields. */
  dropped: boolean
  /** `from` values have been written. */
  primed: boolean
}

/** A started tween; `.then(...)` queues another to start when this one finishes. */
export interface TweenHandle {
  readonly id: number
  /** Starts after this tween finishes. Same arguments as `Tweens.to`. */
  then(target: EntityRef, trait: Trait, values: Record<string, number>, options?: TweenOptions): TweenHandle
  then(target: object, values: Record<string, number>, options?: TweenOptions): TweenHandle
}

function isEntityRef(x: unknown): x is EntityRef {
  return typeof x === 'number' || x instanceof PendingEntity
}

function easing(e: Easing | undefined): (t: number) => number {
  if (e === undefined) return ease.outQuad
  if (typeof e === 'function') return e
  const f = ease[e]
  if (!f) throw new KilnError('unknown-ease', `Unknown ease '${e}'. Use one of: ${Object.keys(ease).join(', ')}, or a function of 0..1.`)
  return f
}

function parse(args: unknown[]): Spec {
  if (isEntityRef(args[0])) {
    const [target, trait, values, opts] = args as [EntityRef, Trait, Record<string, number>, TweenOptions?]
    if (typeof trait !== 'function') {
      throw new KilnError('tween-args', 'Tweens.to(entity, Trait, { field: value }, options): the second argument must be the trait to animate.')
    }
    return { target, trait, values, opts: opts ?? {} }
  }
  const [target, values, opts] = args as [object, Record<string, number>, TweenOptions?]
  if (typeof target !== 'object' || target === null) {
    throw new KilnError('tween-args', 'Tweens.to takes (entity, Trait, values, options) or (object, values, options), e.g. res.mut(Fade).')
  }
  return { target, trait: null, values, opts: opts ?? {} }
}

/**
 * Animates numbers over time, ticked in Fixed (deterministic; rendering interpolates Transform):
 * `res.mut(Tweens).to(entity, Transform, { y: 2, sx: 1.5 }, { duration: 0.4, ease: 'outBack' })`.
 * Works on any trait's number fields, on entities from `commands.spawn` before they exist, and on
 * plain objects such as a resource from `res.mut(R)`. A newer tween on the same fields takes them
 * over. `.then(...)` chains; `cancel(target)` stops them. Emits `TweenDone` when one finishes.
 */
export class TweenManager {
  active: Active[] = []
  private nextId = 1
  constructor(private readonly app: App) {}

  /** Starts a tween on an entity's trait fields. */
  to(target: EntityRef, trait: Trait, values: Record<string, number>, options?: TweenOptions): TweenHandle
  /** Starts a tween on a plain object's number fields (e.g. `res.mut(Fade)`). */
  to(target: object, values: Record<string, number>, options?: TweenOptions): TweenHandle
  to(...args: unknown[]): TweenHandle {
    return this.add(parse(args))
  }

  private add(spec: Spec): TweenHandle {
    const step = this.app.time.step
    const a: Active = {
      ...spec,
      id: this.nextId++,
      steps: stepsFor(spec.opts.duration ?? 0.3, step),
      delay: spec.opts.delay ? Math.round(spec.opts.delay / step) : 0,
      ticks: 0,
      run: 0,
      started: false,
      start: {},
      easeFn: easing(spec.opts.ease),
      next: [],
      dropped: false,
      primed: false,
    }
    this.active.push(a)
    return this.handle(a)
  }

  private handle(a: Active | Spec, chain?: Active): TweenHandle {
    const root = chain ?? (a as Active)
    const id = 'id' in a ? (a as Active).id : 0
    return {
      id,
      then: (...args: unknown[]) => {
        const spec = parse(args)
        root.next.push(spec)
        return this.handle(spec, root)
      },
    } as TweenHandle
  }

  /** Stops tweens on a target (optionally only one trait's). Values stay where they are. */
  cancel(target: EntityRef | object, trait?: Trait): number {
    const before = this.active.length
    const e = isEntityRef(target) ? resolve(target) : undefined
    this.active = this.active.filter((a) => !(matches(a, target, e) && (!trait || a.trait === trait)))
    return before - this.active.length
  }

  /** True while a tween on this target (and trait) is running or waiting. */
  isTweening(target: EntityRef | object, trait?: Trait): boolean {
    const e = isEntityRef(target) ? resolve(target) : undefined
    return this.active.some((a) => matches(a, target, e) && (!trait || a.trait === trait))
  }

  toJSON() {
    return {
      active: this.active.map((a) => ({
        id: a.id,
        entity: isEntityRef(a.target) ? resolve(a.target) ?? null : null,
        trait: a.trait ? traitName(a.trait) : null,
        values: a.values,
        progress: a.started ? Math.round((a.ticks / a.steps) * 1000) / 1000 : 0,
        tag: a.opts.tag ?? '',
      })),
    }
  }

  /** Advances every tween one fixed step. Called by TickTweens. */
  tick(emit: (id: number, tag: string, entity: Entity | undefined) => void): void {
    if (this.active.length === 0) return
    const world = this.app.world
    const list = this.active
    const done: Active[] = []
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!
      if (a.dropped) {
        done.push(a)
        continue
      }
      let entity: Entity | undefined
      if (a.trait) {
        entity = resolve(a.target as EntityRef)
        if (entity === undefined && a.target instanceof PendingEntity && a.target.entity === undefined) continue // not spawned yet
        if (entity === undefined || !world.has(entity) || !entity.has(a.trait)) {
          a.dropped = true
          done.push(a)
          continue
        }
      }
      if (!a.primed) {
        a.primed = true
        // `from` values show at once, during any delay, so nothing flashes at its end value first.
        if (a.opts.from) this.writeValues(a, entity, a.opts.from)
      }
      if (a.delay > 0) {
        a.delay--
        continue
      }
      if (!a.started) this.begin(a, entity)
      a.ticks++
      const p = a.ticks / a.steps
      const back = a.opts.yoyo && a.run % 2 === 1
      const k = a.easeFn(back ? 1 - p : p)
      this.write(a, entity, k)
      if (a.ticks >= a.steps) {
        const repeat = a.opts.repeat ?? 0
        if (repeat < 0 || a.run < repeat) {
          a.run++
          a.ticks = 0
        } else done.push(a)
      }
    }
    if (done.length === 0) return
    this.active = this.active.filter((a) => !done.includes(a))
    for (const a of done) {
      if (a.dropped) continue
      const entity = a.trait ? resolve(a.target as EntityRef) : undefined
      emit(a.id, a.opts.tag ?? '', entity)
      const [next, ...rest] = a.next
      if (next) {
        const h = this.add(next)
        const child = this.active.find((x) => x.id === h.id)!
        child.next.push(...rest)
        // despawn applies once the whole chain is done.
        if (a.opts.despawn) child.opts = { ...child.opts, despawn: true }
      } else if (a.opts.despawn && entity !== undefined) {
        this.app.commands.despawn(entity)
      }
    }
  }

  private begin(a: Active, entity: Entity | undefined): void {
    a.started = true
    const from = a.opts.from
    const cur = a.trait ? (entity!.get(a.trait) as Record<string, number>) : (a.target as Record<string, number>)
    for (const k of Object.keys(a.values)) {
      if (typeof cur[k] !== 'number') {
        const where = a.trait ? traitName(a.trait) : 'the object'
        throw new KilnError('tween-field', `Can't tween '${k}': ${where} has no number field '${k}'. Tween number fields only.`)
      }
      a.start[k] = from?.[k] ?? cur[k]!
    }
    // The newest tween owns its fields: drop them from older tweens on the same target.
    for (const other of this.active) {
      if (other === a || !other.started || other.trait !== a.trait || !sameTarget(other, a)) continue
      for (const k of Object.keys(a.values)) {
        delete other.values[k]
        delete other.start[k]
      }
      if (Object.keys(other.values).length === 0) other.dropped = true
    }
  }

  private writeValues(a: Active, entity: Entity | undefined, values: Record<string, number>): void {
    const patch: Record<string, number> = {}
    for (const f in values) if (f in a.values) patch[f] = values[f]!
    if (a.trait) entity!.set(a.trait, patch as never)
    else Object.assign(a.target, patch)
  }

  private write(a: Active, entity: Entity | undefined, k: number): void {
    if (a.trait) {
      const patch: Record<string, number> = {}
      for (const f in a.values) patch[f] = a.start[f]! + (a.values[f]! - a.start[f]!) * k
      entity!.set(a.trait, patch as never)
    } else {
      const obj = a.target as Record<string, number>
      for (const f in a.values) obj[f] = a.start[f]! + (a.values[f]! - a.start[f]!) * k
    }
  }
}

function resolve(t: EntityRef): Entity | undefined {
  return t instanceof PendingEntity ? t.entity : t
}

function matches(a: Active, target: unknown, e: Entity | undefined): boolean {
  if (a.target === target) return true
  return e !== undefined && isEntityRef(a.target) && resolve(a.target) === e
}

function sameTarget(a: Active, b: Active): boolean {
  if (a.target === b.target) return true
  if (!a.trait || !b.trait) return false
  const ea = resolve(a.target as EntityRef)
  return ea !== undefined && ea === resolve(b.target as EntityRef)
}

/** Running tweens. Start them with `res.mut(Tweens).to(...)`. */
export const Tweens = resource((app) => new TweenManager(app)).named('Tweens')

/** Advances tweens one fixed step and emits TweenDone. Writes whatever traits are being tweened. */
export const TickTweens = system(
  ({ res, events }) => {
    if (res.get(Tweens).active.length === 0) return
    res.mut(Tweens).tick((id, tag, entity) => events.emit(TweenDone, { id, tag, entity }))
  },
  { name: 'TickTweens', unchecked: true },
)

/** Tweens and easing: `res.mut(Tweens).to(...)`, `ease.outBack`. Part of CorePlugins. */
export const TweenPlugin = plugin((app) => {
  app.init(Tweens, TweenDone)
  app.add(Fixed, TickTweens)
}, 'TweenPlugin')
