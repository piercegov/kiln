---
description: "Headless scenario tests: fresh app, exact steps, scripted input, assertions."
---

# Scenario tests

A scenario is a headless test of the real game. It builds a fresh app from `src/main.ts`, runs
`Startup`, lets you set things up and step exact frames, and disposes the app afterwards. Scenarios
run under `bun test`; `kiln test` runs every file in `scenarios/`.

```ts
import { expect, scenario } from 'kiln-ecs/test'
import { Transform } from 'kiln-ecs'
import { Player } from '../src/prefabs.ts'

scenario('player walks right', ({ app }) => {      // fresh app, Startup already run
  const p = app.spawn(Player, { at: { x: 0, y: 0, z: 0 } })
  app.input.script([{ frame: 1, hold: 'right', frames: 60 }])
  app.step(60)                                     // exactly 60 fixed steps, no renderer
  expect(app.get(p, Transform)!.x).toBeCloseTo(6, 3)
}, { seed: 3 })
```

Before the body runs, async plugins (physics) are ready and asset loads started in `Startup` have
finished, so every run is the same.

## Options

`scenario(name, body, options)`:

| Option | |
|---|---|
| `seed` | Overrides `config.seed` |
| `config` | Other config overrides (`fixedHz`, `mode`, ...) |
| `startup` | `false` skips `Startup` |
| `app` | A factory to build the app instead of the game's entry |
| `timeout` | Test timeout in ms |

`scenario.only` and `scenario.skip` work like `test.only` and `test.skip`. `kiln-ecs/test` re-exports
`expect` and `describe` from `bun:test`.

## The app in tests

| Method | |
|---|---|
| `step(n)` | Run `n` frames of exactly one fixed step each |
| `tick(dt)` | Run one frame with a real delta, like the browser |
| `spawn(...)`, `despawn(e)` | Immediate, not queued |
| `get(e, T)`, `set(e, T, {...})`, `has(e, T)` | Trait values |
| `query(...)` | Matching entities now |
| `res(R)` | A resource, writable |
| `insert(R, value)` | Replace a resource |
| `emit(E, data)` | Emit an event from outside a system |
| `events(E)` | Everything `E` emitted during the last `step()` call |
| `input` | Scripted input: `script([...])`, `press`, `release`, `tap`, `setAxis`, `reset` |
| `snapshot(opts)`, `diff(a, b)`, `restore(snap)` | See [Snapshots](./snapshots) |
| `describe()` | The schedule as data |

## Writing good scenarios

**Keep each one about one thing.** Put entities where you need them with
`app.set(e, Transform, {...})`, and despawn what would interfere:

```ts
app.query(IsEnemy).forEach((e) => app.despawn(e))
```

**Mind the level.** Long input holds run into level geometry (arena walls, the ground), so start the
player where the run fits.

**Count events in chunks.** `app.events(E)` only holds what the last `step()` call emitted. To check
"exactly once" over a long run, step in chunks and add up the lengths:

```ts
let hits = 0
for (let i = 0; i < 10; i++) {
  app.step(60)
  hits += app.events(Hit).length
}
expect(hits).toBe(1)
```

**Test the HUD as data.** `app.res(Ui).get('score')?.text`, and `app.res(Ui).click('menu.start')`
to press a button. See [HUD and UI](../plugins/ui#in-tests).

## Building apps yourself

`scenarioApp(options)` builds an app the same way and returns it, for tests that manage their own
lifecycle (two apps sharing save storage, say). Dispose it when done:

```ts
const app = await scenarioApp({ seed: 7 })
try {
  app.step(10)
} finally {
  app.dispose()
}
```

Koota allows 16 worlds at once, so an app that is never disposed eventually fails with
`too-many-apps`.

## Regression tests from recordings

A recorded play session becomes a test with `replay(...)`. See
[Recordings and replay](./recordings#keep-it-as-a-test).
