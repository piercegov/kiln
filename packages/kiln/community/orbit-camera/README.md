# orbit-camera

An orbit camera around a target point. Drag with the `fire` or `alt` action held (left/right mouse
by default) to rotate, scroll to zoom. Add `CameraFollow` to an entity and the orbit target follows
its Transform smoothly. Needs the render and input plugins (`CorePlugins`).

```ts
import { OrbitCameraPlugin, OrbitCamera, CameraFollow } from './plugins/orbit-camera/index.ts'

app.use(CorePlugins, OrbitCameraPlugin)

// in a Startup system:
commands.spawn(OrbitCamera({ distance: 20, yaw: 0.8, pitch: 0.5 }))
commands.spawn(Transform({ x: 2 }), Player, CameraFollow({ smoothing: 6, offsetY: 1 })) // the camera follows it
```

Adds:
- `OrbitCamera` trait: targetX/Y/Z, distance, yaw, pitch, min/max distance and pitch, rotateSpeed, zoomSpeed, enabled. The first entity with it drives the `Camera` resource.
- `CameraFollow` trait: smoothing (catch-up rate per second, 0 snaps), offsetX/Y/Z.
- Systems (Update): `FollowTarget`, then `OrbitControl` (writes `res.mut(Camera)`).
