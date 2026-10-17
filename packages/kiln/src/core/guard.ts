import { $internal, type Trait, type World } from 'koota'
import { KilnError } from './errors.ts'
import { traitName } from './names.ts'

/** What the dev guards need to know about the running system. */
export interface GuardTarget {
  readonly name: string
  readonly phaseName: string
  readonly writes: ReadonlySet<Trait>
  readonly unchecked: boolean
}

/** The system currently running, or null between systems. Single-threaded, so one slot is enough. */
export const guard: { current: GuardTarget | null } = { current: null }

let installed = false

function relTrait(t: any): Trait | undefined {
  if (!t) return undefined
  if (t.relation) return t.relation[$internal]?.trait
  return t
}

function isSoA(t: Trait): boolean {
  return t[$internal]?.type === 'soa'
}

/**
 * Patches Koota's entity methods so that, while a system runs in a dev app, structural changes
 * and undeclared writes throw an error naming the fix. Installed once; costs one null check when
 * no system is running.
 */
export function installEntityGuards(): void {
  if (installed) return
  installed = true
  const proto = Number.prototype as any
  const orig = {
    add: proto.add,
    remove: proto.remove,
    destroy: proto.destroy,
    set: proto.set,
    get: proto.get,
  }

  proto.add = function (...traits: unknown[]) {
    const s = guard.current
    if (s && !s.unchecked) {
      throw new KilnError(
        'structural-in-system',
        `${s.name} called entity.add() during ${s.phaseName}. Use commands.add(entity, ...traits); it applies at the end of the phase.`,
      )
    }
    return orig.add.apply(this, traits)
  }
  proto.remove = function (...traits: unknown[]) {
    const s = guard.current
    if (s && !s.unchecked) {
      throw new KilnError(
        'structural-in-system',
        `${s.name} called entity.remove() during ${s.phaseName}. Use commands.remove(entity, ...traits); it applies at the end of the phase.`,
      )
    }
    return orig.remove.apply(this, traits)
  }
  proto.destroy = function () {
    const s = guard.current
    if (s && !s.unchecked) {
      throw new KilnError(
        'structural-in-system',
        `${s.name} called entity.destroy() during ${s.phaseName}. Use commands.despawn(entity); it applies at the end of the phase.`,
      )
    }
    return orig.destroy.apply(this)
  }
  proto.set = function (t: any, value: unknown, flag?: boolean) {
    const s = guard.current
    if (s && !s.unchecked) {
      const tr = relTrait(t)
      if (tr && !s.writes.has(tr)) {
        const n = traitName(tr)
        throw new KilnError(
          'undeclared-write',
          `${s.name} wrote ${n} with entity.set() but doesn't declare Mut(${n}). Add Mut(${n}) to its query.`,
        )
      }
    }
    return orig.set.call(this, t, value, flag)
  }
  proto.get = function (t: any) {
    const value = orig.get.call(this, t)
    const s = guard.current
    if (s && !s.unchecked && value !== undefined && t && !t.relation && isSoA(t)) {
      return readonlyCopy(value, s, t)
    }
    return value
  }
}

function readonlyCopy(value: object, s: GuardTarget, t: Trait): object {
  return new Proxy(value, {
    set(_, key) {
      const n = traitName(t)
      const fix = s.writes.has(t)
        ? `Use entity.set(${n}, { ${String(key)}: ... }) or write through a query row.`
        : `Add Mut(${n}) to the query and write through the row, or use entity.set(${n}, {...}).`
      throw new KilnError(
        'write-to-copy',
        `${s.name} wrote ${n}.${String(key)} on the copy entity.get() returns, so the write would be lost. ${fix}`,
      )
    },
  })
}

const WORLD_WRITES = new Set(['spawn', 'add', 'remove', 'set', 'destroy', 'reset', 'init'])

/**
 * Wraps the world so systems can read through it but not write. Dev builds only.
 */
export function readonlyWorld(world: World, who: () => GuardTarget | null): World {
  const cache = new Map<PropertyKey, unknown>()
  return new Proxy(world, {
    get(target, key, receiver) {
      if (typeof key === 'string' && WORLD_WRITES.has(key)) {
        return (...args: unknown[]) => {
          const s = who()
          if (!s || s.unchecked) return (target as any)[key](...args)
          const fix =
            key === 'spawn'
              ? 'Use commands.spawn(...).'
              : key === 'destroy' || key === 'reset'
                ? 'Systems cannot destroy the world.'
                : key === 'set'
                  ? 'Use res.mut(Resource) for app-wide state.'
                  : `Use commands.${key}(entity, ...).`
          throw new KilnError('world-write', `${s.name} called world.${key}() through ctx.world, which is read-only. ${fix}`)
        }
      }
      const v = Reflect.get(target, key, receiver)
      if (typeof v !== 'function') return v
      let bound = cache.get(key)
      if (!bound) {
        bound = (v as Function).bind(target)
        cache.set(key, bound)
      }
      return bound
    },
    set(_, key) {
      throw new KilnError('world-write', `Cannot assign world.${String(key)}. ctx.world is read-only.`)
    },
  })
}
