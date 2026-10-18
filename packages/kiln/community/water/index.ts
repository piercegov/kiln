// Animated water surface built with TSL (Three.js node shaders). Vendored by `kiln add water`.
import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { cos, mix, normalize, positionGeometry, sin, smoothstep, transformNormalToView, uniform, varying, vec3 } from 'three/tsl'
import { KilnError, MeshRef, Not, plugin, system, trait, Update } from 'kiln-ecs'

/**
 * A water plane: `commands.spawn(Transform({ y: 0.2 }), Water({ size: 60, waveHeight: 0.3 }))`.
 * `size` is the side length in world units, `segments` the grid resolution per side (rebuilt when
 * size or segments change), `color` the trough colour and `crestColor` the wave-top colour (hex).
 * `waveHeight` is the amplitude in world units and `waveSpeed` a time multiplier. Waves are
 * displaced on the GPU from simulated time, so the same tick always looks the same.
 */
export const Water = trait({
  size: 40,
  segments: 128,
  color: 0x1b5e8c,
  crestColor: 0x7fd4e8,
  waveHeight: 0.35,
  waveSpeed: 1,
  opacity: 0.9,
})

/** Uniforms one water mesh's shader reads; kept on `mesh.userData.water`. */
export interface WaterUniforms {
  time: { value: number }
  height: { value: number }
  speed: { value: number }
  color: { value: THREE.Color }
  crest: { value: THREE.Color }
}

/** Wave height at local (x, z) and time t, in world units. Matches the shader exactly. */
export function waterHeightAt(params: { waveHeight: number; waveSpeed: number }, x: number, z: number, t: number): number {
  const s = t * params.waveSpeed
  return params.waveHeight * (0.5 * Math.sin(x * K1 + s * 1.1) + 0.3 * Math.sin(z * K2 + s * 1.7) + 0.2 * Math.sin((x + z) * K3 + s * 0.6))
}

const K1 = 0.55
const K2 = 0.85
const K3 = 0.32

/** Builds the TSL material: vertex displacement, analytic normals, height-based colour. */
function makeMaterial(u: ReturnType<typeof makeUniforms>): MeshStandardNodeMaterial {
  const p = positionGeometry // undisplaced vertex position (the plane is pre-rotated into XZ)
  const s = u.time.mul(u.speed)
  const a1 = p.x.mul(K1).add(s.mul(1.1))
  const a2 = p.z.mul(K2).add(s.mul(1.7))
  const a3 = p.x.add(p.z).mul(K3).add(s.mul(0.6))
  const h = sin(a1).mul(0.5).add(sin(a2).mul(0.3)).add(sin(a3).mul(0.2)).mul(u.height)
  // Partial derivatives of h for the normal.
  const dhdx = cos(a1).mul(0.5 * K1).add(cos(a3).mul(0.2 * K3)).mul(u.height)
  const dhdz = cos(a2).mul(0.3 * K2).add(cos(a3).mul(0.2 * K3)).mul(u.height)
  const mat = new MeshStandardNodeMaterial({ roughness: 0.18, metalness: 0.05, transparent: true })
  mat.positionNode = vec3(p.x, p.y.add(h), p.z)
  mat.normalNode = normalize(varying(transformNormalToView(normalize(vec3(dhdx.negate(), 1, dhdz.negate())))))
  mat.colorNode = mix(u.color, u.crest, smoothstep(u.height.negate(), u.height, varying(h)))
  return mat
}

function makeUniforms() {
  return {
    time: uniform(0),
    height: uniform(0.35),
    speed: uniform(1),
    color: uniform(new THREE.Color()),
    crest: uniform(new THREE.Color()),
  }
}

function makeGeometry(size: number, segments: number): THREE.PlaneGeometry {
  if (!(segments >= 1 && segments <= 1024) || !(size > 0)) {
    throw new KilnError(
      'bad-water',
      `Water needs size > 0 and segments in 1..1024; got size ${size}, segments ${segments}. Fix the Water({ size, segments }) values.`,
    )
  }
  const g = new THREE.PlaneGeometry(size, size, Math.round(segments), Math.round(segments))
  g.rotateX(-Math.PI / 2)
  return g
}

/** Gives each new Water entity its mesh (via commands, so it lands at the end of Update). */
export const BuildWater = system([Water, Not(MeshRef)], ([w], { entity, commands }) => {
  const u = makeUniforms()
  const mesh = new THREE.Mesh(makeGeometry(w.size, w.segments), makeMaterial(u))
  mesh.name = 'water'
  mesh.userData.water = u
  mesh.userData.waterBuilt = { size: w.size, segments: w.segments }
  commands.add(entity, MeshRef(mesh))
})

/** Pushes Water params and simulated time into each water mesh's uniforms every frame. */
export const AnimateWater = system([Water, MeshRef], ([w, obj], { time }) => {
  const mesh = obj as THREE.Mesh | null
  const u = mesh?.userData.water as WaterUniforms | undefined
  if (!mesh || !u) return
  const built = mesh.userData.waterBuilt as { size: number; segments: number }
  if (built.size !== w.size || built.segments !== w.segments) {
    mesh.geometry.dispose()
    mesh.geometry = makeGeometry(w.size, w.segments)
    mesh.userData.waterBuilt = { size: w.size, segments: w.segments }
  }
  // The same time RenderSync interpolates to: deterministic, smooth between fixed steps.
  u.time.value = time.elapsed + (time.alpha - 1) * time.step
  u.height.value = w.waveHeight
  u.speed.value = w.waveSpeed
  u.color.value.setHex(w.color)
  u.crest.value.setHex(w.crestColor)
  const mat = mesh.material as THREE.Material
  mat.opacity = w.opacity
})

/** Water surfaces: `app.use(WaterPlugin)`, then spawn `Water` entities (with a Transform to place them). */
export const WaterPlugin = plugin((app) => {
  app.add(Update, BuildWater, AnimateWater)
}, 'WaterPlugin')
