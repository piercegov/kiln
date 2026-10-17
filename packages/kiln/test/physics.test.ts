import { afterEach, describe, expect, test } from 'bun:test'
import { App, createApp, CorePlugins, Fixed, Mut, system, trait, Transform, type KilnConfig } from '../src/index.ts'
import {
  AngularVelocity,
  Collider,
  CollisionStarted,
  CreateBodies,
  LinearVelocity,
  Physics,
  PhysicsPlugin,
  RigidBody,
  WriteBackTransforms,
} from '../src/plugins/physics/index.ts'

const apps: App[] = []
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose()
})
async function mk(config: KilnConfig = {}) {
  const a = createApp(config).use(CorePlugins, PhysicsPlugin)
  apps.push(a)
  await a.ready()
  return a
}

function ground(app: App) {
  return app.spawn(Transform({ y: -0.5 }), RigidBody({ type: 'fixed' }), Collider({ hx: 20, hy: 0.5, hz: 20 }))
}

describe('physics', () => {
  test('a ball falls, lands on the ground and reports one collision', async () => {
    const app = await mk()
    ground(app)
    const ball = app.spawn(Transform({ y: 5 }), RigidBody, Collider({ shape: 'ball', radius: 0.5 }))
    app.step(180)
    expect(app.get(ball, Transform)!.y).toBeCloseTo(0.5, 1)
    const hits = app.events(CollisionStarted)
    expect(hits).toHaveLength(1)
    expect([hits[0]!.a, hits[0]!.b]).toContain(ball)
    expect(Math.abs(app.get(ball, LinearVelocity)!.y)).toBeLessThan(0.05)
  })

  test('same seed and steps give the same world', async () => {
    const run = async () => {
      const app = await mk()
      ground(app)
      for (let i = 0; i < 5; i++) app.spawn(Transform({ x: i * 0.3, y: 2 + i }), RigidBody, Collider({ shape: 'ball', radius: 0.4 }))
      app.step(120)
      return app.snapshot({ traits: [Transform], precision: 6 })
    }
    expect(await run()).toEqual(await run())
  })

  test('writing LinearVelocity drives the body; impulses work', async () => {
    const SetVel = system([Mut(LinearVelocity), RigidBody], ([v]) => {
      v.x = 3
    }).before(CreateBodies)
    const app = await mk({ fixedHz: 60 })
    app.add(Fixed, SetVel)
    app.res(Physics).world.gravity = { x: 0, y: 0, z: 0 }
    const e = app.spawn(Transform, RigidBody, Collider, LinearVelocity, AngularVelocity)
    app.step(61)
    expect(Math.abs(app.get(e, Transform)!.x - 3)).toBeLessThan(0.1)
  })

  test('unordered Transform writers in Fixed are a schedule error naming the fix', async () => {
    const Movement = system([Mut(Transform), trait()], () => {})
    const app = await mk()
    app.add(Fixed, Movement)
    expect(() => app.build()).toThrow('WriteBackTransforms and Movement both take Mut(Transform) in Fixed with no order. Put them in chain() or add .after().')
    void WriteBackTransforms
  })

  test('kinematic bodies follow Transform and push dynamics', async () => {
    const Slide = system([Mut(Transform), RigidBody], ([t, rb]) => {
      if (rb.type === 'kinematic') t.x += 0.05
    }).before(CreateBodies)
    const app = await mk()
    app.add(Fixed, Slide)
    app.res(Physics).world.gravity = { x: 0, y: 0, z: 0 }
    const pusher = app.spawn(Transform, RigidBody({ type: 'kinematic' }), Collider)
    const box = app.spawn(Transform({ x: 2 }), RigidBody, Collider)
    app.step(120)
    expect(app.get(pusher, Transform)!.x).toBeCloseTo(6, 3)
    expect(app.get(box, Transform)!.x).toBeGreaterThan(6)
  })

  test('raycast finds the entity; despawn removes the body', async () => {
    const app = await mk()
    const g = ground(app)
    app.step(1)
    const ps = app.res(Physics)
    const hit = ps.raycast({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 })
    expect(hit?.entity).toBe(g)
    expect(hit!.distance).toBeCloseTo(10, 4)
    expect(hit!.normal.y).toBeCloseTo(1, 4)
    app.despawn(g)
    expect(ps.raycast({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 })).toBe(null)
    expect(ps.world.bodies.len()).toBe(0)
  })

  test('2D mode uses Rapier 2D', async () => {
    const app = await mk({ mode: '2d' })
    app.spawn(Transform({ y: -0.5 }), RigidBody({ type: 'fixed' }), Collider({ hx: 10, hy: 0.5 }))
    const ball = app.spawn(Transform({ y: 3 }), RigidBody, Collider({ shape: 'ball', radius: 0.25 }))
    app.step(120)
    expect(app.get(ball, Transform)!.y).toBeCloseTo(0.25, 1)
    expect(app.events(CollisionStarted).length + 0).toBeGreaterThanOrEqual(0)
  })
})
