---
description: "Phases, what happens in one frame, when changes become visible, and startup validation."
---

# The schedule

Every system belongs to one phase. `app.add(Fixed, Movement)` puts `Movement` in `Fixed`; order
inside a phase comes from `chain()`, `.after()` and `.before()`.

## Phases

| Phase | Runs | Use it for |
|---|---|---|
| `Startup` | Once, before the first frame | Spawning the level, starting asset loads |
| `InputPhase` | Once per frame | Polling devices into the `Input` resource (built in; games rarely add to it) |
| `Fixed` | 0..N times per frame, at `fixedHz` | Gameplay, physics, AI, timers. Use `time.step` |
| `Update` | Once per frame, variable `time.dt` | Cameras, HUD, cosmetic animation |
| `Late` | Once per frame | End-of-frame cleanup |
| `Render` | Once per frame, browser only | Copying `Transform` to Three.js (interpolated) and drawing |

`InputPhase` is the phase; `Input` is the resource it fills.

## One frame

```
frame start hooks         state transitions, save loads, scripted input due this frame
InputPhase                poll devices → Input
Fixed × N                 N = how many whole fixed steps the frame's time covers
Update
Late
frame end hooks           recording checkpoints
Render                    skipped headless
```

The browser measures each frame's delta, clamps it to `maxFrameDt` (0.25 s by default, so a
background tab doesn't spiral), and adds it to an accumulator. `Fixed` runs once per whole
`1 / fixedHz` in the accumulator, at most `maxFixedSteps` (5) times a frame; the remainder becomes
`time.alpha`, which `Render` uses to interpolate between the last two steps.

Headless, `app.step(n)` runs `n` frames of exactly one fixed step each, so tests and `kiln run` are
exact. `app.tick(dt)` runs one frame with a real delta, the way the browser does.

## When changes become visible

- **Commands** apply at the end of every phase run. An entity spawned in `Fixed` is visible to the
  next `Fixed` step (and to `Update`), not to later systems in the same step.
- **Events** live for two runs of the phase that emitted them, and each reader sees each event once.
  A whole frame's `Fixed` steps count as one run, so a reader in `Update` sees every event emitted
  in that frame's steps, however many ran.
- **Resource writes** are immediate.
- **State transitions** requested with `set()` apply at the start of the next frame.

## Ordering

```ts
.add(Fixed, chain(PlayerMove, Movement, CollectCoins))
.add(Fixed, Knockback.after(Movement), Aim.before(Fire), Fire)
```

`chain(...)` accepts systems, other chains, `.after()` entries and `runIf` gates. Systems with no
constraint between them run in the order they were added. Adding the same system to a phase twice
is an error.

## Rules checked at startup

The schedule is built and validated before the first frame, so these never become runtime surprises:

- **Write conflicts.** Two systems in one phase that both take `Mut(T)` need an order between them
  (a `chain` or an `.after()`). The error names both systems and the trait.
- **Unknown order targets.** `.after(X)` and `.before(X)` need `X` in the same phase. The error
  says which phase `X` is in, or that it was never added.
- **Cycles.** The error prints the cycle: `A → B → C → A`.
- **Phase first.** `app.add(Movement)` without a phase, or a plain function where a system belongs,
  is an error that shows the right call.

`kiln describe` builds the schedule, so it is the fastest way to see these.

## Plugin systems

Plugins add their own systems. The ones you are most likely to order against:

| System | Phase | Order your system |
|---|---|---|
| `TickTimers` | Fixed | `.after(TickTimers)` if it takes `Mut(Timer)` |
| `TickTweens` | Fixed | `.after(TickTweens)` to read tweened values this step |
| `AnimateSprites` / `AnimateModels` | Fixed | `.before(...)` when setting animation params |
| `CreateBodies` … `WriteBackTransforms` | Fixed | `.before(CreateBodies)` to drive bodies, `.after(WriteBackTransforms)` to react |
| `CameraRigUpdate` | Update | — |
| `RenderSync`, `Draw` | Render | — |

`kiln describe` lists every plugin system with its access, so the full list is always one command
away.
