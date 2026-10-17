import type { App } from './app.ts'
import { nameOf, setName } from './names.ts'

export const $resource = Symbol.for('kiln.resource')

/** A singleton value owned by the app: input, RNG, score, config. */
export interface Resource<T = unknown> {
  readonly [$resource]: true
  readonly create: (app: App) => T
  /** Skip the dev read-only proxy (for Three.js objects and other class graphs). */
  readonly opaque: boolean
  /** Name used in errors, snapshots and `kiln describe`. */
  readonly name: string
  named(name: string): this
}

/**
 * Defines a resource. Pass default fields (copied per app) or a factory:
 * `resource({ value: 0 })`, `resource((app) => new Thing(app.config.seed))`.
 */
export interface ResourceOptions {
  /**
   * false: res.get() returns the raw value instead of a read-only proxy in dev. Use it for
   * Three.js objects, which break when proxied.
   */
  readonlyProxy?: boolean
}

export function resource<T extends object>(init: T | ((app: App) => T), options: ResourceOptions = {}): Resource<T> {
  const create =
    typeof init === 'function'
      ? (init as (app: App) => T)
      : () => structuredCloneSafe(init as T)
  const r: Resource<T> = {
    [$resource]: true,
    create,
    opaque: options.readonlyProxy === false,
    get name() {
      return nameOf(r, 'Resource')
    },
    named(name: string) {
      setName(r, name, true)
      return r
    },
  }
  return r
}

export function isResource(x: unknown): x is Resource {
  return typeof x === 'object' && x !== null && (x as any)[$resource] === true
}

function structuredCloneSafe<T>(v: T): T {
  try {
    return structuredClone(v)
  } catch {
    return { ...(v as object) } as T
  }
}
