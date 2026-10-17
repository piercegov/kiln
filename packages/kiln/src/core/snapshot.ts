import { $internal, $relation, type ConfigurableTrait, type Entity, type Relation, type Trait } from 'koota'
import type { App } from './app.ts'
import { KilnError } from './errors.ts'
import { traitByName, traitName } from './names.ts'
import type { Resource } from './resource.ts'

const ENTITY_ID_MASK = (1 << 20) - 1

/** One entity in a snapshot: its id and the values of the traits that were captured. */
export interface EntitySnapshot {
  /** Entity index. Ids are recycled; `gen` tells reuses apart. */
  id: number
  gen: number
  /** SoA traits as field objects, tags as `true`, relations as arrays of target ids. */
  traits: Record<string, unknown>
}

/** The world as JSON. This is how an agent "sees" the game without screenshots. */
export interface Snapshot {
  tick: number
  frame: number
  entities: EntitySnapshot[]
  resources?: Record<string, unknown>
}

export interface SnapshotOptions {
  /** Only these traits, and only entities that have at least one of them. Default: every trait. */
  traits?: Trait[]
  /** Resources to include, or true for all JSON-friendly ones. Default: none. */
  resources?: Resource<any>[] | boolean
  /** Round numbers to this many decimals. Default: exact. */
  precision?: number
  /** Leave out struct fields equal to the trait's default, for compact output. */
  omitDefaults?: boolean
  /** Keep non-JSON values (Three.js objects) by reference. In-memory only; used by hot reload. */
  refs?: boolean
}

function round(v: unknown, p: number | undefined): unknown {
  if (p === undefined || typeof v !== 'number' || Number.isInteger(v)) return v
  const f = 10 ** p
  const r = Math.round(v * f) / f
  return Object.is(r, -0) ? 0 : r
}

function relationOf(t: Trait): Relation<Trait> | null {
  return (t[$internal] as any).relation ?? null
}

function jsonable(v: unknown, depth = 0): boolean {
  if (v === null || ['number', 'string', 'boolean'].includes(typeof v)) return true
  if (depth > 4 || typeof v !== 'object') return false
  if (typeof (v as any).toJSON === 'function') return true
  const proto = Object.getPrototypeOf(v)
  if (Array.isArray(v)) return v.every((x) => jsonable(x, depth + 1))
  if (proto !== Object.prototype && proto !== null) return false
  return Object.values(v as object).every((x) => jsonable(x, depth + 1))
}

function valueOf(e: Entity, t: Trait, opts: SnapshotOptions): { ok: boolean; value: unknown } {
  const type = t[$internal].type
  if (type === 'tag') return { ok: true, value: true }
  const raw = e.get(t)
  if (type === 'soa') {
    const out: Record<string, unknown> = {}
    const schema = t.schema as Record<string, unknown>
    for (const [k, v] of Object.entries(raw as object)) {
      if (opts.omitDefaults && schema[k] === v) continue
      if (jsonable(v)) out[k] = round(v, opts.precision)
      else if (opts.refs) out[k] = v
    }
    return { ok: true, value: out }
  }
  if (opts.refs) return { ok: true, value: raw }
  if (jsonable(raw)) return { ok: true, value: typeof (raw as any)?.toJSON === 'function' ? (raw as any).toJSON() : raw }
  return { ok: false, value: undefined }
}

/** Captures entities and trait values. Entities are sorted by id; trait keys by name. */
export function takeSnapshot(app: App, opts: SnapshotOptions = {}): Snapshot {
  const world = app.world
  const only = opts.traits ? new Set(opts.traits) : null
  const ctx = world[$internal]
  const entities: EntitySnapshot[] = []
  for (const e of world.query()) {
    const id = (e as number) & ENTITY_ID_MASK
    const set = ctx.entityTraits.get(e) as Set<Trait> | undefined
    if (!set) continue
    const traits: Record<string, unknown> = {}
    let matched = false
    const sorted = [...set].sort((a, b) => traitName(a).localeCompare(traitName(b)))
    for (const t of sorted) {
      const rel = relationOf(t)
      if (rel) {
        if (only && !only.has(t) && !only.has(rel as unknown as Trait)) continue
        traits[traitName(rel as unknown as Trait)] = e.targetsFor(rel).map((x) => (x as number) & ENTITY_ID_MASK)
        matched = true
        continue
      }
      if (only && !only.has(t)) continue
      const { ok, value } = valueOf(e, t, opts)
      if (ok) {
        traits[traitName(t)] = value
        matched = true
      }
    }
    if (only && !matched) continue
    entities.push({ id, gen: e.generation(), traits })
  }
  entities.sort((a, b) => a.id - b.id)
  const snap: Snapshot = { tick: app.time.tick, frame: app.time.frame, entities }
  if (opts.resources) {
    // Time lives in snapshot.tick/frame; `resources: true` means game state.
    const list = opts.resources === true ? app.resourceList().filter((r) => r.name !== 'Time') : opts.resources
    const res: Record<string, unknown> = {}
    for (const r of list) {
      const v = app.resource(r)
      if (opts.refs) res[r.name] = v
      else if (jsonable(v)) res[r.name] = JSON.parse(JSON.stringify(v))
    }
    snap.resources = res
  }
  return snap
}

export interface FieldChange {
  id: number
  trait: string
  field?: string
  from: unknown
  to: unknown
}

/** What changed between two snapshots. */
export interface SnapshotDiff {
  added: EntitySnapshot[]
  removed: number[]
  changed: FieldChange[]
  resources: { name: string; field?: string; from: unknown; to: unknown }[]
  /** True when nothing changed. */
  same: boolean
}

function eq(a: unknown, b: unknown, eps: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b || Math.abs(a - b) <= eps
  return JSON.stringify(a) === JSON.stringify(b)
}

function diffValue(
  a: unknown,
  b: unknown,
  eps: number,
  push: (field: string | undefined, from: unknown, to: unknown) => void,
): void {
  const isObj = (x: unknown) => typeof x === 'object' && x !== null && !Array.isArray(x)
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
    for (const k of keys) {
      const av = (a as any)[k]
      const bv = (b as any)[k]
      if (!eq(av, bv, eps)) push(k, av, bv)
    }
  } else if (!eq(a, b, eps)) push(undefined, a, b)
}

/** Field-level diff. Numbers within `epsilon` (default 0) count as equal. */
export function diffSnapshots(a: Snapshot, b: Snapshot, epsilon = 0): SnapshotDiff {
  const key = (e: EntitySnapshot) => `${e.id}:${e.gen ?? 0}`
  const am = new Map(a.entities.map((e) => [key(e), e]))
  const bm = new Map(b.entities.map((e) => [key(e), e]))
  const added = b.entities.filter((e) => !am.has(key(e)))
  const removed = a.entities.filter((e) => !bm.has(key(e))).map((e) => e.id)
  const changed: FieldChange[] = []
  for (const [k, be] of bm) {
    const ae = am.get(k)
    if (!ae) continue
    const id = be.id
    const keys = new Set([...Object.keys(ae.traits), ...Object.keys(be.traits)])
    for (const trait of keys) {
      diffValue(ae.traits[trait], be.traits[trait], epsilon, (field, from, to) =>
        changed.push(field === undefined ? { id, trait, from, to } : { id, trait, field, from, to }),
      )
    }
  }
  const resources: SnapshotDiff['resources'] = []
  const ar = a.resources ?? {}
  const br = b.resources ?? {}
  for (const name of new Set([...Object.keys(ar), ...Object.keys(br)])) {
    diffValue(ar[name], br[name], epsilon, (field, from, to) =>
      resources.push(field === undefined ? { name, from, to } : { name, field, from, to }),
    )
  }
  return { added, removed, changed, resources, same: !added.length && !removed.length && !changed.length && !resources.length }
}

/**
 * Replaces the app's entities with the snapshot's. Traits are looked up by name, so a snapshot
 * taken before a code change restores into the new code; unknown traits are reported, not lost
 * silently. Entity ids are remapped; relations follow the remap.
 */
export function restoreSnapshot(app: App, snap: Snapshot): { missingTraits: string[] } {
  const world = app.world
  for (const e of world.query()) e.destroy()
  const missing = new Set<string>()
  const idMap = new Map<number, Entity>()
  const relations: { e: Entity; rel: Relation<Trait>; targets: number[] }[] = []
  for (const es of snap.entities) {
    const list: ConfigurableTrait[] = []
    for (const [name, value] of Object.entries(es.traits)) {
      const t = traitByName(name) as any
      if (!t) {
        missing.add(name)
        continue
      }
      if (t[$relation]) {
        // A relation: re-link after every entity exists.
        continue
      }
      const type = t[$internal].type
      if (type === 'tag') list.push(t)
      else list.push(t(value))
    }
    const e = world.spawn(...list)
    idMap.set(es.id, e)
    for (const [name, value] of Object.entries(es.traits)) {
      const t = traitByName(name) as any
      if (t && t[$relation] && Array.isArray(value)) relations.push({ e, rel: t, targets: value as number[] })
    }
  }
  for (const { e, rel, targets } of relations) {
    for (const id of targets) {
      const target = idMap.get(id)
      if (target !== undefined) e.add(rel(target))
    }
  }
  app.time.tick = snap.tick
  app.time.frame = snap.frame
  app.time.elapsed = snap.tick * app.time.step
  if (snap.resources) {
    for (const r of app.resourceList()) {
      if (r.name === 'Time') continue
      const saved = snap.resources[r.name]
      if (saved === undefined) continue
      const cur = app.resource(r) as any
      if (typeof cur === 'object' && cur !== null && typeof saved === 'object' && saved !== null && cur !== saved) Object.assign(cur, saved)
      else if (cur !== saved) app.insert(r, saved)
    }
  }
  return { missingTraits: [...missing] }
}

export function snapshotTraitsByName(names: string[]): Trait[] {
  return names.map((n) => {
    const t = traitByName(n)
    if (!t) {
      throw new KilnError('unknown-trait', `No trait named "${n}". Run \`kiln describe\` for the list of traits.`)
    }
    return t
  })
}
