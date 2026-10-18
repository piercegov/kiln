---
description: "The three system forms, the context, Mut() and checked access, order and run conditions."
---

# Systems

A system is a function plus the query it runs over. Define it with `system()`, export it, and
schedule it in `src/main.ts` with `app.add(Phase, MySystem)`.

## Three forms

**Per entity.** A query list; the function runs once for every matching entity, with a row of that
entity's trait values:

```ts
/** Integrates Velocity into Transform. */
export const Movement = system([Mut(Transform), Velocity], ([t, v], { time }) => {
  t.x += v.x * time.step
  t.z += v.z * time.step
})
```

The row has one entry per plain trait or `Mut(T)`, in order. Tags, `Not`, `Or` and change filters
give no entry. `ctx.entity` is the current entity.

**Named queries.** An object of query lists; the function runs once per phase run with a view per
query:

```ts
/** Each enemy chases the player. */
export const Chase = system(
  { player: [Transform, IsPlayer], enemies: [Mut(Velocity), Transform, IsEnemy] },
  ({ player, enemies }) => {
    const p = player.first()
    if (!p) return
    const target = p.get(Transform)!
    enemies.each(([v, t]) => {
      v.x = Math.sign(target.x - t.x) * 2
      v.z = Math.sign(target.z - t.z) * 2
    })
  },
)
```

A view has `.length`, `.entities`, `.first()`, `.forEach((entity, i) => ...)`, `.each(([...row],
entity) => ...)` and is iterable. `.each` gives rows with the same access rules as the per-entity
form. Several named queries may each take `Mut(T)`; the system's write set is their union.

**No query.** Just the context, once per phase run:

```ts
/** Spawns a wave of enemies every 10 seconds. */
export const Waves = system(({ commands, res, time }) => {
  if (time.tick % stepsFor(10, time.step) !== 0) return
  const rng = res.mut(Rng)
  for (let i = 0; i < 5; i++) commands.spawn(Enemy, { at: vec3(rng.float(-10, 10), 0, -12) })
})
```

## The context

Every system gets the context as its last argument:

| Field | |
|---|---|
| `time` | `step` (fixed dt), `dt` (this phase's dt), `elapsed` (simulated seconds), `frame`, `tick`, `alpha` |
| `res` | `res.get(Score)` reads (read-only), `res.mut(Score)` writes, `res.has(R)` |
| `commands` | `spawn`, `despawn`, `add`, `remove`, `run`; applied at the end of the phase |
| `events` | `emit(E, payload)`, `read(E)` (each reader sees each event once) |
| `world` | The Koota world for ad-hoc reads (`world.query(...)`); read-only in dev |
| `entity` | The current entity (per-entity form only) |

`time.dt` is `time.step` inside `Fixed` and the clamped frame delta elsewhere. `time.alpha` is how
far the frame is between the last two fixed steps, which rendering uses to interpolate.

## Access is in the types

`Mut(T)` is the system's write set. Every other trait in its queries arrives read-only:

```ts
system([Mut(Transform), Velocity], ([t, v]) => {
  t.x += v.x      // fine
  v.x = 0         // compile error: v is Readonly
})
```

In dev builds the same rule is checked at runtime, so a cast doesn't get around it. The other ways to
write are checked too:

| You wrote | What happens | Fix |
|---|---|---|
| a read-only row field | `readonly-write` error | `Mut(T)` in the query |
| `entity.set(T, {...})` without `Mut(T)` in any query | `undeclared-write` error | add `Mut(T)` |
| a field of the copy `entity.get(T)` returns | `write-to-copy` error | write through the row, or `entity.set` |
| `res.get(R).field = x` | `readonly-resource` error | `res.mut(R)` |
| `entity.destroy()`, `entity.add()`, `world.spawn()` | `structural-in-system` / `world-write` error | `commands` |

In the named-query form, `q.forEach(e => ...)` gives entities, not rows. Write those with
`e.set(T, {...})`, which needs `Mut(T)` in one of the system's queries.

The scheduler uses the same write sets: two systems in one phase that both take `Mut(T)` must have an
order between them. See [The schedule](./schedule#rules-checked-at-startup).

## Order

Order only matters inside a phase, and file order never matters:

```ts
.add(Fixed, chain(PlayerMove, Movement, CollectCoins))     // in this order
.add(Fixed, Knockback.after(Movement))                     // after Movement
.add(Fixed, Aim.before(Fire), Fire)                        // before Fire
.add(Fixed, Shoot.after(Aim).before(Recoil))               // both
```

Systems with no constraint between them keep the order they were added in.

## Run conditions

`runIf(condition, ...systems)` runs systems only while the condition holds. A condition is any
function of `{ res, time }` that returns a boolean:

```ts
.add(Fixed, runIf(inState(Screen, 'playing'), chain(PlayerMove, Movement, Collide)))
.add(Update, runIf(({ res }) => res.get(Score).value >= 10, ShowWinBanner))
.add(Update, runIf(not(inState(Screen, 'paused')), AnimateWater))
```

Gates nest (every condition must hold), and a gated chain still runs in order. Resource reads inside
conditions are recorded, and `kiln describe` prints each system's conditions. Name a custom condition
for `kiln describe` with `withLabel(cond, 'scoreAtLeast10')`. The built-in state conditions are on
[States](./states).

A skipped system doesn't read events, so it only sees events emitted while it was off if they are
still alive when it runs again (events live for two runs of the phase that emitted them).

## Options

`system(query, fn, options)` takes:

| Option | |
|---|---|
| `name` | Overrides the export name |
| `writes` / `reads` | Traits the system touches outside its queries (for plugins) |
| `unchecked` | Skips dev write guards and hands over the raw world (plugin internals only) |

`MySystem.named('Name')` renames a system after the fact.
