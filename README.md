# Kiln

An agent-first game framework on Three.js: a fixed-step loop, a [Koota](https://github.com/pmndrs/koota)
ECS, and a render bridge, designed so a coding agent can add a feature with a few exports and one
scheduling line, and verify it headlessly.

[![Docs](https://img.shields.io/badge/docs-read%20online-orange?style=for-the-badge&logo=readthedocs&logoColor=white)](https://kilnjs.pages.dev)

```ts
// src/systems.ts
/** Integrates Velocity into Transform. */
export const Movement = system([Mut(Transform), Velocity], ([t, v], { time }) => {
  t.x += v.x * time.step
  t.z += v.z * time.step
})

// src/main.ts
export default () =>
  createApp(config)
    .use(CorePlugins)
    .add(Startup, SpawnLevel)
    .add(Fixed, chain(PlayerMove, Movement, CollectCoins))
```

```bash
kiln describe     # the schedule: phases, systems, reads/writes/order
kiln test         # headless scenario tests (bun test)
kiln run --steps 600 --snapshot Transform    # the world as JSON after 10 simulated seconds
kiln check        # determinism lint: Math.random, Date.now and friends in game code
kiln replay recordings/session.json   # replay a recorded play session headless on the current code
kiln shot out.png # one frame from headless Chromium
kiln docs         # AGENTS.md from the code and its JSDoc
```

## What's included

- `CorePlugins`: time and seeded RNG, rendering, input actions, assets, timers, tweens, a HUD/UI layer
  (text, bars and buttons as retained data) and a dev debug panel.
- Game states and run conditions: `state()`, `runIf(inState(...))`, `onEnter`/`onExit`, `despawnOnExit`.
- Opt-in plugins: `CameraPlugin` (follow, bounds, zoom, trauma shake; 2D and 3D), `savePlugin` (save slots
  and persisted settings), `SpriteAnimationPlugin` (sprite sheets and atlases), `SkeletalAnimationPlugin`
  (glTF models), both driven by an animation graph with crossfades and frame events, and Rapier physics
  (`kiln/physics`).
- Session recording: press F8 in the dev server to save a play session, then `kiln replay` it headless to
  find where the current code stops matching it.
- Community plugins via `kiln add`: audio, orbit-camera, particles, terrain, water.

## Repo

- `packages/kiln`: the framework (`kiln`, `kiln/physics`, `kiln/test`, `kiln/vite`, `kiln/browser`), the CLI,
  community plugins for `kiln add`, and the `kiln new` template.
- `examples/coin-collector`: a 3D sample game (states, pause menu, tweens, camera follow, saved best score),
  with `eval/` tasks for measuring agents.
- `examples/sprite-hero`: a 2D sprite-sheet hero with an animation graph, footstep dust and hit-frame sword hits.
- `docs/`: the documentation site (VitePress guides plus a TypeDoc API reference); `cd docs && bun install && bun run dev`.
  `docs/design.md` is how the build maps to the design doc.

## Develop

```bash
bun install
bun test                 # everything, including the examples' scenarios
bun run typecheck
cd examples/coin-collector && bunx vite     # play it (or examples/sprite-hero)
```

Start a game: `bun packages/kiln/src/cli/kiln.ts new ../my-game`.
