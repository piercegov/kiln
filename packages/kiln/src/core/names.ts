import { $internal, type Trait } from 'koota'

/**
 * Kiln names things after their export: `export const Movement = system(...)` is "Movement".
 * The names transform (kiln/vite, kiln/preload) appends `__kiln_name(Movement, "Movement")`
 * to each module; `.named()` or a `name` option override it.
 */
const names = new WeakMap<object, string>()
const traitsByName = new Map<string, Trait>()

export function setName(obj: unknown, name: string, override = false): void {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return
  if (!override && names.has(obj)) return
  names.set(obj, name)
  if (isTrait(obj)) traitsByName.set(name, obj)
}

export function nameOf(obj: unknown, fallback = 'anonymous'): string {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return fallback
  return names.get(obj) ?? fallback
}

export function hasName(obj: object): boolean {
  return names.has(obj)
}

/** Looks up a named trait, for restoring snapshots. */
export function traitByName(name: string): Trait | undefined {
  return traitsByName.get(name)
}

export function namedTraits(): ReadonlyMap<string, Trait> {
  return traitsByName
}

export function isTrait(x: unknown): x is Trait {
  return typeof x === 'function' && 'schema' in x && (x as any)[$internal] !== undefined && !('relation' in x)
}

/** Name of a Koota trait, falling back to its numeric id. */
export function traitName(t: Trait): string {
  return nameOf(t, `Trait#${t.id}`)
}

let pending: string | null = null

/** Takes the name the transform announced for the factory call that is starting, if any. */
export function takePendingName(): string | null {
  const n = pending
  pending = null
  return n
}

;(globalThis as any).__kiln_name = (obj: unknown, name: string) => setName(obj, name)
;(globalThis as any).__kiln_n = (name: string) => {
  pending = name
}
