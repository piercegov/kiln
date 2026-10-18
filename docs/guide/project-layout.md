---
description: "The files of a Kiln game, the entry module, and how names come from exports."
---

# Project layout

```
kiln.config.ts           fixedHz, seed, mode ('3d' | '2d'), hotReload, vsync, maxFps
src/main.ts              default-exports () => createApp(config)...: the whole schedule
src/data.ts              traits, resources and events
src/prefabs.ts           spawn recipes (and spawn helpers)
src/systems.ts           systems, grouped by phase
src/plugins/<name>/      vendored community plugins (yours to read and edit)
scenarios/*.test.ts      headless tests
recordings/              play sessions saved with F8 in the dev server
public/                  assets, loaded by path ('models/ship.glb' → public/models/ship.glb)
AGENTS.md                the Kiln guide plus a generated section for this game
```

Start with these few files and split one only when it gets long (`src/systems/combat.ts`,
`src/systems/ui.ts`, ...). Import everything from `'kiln-ecs'`; physics comes from `'kiln-ecs/physics'` and
test helpers from `'kiln-ecs/test'`.

## The entry module

`src/main.ts` default-exports a function that builds the app and returns it. It is the only place
the schedule is written down, so reading it top to bottom tells you everything that runs:

```ts
export default () =>
  createApp(config)
    .use(CorePlugins, CameraPlugin)
    .init(Score, Screen, Hit)
    .add(Startup, SpawnLevel)
    .add(Fixed, runIf(inState(Screen, 'playing'), chain(PlayerMove, Movement, CollectCoins)))
    .add(Update, UpdateHud)
```

- `.use(...)` adds [plugins](../concepts/prefabs-plugins#plugins).
- `.init(...)` registers [resources and events](../concepts/resources-events). Resources also create
  themselves on first use, but listing them here makes them show in `kiln describe` and snapshots
  from the start.
- `.add(Phase, ...)` schedules systems in a [phase](../concepts/schedule).

The function may be async. The browser runtime, the CLI and the scenario runner all call it, so it
must not call `.start()` or touch the DOM.

A different entry file can be set with `entry` in `kiln.config.ts`.

## Names come from exports

`export const Movement = system(...)` is named `Movement`. The same goes for traits, relations,
resources, events, prefabs, plugins and states. Those names appear in errors, in `kiln describe`, in
snapshots, in recordings and in `AGENTS.md`, and `kiln run --snapshot Health` finds a trait by its
name.

A small runtime transform does the naming: it rewrites
`const X = system(...)` into `const X = __kiln_named("X", system(...))`. The `kiln()` Vite plugin
applies it in the browser and `kiln-ecs/preload` applies it under Bun (the template's `bunfig.toml`
preloads it for `bun test`). Types are untouched. Two consequences:

- Moving code between files changes nothing. Kiln never names things after their file.
- Define Kiln objects with `const` and a direct factory call. `let X = system(...)`, or a system
  returned from a helper function, isn't named; call `.named('X')` on it (or pass the `name`
  option to `system`).

## JSDoc is the documentation

Give every export a one-line JSDoc comment:

```ts
/** Hit points; the entity despawns at 0. */
export const Health = trait({ hp: 3 })
```

`kiln docs` copies these lines into the generated part of `AGENTS.md`, next to each system's place
in the schedule, and lists exports that have none. See [Working with agents](./agents).

## Files and hot reload

Keep systems in files that define only systems (plain constants and helper functions are fine), and
export each one. Editing a systems-only file swaps those systems in place and keeps the world. A file
that also defines a trait, resource, event, prefab or plugin reloads the app instead. See
[Hot reload](../concepts/hot-reload).

## Configuration

`kiln.config.ts` default-exports a config object:

```ts
import { defineConfig } from 'kiln-ecs'

export default defineConfig({
  fixedHz: 60,
  seed: 1,
  mode: '3d',
  hotReload: 'keep',
})
```

Every field is optional. The full list is in [Configuration](../reference/config).
