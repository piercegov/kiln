---
description: "CameraPlugin: follow a target with smoothing, bounds, zoom and trauma shake."
---

# Camera

`CameraPlugin` is a camera rig that follows an entity, with smoothing, bounds, zoom and trauma-based
shake, in 2D and 3D. It needs the render plugin (`CorePlugins`) first.

```ts
app.use(CorePlugins, CameraPlugin)

commands.add(player, CameraTarget)        // or put CameraTarget in the Player prefab
res.mut(CameraRig).offset = { x: 0, y: 8, z: 10 }
events.emit(CameraShake, { amount: 0.4 })  // from any system; or res.mut(CameraRig).shake(0.4)
```

The rig follows the first entity tagged `CameraTarget`. On the first frame it finds one, it snaps to
it; after that it eases.

## Settings

Change them with `res.mut(CameraRig)`:

| Field | Default | |
|---|---|---|
| `offset` | 3D `0, 10, 12`; 2D `0, 0, 100` | Camera position relative to the focus point |
| `smoothing` | `6` | Catch-up rate per second; `0` snaps |
| `lookAt` | `true` | Aim at the focus point (3D) |
| `bounds` | none | `{ minX, maxX, minY, maxY, minZ, maxZ }`; leave an axis out to not limit it |
| `zoom` | `1` | |
| `maxOffset`, `maxAngle`, `decay` | 3D `0.4`, 2D `0.6`; `0.06`; `1.5` | Shake tuning: world units, radians, trauma lost per second |
| `frequency` | `18` | Shake noise speed, cycles per second |
| `enabled` | `true` | `false` hands the `Camera` back to your systems |

`focus` is the point the rig is looking at now; set it to cut the camera somewhere. `snap(to?)`
jumps to the target (or `to`) next frame instead of easing.

## Shake

Shake is trauma squared, so small hits stay subtle: `0.2` is a bump, `0.5` a hit, `1` an explosion.
Amounts add up to 1 and decay on their own. Emit `CameraShake` from gameplay rather than reaching for
the rig, so the system that causes it doesn't need the rig's resource.

Don't also move `res.mut(Camera)` yourself while the rig is enabled; the rig overwrites it every
frame.
