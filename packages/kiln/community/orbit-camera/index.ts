// Orbit camera: drag to rotate, wheel to zoom, optionally follow an entity. Vendored by `kiln add orbit-camera`.
import { Camera, clamp, Input, Mut, plugin, system, trait, Transform, Update } from 'kiln-ecs'

/**
 * Orbit camera parameters. Put it on one entity (the first one found drives the Camera):
 * `commands.spawn(OrbitCamera({ distance: 20, pitch: 0.6 }))`. The camera sits `distance` away from
 * (targetX, targetY, targetZ), at `yaw` radians around Y and `pitch` radians above the horizon.
 * Dragging with 'fire' or 'alt' held rotates it, the wheel zooms. Set `enabled: false` to freeze
 * input while still placing the camera.
 */
export const OrbitCamera = trait({
  targetX: 0,
  targetY: 0,
  targetZ: 0,
  distance: 15,
  yaw: 0,
  pitch: 0.5,
  minDistance: 2,
  maxDistance: 200,
  minPitch: -1.45,
  maxPitch: 1.45,
  /** Radians per pixel of pointer drag. */
  rotateSpeed: 0.006,
  /** Fraction of distance per 100 wheel units. */
  zoomSpeed: 0.1,
  enabled: true,
})

/**
 * Makes the orbit target follow this entity's Transform: `CameraFollow({ smoothing: 6, offsetY: 1 })`.
 * `smoothing` is the catch-up rate per second (0 snaps). The first entity with CameraFollow and
 * Transform is followed.
 */
export const CameraFollow = trait({ smoothing: 6, offsetX: 0, offsetY: 0, offsetZ: 0 })

/** Moves the orbit target toward the followed entity, framerate-independently. */
export const FollowTarget = system(
  { cams: [Mut(OrbitCamera)], follow: [CameraFollow, Transform] },
  ({ cams, follow }, { time }) => {
    const target = follow.first()
    if (target === undefined || cams.length === 0) return
    const t = target.get(Transform)!
    const f = target.get(CameraFollow)!
    cams.each(([o]) => {
      const k = f.smoothing <= 0 ? 1 : 1 - Math.exp(-f.smoothing * time.dt)
      o.targetX += (t.x + f.offsetX - o.targetX) * k
      o.targetY += (t.y + f.offsetY - o.targetY) * k
      o.targetZ += (t.z + f.offsetZ - o.targetZ) * k
    })
  },
)

/** Applies pointer drag and wheel to the OrbitCamera, then places the Camera and aims it at the target. */
export const OrbitControl = system({ cams: [Mut(OrbitCamera)] }, ({ cams }, { res }) => {
  if (cams.length === 0) return
  const input = res.has(Input) ? res.get(Input) : null
  let done = false
  cams.each(([o]) => {
    if (done) return // only the first OrbitCamera drives the Camera
    done = true
    if (input && o.enabled) {
      const p = input.pointer
      if (input.down('fire') || input.down('alt')) {
        o.yaw -= p.dx * o.rotateSpeed
        o.pitch += p.dy * o.rotateSpeed
      }
      if (p.wheel !== 0) o.distance *= Math.exp((p.wheel / 100) * o.zoomSpeed)
    }
    o.pitch = clamp(o.pitch, o.minPitch, o.maxPitch)
    o.distance = clamp(o.distance, o.minDistance, o.maxDistance)
    const cam = res.mut(Camera)
    const cp = Math.cos(o.pitch)
    cam.position.set(
      o.targetX + o.distance * cp * Math.sin(o.yaw),
      o.targetY + o.distance * Math.sin(o.pitch),
      o.targetZ + o.distance * cp * Math.cos(o.yaw),
    )
    cam.lookAt(o.targetX, o.targetY, o.targetZ)
  })
})

/**
 * Orbit camera: `app.use(OrbitCameraPlugin)` after CorePlugins, then spawn an `OrbitCamera` entity.
 * Runs FollowTarget then OrbitControl in Update; writes `res.mut(Camera)`.
 */
export const OrbitCameraPlugin = plugin((app) => {
  app.add(Update, OrbitControl.after(FollowTarget), FollowTarget)
}, 'OrbitCameraPlugin')
