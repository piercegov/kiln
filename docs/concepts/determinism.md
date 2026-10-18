---
description: "Seeded Rng, the simulation clock, kiln check, and where determinism ends."
---

# Determinism

The same seed and the same input give the same world, step for step. That is what makes scenario
tests exact, `kiln run` repeatable, and recorded play sessions replayable. It holds as long as the
simulation only reads three things from outside: the clock in `ctx.time`, the seeded `Rng`, and input
through the input plugin.

## Randomness: `Rng`

```ts
const rng = res.mut(Rng)
rng.float()             // [0, 1)
rng.float(-5, 5)        // [-5, 5)
rng.int(1, 6)           // 1..6 inclusive
rng.chance(0.25)        // true a quarter of the time
rng.pick(['a', 'b'])    // a random element
rng.shuffle(items)      // in place
```

`Rng` is seeded from `seed` in `kiln.config.ts`. Scenarios can override it (`scenario(name, fn, {
seed: 3 })`), and so can the CLI (`kiln run --seed 3`, `kiln shot --seed 3`). Its state is part of
snapshots and recordings.

For a stream of its own (a particle emitter, a level generator), seed a new `RngState` from the app's:
`new RngState(res.mut(Rng).u32())`.

## Time: `ctx.time`

| Field | |
|---|---|
| `time.step` | The fixed step, `1 / fixedHz` |
| `time.dt` | `step` inside `Fixed`; the clamped frame delta elsewhere |
| `time.elapsed` | Simulated seconds: `tick * step` |
| `time.tick` | Fixed steps run so far |
| `time.frame` | Frames run so far |
| `time.alpha` | Interpolation between the last two fixed steps |

Count steps instead of adding up floats: subtracting `time.step` 3600 times leaves about `1e-12`, so
a `remaining <= 0` check fires one step late. `stepsFor(seconds, time.step)` converts a duration to
steps, and the built-in [`Timer`, `Lifetime` and `Delayed`](../plugins/timers-tweens) all count steps.

## `kiln check`

```bash
kiln check
```

```
src/systems.ts:42:15 no-math-random Use res.mut(Rng).float() (seeded) instead of Math.random().
src/systems.ts:57:20 no-date-now Use ctx.time.elapsed (simulated seconds) instead of Date.now().
```

It flags `Math.random()`, `Date.now()`, `performance.now()` and `new Date()` in `src/` (vendored
plugins included) and exits 1 if it finds any. Add `kiln-allow` in a comment on a line that needs one
on purpose, such as a timestamp in a save file name.

## Where determinism ends

- **Physics.** Rapier is deterministic on one machine, and runs the same WASM in the browser and
  under Bun, which usually matches. Cross-machine determinism is not guaranteed.
- **Floating point across engines.** `Math.sin`, `cos` and `pow` can differ in the last bit between
  Chrome's V8 and Bun's JavaScriptCore. Long, physics-heavy replays can drift because of it.
- **Rendering and cosmetics.** `Update` and `Render` run once per frame with a variable `dt`, so
  anything they compute depends on the frame rate. Keep gameplay in `Fixed`.

Replays report the first frame where state stopped matching (`divergedAt`), so drift shows up as a
number rather than a mystery. See [Recordings and replay](../testing/recordings).
