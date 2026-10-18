# Kiln design

The full design doc is the Claude Doc "Three.js ECS Game Framework — Design":
https://claude.ai/artifact/MJzEQjKso9bHKcUYGu3zyD

This page records how the implementation maps to it, and where it deliberately differs.

## Layers

| Layer | Where | Imports Three.js? |
|---|---|---|
| Core: app, loop, ECS wrap, schedule, events, snapshots | `packages/kiln/src/core` | No (enforced by a test) |
| Plugins: render, input, assets, debug, physics, timer, tween, ui, camera, save, animation | `packages/kiln/src/plugins` | render/assets/debug/camera/animation yes (except the animation graph); the rest no |
| Tooling: CLI, Vite plugin, Bun preload, scenario runner | `packages/kiln/src/{cli,tooling,test}` | — |
| Community plugins (`kiln add`) | `packages/kiln/community` | yes |

## Decisions as built

- **Koota boundary**: systems use Kiln's `system`/`Mut`/`commands`/`res`/`events`; `trait`, `relation`,
  `Not`, `Or` are Koota's own. Koota has no static `Changed`, so Kiln's `Changed/Added/Removed(T)`
  create a separate Koota tracker per system. `ctx.world` is a read-only proxy in dev.
- **Write checks**: `Mut()` types make undeclared row writes compile errors; in dev, row views throw
  on read-only writes, `entity.set` checks the system's `Mut` set, `entity.get` copies of struct traits
  throw on write, and structural entity calls inside systems throw with the `commands` fix.
- **Names** come from exports through a runtime transform (`kiln-ecs/preload` for Bun, `kiln-ecs/vite` for
  the browser) that wraps `const X = system(...)` as `__kiln_named("X", system(...))`.
- **Events** are double-buffered per phase block: a whole frame's Fixed steps count as one run, so
  every reader sees every event exactly once however many steps a frame runs. `app.events(E)` reads a
  per-`step()` recorder. Registration is `app.init(E)` (so `app.events(E)` can stay the test reader).
- **Input phase** is exported as `InputPhase` because `Input` is the resource.
- **Hot reload**: modules that only define systems hot-swap in place (`'keep'`); anything else reaches
  the entry, which rebuilds and restores a snapshot (`'snapshot'`) or reloads (`'keep'`, `false`).
- **Renderer**: `WebGPURenderer` (WebGL2 fallback), Three.js pinned to 0.186.1; TSL cheat sheet in the
  generated AGENTS.md; vendored community shader plugins as working examples.
- **Physics**: Rapier 0.21 compat builds (3D, or 2D in `mode: '2d'`). Deterministic on one machine;
  cross-machine determinism is deferred.
- **Runtime**: Bun for CLI/tests/scripts, Vite for the browser; core uses no `Bun.*` APIs.
- **Run conditions** (`runIf(cond, ...items)`) are schedule gates, not system options, so the same
  system can be gated at the add site like Bevy's `.run_if`. Conditions see `{ res, time }`; their
  resource reads are recorded for `kiln describe`, which prints them per system.
- **States** are resources (`state([...], initial)`). Transitions apply in a frame-start hook, once
  per frame; `onEnter`/`onExit` are conditions true for one frame (one step in Fixed), with the same
  edge rule as `Input.pressed`. `despawnOnExit` replaces Bevy's `StateScoped`.
- **Game plugins**: timers, tweens and the UI layer are in CorePlugins (headless, cheap, and silent
  no-ops when unused, which agents would otherwise trip on); camera and save are opt-in because they
  take over the camera or need configuration. Timers, Delayed and tweens count fixed steps so they
  stay deterministic. The UI is retained data in a resource (assertable headless), drawn as DOM over
  the canvas; `kiln shot` clips the page so the HUD is in the image. Save files hold the chosen
  resources and trait values only; Three.js objects are rebuilt by the game after `Loaded`.
- **Animation**: sprite and skeletal animation share one graph (`plugins/animation/graph.ts`, no
  Three.js): states play clips, transitions test params, triggers and exit times, events sit on states.
  It ticks in Fixed like timers and tweens, so a `hitFrame` event can drive gameplay deterministically.
  The graph computes crossfade weights and playheads itself; the skeletal plugin writes them into each
  mixer action and samples with `mixer.update(0)`, instead of Three's own fades, so the weights are
  testable headless and match the graph exactly. Sprite quads own their geometry (UVs per frame) and
  share one material per sheet. Both are opt-in plugins; animators are AoS objects with `toJSON` for
  snapshots and are not part of saves.
- **Recordings** (`core/recording.ts`): a session is the seed and loop config plus everything that
  reaches the simulation from outside, so a replay needs no world snapshot: per-frame deltas (replayed
  with `tick(dt)`, so the fixed-step accumulator splits frames exactly as it did live), input as the
  game saw it (action values, not keys, so devices and bindings don't matter), and side channels
  plugins note between frames (DOM HUD clicks; asset loads, which a replay holds back to the recorded
  frame; stored saves at start). Dev browser sessions record from boot; F8 or a crash POSTs to the
  Vite plugin, which writes `recordings/`. A state hash (entities and Rng, rounded) every 60 frames
  locates drift. Physics is not made deterministic here: Rapier drift, and `Math.*` differences
  between V8 and JavaScriptCore, show up as an early `divergedAt` rather than being prevented.
  Snapshots skip Three.js objects even though they have `toJSON`, so browser and headless states
  compare.
