import { $internal, $relation, type ConfigurableTrait, type Entity, type Trait } from 'koota'
import type { App } from '../../core/app.ts'
import { KilnError } from '../../core/errors.ts'
import { event } from '../../core/event.ts'
import { traitName } from '../../core/names.ts'
import { plugin, type Plugin } from '../../core/plugin.ts'
import { resource, type Resource } from '../../core/resource.ts'
import { takeSnapshot, type EntitySnapshot } from '../../core/snapshot.ts'

/** Where saves go. localStorage in the browser; memory otherwise (or pass your own). */
export interface SaveStorage {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
  /** Keys starting with `prefix`. */
  keys(prefix: string): string[]
}

/** In-memory storage. Share one between apps to test that data survives a restart. */
export function memoryStorage(): SaveStorage {
  const m = new Map<string, string>()
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
    keys: (p) => [...m.keys()].filter((k) => k.startsWith(p)),
  }
}

/** The browser's localStorage, or null where there is none. */
export function localStorageStorage(): SaveStorage | null {
  const ls = (globalThis as any).localStorage as Storage | undefined
  if (!ls) return null
  return {
    get: (k) => ls.getItem(k),
    set: (k, v) => ls.setItem(k, v),
    remove: (k) => ls.removeItem(k),
    keys: (p) => {
      const out: string[] = []
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i)
        if (k?.startsWith(p)) out.push(k)
      }
      return out
    },
  }
}

export interface SaveOptions {
  /** Resources written to save slots (game progress: level, score, inventory). */
  resources?: Resource<any>[]
  /**
   * Entities to save: every entity with at least one of these traits, with these traits' values.
   * Loading replaces those entities. Non-JSON traits (MeshRef) can't be saved: rebuild visuals on
   * `Loaded`, or with a system over `[IsCoin, Not(MeshRef)]`.
   */
  traits?: Trait[]
  /** Resources kept across sessions automatically (settings, high scores): loaded at startup, saved when they change. */
  persist?: Resource<any>[]
  /** Storage key prefix, so games on one origin don't collide. Default 'kiln'. */
  key?: string
  /** Default: localStorage in the browser, memory elsewhere. */
  storage?: SaveStorage
}

/** A slot was written. */
export const Saved = event<{ slot: string }>()
/** A slot was loaded: saved entities and resources are back. Rebuild anything not saved (meshes). */
export const Loaded = event<{ slot: string }>()

interface SaveFile {
  version: 1
  tick: number
  resources: Record<string, unknown>
  entities: EntitySnapshot[]
}

/**
 * Save slots: `res.mut(Saves).save('slot1')` writes now; `.load('slot1')` applies at the start of
 * the next frame and emits `Loaded`. Also `has`, `delete`, `slots()`. What is saved comes from
 * `savePlugin({ resources, traits })`.
 */
export class SaveSlots {
  /** A load requested this frame, applied at the next frame start. */
  pendingLoad: string | null = null

  constructor(
    private readonly app: App,
    private readonly opts: Required<Pick<SaveOptions, 'resources' | 'traits' | 'key'>> & { storage: SaveStorage },
  ) {}

  private slotKey(slot: string): string {
    if (typeof slot !== 'string' || slot === '') throw new KilnError('save-slot', 'Save slots are non-empty strings: saves.save(\'slot1\').')
    return `${this.opts.key}:slot:${slot}`
  }

  /** Writes the slot now and emits Saved. Returns the JSON written. */
  save(slot = 'auto'): string {
    // With no traits configured the filter matches nothing, so only resources are saved.
    const snap = takeSnapshot(this.app, { traits: this.opts.traits, resources: this.opts.resources })
    const file: SaveFile = { version: 1, tick: snap.tick, resources: snap.resources ?? {}, entities: snap.entities }
    const json = JSON.stringify(file)
    this.opts.storage.set(this.slotKey(slot), json)
    this.app.bus.emit(Saved, { slot })
    return json
  }

  /** Loads the slot at the start of the next frame. Returns false (and does nothing) if it doesn't exist. */
  load(slot = 'auto'): boolean {
    if (this.opts.storage.get(this.slotKey(slot)) === null) return false
    this.pendingLoad = slot
    return true
  }

  has(slot = 'auto'): boolean {
    return this.opts.storage.get(this.slotKey(slot)) !== null
  }

  delete(slot = 'auto'): void {
    this.opts.storage.remove(this.slotKey(slot))
  }

  /** Slot names that exist, sorted. */
  slots(): string[] {
    const p = `${this.opts.key}:slot:`
    return this.opts.storage.keys(p).map((k) => k.slice(p.length)).sort()
  }

  /** @internal Applies a pending load. Runs outside systems, at frame start. */
  applyPending(): void {
    const slot = this.pendingLoad
    if (slot === null) return
    this.pendingLoad = null
    const raw = this.opts.storage.get(this.slotKey(slot))
    if (raw === null) return
    let file: SaveFile
    try {
      file = JSON.parse(raw)
    } catch (err) {
      throw new KilnError('save-corrupt', `Save slot '${slot}' isn't valid JSON. Delete it with saves.delete('${slot}').`, { cause: err })
    }
    restoreEntities(this.app, this.opts.traits, file.entities ?? [])
    applyResources(this.app, this.opts.resources, file.resources ?? {})
    this.app.bus.emit(Loaded, { slot })
  }

  toJSON() {
    return { slots: this.slots(), pendingLoad: this.pendingLoad }
  }
}

function restoreEntities(app: App, traits: Trait[], saved: EntitySnapshot[]): void {
  if (traits.length === 0) return
  const world = app.world
  const byName = new Map(traits.map((t) => [traitName(t), t]))
  const doomed = new Set<Entity>()
  for (const t of traits) if (!(t as any)[$relation]) for (const e of world.query(t)) doomed.add(e)
  for (const e of doomed) if (world.has(e)) e.destroy()
  const idMap = new Map<number, Entity>()
  const links: { e: Entity; rel: any; targets: number[] }[] = []
  for (const es of saved) {
    const list: ConfigurableTrait[] = []
    for (const [name, value] of Object.entries(es.traits)) {
      const t = byName.get(name) as any
      if (!t || t[$relation]) continue
      list.push(t[$internal].type === 'tag' ? t : t(value))
    }
    const e = world.spawn(...list)
    idMap.set(es.id, e)
    for (const [name, value] of Object.entries(es.traits)) {
      const t = byName.get(name) as any
      if (t?.[$relation] && Array.isArray(value)) links.push({ e, rel: t, targets: value })
    }
  }
  for (const { e, rel, targets } of links) for (const id of targets) if (idMap.has(id)) e.add(rel(idMap.get(id)!))
}

function applyResources(app: App, list: Resource<any>[], saved: Record<string, unknown>): void {
  for (const r of list) {
    const v = saved[r.name]
    if (v === undefined) continue
    applyResource(app, r, v)
  }
}

function applyResource(app: App, r: Resource<any>, v: unknown): void {
  const cur = app.resource(r) as any
  if (typeof cur?.restore === 'function') cur.restore(v)
  else if (cur && typeof cur === 'object' && typeof v === 'object' && v !== null) Object.assign(cur, structuredClone(v))
}

export const Saves = resource((): SaveSlots => {
  throw new KilnError('no-save-plugin', 'Saves needs the save plugin: .use(savePlugin({ resources: [...], traits: [...] })).')
}).named('Saves')

/**
 * Save slots and persisted settings. `savePlugin({ resources: [Level, Score], traits: [IsPlayer,
 * Transform, Health], persist: [Settings, HighScore] })`. Systems call `res.mut(Saves).save('slot1')`
 * / `.load('slot1')`; `persist` resources load before Startup and save themselves when they change.
 */
export function savePlugin(options: SaveOptions = {}): Plugin {
  return plugin((app) => {
    const storage = options.storage ?? localStorageStorage() ?? memoryStorage()
    const key = options.key ?? 'kiln'
    const slots = new SaveSlots(app, { resources: options.resources ?? [], traits: options.traits ?? [], key, storage })
    app.insert(Saves, slots)
    app.init(Saved, Loaded)
    for (const r of options.resources ?? []) app.init(r)

    // Persisted resources: load now (before Startup), save when their JSON changes.
    const persisted = (options.persist ?? []).map((r) => {
      const k = `${key}:persist:${r.name}`
      app.init(r)
      const raw = storage.get(k)
      if (raw !== null) {
        try {
          applyResource(app, r, JSON.parse(raw))
        } catch {
          console.warn(`[save] ignoring unreadable saved ${r.name}; it will be overwritten.`)
        }
      }
      return { r, k, last: JSON.stringify(app.resource(r)) }
    })
    const flush = () => {
      for (const p of persisted) {
        const json = JSON.stringify(app.resource(p.r))
        if (json === p.last) continue
        p.last = json
        storage.set(p.k, json)
      }
    }
    app.hooks.frameStart.push(() => {
      flush()
      slots.applyPending()
    })
    app.hooks.dispose.push(flush)
  }, 'SavePlugin')
}

