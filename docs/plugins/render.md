---
description: "MeshRef, interpolation, teleports, hierarchy, instancing, the camera, 2D mode."
---

# Rendering

The ECS is the truth and Three.js is a view of it. Gameplay writes `Transform`; the render plugin
copies it into Three.js objects every frame, interpolated between fixed steps, and draws.

## Showing an entity

Give it a `MeshRef` holding any Three.js `Object3D`:

```ts
commands.spawn(
  Transform({ y: 0.5 }),
  MeshRef(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x4d96ff }))),
)
```

- Adding `MeshRef` puts the object in the scene. Replacing it swaps the object.
- Despawning (or removing `MeshRef`) takes it out of the scene and disposes its geometry and
  materials, unless the entity has `SharedMesh` (or the object has `userData.kilnShared`). Use
  `SharedMesh` when several entities share one geometry or material.
- Systems may reach through `MeshRef` to change materials and uniforms, but positions always come
  from `Transform`. Setting `object.position` yourself is overwritten next frame.
- `objectOf(entity)` returns the object an entity renders as.

For loaded glTF models, use [`Model`](./assets#models) instead; it adds the `MeshRef` for you.

## Interpolation and teleports

`Fixed` runs at `fixedHz`, but the display may run faster. The render plugin keeps each entity's
previous transform and blends towards the current one by `time.alpha`, so motion is smooth at any
frame rate.

To move an entity without the blend (respawning, portals), write the `Transform` and add
`Teleported`. The tag removes itself after one step.

```ts
t.x = spawn.x; t.z = spawn.z
commands.add(entity, Teleported)
```

## Hierarchy

`ChildOf(parent)` makes an entity's `Transform` local to its parent's. The render plugin composes the
chain, so a hat on a player follows the player:

```ts
commands.spawn(Transform({ y: 1.1 }), MeshRef(hatMesh), ChildOf(player))
```

## Instancing

Many copies of one mesh (bullets, coins, grass) should share one `InstancedMesh`:

```ts
// once, at module level or in a plugin
defineInstanced('bullet', { geometry: new THREE.SphereGeometry(0.1), material: new THREE.MeshBasicMaterial() })

// per entity
commands.spawn(Transform({ ...at }), Instanced('bullet'), InstanceColor({ r: 1, g: 0.3, b: 0.2 }))
```

Capacity starts at 256 (or `capacity` in the definition) and doubles as needed. `InstanceColor`
multiplies the material colour per instance. Instanced geometry and materials are shared by every app
and never disposed by Kiln.

## Scene and camera

```ts
res.get(Scene)       // the THREE.Scene: add lights, fog, a background
res.mut(Camera)      // a plain THREE camera: perspective in 3D, orthographic in 2D
res.get(Renderer)    // { renderer, backend: 'webgpu' | 'webgl2', width, height, pixelRatio }
```

Move the camera from an `Update` system, or let the [camera rig](./camera) do it. The 3D default is
a 60° perspective camera at `(0, 10, 14)` looking at the origin, with a hemisphere light and a
directional light in the scene.

## Ordering Render-phase work

The render plugin's systems run in `Render`: `RenderSync` (copies interpolated transforms to the
objects), `InstanceSync`, then `Draw`. A camera or posing system that reads interpolated positions
and must land in this frame's draw goes between them:

```ts
import { Draw, Render, RenderSync } from 'kiln-ecs'

app.add(Render, FollowCamera.after(RenderSync).before(Draw))
```

## Options

`renderPlugin({ ... })` in place of `RenderPlugin`:

| Option | Default | |
|---|---|---|
| `background` | `0x1a1d23` | Clear colour; `null` for none |
| `lights` | `true` | The default lights (3D) |
| `antialias` | | Passed to the renderer |
| `fov` | `60` | Perspective field of view, degrees |
| `cameraPosition` | `[0, 10, 14]` | Initial 3D camera position |
| `viewHeight` | `20` | World units visible vertically in 2D |
| `maxPixelRatio` | `2` | Cap on `devicePixelRatio` |
| `forceWebGL` | `false` | Use the WebGL2 backend |

## 2D mode

`mode: '2d'` in `kiln.config.ts` keeps the same traits with different meanings:

- The camera is orthographic, showing `viewHeight` world units vertically, looking down -Z.
- `x` and `y` are the screen plane; `z` is draw order.
- Only rotation about Z is used: set it with `setAngle2D(t, angle)` and read it with `angle2D(t)`.
- Physics switches to Rapier 2D.

## Renderer

Kiln uses Three.js's `WebGPURenderer`, which falls back to WebGL2 where WebGPU isn't available.
Three.js is pinned to 0.186.1. Write custom materials with TSL node materials, not `ShaderMaterial`
or GLSL, which don't run on WebGPU. See [Shaders (TSL)](./tsl).

Headless (tests, `kiln run`) the scene still tracks `MeshRef` objects, but nothing is drawn and the
`Render` phase doesn't run.
