---
description: "Entities, traits, relations, Transform, queries and commands."
---

# Entities and traits

Kiln's world is a [Koota](https://github.com/pmndrs/koota) ECS. An **entity** is an id. A **trait**
is a piece of data an entity can have. **Systems** query entities by their traits and change them.
Kiln re-exports Koota's `trait`, `relation`, `Not` and `Or` as they are, and wraps the rest
(systems, commands, resources, events) so access can be checked.

## Traits

```ts
import { trait } from 'kiln-ecs'

/** Linear velocity in world units per second. */
export const Velocity = trait({ x: 0, y: 0, z: 0 })   // struct of arrays

/** The enemy's current path, one array per entity. */
export const Path = trait(() => [] as { x: number; z: number }[])   // one object per entity

/** Tag: the entity the input controls. */
export const IsPlayer = trait()                        // no data
```

| Form | Storage | Use for |
|---|---|---|
| `trait({ x: 0 })` | Struct of arrays: one array per field. Fast. | Numbers, strings, booleans |
| `trait(() => obj)` | One object per entity | Three.js objects, arrays, maps, class instances |
| `trait()` | Nothing | Tags and markers |

The object passed to a struct trait holds the defaults. Add a trait with its defaults by passing the
trait itself, or override fields by calling it:

```ts
commands.spawn(Transform, Velocity, IsPlayer)
commands.spawn(Transform({ x: 3, y: 1 }), Velocity({ x: -2 }))
```

Struct traits are what `kiln run --snapshot`, saves and recordings capture as JSON. Object traits
appear in snapshots only when their value is JSON-friendly (or has `toJSON`); Three.js objects are
skipped.

## Transform

`Transform` is the one trait almost every entity has: position `x y z`, rotation as a quaternion
`qx qy qz qw`, and scale `sx sy sz`. Gameplay writes it and the render plugin copies it to Three.js,
interpolated between fixed steps.

```ts
setYaw(t, angle)            // rotation about Y, radians
setEuler(t, x, y, z)        // XYZ Euler angles, radians
setAngle2D(t, angle)        // rotation about Z, for 2D mode
angle2D(t)                  // read the Z angle back
```

Math helpers come along: `vec3`, `origin`, `distSq`, `dist`, `clamp`, `lerp`. Compare `distSq`
against a squared radius to skip the square root.

## Relations

A relation links one entity to another. Kiln ships one, and you can define your own with Koota's
`relation`:

```ts
/** Scene hierarchy; the child's Transform is local to the parent. */
ChildOf   // relation({ exclusive: true, autoDestroy: 'orphan' })

/** Who this turret is aiming at. */
export const Targets = relation({ exclusive: true })

commands.spawn(Transform({ y: 1 }), Hat, ChildOf(player))
commands.add(turret, Targets(enemy))
```

`ChildOf` is the scene graph. A child's `Transform` is relative to its parent, and despawning a
parent despawns its children. Unlike `Object3D.add`, the hierarchy survives snapshots and hot reload.

## Queries

A query is a list of traits. An entity matches if it has all of them:

```ts
[Mut(Transform), Velocity]          // has Transform and Velocity; writes Transform
[Transform, IsEnemy, Not(Dead)]     // has Transform and IsEnemy, but not Dead
[Transform, Or(IsCoin, IsGem)]      // has Transform and at least one of IsCoin, IsGem
[Transform, Changed(Health)]        // Health changed since this system last ran
[Added(IsEnemy)]                    // gained IsEnemy since this system last ran
[Removed(IsEnemy)]                  // lost IsEnemy (or was despawned) since this system last ran
```

- `Mut(T)` marks a trait the system writes. See [Systems](./systems#access-is-in-the-types).
- Tags (`IsEnemy`), `Not`, `Or` and the change filters narrow the match but give no row entry.
- `Changed`, `Added` and `Removed` get a separate tracker per system, so two systems watching the
  same trait never steal each other's changes.

## Commands

Structural changes (spawning, despawning, adding and removing traits) never happen in the middle of
a system. They go through `commands`, which queue them and apply them in order at the end of the
current phase:

```ts
const bullet = commands.spawn(Bullet, { at, dir })    // a prefab and its params
commands.spawn(Transform({ x: 1 }), Velocity)         // or a list of traits
commands.despawn(entity)                              // twice, or on a dead entity: a no-op
commands.add(entity, Stunned, Timer({ duration: 1 }))
commands.remove(entity, Stunned)
commands.run((world) => { /* any world change, applied in order with the rest */ })
```

`commands.spawn` returns a `PendingEntity`. Pass it to other commands in the same system (they apply
in order, so they see it), or to a tween. Its `.entity` is set once commands have applied; calling
`.get()` before then throws and explains why.

Inside a system, calling `entity.destroy()`, `entity.add()` or `world.spawn()` directly throws in
dev builds with the `commands` call to use instead.

## Outside systems

Tests and tools work on the world directly through the app:

```ts
const p = app.spawn(Player, { at: origin })   // immediate, not queued
app.set(p, Transform, { x: 4 })
app.get(p, Transform)?.x                      // a copy of the values
app.has(p, Health)
app.query(IsEnemy, Not(Dead))                 // entities, right now
app.despawn(p)
```

Calling these from inside a system throws: systems use their context. See
[Scenario tests](../testing/scenarios).
