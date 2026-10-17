import { relation, trait } from './koota.ts'

/**
 * Position, rotation (quaternion) and scale, stored struct-of-arrays.
 * Gameplay writes Transform; the render plugin copies it to Three.js with interpolation.
 */
export const Transform = trait({
  x: 0,
  y: 0,
  z: 0,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 1,
  sx: 1,
  sy: 1,
  sz: 1,
})

/** Scene hierarchy. Survives snapshots, unlike Object3D.add. Despawning a parent despawns its children. */
export const ChildOf = relation({ exclusive: true, autoDestroy: 'orphan' })

type Rot = { qx: number; qy: number; qz: number; qw: number }

/** Sets a rotation from Euler angles in radians (XYZ order). */
export function setEuler(t: Rot, x: number, y: number, z: number): void {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2)
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2)
  t.qx = s1 * c2 * c3 + c1 * s2 * s3
  t.qy = c1 * s2 * c3 - s1 * c2 * s3
  t.qz = c1 * c2 * s3 + s1 * s2 * c3
  t.qw = c1 * c2 * c3 - s1 * s2 * s3
}

/** Rotation about the Y axis only (yaw), in radians. */
export function setYaw(t: Rot, angle: number): void {
  t.qx = 0
  t.qy = Math.sin(angle / 2)
  t.qz = 0
  t.qw = Math.cos(angle / 2)
}

/** Rotation about the Z axis only, the one rotation 2D mode uses. */
export function setAngle2D(t: Rot, angle: number): void {
  t.qx = 0
  t.qy = 0
  t.qz = Math.sin(angle / 2)
  t.qw = Math.cos(angle / 2)
}

/** Z-axis angle of a rotation, for 2D mode. */
export function angle2D(t: Readonly<Rot>): number {
  return 2 * Math.atan2(t.qz, t.qw)
}
