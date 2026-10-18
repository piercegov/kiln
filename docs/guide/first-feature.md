---
description: "Health, hazards and a health bar end to end: data, systems, schedule, test."
---

# A complete feature

This walks through one feature end to end in the starter game: hazards that cost the player health,
a health bar, and despawning at zero. Every snippet here runs as written on top of `kiln new`.

## 1. Data

Traits and events go in `src/data.ts`, each with a one-line JSDoc:

```ts
import { event, trait, type Entity } from 'kiln-ecs'

/** Hit points. */
// A struct trait: these numbers are the defaults, overridable per entity with Health({ hp: 5 }).
export const Health = trait({ hp: 3, max: 3 })

/** Hurts the player while they stand inside `radius`. */
export const Hazard = trait({ radius: 1, damage: 1 })

/** Something took damage. */
// An event: systems emit it and any system can read it. The type is its payload.
export const Damaged = event<{ entity: Entity; amount: number }>()
```

Give the player health in its prefab (`src/prefabs.ts`):

```ts
export const Player = prefab((p: { at: Vec3 }) => [
  Transform({ x: p.at.x, y: 0.5, z: p.at.z }),
  Velocity,
  IsPlayer,
  Health({ hp: 3, max: 3 }),
  MeshRef(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x4d96ff }))),
])
```

## 2. Behaviour

Systems go in `src/systems.ts`:

```ts
/** Damages the player once per second while it stands in a hazard. */
export const HurtInHazards = system(
  // Two named queries. Each becomes a view the function can loop over:
  //   players: entities with Health, Transform and the IsPlayer tag. Mut(Health) means this
  //            system may change Health; Transform is read-only here.
  //   hazards: entities with Hazard and Transform, both read-only.
  { players: [Mut(Health), Transform, IsPlayer], hazards: [Hazard, Transform] },

  // The function runs once per fixed step (60 times a second by default).
  ({ players, hazards }, { events, time }) => {
    // Only deal damage once per second: skip every step that isn't a multiple of
    // "steps in one second". time.tick counts fixed steps since the game started.
    if (time.tick % stepsFor(1, time.step) !== 0) return

    // .each gives a row per entity, holding its traits in query order (tags like IsPlayer
    // add no entry), plus the entity itself.
    players.each(([health, playerPos], player) => {
      hazards.each(([hazard, hazardPos]) => {
        // Inside the hazard's radius? Comparing squared distances avoids a square root.
        const inside = distSq(playerPos, hazardPos) <= hazard.radius * hazard.radius
        if (!inside) return

        health.hp -= hazard.damage                                        // allowed: Mut(Health)
        events.emit(Damaged, { entity: player, amount: hazard.damage })   // tell anyone listening
      })
    })
  },
)

/** Despawns anything whose health reached zero. */
// A per-entity system: the function runs once for every entity that has Health.
export const DespawnDead = system([Health], ([health], { commands, entity }) => {
  // Despawning is queued through commands and happens at the end of the phase,
  // so other systems this step still see a consistent world.
  if (health.hp <= 0) commands.despawn(entity)
})

/** Shows the player's health as a bar. */
// Runs once for the player. res.mut(Ui) is the HUD; setting the same bar every frame is free.
export const HealthHud = system([Health, IsPlayer], ([health], { res }) => {
  res.mut(Ui).bar('hp', health.hp / health.max, { anchor: 'bottom-left', label: 'HP', color: '#f55' })
})
```

Three system shapes appear here:

- `HurtInHazards` takes **named queries**. It runs once per step and gets a view per query. Only
  `Health` is written, so it is the only trait wrapped in `Mut()`; writing `playerPos.x` would be a
  type error.
- `DespawnDead` is **per entity**: it runs once for every entity with `Health`. Despawning goes
  through `commands`, which apply at the end of the phase.
- `HealthHud` is per entity too, and writes a resource with `res.mut(Ui)`.

Counting steps (`time.tick`) instead of adding up `time.step` keeps the timing exact. For anything
longer-lived, the built-in [`Timer`](../plugins/timers-tweens) does the counting for you.

## 3. Schedule

One change in `src/main.ts`:

```ts
export default () =>
  createApp(config)
    .use(CorePlugins)
    .init(Damaged)                       // register the new event
    .add(Startup, SpawnLevel)
    // chain() runs these in order: move first, then take damage where the player ended up,
    // then despawn anything that hit zero.
    .add(Fixed, chain(PlayerMove, Movement, HurtInHazards, DespawnDead))
    .add(Update, HealthHud)              // once per frame, after the fixed steps
```

Gameplay goes in `Fixed`, in a `chain` so it runs in a known order. The HUD is cosmetic, so it goes
in `Update`.

## 4. Check the schedule

```bash
kiln describe
```

```
phase Fixed
  ...
  3. PlayerMove | writes Velocity | reads IsPlayer | res-reads Input
  4. Movement | writes Transform | reads Velocity | after PlayerMove
  5. HurtInHazards | writes Health | reads Hazard,IsPlayer,Transform | after Movement
  6. DespawnDead | reads Health | after HurtInHazards
phase Update
  1. SpawnModels | reads MeshRef,Model
  2. HealthHud | reads Health,IsPlayer | res-writes Ui
```

Had `HurtInHazards` and another system both taken `Mut(Health)` with no order between them, this
command would stop with an error naming both and the fix.

## 5. Test it

`scenarios/hazard.test.ts`:

```ts
import { expect, scenario } from 'kiln-ecs/test'
import { Transform, Ui } from 'kiln-ecs'
import { Damaged, Hazard, Health, IsPlayer } from '../src/data.ts'

scenario('standing in a hazard costs 1 hp per second, then the player despawns', ({ app }) => {
  // Startup already ran, so the player exists. Put a hazard right on top of it.
  const player = app.query(IsPlayer)[0]!
  app.spawn(Transform({ x: 0, z: 0 }), Hazard({ radius: 2, damage: 1 }))

  // One second (60 fixed steps): one hit, 3 hp -> 2.
  app.step(60)
  expect(app.get(player, Health)!.hp).toBe(2)
  expect(app.events(Damaged)).toEqual([{ entity: player, amount: 1 }])   // events from this step() call
  expect(app.res(Ui).get('hp')?.value).toBeCloseTo(2 / 3)               // the HUD bar, as data

  // Two more seconds: two more hits, hp reaches 0 and DespawnDead removes the player.
  app.step(120)
  expect(app.has(player, Health)).toBe(false)
})
```

```bash
kiln test
```

The test spawns the hazard directly with `app.spawn`, steps exact frames, and reads the result:
trait values, the events the last `step()` call emitted, and the HUD as data. No browser is
involved, and the run is the same every time.

## 6. Update AGENTS.md

```bash
kiln docs
```

The generated section now lists `Health`, `Hazard`, `Damaged` and the new systems with their JSDoc
and their place in the schedule.
