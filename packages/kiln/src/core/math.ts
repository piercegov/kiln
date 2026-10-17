/** Plain 3D vector shape used by prefab params and helpers. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

export const origin: Readonly<Vec3> = Object.freeze({ x: 0, y: 0, z: 0 })

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

/** Squared distance between two points; compare against radius² to avoid a sqrt. */
export function distSq(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

export function dist(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.sqrt(distSq(a, b))
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
