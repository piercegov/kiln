---
description: "What is in CorePlugins, the opt-in plugins, and how to configure them."
---

# Plugins

Most of Kiln is plugins. `CorePlugins` is the set nearly every game uses; the rest are opt-in.

```ts
import { createApp, CorePlugins, CameraPlugin, savePlugin, SpriteAnimationPlugin } from 'kiln'
import { PhysicsPlugin } from 'kiln/physics'

createApp(config).use(CorePlugins, CameraPlugin, PhysicsPlugin)
```

## In CorePlugins

| Plugin | Gives you | Page |
|---|---|---|
| `CorePlugin` | `Time`, `Rng` | [Determinism](../concepts/determinism) |
| `RenderPlugin` | `Scene`, `Camera`, `Renderer`, `MeshRef`, instancing, interpolation | [Rendering](./render) |
| `InputPlugin` | `Input`, `ActionMap`, scripted input | [Input](./input) |
| `AssetsPlugin` | `Assets`, `Model` | [Assets](./assets) |
| `TimerPlugin` | `Timer`, `Lifetime`, `Delayed` | [Timers and tweens](./timers-tweens) |
| `TweenPlugin` | `Tweens`, `ease` | [Timers and tweens](./timers-tweens) |
| `UiPlugin` | `Ui`, `UiClick` | [HUD and UI](./ui) |
| `DebugPlugin` | The Tweakpane inspector (dev builds only) | [Debug panel](./debug) |

These are headless-safe and cost nothing when unused: the render plugin only draws once the app
starts on a canvas, and the debug panel does nothing headless or in production.

## Opt-in

| Plugin | Import | Page |
|---|---|---|
| `CameraPlugin` | `kiln` | [Camera](./camera) |
| `savePlugin({ ... })` | `kiln` | [Saving](./save) |
| `SpriteAnimationPlugin` | `kiln` | [Animation](./animation) |
| `SkeletalAnimationPlugin` | `kiln` | [Animation](./animation) |
| `PhysicsPlugin` / `physicsPlugin({ gravity })` | `kiln/physics` | [Physics](./physics) |

The camera rig takes over the camera and saving needs configuration, so neither is on by default.

## Configuring core plugins

Several core plugins have a configurable form. Use it instead of the default in `CorePlugins` by
listing the plugins yourself:

```ts
import { CorePlugin, renderPlugin, inputPlugin, DEFAULT_ACTIONS, AssetsPlugin, TimerPlugin, TweenPlugin, UiPlugin, debugPlugin } from 'kiln'

createApp(config).use(
  CorePlugin,
  renderPlugin({ background: 0x87ceeb, fov: 50 }),
  inputPlugin({ actions: { ...DEFAULT_ACTIONS, dash: ['KeyQ', 'Pad:RB'] } }),
  AssetsPlugin, TimerPlugin, TweenPlugin, UiPlugin,
  debugPlugin({ open: false }),
)
```

## Community plugins

`kiln add <name>` copies a community plugin's source into `src/plugins/<name>/`, where it is yours to
read and change. See [Community plugins](./community).

## Writing your own

A plugin is `plugin((app) => { ... })`. See [Prefabs and plugins](../concepts/prefabs-plugins#plugins).
