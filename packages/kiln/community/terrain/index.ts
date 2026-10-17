// Procedural heightfield terrain from seeded value noise. Vendored by `kiln add terrain`.
import * as THREE from 'three'
import { KilnError, MeshRef, Not, plugin, system, trait, Update } from 'kiln'

/**
 * A square heightfield centred on the entity: `commands.spawn(Transform, Terrain({ size: 80, height: 6, seed: 7 }))`.
 * `resolution` is quads per side, `height` the peak height in world units, `seed` picks the
 * landscape, `scale` the feature size in world units, `colorLow`/`colorHigh` the vertex colours at
 * the lowest and highest points (hex). Changing any field rebuilds the mesh.
 */
export const Terrain = trait({
  size: 64,
  resolution: 96,
  height: 6,
  seed: 1,
  scale: 18,
  octaves: 4,
  colorLow: 0x3d6b35,
  colorHigh: 0xc9b98a,
})

/** The fields `terrainHeightAt` needs; a Terrain trait value works as-is. */
export interface TerrainParams {
  height: number
  seed: number
  scale?: number
  octaves?: number
}

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uz = fz * fz * (3 - 2 * fz)
  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz
}

/**
 * Terrain height at local (x, z), in world units from 0 to `params.height`. Pure and deterministic:
 * gameplay can call it headless to place things on the ground (add the terrain entity's Transform
 * if it isn't at the origin). The mesh uses exactly this function at each vertex, so between
 * vertices the rendered surface is the linear interpolation of it.
 */
export function terrainHeightAt(params: TerrainParams, x: number, z: number): number {
  const scale = params.scale ?? 18
  const octaves = Math.max(1, Math.min(8, Math.round(params.octaves ?? 4)))
  let amp = 1
  let freq = 1 / scale
  let sum = 0
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, z * freq, (params.seed | 0) + o * 1013)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  const n = sum / norm // 0..1, mostly 0.2..0.8
  // Spread the middle out and flatten the lows a little so valleys read as valleys.
  const t = Math.min(1, Math.max(0, (n - 0.2) / 0.6))
  return params.height * t * t * (3 - 2 * t)
}

type TerrainValue = { size: number; resolution: number; height: number; seed: number; scale: number; octaves: number; colorLow: number; colorHigh: number }

/** Builds the heightfield geometry with per-vertex colours and normals. */
export function buildTerrainGeometry(t: TerrainValue): THREE.BufferGeometry {
  const res = Math.round(t.resolution)
  if (!(res >= 1 && res <= 1024) || !(t.size > 0)) {
    throw new KilnError(
      'bad-terrain',
      `Terrain needs size > 0 and resolution in 1..1024; got size ${t.size}, resolution ${t.resolution}. Fix the Terrain({ size, resolution }) values.`,
    )
  }
  const g = new THREE.PlaneGeometry(t.size, t.size, res, res)
  g.rotateX(-Math.PI / 2)
  const pos = g.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const lo = new THREE.Color(t.colorLow)
  const hi = new THREE.Color(t.colorHigh)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const y = terrainHeightAt(t, pos.getX(i), pos.getZ(i))
    pos.setY(i, y)
    c.copy(lo).lerp(hi, t.height > 0 ? y / t.height : 0)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

const key = (t: TerrainValue) => `${t.size}|${t.resolution}|${t.height}|${t.seed}|${t.scale}|${t.octaves}|${t.colorLow}|${t.colorHigh}`

/** Gives each new Terrain entity its mesh. */
export const BuildTerrain = system([Terrain, Not(MeshRef)], ([t], { entity, commands }) => {
  const mesh = new THREE.Mesh(buildTerrainGeometry(t), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }))
  mesh.name = 'terrain'
  mesh.userData.terrainKey = key(t)
  commands.add(entity, MeshRef(mesh))
})

/** Rebuilds a terrain's geometry when its Terrain fields change. */
export const RebuildTerrain = system([Terrain, MeshRef], ([t, obj]) => {
  const mesh = obj as THREE.Mesh | null
  if (!mesh || mesh.userData.terrainKey === undefined) return
  const k = key(t)
  if (mesh.userData.terrainKey === k) return
  mesh.geometry.dispose()
  mesh.geometry = buildTerrainGeometry(t)
  mesh.userData.terrainKey = k
})

/** Procedural terrain: `app.use(TerrainPlugin)`, then spawn `Terrain` entities. */
export const TerrainPlugin = plugin((app) => {
  app.add(Update, BuildTerrain, RebuildTerrain)
}, 'TerrainPlugin')
