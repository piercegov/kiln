---
description: "Every kiln.config.ts field, overrides, and the Vite and Bun setup."
---

# Configuration

`kiln.config.ts` at the game root default-exports the config. `defineConfig` only adds types:

```ts
import { defineConfig } from 'kiln'

export default defineConfig({
  fixedHz: 60,
  seed: 1,
  mode: '3d',
  hotReload: 'keep',
})
```

`src/main.ts` passes it to `createApp(config)`. Every field is optional.

| Field | Default | |
|---|---|---|
| `fixedHz` | `60` | Fixed simulation rate; `time.step` is `1 / fixedHz` |
| `seed` | `0` | Seed for the `Rng` resource |
| `mode` | `'3d'` | `'2d'`: orthographic camera, `z` as draw order, Z-only rotation, Rapier 2D |
| `hotReload` | `'keep'` | `'keep'`, `'snapshot'` or `false`. See [Hot reload](../concepts/hot-reload) |
| `dev` | on unless `NODE_ENV=production` | Dev guards and read-only proxies |
| `maxFrameDt` | `0.25` | Frame delta clamp in seconds, so a background tab doesn't spiral |
| `maxFixedSteps` | `5` | Most fixed steps per frame |
| `vsync` | `true` | Pace browser frames with `requestAnimationFrame` |
| `maxFps` | `0` | Cap on browser frames per second; `0` means no cap |
| `record` | `true` | Record dev browser sessions so F8 or a crash saves a recording |
| `entry` | `'src/main.ts'` | The module whose default export builds the app |

`vsync` and `maxFps` can change at runtime through `app.frameRate`, and the debug panel has controls
for both. With `vsync: false` frames run back to back, keeping at most one frame of GPU work in
flight, which is useful for measuring throughput.

## Overrides

The CLI and the scenario runner override config without editing the game: `kiln run --seed 3`,
`scenario(name, fn, { seed: 3, config: { fixedHz: 30 } })`, and replays use the recording's loop
config. Overrides apply inside `createApp`, so they reach the app however `main.ts` builds it.

## Vite

`vite.config.ts` adds the `kiln()` plugin:

```ts
import { defineConfig } from 'vite'
import { kiln } from 'kiln/vite'

export default defineConfig({ plugins: [kiln()] })
```

It applies the names transform, wires hot reload, serves the page `kiln shot` renders, and accepts
recordings from F8. Pass `kiln({ entry })` if the entry isn't `src/main.ts`.

## Bun

`bunfig.toml` preloads the names transform for tests:

```toml
[test]
preload = ["kiln/preload"]
```
