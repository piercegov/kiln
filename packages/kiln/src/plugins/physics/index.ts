import { Not, type Entity } from 'koota'
import type { App } from '../../core/app.ts'
import { Changed, Mut } from '../../core/access.ts'
import { KilnError } from '../../core/errors.ts'
import { event } from '../../core/event.ts'
import { trait } from '../../core/koota.ts'
import type { Vec3 } from '../../core/math.ts'
import { plugin, type Plugin } from '../../core/plugin.ts'
import { resource } from '../../core/resource.ts'
import { Fixed } from '../../core/schedule.ts'
import { chain, system } from '../../core/system.ts'
import { ChildOf, Transform } from '../../core/transform.ts'

/**
 * A Rapier rigid body. Its Transform is the body's pose: physics writes it back after every step
 * for dynamic bodies; kinematic bodies follow the Transform you write.
 */
export const RigidBody = trait({
  /** 'dynamic' (simulated), 'kinematic' (moved by writing Transform), or 'fixed'. */
  type: 'dynamic' as 'dynamic' | 'kinematic' | 'fixed',
  linearDamping: 0,
  angularDamping: 0,
  gravityScale: 1,
  /** Continuous collision detection for fast bodies (bullets). */
  ccd: false,
  /** Keep the body upright (characters). */
  lockRotations: false,
  canSleep: true,
})

/**
 * A collider shape. On an entity with RigidBody it attaches to that body; on a child
 * (ChildOf a body entity) it attaches with the child's Transform as the offset; alone it is static.
 * 'box' uses hx/hy/hz half-extents, 'ball' radius, 'capsule' and 'cylinder' halfHeight + radius.
 */
export const Collider = trait({
  shape: 'box' as 'box' | 'ball' | 'capsule' | 'cylinder',
  hx: 0.5,
  hy: 0.5,
  hz: 0.5,
  radius: 0.5,
  halfHeight: 0.5,
  friction: 0.5,
  restitution: 0,
  density: 1,
  /** Reports overlaps (CollisionStarted with sensor: true) but doesn't push. */
  sensor: false,
})

/** Linear velocity in units/second. Physics writes it back each step; write it to set velocity. */
export const LinearVelocity = trait({ x: 0, y: 0, z: 0 })

/** Angular velocity in radians/second (2D uses z). Physics writes it back each step. */
export const AngularVelocity = trait({ x: 0, y: 0, z: 0 })

/** Two colliders started touching (or a sensor started overlapping). */
export const CollisionStarted = event<{ a: Entity; b: Entity; sensor: boolean }>()
/** Two colliders stopped touching. */
export const CollisionEnded = event<{ a: Entity; b: Entity; sensor: boolean }>()

export interface RaycastHit {
  entity: Entity
  distance: number
  point: Vec3
  normal: Vec3
}

interface Created {
  body: any | null
  colliders: any[]
}

/** The Rapier world plus Kiln's entity mapping. Use `res.mut(Physics)` for impulses and raycasts. */
export class PhysicsState {
  readonly bodies = new Map<Entity, Created>()
  readonly colliderOwner = new Map<number, Entity>()
  readonly eventQueue: any

  constructor(
    readonly rapier: any,
    readonly world: any,
    readonly is2D: boolean,
  ) {
    this.eventQueue = new rapier.EventQueue(true)
  }

  /** The Rapier body for an entity, once created (the step after RigidBody was added). */
  bodyOf(e: Entity): any | null {
    return this.bodies.get(e)?.body ?? null
  }

  private requireBody(e: Entity, what: string): any {
    const b = this.bodyOf(e)
    if (!b) {
      throw new KilnError(
        'no-body',
        `${what} needs a rigid body on entity ${(e as number) & 0xfffff}. Add RigidBody and Collider to it; bodies are created at the start of the next Fixed step.`,
      )
    }
    return b
  }

  private vec(v: Partial<Vec3>) {
    return this.is2D ? { x: v.x ?? 0, y: v.y ?? 0 } : { x: v.x ?? 0, y: v.y ?? 0, z: v.z ?? 0 }
  }

  /** Adds an instantaneous change in momentum (mass × velocity). */
  applyImpulse(e: Entity, impulse: Partial<Vec3>): void {
    this.requireBody(e, 'applyImpulse').applyImpulse(this.vec(impulse), true)
  }

  /** Sets linear velocity directly (same as writing LinearVelocity). */
  setVelocity(e: Entity, v: Partial<Vec3>): void {
    this.requireBody(e, 'setVelocity').setLinvel(this.vec(v), true)
  }

  /** Casts a ray and returns the first hit, or null. `exclude` skips one entity's colliders. */
  raycast(origin: Vec3, dir: Vec3, maxDistance = 1000, exclude?: Entity): RaycastHit | null {
    const R = this.rapier
    const len = Math.hypot(dir.x, dir.y, this.is2D ? 0 : dir.z) || 1
    const d = this.vec({ x: dir.x / len, y: dir.y / len, z: dir.z / len })
    const ray = new R.Ray(this.vec(origin), d)
    const pred = exclude === undefined ? undefined : (c: any) => this.colliderOwner.get(c.handle) !== exclude
    const hit = this.world.castRayAndGetNormal(ray, maxDistance, true, undefined, undefined, undefined, undefined, pred)
    if (!hit) return null
    const entity = this.colliderOwner.get(hit.collider.handle)
    if (entity === undefined) return null
    const p = ray.pointAt(hit.timeOfImpact)
    return {
      entity,
      distance: hit.timeOfImpact,
      point: { x: p.x, y: p.y, z: p.z ?? 0 },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z ?? 0 },
    }
  }

  remove(e: Entity): void {
    const c = this.bodies.get(e)
    if (!c) return
    this.bodies.delete(e)
    for (const col of c.colliders) {
      this.colliderOwner.delete(col.handle)
      if (this.world.getCollider(col.handle)) this.world.removeCollider(col, true)
    }
    if (c.body) this.world.removeRigidBody(c.body)
  }
}

/** The physics world. Present after the plugin's async init (`app.ready()`). */
export const Physics = resource((): PhysicsState => {
  throw new KilnError('physics-not-ready', 'Physics is used before PhysicsPlugin finished loading. Add .use(PhysicsPlugin) and await app.ready() (scenario() does).')
}, { readonlyProxy: false }).named('Physics')

function poseOf(t: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }, is2D: boolean) {
  if (is2D) return { pos: { x: t.x, y: t.y }, rot: 2 * Math.atan2(t.qz, t.qw) }
  return { pos: { x: t.x, y: t.y, z: t.z }, rot: { x: t.qx, y: t.qy, z: t.qz, w: t.qw } }
}

function colliderDesc(R: any, c: Record<string, any>, is2D: boolean): any {
  let d: any
  switch (c.shape) {
    case 'ball':
      d = R.ColliderDesc.ball(c.radius)
      break
    case 'capsule':
      d = is2D ? R.ColliderDesc.capsule(c.halfHeight, c.radius) : R.ColliderDesc.capsule(c.halfHeight, c.radius)
      break
    case 'cylinder':
      d = is2D ? R.ColliderDesc.cuboid(c.radius, c.halfHeight) : R.ColliderDesc.cylinder(c.halfHeight, c.radius)
      break
    default:
      d = is2D ? R.ColliderDesc.cuboid(c.hx, c.hy) : R.ColliderDesc.cuboid(c.hx, c.hy, c.hz)
  }
  return d
    .setFriction(c.friction)
    .setRestitution(c.restitution)
    .setDensity(c.density)
    .setSensor(c.sensor)
    .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
}

/** Creates Rapier bodies and colliders for new RigidBody / Collider entities. */
export const CreateBodies = system(
  { bodies: [RigidBody, Transform], loose: [Collider, Transform, Not(RigidBody)] },
  ({ bodies, loose }, { res, commands }) => {
    const ps = res.get(Physics)
    const R = ps.rapier
    const is2D = ps.is2D
    bodies.forEach((e) => {
      if (ps.bodies.has(e)) return
      const rb = e.get(RigidBody)!
      const t = e.get(Transform)!
      const { pos, rot } = poseOf(t, is2D)
      const desc = (
        rb.type === 'fixed' ? R.RigidBodyDesc.fixed() : rb.type === 'kinematic' ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic()
      )
        .setLinearDamping(rb.linearDamping)
        .setAngularDamping(rb.angularDamping)
        .setGravityScale(rb.gravityScale)
        .setCcdEnabled(rb.ccd)
        .setCanSleep(rb.canSleep)
      if (is2D) desc.setTranslation(pos.x, pos.y).setRotation(rot)
      else desc.setTranslation((pos as Vec3).x, (pos as Vec3).y, (pos as Vec3).z).setRotation(rot)
      if (rb.lockRotations) desc.lockRotations()
      const body = ps.world.createRigidBody(desc)
      const v = e.get(LinearVelocity)
      if (v) body.setLinvel(is2D ? { x: v.x, y: v.y } : { x: v.x, y: v.y, z: v.z }, true)
      const created: Created = { body, colliders: [] }
      ps.bodies.set(e, created)
      const col = e.get(Collider)
      if (col) {
        const c = ps.world.createCollider(colliderDesc(R, col, is2D), body)
        created.colliders.push(c)
        ps.colliderOwner.set(c.handle, e)
      }
      if (!e.has(LinearVelocity)) commands.add(e, LinearVelocity, AngularVelocity)
    })
    loose.forEach((e) => {
      if (ps.bodies.has(e)) return
      const col = e.get(Collider)!
      const t = e.get(Transform)!
      const parent = e.targetFor(ChildOf)
      const parentBody = parent !== undefined ? ps.bodyOf(parent) : null
      if (parent !== undefined && parent.has(RigidBody) && !parentBody) return // parent body first
      const { pos, rot } = poseOf(t, is2D)
      const desc = colliderDesc(R, col, is2D)
      if (is2D) desc.setTranslation(pos.x, pos.y).setRotation(rot)
      else desc.setTranslation((pos as Vec3).x, (pos as Vec3).y, (pos as Vec3).z).setRotation(rot)
      const c = parentBody ? ps.world.createCollider(desc, parentBody) : ps.world.createCollider(desc)
      ps.bodies.set(e, { body: null, colliders: [c] })
      ps.colliderOwner.set(c.handle, parentBody && parent !== undefined ? parent : e)
    })
  },
  { name: 'CreateBodies' },
)

/** Pushes Transforms you wrote (teleports, kinematic targets) and LinearVelocity into Rapier. */
export const PushState = system(
  { moved: [Transform, RigidBody, Changed(Transform)], vel: [LinearVelocity, RigidBody, Changed(LinearVelocity)] },
  ({ moved, vel }, { res }) => {
    const ps = res.get(Physics)
    const is2D = ps.is2D
    moved.forEach((e) => {
      const body = ps.bodyOf(e)
      if (!body) return
      const t = e.get(Transform)!
      const { pos, rot } = poseOf(t, is2D)
      if (body.isKinematic()) {
        body.setNextKinematicTranslation(pos)
        body.setNextKinematicRotation(rot)
        return
      }
      const cur = body.translation()
      const dz = is2D ? 0 : Math.abs(cur.z - (pos as Vec3).z)
      if (Math.abs(cur.x - pos.x) + Math.abs(cur.y - pos.y) + dz > 1e-6) {
        body.setTranslation(pos, true)
        body.setRotation(rot, true)
      }
    })
    vel.forEach((e) => {
      const body = ps.bodyOf(e)
      if (!body || body.isKinematic() || body.isFixed()) return
      const v = e.get(LinearVelocity)!
      const cur = body.linvel()
      const dz = is2D ? 0 : Math.abs(cur.z - v.z)
      if (Math.abs(cur.x - v.x) + Math.abs(cur.y - v.y) + dz > 1e-6) body.setLinvel(is2D ? { x: v.x, y: v.y } : { x: v.x, y: v.y, z: v.z }, true)
    })
  },
  { name: 'PushState' },
)

/** Steps Rapier by the fixed step and emits CollisionStarted / CollisionEnded. */
export const StepPhysics = system(
  ({ res, time, events }) => {
    const ps = res.mut(Physics)
    ps.world.timestep = time.step
    ps.world.step(ps.eventQueue)
    ps.eventQueue.drainCollisionEvents((h1: number, h2: number, started: boolean) => {
      const a = ps.colliderOwner.get(h1)
      const b = ps.colliderOwner.get(h2)
      if (a === undefined || b === undefined) return
      const c1 = ps.world.getCollider(h1)
      const c2 = ps.world.getCollider(h2)
      const sensor = !!(c1?.isSensor() || c2?.isSensor())
      events.emit(started ? CollisionStarted : CollisionEnded, { a, b, sensor })
    })
  },
  { name: 'StepPhysics' },
)

/** Writes body poses and velocities back to Transform, LinearVelocity and AngularVelocity. */
export const WriteBackTransforms = system(
  {
    poses: [Mut(Transform), RigidBody],
    vels: [Mut(LinearVelocity), Mut(AngularVelocity), RigidBody],
  },
  ({ poses, vels }, { res }) => {
    const ps = res.get(Physics)
    const is2D = ps.is2D
    poses.each(([t, rb], e) => {
      if (rb.type === 'fixed') return
      const body = ps.bodyOf(e)
      if (!body || body.isSleeping()) return
      const p = body.translation()
      t.x = p.x
      t.y = p.y
      if (is2D) {
        const a = body.rotation() as number
        t.qx = 0
        t.qy = 0
        t.qz = Math.sin(a / 2)
        t.qw = Math.cos(a / 2)
      } else {
        t.z = p.z
        const q = body.rotation()
        t.qx = q.x
        t.qy = q.y
        t.qz = q.z
        t.qw = q.w
      }
    })
    vels.each(([v, w], e) => {
      const body = ps.bodyOf(e)
      if (!body) return
      const lv = body.linvel()
      v.x = lv.x
      v.y = lv.y
      if (is2D) {
        w.z = body.angvel() as number
      } else {
        v.z = lv.z
        const av = body.angvel()
        w.x = av.x
        w.y = av.y
        w.z = av.z
      }
    })
  },
  { name: 'WriteBackTransforms' },
)

export interface PhysicsOptions {
  /** Default [0, -9.81, 0] (3D) or [0, -9.81] (2D). */
  gravity?: [number, number, number?]
}

/**
 * Rapier rigid bodies synced to Transform; steps in Fixed. Uses Rapier 3D, or Rapier 2D when the
 * app is `mode: '2d'`. Order your own Transform/velocity writers with
 * `.before(CreateBodies)` (inputs) or `.after(WriteBackTransforms)` (reactions).
 */
export function physicsPlugin(options: PhysicsOptions = {}): Plugin {
  return plugin(async (app: App) => {
    const is2D = app.config.mode === '2d'
    const mod: any = is2D ? await import('@dimforge/rapier2d-compat') : await import('@dimforge/rapier3d-compat')
    const R = mod.default ?? mod
    await R.init()
    const g = options.gravity ?? [0, -9.81, 0]
    const world = new R.World(is2D ? { x: g[0], y: g[1] } : { x: g[0], y: g[1], z: g[2] ?? 0 })
    const state = new PhysicsState(R, world, is2D)
    app.insert(Physics, state)
    app.init(CollisionStarted, CollisionEnded)
    const unsubs = [
      app.world.onRemove(RigidBody, (e) => state.remove(e)),
      app.world.onRemove(Collider, (e) => state.remove(e)),
    ]
    app.hooks.dispose.push(() => {
      for (const u of unsubs) u()
      state.eventQueue.free?.()
      world.free()
    })
    app.add(Fixed, chain(CreateBodies, PushState, StepPhysics, WriteBackTransforms))
  }, 'PhysicsPlugin')
}

/** Rapier physics with default gravity. */
export const PhysicsPlugin = physicsPlugin()
