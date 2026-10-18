---
description: "Vendoring community plugins with kiln add, the available plugins, and writing one."
---

# Community plugins

Community plugins are vendored, not installed. `kiln add` copies a plugin's source into
`src/plugins/<name>/`, where it is part of your game: readable, editable, and covered by `kiln check`
and the names transform like the rest of your code.

```bash
kiln add --list
kiln add particles
```

```
ok copied particles to src/plugins/particles/
next in src/main.ts: import { ParticlesPlugin } from './plugins/particles/index.ts' and add .use(ParticlesPlugin)
```

Adding a plugin that's already there fails unless you pass `--force`, so your edits aren't lost by
accident.

## Available plugins

| Plugin | What it does |
|---|---|
| `audio` | Positional sounds tied to `Transform` on Web Audio (`Sound` trait, `PlaySound` event). No-op headless |
| `orbit-camera` | Drag to rotate, wheel to zoom, optional smooth follow (`OrbitCamera`, `CameraFollow`) |
| `particles` | Visual-only emitters, one `InstancedMesh` each, seeded from the app's `Rng` (`ParticleEmitter`) |
| `terrain` | Seeded heightfield terrain with vertex colours and a headless `terrainHeightAt` sampler |
| `water` | An animated TSL water plane, with `waterHeightAt` on the CPU for buoyancy |

Each plugin's `README.md` (copied along with it) lists its traits, events and systems.

## Writing one

A community plugin is a folder with an `index.ts` that exports a `...Plugin`, a `README.md`, and a
`kiln-plugin.json` manifest:

```json
{
  "name": "particles",
  "description": "Visual-only particle emitters: one InstancedMesh per emitter, seeded from the app Rng.",
  "files": ["index.ts", "README.md"],
  "requires": []
}
```

`kiln add` looks in Kiln's own `community/` folder and in every folder listed in `KILN_PLUGIN_PATH`
(colon-separated), so a team can keep its own registry.
