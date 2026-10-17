import {
  $internal,
  createAdded,
  createChanged,
  createQuery,
  createRemoved,
  getStore,
  type Entity,
  type Query,
  type QueryParameter,
  type Trait,
  type World,
} from 'koota'
import { $track, isMut, isTrack, type QueryList, type QueryView, type TrackParam } from './access.ts'
import { KilnError } from './errors.ts'
import { isTrait, traitName } from './names.ts'

const ENTITY_ID_MASK = (1 << 20) - 1

/** Traits a query reads and writes, for the scheduler and `kiln describe`. */
export interface Access {
  reads: Set<Trait>
  writes: Set<Trait>
}

function filterTraits(p: any): Trait[] {
  if (isTrack(p)) return [...p.traits]
  if (p && Array.isArray(p.traits)) return p.traits // Koota Not/Or modifiers
  if (p && p.relation) return [p.relation[$internal].trait] // relation pair
  return []
}

export function accessOf(list: QueryList, into: Access): void {
  for (const p of list) {
    if (isMut(p)) into.writes.add(p.trait)
    else if (isTrait(p)) into.reads.add(p)
    else for (const t of filterTraits(p)) into.reads.add(t)
  }
  for (const w of into.writes) into.reads.delete(w)
}

interface Slot {
  trait: Trait
  aos: boolean
  view: any
  store: any
}

/** A per-system tracker instance for each Kiln Changed/Added/Removed marker. */
function toKoota(p: TrackParam): QueryParameter {
  const make = p[$track] === 'changed' ? createChanged() : p[$track] === 'added' ? createAdded() : createRemoved()
  return make(...p.traits)
}


/**
 * Builds a reusable row view for a struct-of-arrays trait. Fields are own enumerable accessors,
 * so spreading or JSON.stringify works; writes go straight to the store with no allocation.
 */
function makeView(trait: Trait, mut: boolean, systemName: () => string, world: World): any {
  const view: any = {}
  Object.defineProperty(view, '_i', { value: 0, writable: true, enumerable: false })
  Object.defineProperty(view, '_e', { value: 0, writable: true, enumerable: false })
  Object.defineProperty(view, '_s', { value: null, writable: true, enumerable: false })
  const keys = Object.keys(trait.schema as object)
  const inst = () => world[$internal].traitInstances[trait.id]!
  for (const key of keys) {
    Object.defineProperty(view, key, {
      enumerable: true,
      get() {
        return this._s[key][this._i]
      },
      set: mut
        ? function (this: any, v: unknown) {
            const arr = this._s[key]
            if (arr[this._i] !== v) {
              arr[this._i] = v
              const ti = inst()
              if (ti.trackingQueries.size > 0 || ti.changeSubscriptions.size > 0) (this._e as Entity).changed(trait)
            }
          }
        : function () {
            const n = traitName(trait)
            throw new KilnError(
              'readonly-write',
              `${systemName()} wrote ${n}.${key}, but its query takes ${n} read-only. Use Mut(${n}) in the query.`,
            )
          },
    })
  }
  Object.seal(view)
  return view
}

/** One query, compiled for one system in one world. */
export class RowPlan {
  readonly ref: Query<any>
  private slots: Slot[] = []
  private row: unknown[] = []
  private storesReady = false

  constructor(
    private world: World,
    list: QueryList,
    systemName: () => string,
  ) {
    const params: QueryParameter[] = []
    for (const p of list) {
      if (isMut(p)) {
        params.push(p.trait)
        this.addSlot(p.trait, true, systemName)
      } else if (isTrack(p)) {
        params.push(toKoota(p))
      } else {
        params.push(p as QueryParameter)
        if (isTrait(p)) this.addSlot(p, false, systemName)
      }
    }
    this.ref = createQuery(...params)
  }

  private addSlot(trait: Trait, mut: boolean, systemName: () => string) {
    const type = trait[$internal].type
    if (type === 'tag') return
    const aos = type === 'aos'
    this.slots.push({ trait, aos, view: aos ? null : makeView(trait, mut, systemName, this.world), store: null })
    this.row.push(undefined)
  }

  entities(): readonly Entity[] {
    const ents = this.world.query(this.ref)
    if (!this.storesReady) {
      for (const s of this.slots) {
        s.store = getStore(this.world, s.trait)
        if (s.view) s.view._s = s.store
      }
      this.storesReady = true
    }
    return ents
  }

  /** Calls fn(row, entity) for each entity. The row array and its views are reused. */
  each(ents: readonly Entity[], fn: (row: any, entity: Entity) => void): void {
    const slots = this.slots
    const row = this.row
    const n = slots.length
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i]!
      const eid = (e as number) & ENTITY_ID_MASK
      for (let k = 0; k < n; k++) {
        const s = slots[k]!
        if (s.aos) row[k] = s.store[eid]
        else {
          s.view._i = eid
          s.view._e = e
          row[k] = s.view
        }
      }
      fn(row, e)
    }
  }
}

/** The object behind each named query. One per system, refreshed every run. */
export class NamedQueryView implements QueryView<any> {
  private ents: readonly Entity[] = []
  constructor(readonly plan: RowPlan) {}

  refresh(): void {
    this.ents = this.plan.entities()
  }
  get length() {
    return this.ents.length
  }
  get entities() {
    return this.ents
  }
  first(): Entity | undefined {
    return this.ents[0]
  }
  forEach(fn: (entity: Entity, index: number) => void): void {
    const ents = this.ents
    for (let i = 0; i < ents.length; i++) fn(ents[i]!, i)
  }
  each(fn: (row: any, entity: Entity) => void): void {
    this.plan.each(this.ents, fn)
  }
  [Symbol.iterator](): Iterator<Entity> {
    return this.ents[Symbol.iterator]()
  }
}
