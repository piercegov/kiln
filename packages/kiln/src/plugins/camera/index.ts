import * as THREE from 'three'
import type { App } from '../../core/app.ts'
import { event } from '../../core/event.ts'
import { trait } from '../../core/koota.ts'
import { plugin } from '../../core/plugin.ts'
import { resource } from '../../core/resource.ts'
import { Render, Update } from '../../core/schedule.ts'
import { system } from '../../core/system.ts'
import { ChildOf, Transform } from '../../core/transform.ts'
import { Camera, Draw, RenderSync } from '../render/index.ts'
import { MeshRef } from '../render/traits.ts'

/** Tag: the camera rig follows this entity (the first one, if several). */
export const CameraTarget = trait()

/** Shakes the camera: `events.emit(CameraShake, { amount: 0.4 })`. Amounts add up to 1. */
export const CameraShake = event<{ amount: number }>()

interface Vec {
  x: number
  y: number
  z: number
}

/** Area the camera's focus point stays inside (world units). Leave an axis out to not limit it. */
export interface CameraBounds {
  minX?: number
  maxX?: number
  minY?: number
  maxY?: number
  minZ?: number
  maxZ?: number
}

/**
 * The camera rig's settings and state. Change settings with `res.mut(CameraRig)`:
 * `offset` from the focus point (3D default 0, 10, 12; 2D 0, 0, 100), `smoothing` (catch-up rate per
 * second; 0 snaps), `lookAt` (3D: aim at the focus), `bounds` (clamp the focus), `zoom`, and shake
 * tuning (`maxOffset` world units, `maxAngle` radians, `decay` trauma per second). `shake(amount)`
 * adds trauma 0..1; the shake is trauma² so small hits stay subtle. `focus` is where the rig looks now.
 */
export class CameraRigState {
  enabled = true
  offset: Vec
  smoothing = 6
  lookAt = true
  bounds: CameraBounds | null = null
  zoom = 1
  trauma = 0
  maxOffset: number
  maxAngle = 0.06
  decay = 1.5
  /** Noise speed of the shake, in cycles per second. */
  frequency = 18
  /** The smoothed point the camera follows. Set it to cut the camera somewhere. */
  focus: Vec = { x: 0, y: 0, z: 0 }
  /** False until the first target is found; then the rig snaps to it once. */
  started = false
  /** Seconds of shake noise elapsed. */
  t = 0
  /** The current shake offset and roll, for tests and for effects that want to match it. */
  readonly current = { x: 0, y: 0, z: 0, roll: 0 }

  constructor(readonly is2D: boolean) {
    this.offset = is2D ? { x: 0, y: 0, z: 100 } : { x: 0, y: 10, z: 12 }
    this.maxOffset = is2D ? 0.6 : 0.4
  }

  /** Adds trauma (0..1 total). 0.2 is a bump, 0.5 a hit, 1 an explosion. */
  shake(amount: number): void {
    this.trauma = Math.min(1, Math.max(0, this.trauma + amount))
  }

  /** Jumps to the target (or `to`) next frame instead of easing there. */
  snap(to?: Partial<Vec>): void {
    if (to) Object.assign(this.focus, to)
    this.started = !!to
  }

  toJSON() {
    const { enabled, offset, smoothing, lookAt, bounds, zoom, trauma, focus } = this
    return { enabled, offset, smoothing, lookAt, bounds, zoom, trauma, focus }
  }

  restore(json: Partial<ReturnType<CameraRigState['toJSON']>>): void {
    Object.assign(this, structuredClone(json))
  }
}

export const CameraRig = resource((app: App) => new CameraRigState(app.config.mode === '2d')).named('CameraRig')

// Smooth deterministic noise in -1..1: a few sines with unrelated frequencies.
function noise(t: number, seed: number): number {
  return (Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.67 + seed * 2.9) * 0.2)
}

function clampTo(v: number, min: number | undefined, max: number | undefined): number {
  if (min !== undefined && v < min) v = min
  if (max !== undefined && v > max) v = max
  return v
}

const _look = new THREE.Vector3()

/**
 * Moves the Camera: eases `focus` toward the CameraTarget, places the camera at focus + offset,
 * aims it (3D), applies shake and zoom. Reads CameraShake events.
 */
export const CameraRigUpdate = system(
  { targets: [Transform, CameraTarget] },
  ({ targets }, { res, events, time }) => {
    const shakes = events.read(CameraShake)
    const rig = res.mut(CameraRig)
    for (const s of shakes) rig.shake(s.amount)
    if (!rig.enabled) return
    const target = targets.first()
    if (target !== undefined) {
      const t = target.get(Transform)!
      const b = rig.bounds
      const gx = b ? clampTo(t.x, b.minX, b.maxX) : t.x
      const gy = b ? clampTo(t.y, b.minY, b.maxY) : t.y
      const gz = b ? clampTo(t.z, b.minZ, b.maxZ) : t.z
      const k = !rig.started || rig.smoothing <= 0 ? 1 : 1 - Math.exp(-rig.smoothing * time.dt)
      rig.focus.x += (gx - rig.focus.x) * k
      rig.focus.y += (gy - rig.focus.y) * k
      rig.focus.z += (gz - rig.focus.z) * k
      rig.started = true
    }

    rig.t += time.dt
    rig.trauma = Math.max(0, rig.trauma - rig.decay * time.dt)
    const amount = rig.trauma * rig.trauma
    const ft = rig.t * rig.frequency
    const c = rig.current
    c.x = amount * rig.maxOffset * noise(ft, 1)
    c.y = amount * rig.maxOffset * noise(ft, 2)
    c.z = rig.is2D ? 0 : amount * rig.maxOffset * noise(ft, 3)
    c.roll = amount * rig.maxAngle * noise(ft, 4)

    const cam = res.mut(Camera)
    const f = rig.focus
    const o = rig.offset
    cam.position.set(f.x + o.x + c.x, f.y + o.y + c.y, f.z + o.z + c.z)
    if (rig.is2D) cam.rotation.set(0, 0, c.roll)
    else if (rig.lookAt) {
      cam.lookAt(_look.set(f.x + c.x, f.y + c.y, f.z + c.z))
      cam.rotateZ(c.roll)
    }
    if (cam.zoom !== rig.zoom) {
      cam.zoom = rig.zoom
      cam.updateProjectionMatrix()
    }
  },
  { name: 'CameraRigUpdate' },
)

const _delta = new THREE.Vector3()

/**
 * A camera that follows the entity tagged `CameraTarget`, with smoothing, bounds, zoom and trauma
 * shake (`events.emit(CameraShake, { amount })` or `res.mut(CameraRig).shake(0.5)`). 2D and 3D.
 * Needs RenderPlugin (CorePlugins) first.
 */
export const CameraPlugin = plugin((app) => {
  app.init(CameraRig, CameraShake)
  app.add(Update, CameraRigUpdate)
  if (!app.ext.renderOptions) return // no render plugin, nothing to interpolate
  /**
   * Gameplay moves in fixed steps and the render interpolates between them; this shifts the camera
   * by the target's interpolation offset just before drawing so the target doesn't jitter.
   */
  // The shift applied on `frame`; while paused, Render repeats without Update, so undo it first.
  const applied = { frame: -1, x: 0, y: 0, z: 0 }
  const CameraRigInterpolate = system(
    ({ res, time }) => {
      const cam = res.mut(Camera)
      if (applied.frame === time.frame) cam.position.sub(_delta.set(applied.x, applied.y, applied.z))
      applied.frame = -1
      const rig = res.get(CameraRig)
      if (!rig.enabled || !rig.started) return
      const target = app.world.queryFirst(Transform, CameraTarget, MeshRef)
      if (target === undefined || target.targetFor(ChildOf) !== undefined) return
      const obj = target.get(MeshRef) as THREE.Object3D | null
      const t = target.get(Transform)
      if (!obj || !t) return
      // The render places root objects at their interpolated position; Transform is the latest step.
      _delta.set(obj.position.x - t.x, obj.position.y - t.y, obj.position.z - t.z)
      cam.position.add(_delta)
      Object.assign(applied, { frame: time.frame, x: _delta.x, y: _delta.y, z: _delta.z })
    },
    { name: 'CameraRigInterpolate', unchecked: true },
  )
  app.add(Render, CameraRigInterpolate.after(RenderSync).before(Draw))
}, 'CameraPlugin')
