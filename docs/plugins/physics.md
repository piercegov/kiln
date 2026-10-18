---
description: "Rapier rigid bodies and colliders synced to Transform, collisions, raycasts and ordering."
---

# Physics

`kiln/physics` wraps [Rapier](https://rapier.rs) 0.21: Rapier 3D by default, Rapier 2D when the app is
`mode: '2d'`. Bodies are synced to `Transform`, and the simulation steps in `Fixed`.

```ts
import { PhysicsPlugin, RigidBody, Collider } from 'kiln/physics'

app.use(CorePlugins, PhysicsPlugin)

commands.spawn(Transform({ y: 5 }), RigidBody, Collider({ shape: 'ball', radius: 0.5 }))           // falls
commands.spawn(Transform, RigidBody({ type: 'fixed' }), Collider({ hx: 10, hy: 0.5, hz: 10 }))   // the ground
```

The plugin loads Rapier's WASM asynchronously. Scenario tests, the CLI and the browser runtime wait
for it; code that builds an app itself calls `await app.ready()` first.

## Traits

`RigidBody`:

| Field | Default | |
|---|---|---|
| `type` | `'dynamic'` | `'dynamic'` (simulated), `'kinematic'` (follows the Transform you write), `'fixed'` |
| `linearDamping`, `angularDamping` | `0` | |
| `gravityScale` | `1` | |
| `ccd` | `false` | Continuous collision detection, for fast bodies |
| `lockRotations` | `false` | Keep the body upright (characters) |
| `canSleep` | `true` | |

`Collider`:

| Field | Default | |
|---|---|---|
| `shape` | `'box'` | `'box'`, `'ball'`, `'capsule'`, `'cylinder'` |
| `hx`, `hy`, `hz` | `0.5` | Box half-extents |
| `radius` | `0.5` | Ball, capsule, cylinder |
| `halfHeight` | `0.5` | Capsule, cylinder |
| `friction` | `0.5` | |
| `restitution` | `0` | Bounciness |
| `density` | `1` | |
| `sensor` | `false` | Report overlaps without pushing |

A `Collider` on an entity with `RigidBody` attaches to that body. On a child (`ChildOf` a body
entity) it attaches with the child's `Transform` as its offset, which is how compound shapes are
built. On its own it is static.

`LinearVelocity` and `AngularVelocity` (`x y z`; 2D uses `z` for angular) are written back after
every step. Write `LinearVelocity` to drive a body.

## The Physics resource

```ts
const physics = res.mut(Physics)
physics.applyImpulse(entity, { x: 0, y: 5, z: 0 })
physics.setVelocity(entity, { x: 2, y: 0, z: 0 })
const hit = physics.raycast(origin, direction, maxDist, excludeEntity)   // { entity, distance, point, normal } | null
```

## Events

`CollisionStarted` and `CollisionEnded` carry `{ a, b, sensor }`. Sensors report with
`sensor: true`.

```ts
for (const { a, b } of events.read(CollisionStarted)) {
  if (a.has(IsPlayer) && b.has(IsCoin)) commands.despawn(b)
}
```

## Ordering

The plugin runs four systems in `Fixed`:

```
CreateBodies → PushState → StepPhysics → WriteBackTransforms
```

Systems that write `Transform` or `LinearVelocity` for bodies (movement input, teleports, kinematic
targets) go `.before(CreateBodies)`. Systems that react to the new positions go
`.after(WriteBackTransforms)`:

```ts
.add(Fixed, PlayerMove.before(CreateBodies), Landing.after(WriteBackTransforms))
```

## Options

`physicsPlugin({ gravity })` in place of `PhysicsPlugin`. Gravity defaults to `[0, -9.81, 0]` in
3D and `[0, -9.81]` in 2D.

## Determinism

Rapier is deterministic on one machine and runs the same WASM in the browser and under Bun, which
usually matches. Cross-machine determinism isn't guaranteed, and long physics-heavy replays can drift.
See [Determinism](../concepts/determinism#where-determinism-ends).
