---
description: "Create a game with kiln new, run it, read its schedule and run its test."
---

# Getting started

## Requirements

- [Bun](https://bun.sh) (developed on 1.4). Bun runs the CLI, the tests and the scripts.
- A browser with WebGPU or WebGL2 to play. `kiln shot` needs a Chromium: Playwright's, or any
  Chrome binary named by `KILN_CHROMIUM`.

Kiln isn't published to npm yet. From a checkout of the Kiln repository:

```bash
bun install
bun test
```

## Create a game

`kiln new` copies the starter template into a new folder and writes an `AGENTS.md`:

```bash
bun packages/kiln/src/cli/kiln.ts new ../my-game
cd ../my-game
bun install
```

Outside the Kiln repo the game depends on your checkout through a `file:` path. Created inside
`examples/`, it joins the workspace instead.

Inside the game the `kiln` command comes from the `kiln` package, so run it with `bunx kiln ...` or
through the package scripts (`bun run test`, `bun run describe`, `bun run docs`). The rest of these
docs write it as plain `kiln`.

```bash
bunx kiln docs       # add this game's schedule and exports to AGENTS.md
bunx kiln test       # the template's scenario test
bunx vite            # play it at http://localhost:5173
```

The starter is a blue box on a floor that moves with WASD, the arrow keys or a gamepad stick.

## What you got

```
my-game/
  kiln.config.ts      fixedHz, seed, mode, hotReload
  index.html          a canvas and boot(main)
  vite.config.ts      the kiln() Vite plugin
  bunfig.toml         preloads kiln/preload for bun test
  src/main.ts         default-exports () => createApp(config)...: the whole schedule
  src/data.ts         traits, resources and events
  src/prefabs.ts      spawn recipes
  src/systems.ts      systems, grouped by phase
  scenarios/          headless tests
  public/             assets, loaded by path
  AGENTS.md           the Kiln guide, plus a generated section for this game
```

The schedule in `src/main.ts` is short:

```ts
import { chain, createApp, CorePlugins, Fixed, Startup } from 'kiln'
import config from '../kiln.config.ts'
import { Movement, PlayerMove, SpawnLevel } from './systems.ts'

/** The game: the whole schedule, top to bottom. */
export default () =>
  createApp(config)
    .use(CorePlugins)
    .add(Startup, SpawnLevel)
    .add(Fixed, chain(PlayerMove, Movement))
```

The entry module default-exports a function that builds the app and returns it. The browser calls
it through `boot(main)` and starts the loop; the CLI and scenario tests call it and step the app
headless. Never call `.start()` in `main.ts`.

## See the schedule

```bash
kiln describe
```

```
app mode=3d fixedHz=60 seed=1
plugins CorePlugin, RenderPlugin, InputPlugin, AssetsPlugin, TimerPlugin, TweenPlugin, UiPlugin, DebugPlugin
phase Startup
  1. SpawnLevel
phase Input
  1. PollInput | res-writes Input | res-reads ActionMap
  2. UiEvents | res-reads Input,Ui
phase Fixed
  1. TickTimers | writes Lifetime,Timer | res-reads Delayed
  2. TickTweens | res-reads Tweens
  3. PlayerMove | writes Velocity | reads IsPlayer | res-reads Input
  4. Movement | writes Transform | reads Velocity | after PlayerMove
phase Update
  1. SpawnModels | reads MeshRef,Model
phase Render
  1. RenderSync | reads MeshRef,Transform
  2. InstanceSync | reads InstanceColor,Instanced,Transform | after RenderSync
  3. Draw | after RenderSync,InstanceSync
  4. RenderUi
traits
  ...
```

Every system is listed in run order with what it writes and reads, including the ones plugins
add. Resource access (`res-reads`, `res-writes`) is what one headless step actually touched. This is the first thing to run
after a change: schedule errors show here before anything else.

## Run the test

`scenarios/player.test.ts` holds the starter's one test:

```ts
import { expect, scenario } from 'kiln/test'
import { Transform } from 'kiln'
import { IsPlayer } from '../src/data.ts'

scenario('the player walks right while right is held', ({ app }) => {
  const p = app.query(IsPlayer)[0]!
  app.input.script([{ frame: 1, hold: 'right', frames: 60 }])
  app.step(60)
  expect(app.get(p, Transform)!.x).toBeCloseTo(5, 3)
})
```

`scenario` builds a fresh app from `src/main.ts`, runs Startup, and disposes it afterwards. `step(60)`
runs exactly 60 fixed steps with no renderer, so the result is exact: speed 5 for one second is
5 units.

## Next

- [A complete feature](./first-feature): add health and damage end to end.
- [Working with agents](./agents): the loop and `AGENTS.md`.
- [Entities and traits](../concepts/ecs): the data model.
