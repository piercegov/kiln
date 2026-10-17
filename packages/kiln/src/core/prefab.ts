import type { ConfigurableTrait } from 'koota'
import { nameOf, setName, takePendingName } from './names.ts'

export const $prefab = Symbol.for('kiln.prefab')

/** A named spawn recipe, so agents never hand-assemble trait lists. */
export interface Prefab<P = void> {
  readonly [$prefab]: true
  readonly build: (params: P) => ConfigurableTrait[]
  readonly name: string
  named(name: string): this
}

/**
 * Defines a prefab:
 * `export const Enemy = prefab((p: { at: Vec3 }) => [Transform({ ...p.at }), Health({ hp: 30 })])`
 * then `commands.spawn(Enemy, { at })`.
 */
export function prefab<P = void>(build: (params: P) => ConfigurableTrait[]): Prefab<P> {
  const pendingName = takePendingName()
  const p: Prefab<P> = {
    [$prefab]: true,
    build,
    get name() {
      return nameOf(p, 'Prefab')
    },
    named(name: string) {
      setName(p, name, true)
      return p
    },
  }
  if (pendingName) setName(p, pendingName)
  return p
}

export function isPrefab(x: unknown): x is Prefab<any> {
  return typeof x === 'object' && x !== null && (x as any)[$prefab] === true
}

/** Arguments accepted by every spawn: a prefab plus its params, or a plain trait list. */
export type SpawnArgs<P> = [prefab: Prefab<P>, ...params: P extends void ? [] : [P]] | ConfigurableTrait[]

export function resolveSpawn(args: unknown[]): ConfigurableTrait[] {
  const [first, ...rest] = args
  if (isPrefab(first)) return first.build(rest[0] as never)
  return args as ConfigurableTrait[]
}
