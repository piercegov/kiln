---
description: "Singletons with res.get/res.mut, and typed events with their lifetime rules."
---

# Resources and events

## Resources

A resource is a singleton the app owns: the score, the level, settings, the input state, the RNG.

```ts
/** Coins collected this run. */
export const Score = resource({ value: 0 })

/** The level layout, built from the seed. */
export const Level = resource((app) => buildLevel(app.config.seed))
```

Pass default fields (copied for each app) or a factory that gets the app. Register resources in
`src/main.ts` with `.init(Score, Level)`. They also create themselves with their defaults on first
use, but listing them makes them show in `kiln describe` and snapshots from the start.

In a system:

```ts
res.get(Score).value          // read; a read-only proxy in dev
res.mut(Score).value += 1     // write
res.has(Level)                // created yet?
```

Writing through `res.get` throws in dev with the fix (`res.mut`). `kiln describe` shows which
resources each system read and wrote during one headless step.

Outside systems, `app.res(Score)` returns the live, writable value, and `app.insert(Score, { value:
10 })` replaces it.

### Three.js objects in resources

The dev read-only proxy breaks Three.js objects and other class graphs that check their own identity.
Opt out with `readonlyProxy: false`:

```ts
export const Sky = resource(() => new THREE.Color(0x88aaff), { readonlyProxy: false })
```

### Built-in resources

| Resource | From | |
|---|---|---|
| `Time` | core | The clock (`ctx.time` is the same values) |
| `Rng` | core | Seeded random numbers. See [Determinism](./determinism) |
| `Scene`, `Camera`, `Renderer` | render | See [Rendering](../plugins/render) |
| `Input`, `ActionMap` | input | See [Input](../plugins/input) |
| `Assets` | assets | See [Assets](../plugins/assets) |
| `Delayed`, `Tweens` | timers, tweens | See [Timers and tweens](../plugins/timers-tweens) |
| `Ui` | UI | See [HUD and UI](../plugins/ui) |
| `CameraRig`, `Saves`, `Physics` | opt-in plugins | |

## Events

An event is a typed message from one system to any number of others:

```ts
/** Something took damage. */
export const Damaged = event<{ entity: Entity; amount: number }>()

/** The round ended. */
export const RoundOver = event()      // no payload
```

```ts
events.emit(Damaged, { entity, amount: 2 })
events.emit(RoundOver)

for (const d of events.read(Damaged)) {
  // d.entity, d.amount
}
```

Register events with `.init(Damaged, RoundOver)` in `src/main.ts`, so `kiln describe`, `kiln run
--events` and `AGENTS.md` know them before the first emit.

### Lifetime

- Each reader (each system) sees each event exactly once.
- An event lives for two runs of the phase that emitted it, then is dropped.
- All of one frame's `Fixed` steps count as a single run, so a reader in `Update` sees every event
  that frame's steps emitted.
- A reader that runs before the emitter (in the same phase, or an earlier one) sees the events on
  its next run.

So a `Fixed` system can emit and an `Update` system can react (play a sound, shake the camera) without
missing events on frames that ran two steps, or seeing one twice on frames that ran none.

`events.read` reuses its array between calls; copy it if you need to keep it.

### Outside systems

```ts
app.emit(Damaged, { entity, amount: 1 })    // from tests or DOM callbacks
app.events(Damaged)                         // everything emitted during the last app.step() call
```

`app.events(E)` only holds what the last `step()` call emitted. To check "exactly once" over a long
run, step in chunks and add up the lengths.
