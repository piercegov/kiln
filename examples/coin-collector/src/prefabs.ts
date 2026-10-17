import * as THREE from 'three'
import { MeshRef, prefab, SharedMesh, Transform, type Commands, type RngState, type Vec3 } from 'kiln'
import { Bob, IsCoin, IsPlayer, Spin, Velocity } from './data.ts'

/** The arena floor, `size` units across, with a grid on top. */
export const Ground = prefab((p: { size: number }) => {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(p.size, p.size).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2b2f38 }))
  const grid = new THREE.GridHelper(p.size, p.size, 0x3d4350, 0x343944)
  grid.position.y = 0.01
  floor.add(grid)
  return [Transform, MeshRef(floor)]
})

const playerGeometry = new THREE.CapsuleGeometry(0.4, 0.6, 4, 12)

/** The player: a capsule standing on the ground at `at`. */
export const Player = prefab((p: { at: Vec3 }) => [
  Transform({ x: p.at.x, y: 0.7, z: p.at.z }),
  Velocity,
  IsPlayer,
  MeshRef(new THREE.Mesh(playerGeometry, new THREE.MeshStandardMaterial({ color: 0x4d96ff, roughness: 0.4 }))),
])

const coinGeometry = new THREE.CylinderGeometry(0.35, 0.35, 0.08, 24).rotateX(Math.PI / 2)
const coinMaterial = new THREE.MeshStandardMaterial({ color: 0xffd93d, metalness: 0.3, roughness: 0.35, emissive: 0x3a2a00 })

/** A spinning, bobbing coin at `at` (y is ignored). Geometry and material are shared. */
export const Coin = prefab((p: { at: Vec3; phase: number }) => [
  Transform({ x: p.at.x, y: 0.6, z: p.at.z }),
  IsCoin,
  Spin({ speed: 2.5 }),
  Bob({ baseY: 0.6, amplitude: 0.15, phase: p.phase }),
  MeshRef(new THREE.Mesh(coinGeometry, coinMaterial)),
  SharedMesh,
])

/**
 * Queues `count` coins on whole-unit grid points inside the arena, never on the centre tile.
 * Shared by SpawnLevel and NextWave; randomness comes from the seeded Rng.
 */
export function spawnCoins(commands: Commands, rng: RngState, halfSize: number, count: number): void {
  const taken = new Set<string>(['0,0'])
  const n = Math.floor(halfSize) - 1
  while (taken.size - 1 < count) {
    const x = rng.int(-n, n)
    const z = rng.int(-n, n)
    const key = `${x},${z}`
    if (taken.has(key)) continue
    taken.add(key)
    commands.spawn(Coin, { at: { x, y: 0, z }, phase: rng.float(0, Math.PI * 2) })
  }
}
