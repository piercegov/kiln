---
description: "Loading glTF, textures and JSON by path without blocking, Model, and headless loads."
---

# Assets

Files in the game's `public/` folder load by path: `'models/ship.glb'` is `public/models/ship.glb`.
Loading never blocks a phase. A load returns a cached handle at once, and systems check whether it
is ready.

## Loading

```ts
const assets = res.get(Assets)
const ship = assets.gltf('models/ship.glb')     // AssetHandle<GLTF>
const grass = assets.texture('textures/grass.png')
const level = assets.json<LevelData>('levels/1.json')
const any = assets.load('data/names.txt')       // kind from the extension
```

| Handle field | |
|---|---|
| `ready` | The value is loaded |
| `failed`, `error` | Loading failed; `error` says why and how to fix it |
| `value` | The loaded value, or null |
| `promise` | Resolves with the value, for code outside systems |

Loading the same path twice returns the same handle. Never `await` in a system: check `ready` and try
again next frame.

```ts
export const BuildLevel = system(({ res, commands }) => {
  const level = res.get(Assets).json<LevelData>('levels/1.json')
  if (!level.ready || res.get(LevelBuilt).done) return
  for (const c of level.value!.coins) commands.spawn(Coin, { at: c })
  res.mut(LevelBuilt).done = true
})
```

Kinds come from the extension: `.glb`/`.gltf` are glTF, images (`png jpg jpeg webp avif gif ktx2`)
are textures, `.json` is parsed, `txt glsl wgsl csv md` are text, anything else is an `ArrayBuffer`.

## Models

`Model(handle)` shows a glTF once it has loaded:

```ts
commands.spawn(Transform({ x: 2 }), Model(res.get(Assets).gltf('models/ship.glb')))
```

When the handle is ready, the entity gets a `MeshRef` holding a new instance of the model's scene
(skinned meshes are cloned properly). Geometry and materials are shared with the cache, so despawning
the entity doesn't dispose them. `res.get(Assets).instantiate(handle)` makes an instance yourself.

## Headless

Under Bun the same calls read from `public/` on disk. Textures are placeholders (pixels don't affect
the simulation), and glTF files parse fully, so animation clips and skeletons are there in tests.

Scenarios and `kiln shot` wait for loads started in `Startup` before stepping, so runs are
deterministic. Loads started later finish in the background; `await app.idle()` waits for them, and
`res.get(Assets).pending` counts them.

## Options

`assetsPlugin({ baseUrl, baseDir })` in place of `AssetsPlugin`: `baseUrl` is the URL prefix in the
browser (Vite's base by default), `baseDir` the folder for headless loads (`<game>/public` by
default).
