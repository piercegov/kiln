---
description: "savePlugin: save slots, persisted settings, storage, and testing saves."
---

# Saving

`savePlugin` gives a game save slots (progress the player saves and loads) and persisted resources
(settings and high scores that survive between sessions on their own).

```ts
app.use(CorePlugins, savePlugin({
  key: 'my-game',
  resources: [Level, Inventory],              // written to slots
  traits: [IsPlayer, Transform, Health],      // which entities, and which of their values
  persist: [Settings, HighScore],             // loaded at startup, saved whenever they change
}))
```

## Slots

```ts
res.mut(Saves).save('slot1')     // writes now, emits Saved { slot }
res.mut(Saves).load('slot1')     // false if missing; applies at the next frame start, then emits Loaded { slot }
res.get(Saves).has('slot1')
res.get(Saves).slots()           // slot names, sorted
res.mut(Saves).delete('slot1')
```

- `resources` are written to each slot whole.
- `traits` picks entities (every entity with at least one of them) and the values saved for them.
  Loading replaces those entities and leaves every other entity alone. Relations listed here are
  relinked between saved entities.
- Only JSON-friendly values are saved. Three.js objects (`MeshRef`) are not: rebuild visuals when
  `Loaded` arrives, or with a system over `[IsCoin, Not(MeshRef)]` that adds the mesh to anything
  missing one. Animators aren't saved either.

## Persisted resources

`persist` resources load before `Startup` and save themselves whenever they change. They are for
things that belong to the player rather than to a run: volume, key bindings, best score.

## Storage

Saves go to `localStorage` in the browser, under keys prefixed with `key` (default `'kiln'`), so
games on one origin don't collide. Headless they go to memory. Pass `storage` to use something else
(any `{ get, set, remove, keys }` object; `localStorageStorage()` and `memoryStorage()` are the built-in ones).

Tests share one `memoryStorage()` between two apps to check that data survives a restart:

```ts
import { test } from 'bun:test'
import { expect, scenarioApp } from 'kiln/test'

test('the best score survives a restart', async () => {
  const storage = memoryStorage()
  const make = () => createApp().use(CorePlugins, savePlugin({ persist: [Best], storage }))

  const first = await scenarioApp({ app: make })
  first.res(Best).value = 12
  first.step(1)                    // persisted resources save when they change
  first.dispose()

  const second = await scenarioApp({ app: make })
  expect(second.res(Best).value).toBe(12)
  second.dispose()
})
```

A recording captures the stored saves a session started with, so replays load the same data.
