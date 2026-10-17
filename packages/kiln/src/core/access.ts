import type { Entity, IsTag, QueryParameter, Trait, TraitRecord } from 'koota'

export const $mut = Symbol.for('kiln.mut')
export const $track = Symbol.for('kiln.track')

/** A write declaration inside a query: `Mut(Transform)`. */
export interface MutParam<T extends Trait = Trait> {
  readonly [$mut]: true
  readonly trait: T
}

/**
 * Marks a trait as written by this system. Every other trait in the query arrives read-only,
 * and the scheduler uses Mut() as the system's write set.
 */
export function Mut<T extends Trait>(trait: T): MutParam<T> {
  return { [$mut]: true, trait }
}

export function isMut(p: unknown): p is MutParam {
  return typeof p === 'object' && p !== null && (p as any)[$mut] === true
}

export type TrackKind = 'changed' | 'added' | 'removed'

/** A change-tracking filter. Each system gets its own tracker, so systems never steal each other's changes. */
export interface TrackParam {
  readonly [$track]: TrackKind
  readonly traits: readonly Trait[]
}

function tracker(kind: TrackKind) {
  return (...traits: Trait[]): TrackParam => ({ [$track]: kind, traits })
}

/** Filter: entities whose traits changed since this system last ran. */
export const Changed = tracker('changed')
/** Filter: entities that gained these traits since this system last ran. */
export const Added = tracker('added')
/** Filter: entities that lost these traits (or were despawned) since this system last ran. */
export const Removed = tracker('removed')

export function isTrack(p: unknown): p is TrackParam {
  return typeof p === 'object' && p !== null && (p as any)[$track] !== undefined
}

/** Anything that can appear in a Kiln query. */
export type QueryParam = QueryParameter | MutParam | TrackParam

export type QueryList = readonly QueryParam[]

type DataOf<T extends Trait> = IsTag<T> extends true ? [] : [TraitRecord<T>]
type ReadOf<T extends Trait> = IsTag<T> extends true ? [] : [Readonly<TraitRecord<T>>]

/** Only plain traits and Mut(T) produce row entries, in order. Tags and filters produce none. */
export type Row<P extends QueryList> = P extends readonly [infer F, ...infer R extends QueryList]
  ? [
      ...(F extends MutParam<infer T> ? DataOf<T> : F extends Trait ? ReadOf<F> : []),
      ...Row<R>,
    ]
  : []

/** The result of one named query inside `system({ a: [...], b: [...] }, fn)`. */
export interface QueryView<P extends QueryList = QueryList> extends Iterable<Entity> {
  /** Number of matching entities this run. */
  readonly length: number
  /** The matching entities. Do not keep this array across runs. */
  readonly entities: readonly Entity[]
  /** First matching entity, or undefined. */
  first(): Entity | undefined
  /** Calls fn for every matching entity. */
  forEach(fn: (entity: Entity, index: number) => void): void
  /** Like the per-entity system form: rows honour Mut() and read-only access. */
  each(fn: (row: Row<P>, entity: Entity) => void): void
}

export type NamedQueries = Record<string, QueryList>

export type QueryViews<Q extends NamedQueries> = { [K in keyof Q]: QueryView<Q[K]> }
