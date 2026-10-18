---
description: "Named spawn recipes, and plugins that bundle resources, events, systems and hooks."
---

# Prefabs and plugins

## Prefabs

A prefab is a named spawn recipe: a function from parameters to a list of traits. It keeps systems
from hand-assembling the same trait list in several places.

```ts
/** A coin at `at` that spins and bobs. */
export const Coin = prefab((p: { at: Vec3 }) => [
  Transform({ ...p.at }),
  IsCoin,
  Spin({ speed: 2 }),
  Bob({ baseY: p.at.y }),
  Model(coinModel),
])

/** The exit door. Takes no parameters. */
export const Door = prefab(() => [Transform({ z: -10 }), IsDoor])
```

Spawn one with `commands.spawn(Coin, { at })` in a system, or `app.spawn(Coin, { at })` in a test.
The parameters are type-checked, and a prefab without parameters takes none: `commands.spawn(Door)`.

Add more traits to a prefab's entity in the same system by passing the `PendingEntity` to
`commands.add`, which applies right after the spawn:

```ts
const coin = commands.spawn(Coin, { at })
commands.add(coin, despawnOnExit(Screen, 'playing'))
```

## Plugins

A plugin bundles resources, events and systems, the way a Bevy plugin does. It is a function of the
app:

```ts
/** Enemies: spawning, chasing, dying. */
export const EnemyPlugin = plugin((app) => {
  app
    .init(EnemyCount, EnemyDied)
    .add(Fixed, chain(Chase, EnemyMovement, KillEnemies))
    .add(Update, EnemyHud)
})

// src/main.ts
createApp(config).use(CorePlugins, EnemyPlugin)
```

- `app.use(...)` takes plugins, plain `(app) => void` functions, and arrays of either (that is all
  `CorePlugins` is). Each plugin is used once, however many times it is passed.
- Plugins can take options by being a function that returns a plugin, like the built-in
  `savePlugin({ ... })` and `renderPlugin({ ... })`.
- A plugin may be **async** (to load WASM, say). `app.ready()` waits for it, and the CLI, scenario
  tests and the browser runtime all wait for you. Stepping before it finishes throws `not-ready`.

### Hooks

Plugins that need to run outside systems can use `app.hooks`:

| Hook | When |
|---|---|
| `start(canvas)` | Before Startup when the app starts in a browser |
| `frameStart(dt, exact)` | At the start of each frame |
| `fixedStart`, `fixedEnd` | Around each fixed step |
| `frameEnd` | After Update and Late, before Render |
| `built` | After the schedule is (re)built |
| `dispose` | When the app is disposed |
| `error(err)` | When a browser frame throws (the loop pauses) |

`app.ext` is a bag for plugin controllers (the input plugin puts `app.input` there), and
`app.headless` is true until the app starts in a browser, so render-only work can skip itself.

### Plugins with outside input

Anything that reaches the simulation from outside, other than input devices, needs to be recorded for
[replays](../testing/recordings) to match. Plugins note it with `noteChannel(app, kind, data)`,
apply it in a replay with `replayChannel(app, kind, apply)`, and capture start-up state (stored
saves, for example) with `recordStartState(app, kind, capture, restore)`. `isReplaying(app)` is true
while a replay drives the app.
