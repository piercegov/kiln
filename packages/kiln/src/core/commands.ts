import type { ConfigurableTrait, Entity, RelationPair, Trait, World } from 'koota'
import { KilnError } from './errors.ts'
import { resolveSpawn, type Prefab } from './prefab.ts'

/** An entity queued by `commands.spawn`. `entity` is set once commands apply at the phase boundary. */
export class PendingEntity {
  entity: Entity | undefined = undefined
  /** The spawned entity. Throws if commands haven't applied yet. */
  get(): Entity {
    if (this.entity === undefined) {
      throw new KilnError(
        'pending-entity',
        'This entity is still queued: commands apply at the end of the phase. Read it in a later system or phase, or keep the PendingEntity and pass it to other commands.',
      )
    }
    return this.entity
  }
}

export type EntityRef = Entity | PendingEntity

type Op =
  | { k: 'spawn'; traits: ConfigurableTrait[]; pending: PendingEntity }
  | { k: 'despawn'; e: EntityRef }
  | { k: 'add'; e: EntityRef; traits: ConfigurableTrait[] }
  | { k: 'remove'; e: EntityRef; traits: (Trait | RelationPair)[] }
  | { k: 'run'; fn: (world: World) => void }

function resolve(e: EntityRef): Entity | undefined {
  return e instanceof PendingEntity ? e.entity : e
}

/** The app-wide queue that every system's `commands` writes to. Applied at phase boundaries. */
export class CommandQueue {
  private ops: Op[] = []

  push(op: Op): void {
    this.ops.push(op)
  }

  get size(): number {
    return this.ops.length
  }

  /** Applies queued ops in order. Ops on entities that are already gone are skipped. */
  apply(world: World): void {
    // Ops may queue more ops (e.g. hooks); loop until empty.
    while (this.ops.length > 0) {
      const ops = this.ops
      this.ops = []
      for (const op of ops) {
        switch (op.k) {
          case 'spawn':
            op.pending.entity = world.spawn(...op.traits)
            break
          case 'despawn': {
            const e = resolve(op.e)
            if (e !== undefined && world.has(e)) e.destroy()
            break
          }
          case 'add': {
            const e = resolve(op.e)
            if (e !== undefined && world.has(e)) e.add(...op.traits)
            break
          }
          case 'remove': {
            const e = resolve(op.e)
            if (e !== undefined && world.has(e)) e.remove(...op.traits)
            break
          }
          case 'run':
            op.fn(world)
            break
        }
      }
    }
  }

  clear(): void {
    this.ops.length = 0
  }
}

/** Deferred structural changes. They apply at the end of the current phase, in order. */
export class Commands {
  constructor(private queue: CommandQueue) {}

  /** Queues a spawn from a prefab: `commands.spawn(Enemy, { at })`. */
  spawn<P>(prefab: Prefab<P>, ...params: P extends void ? [] : [P]): PendingEntity
  /** Queues a spawn from a trait list: `commands.spawn(Transform({ x: 1 }), Velocity)`. */
  spawn(...traits: ConfigurableTrait[]): PendingEntity
  spawn(...args: unknown[]): PendingEntity {
    const pending = new PendingEntity()
    this.queue.push({ k: 'spawn', traits: resolveSpawn(args), pending })
    return pending
  }

  /** Queues a despawn. Despawning twice, or an entity that is already gone, is a no-op. */
  despawn(entity: EntityRef): void {
    this.queue.push({ k: 'despawn', e: entity })
  }

  /** Queues adding traits (or relation pairs) to an entity. */
  add(entity: EntityRef, ...traits: ConfigurableTrait[]): void {
    this.queue.push({ k: 'add', e: entity, traits })
  }

  /** Queues removing traits (or relation pairs) from an entity. */
  remove(entity: EntityRef, ...traits: (Trait | RelationPair)[]): void {
    this.queue.push({ k: 'remove', e: entity, traits })
  }

  /** Queues an arbitrary world mutation, applied in order with the others. */
  run(fn: (world: World) => void): void {
    this.queue.push({ k: 'run', fn })
  }
}
